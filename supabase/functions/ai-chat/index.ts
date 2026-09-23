import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizePrivateChat, ChatAuthorizationError } from "../_shared/chatAuth.mjs";
import {
  boundedChatHistory,
  ChatPayloadError,
  parseChatBody,
  parseChatOperation,
  sha256Hex,
} from "../_shared/chatRequest.mjs";
import {
  buildEditorialActionHistory,
  EditorialActionError,
} from "../_shared/chatEditorialActions.mjs";
import {
  buildChatEditorialInstructions,
  EditorialConfigurationError,
  getRequiredEditorialContext,
} from "../_shared/editorialPolicy.ts";
import {
  estimateOpenAICost,
  OPENAI_PRICING_VERSION,
  requirePricedOpenAIModel,
} from "../_shared/openaiPricing.mjs";
import {
  callOpenAIResponses,
  OpenAIProviderError,
  sanitizeProviderErrorCode,
} from "../_shared/openaiResponsesClient.mjs";
import { extractPublicArticle } from "../_shared/linkArticleExtractor.ts";
import { SafeLinkFetchError } from "../_shared/safeLinkFetcher.mjs";
import { signImageAsset } from "../_shared/chatImageAssets.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class ChatRequestError extends Error {
  code: string;
  status: number;

  constructor(code: string, status = 400) {
    super(code);
    this.name = "ChatRequestError";
    this.code = code;
    this.status = status;
  }
}

function statusForLinkError(error: SafeLinkFetchError) {
  switch (error.code) {
    case "INVALID_URL":
    case "UNSUPPORTED_PROTOCOL":
    case "PRIVATE_DESTINATION":
    case "INVALID_REDIRECT":
      return 400;
    case "REQUEST_TIMEOUT":
      return 408;
    case "RESPONSE_TOO_LARGE":
      return 413;
    case "UNSUPPORTED_CONTENT_TYPE":
      return 415;
    default:
      return 502;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);

  let runId: string | null = null;
  let sbAdmin: any = null;
  const startedAt = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRole) {
      throw new ChatRequestError("CHAT_BACKEND_NOT_CONFIGURED", 500);
    }

    const authorization = await authorizePrivateChat({
      authorization: req.headers.get("Authorization"),
      createUserClient: (token: string) => createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }),
    });
    const requestBody = await req.json() as Record<string, unknown>;
    const operation = parseChatOperation(requestBody);

    sbAdmin = createClient<any, any>(supabaseUrl, supabaseServiceRole, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    if (operation === "list_conversations") {
      const { data, error } = await sbAdmin.schema("ap").from("ai_conversations")
        .select("id, title, created_at, updated_at")
        .eq("cliente_id", authorization.clienteId)
        .eq("user_id", authorization.userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(100);
      if (error) throw new ChatRequestError("CHAT_CONVERSATIONS_UNAVAILABLE", 500);
      return jsonResponse({ conversations: data ?? [] });
    }

    if (operation === "create_conversation") {
      const conversationId = crypto.randomUUID();
      const { data, error } = await sbAdmin.schema("ap").rpc("create_ai_conversation", {
        p_conversation_id: conversationId,
        p_cliente_id: authorization.clienteId,
        p_user_id: authorization.userId,
      });
      if (error || !data?.id) throw new ChatRequestError("CHAT_CONVERSATION_CREATE_FAILED", 500);
      return jsonResponse({ conversation: data }, 201);
    }

    const conversationId = typeof requestBody.conversation_id === "string"
      ? requestBody.conversation_id
      : null;

    if (operation === "get_conversation") {
      const { data: conversation, error: conversationError } = await sbAdmin.schema("ap").from("ai_conversations")
        .select("id, title, created_at, updated_at")
        .eq("id", conversationId)
        .eq("cliente_id", authorization.clienteId)
        .eq("user_id", authorization.userId)
        .is("archived_at", null)
        .maybeSingle();
      if (conversationError) throw new ChatRequestError("CHAT_CONVERSATION_UNAVAILABLE", 500);
      if (!conversation) throw new ChatRequestError("CHAT_CONVERSATION_NOT_FOUND", 404);

      const { data: messages, error: messagesError } = await sbAdmin.schema("ap").from("ai_messages")
        .select("id, role, content, status, ai_run_id, sequence_no, created_at")
        .eq("conversation_id", conversationId)
        .eq("cliente_id", authorization.clienteId)
        .eq("user_id", authorization.userId)
        .eq("status", "completed")
        .order("sequence_no", { ascending: true })
        .limit(1000);
      if (messagesError) throw new ChatRequestError("CHAT_HISTORY_UNAVAILABLE", 500);
      const runIds = [...new Set((messages ?? []).map((message: any) => message.ai_run_id).filter(Boolean))];
      let operationsByRun = new Map<string, string>();
      let assetsByRun = new Map<string, any[]>();
      if (runIds.length) {
        const [runsResult, assetsResult] = await Promise.all([
          sbAdmin.schema("ap").from("ai_runs")
            .select("id, operation")
            .in("id", runIds)
            .eq("conversation_id", conversationId)
            .eq("cliente_id", authorization.clienteId)
            .eq("user_id", authorization.userId),
          sbAdmin.schema("ap").from("ai_image_assets")
            .select("id, ai_run_id, kind, storage_path, mime_type, file_extension, byte_size, width, height")
            .in("ai_run_id", runIds)
            .eq("conversation_id", conversationId)
            .eq("cliente_id", authorization.clienteId)
            .eq("user_id", authorization.userId),
        ]);
        const { data: runs, error: runsError } = runsResult;
        const { data: assets, error: assetsError } = assetsResult;
        if (runsError || assetsError) throw new ChatRequestError("CHAT_HISTORY_UNAVAILABLE", 500);
        operationsByRun = new Map((runs ?? []).map((run: any) => [run.id, run.operation]));
        const signedAssets = await Promise.all((assets ?? []).map(async (asset: any) => ({
          aiRunId: asset.ai_run_id,
          signed: await signImageAsset(sbAdmin.storage, asset),
        })));
        for (const asset of signedAssets) {
          const current = assetsByRun.get(asset.aiRunId) ?? [];
          current.push(asset.signed);
          assetsByRun.set(asset.aiRunId, current);
        }
      }
      return jsonResponse({
        conversation,
        messages: (messages ?? []).map((message: any) => {
          const operation = operationsByRun.get(message.ai_run_id) ?? "chat";
          const runAssets = assetsByRun.get(message.ai_run_id) ?? [];
          return {
            ...message,
            operation,
            attachments: operation === "image_edit"
              ? runAssets.filter((asset) => message.role === "assistant" || asset.kind === "original")
              : [],
          };
        }),
      });
    }

    if (operation === "archive_conversation") {
      const { data, error } = await sbAdmin.schema("ap").rpc("archive_ai_conversation", {
        p_conversation_id: conversationId,
        p_cliente_id: authorization.clienteId,
        p_user_id: authorization.userId,
      });
      if (error) throw new ChatRequestError("CHAT_CONVERSATION_ARCHIVE_FAILED", 500);
      if (data !== true) throw new ChatRequestError("CHAT_CONVERSATION_NOT_FOUND", 404);
      return jsonResponse({ archived: true, conversation_id: conversationId });
    }

    const payload = parseChatBody(requestBody);

    const requestedModel = requirePricedOpenAIModel(Deno.env.get("OPENAI_CHAT_MODEL"));
    const maxOutputTokensRaw = Number(Deno.env.get("OPENAI_CHAT_MAX_OUTPUT_TOKENS") ?? "2000");
    if (!Number.isInteger(maxOutputTokensRaw) || maxOutputTokensRaw < 1 || maxOutputTokensRaw > 16000) {
      throw new ChatRequestError("OPENAI_CHAT_MAX_OUTPUT_TOKENS_INVALID", 500);
    }

    const editorialContext = await getRequiredEditorialContext(sbAdmin, authorization.clienteId);
    const instructions = buildChatEditorialInstructions(editorialContext, payload.operation);
    const promptHash = await sha256Hex(instructions);

    const { data: claim, error: claimError } = await sbAdmin.schema("ap").rpc("claim_ai_chat_run", {
      p_request_id: payload.requestId,
      p_operation: payload.operation,
      p_cliente_id: authorization.clienteId,
      p_user_id: authorization.userId,
      p_conversation_id: payload.conversationId,
      p_title: payload.title,
      p_content: payload.message,
      p_requested_model: requestedModel,
      p_prompt_version_id: editorialContext.promptVersionId,
      p_prompt_hash: promptHash,
      p_pricing_version: OPENAI_PRICING_VERSION,
    });
    if (claimError || !claim?.run_id || !claim?.conversation_id) {
      throw new ChatRequestError(sanitizeProviderErrorCode(claimError?.message || "CHAT_RUN_CLAIM_FAILED"), 409);
    }
    runId = claim.run_id;

    if (claim.claimed !== true) {
      if (claim.status !== "completed") {
        throw new ChatRequestError("CHAT_REQUEST_IN_PROGRESS", 409);
      }
      const { data: replay, error: replayError } = await sbAdmin.schema("ap").from("ai_messages")
        .select("id, content")
        .eq("ai_run_id", runId)
        .eq("conversation_id", claim.conversation_id)
        .eq("cliente_id", authorization.clienteId)
        .eq("user_id", authorization.userId)
        .eq("role", "assistant")
        .eq("status", "completed")
        .maybeSingle();
      if (replayError || !replay) throw new ChatRequestError("CHAT_COMPLETED_MESSAGE_NOT_FOUND", 500);
      return jsonResponse({
        conversation_id: claim.conversation_id,
        message_id: replay.id,
        run_id: runId,
        content: replay.content,
        replayed: true,
      });
    }

    const { data: historyRows, error: historyError } = await sbAdmin.schema("ap").from("ai_messages")
      .select("role, content, sequence_no")
      .eq("conversation_id", claim.conversation_id)
      .eq("cliente_id", authorization.clienteId)
      .eq("user_id", authorization.userId)
      .eq("status", "completed")
      .order("sequence_no", { ascending: false })
      .limit(40);
    if (historyError || !historyRows?.length) throw new ChatRequestError("CHAT_HISTORY_UNAVAILABLE", 500);
    const history = boundedChatHistory(historyRows);
    const extractedArticle = payload.operation === "generate_from_link"
      ? await extractPublicArticle(payload.message)
      : null;
    const providerHistory = buildEditorialActionHistory(history, payload.operation, extractedArticle);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let providerResult;
    try {
      providerResult = await callOpenAIResponses({
        apiKey: openaiApiKey,
        model: requestedModel,
        instructions,
        history: providerHistory,
        maxOutputTokens: maxOutputTokensRaw,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const costEstimate = estimateOpenAICost({
      model: requestedModel,
      inputTokens: providerResult.inputTokens,
      cachedInputTokens: providerResult.cachedInputTokens,
      outputTokens: providerResult.outputTokens,
    });
    const latencyMs = Date.now() - startedAt;

    const { data: completed, error: completeError } = await sbAdmin.schema("ap").rpc("complete_ai_chat_run", {
      p_run_id: runId,
      p_content: providerResult.content,
      p_actual_model: providerResult.actualModel,
      p_provider_request_id: providerResult.providerRequestId,
      p_input_tokens: providerResult.inputTokens,
      p_cached_input_tokens: providerResult.cachedInputTokens,
      p_output_tokens: providerResult.outputTokens,
      p_cost_estimate: costEstimate,
      p_currency: "USD",
      p_latency_ms: latencyMs,
    });
    if (completeError || !completed?.message_id) {
      throw new ChatRequestError("CHAT_COMPLETION_PERSIST_FAILED", 500);
    }

    return jsonResponse({
      conversation_id: claim.conversation_id,
      message_id: completed.message_id,
      run_id: runId,
      content: completed.content,
      model: providerResult.actualModel,
      usage: {
        input_tokens: providerResult.inputTokens,
        cached_input_tokens: providerResult.cachedInputTokens,
        output_tokens: providerResult.outputTokens,
      },
      source: extractedArticle ? {
        title: extractedArticle.title,
        image_url: extractedArticle.imageUrl,
        final_url: extractedArticle.finalUrl,
      } : undefined,
      replayed: false,
    });
  } catch (error) {
    const status = error instanceof SafeLinkFetchError
      ? statusForLinkError(error)
      : error instanceof ChatAuthorizationError || error instanceof ChatPayloadError || error instanceof ChatRequestError || error instanceof OpenAIProviderError || error instanceof EditorialActionError
      ? error.status
      : error instanceof EditorialConfigurationError
      ? 409
      : 500;
    const code = error instanceof ChatAuthorizationError || error instanceof ChatPayloadError || error instanceof ChatRequestError || error instanceof OpenAIProviderError || error instanceof EditorialConfigurationError || error instanceof EditorialActionError || error instanceof SafeLinkFetchError
      ? error.code
      : "CHAT_INTERNAL_ERROR";

    if (runId && sbAdmin && code !== "CHAT_REQUEST_IN_PROGRESS") {
      await sbAdmin.schema("ap").rpc("fail_ai_chat_run", {
        p_run_id: runId,
        p_error_code: sanitizeProviderErrorCode(code),
        p_latency_ms: Date.now() - startedAt,
      });
    }
    console.error("[ai-chat] request failed", { runId, code, status });
    return jsonResponse({ error: code }, status);
  }
});
