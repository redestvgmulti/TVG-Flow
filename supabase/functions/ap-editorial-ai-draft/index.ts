import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildCanonicalEditorialDraftPrompt,
  getEditorialContext,
} from "../_shared/editorialPromptBuilder.ts";
import { callLLM } from "../_shared/llmClient.ts";
import {
  EDITORIAL_AI_DRAFT_JSON_SCHEMA,
  parseEditorialAiDraft,
  providerFromBaseUrl,
  sanitizedAiErrorCode,
} from "../_shared/editorialAiDraftContract.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

function response(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function statusForCode(code: string) {
  if (code.includes("AUTH_REQUIRED") || code.includes("AUTH_INVALID")) return 401;
  if (code.includes("FORBIDDEN") || code.includes("DISABLED")) return 403;
  if (code.includes("NOT_FOUND") || code.includes("NOT_CAPTURED")) return 404;
  if (code.includes("IN_PROGRESS") || code.includes("CONFLICT") || code.includes("ALREADY")) return 409;
  return 400;
}

function rpcErrorCode(message: string) {
  return message.match(/(?:EDITORIAL_AI|ARTICLE)_[A-Z0-9_]+/)?.[0]
    || (message.includes("FORBIDDEN") ? "FORBIDDEN" : "EDITORIAL_AI_CLAIM_FAILED");
}

function apiKeyForProvider(provider: string) {
  if (provider === "anthropic") return Deno.env.get("ANTHROPIC_API_KEY") || "";
  if (provider === "google") return Deno.env.get("GEMINI_API_KEY") || "";
  if (provider === "openrouter") return Deno.env.get("OPENROUTER_API_KEY") || "";
  return Deno.env.get("OPENAI_API_KEY") || "";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return response(405, { error: "METHOD_NOT_ALLOWED" });

  const authorization = req.headers.get("Authorization");
  if (!authorization?.match(/^Bearer\s+.+$/i)) {
    return response(401, { error: "AUTH_REQUIRED" });
  }

  let articleId: string;
  let requestId: string;
  try {
    const payload = await req.json();
    articleId = typeof payload?.article_id === "string" ? payload.article_id : "";
    requestId = typeof payload?.request_id === "string" ? payload.request_id : "";
  } catch {
    return response(400, { error: "INVALID_PAYLOAD" });
  }
  if (!articleId || !requestId) return response(400, { error: "REQUEST_ID_REQUIRED" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: { headers: { Authorization: authorization } },
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
  const adminClient = createClient(
    supabaseUrl,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user?.id) return response(401, { error: "AUTH_INVALID" });

  const { data: claimRows, error: claimError } = await userClient.schema("ap").rpc(
    "claim_editorial_ai_draft",
    { p_article_id: articleId, p_request_id: requestId },
  );
  if (claimError) {
    const code = rpcErrorCode(claimError.message || "EDITORIAL_AI_CLAIM_FAILED");
    return response(statusForCode(code), { error: code });
  }
  const claim = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (!claim) return response(404, { error: "EDITORIAL_AI_CLAIM_NOT_FOUND" });
  if (claim.reused && claim.result) {
    return response(200, {
      success: true,
      reused: true,
      article_id: articleId,
      request_id: requestId,
      draft: claim.result,
    });
  }

  const startedAt = Date.now();
  let provider = "unknown";
  let model = "unknown";
  let reservedTokens = 0;
  let chargedTokens = 0;

  const failRun = async (error: unknown) => {
    const errorCode = sanitizedAiErrorCode(error);
    await adminClient.schema("ap").rpc("fail_editorial_ai_draft", {
      p_run_id: claim.run_id,
      p_error_code: errorCode,
      p_provider: provider,
      p_model: model,
      p_duration_ms: Date.now() - startedAt,
    });
    if (reservedTokens > chargedTokens) {
      await adminClient.schema("ap").rpc("refund_editorial_tokens", {
        p_cliente_id: claim.cliente_id,
        p_tokens_to_refund: reservedTokens - chargedTokens,
      });
    }
    return errorCode;
  };

  try {
    const context = await getEditorialContext(adminClient, claim.cliente_id, claim.source_body);
    if (!context?.settings) throw new Error("EDITORIAL_AI_SETTINGS_NOT_CONFIGURED");

    const baseUrl = context.settings.api_base_url || "https://api.openai.com/v1";
    provider = providerFromBaseUrl(baseUrl);
    model = context.settings.model_primary || "gpt-4o-mini";
    const fallbackModel = context.settings.model_fallback || model;

    let apiKey = "";
    if (context.settings.vault_secret_id) {
      const { data: secret, error: secretError } = await adminClient.rpc("get_decrypted_secret", {
        secret_id: context.settings.vault_secret_id,
      });
      if (secretError) throw new Error("EDITORIAL_AI_SECRET_UNAVAILABLE");
      apiKey = typeof secret === "string" ? secret : "";
    }
    if (!apiKey) apiKey = apiKeyForProvider(provider);
    if (!apiKey) throw new Error("EDITORIAL_AI_SECRET_UNAVAILABLE");

    const prompt = buildCanonicalEditorialDraftPrompt({
      source: {
        type: claim.source_type,
        title: claim.source_title,
        body: claim.source_body,
        url: claim.source_url,
      },
      settings: context.settings,
      promptVersion: context.promptVersion,
      humanization: context.humanization,
      rules: context.rules,
    });

    const maxTokens = Math.min(Math.max(Number(context.settings.max_tokens) || 1200, 800), 2000);
    const estimatedInputTokens = Math.ceil(prompt.length / 3);
    const requestedReservation = maxTokens + estimatedInputTokens;
    const { data: reserved, error: reserveError } = await adminClient.schema("ap").rpc("reserve_editorial_tokens", {
      p_cliente_id: claim.cliente_id,
      p_tokens: requestedReservation,
    });
    if (reserveError || !reserved) throw new Error("EDITORIAL_AI_TOKEN_LIMIT_REACHED");
    reservedTokens = requestedReservation;

    let llmResult;
    try {
      llmResult = await callLLM({
        apiKey,
        baseUrl,
        model,
        prompt,
        temperature: context.settings.temperature ?? 0.7,
        maxTokens,
        timeoutMs: 30000,
        jsonSchema: EDITORIAL_AI_DRAFT_JSON_SCHEMA,
      });
    } catch (primaryError) {
      if (!fallbackModel || fallbackModel === model) throw primaryError;
      model = fallbackModel;
      llmResult = await callLLM({
        apiKey,
        baseUrl,
        model,
        prompt,
        temperature: context.settings.temperature ?? 0.7,
        maxTokens,
        timeoutMs: 30000,
        jsonSchema: EDITORIAL_AI_DRAFT_JSON_SCHEMA,
      });
    }

    chargedTokens = Math.max(Number(llmResult.tokens.total) || 0, 0);
    const draft = parseEditorialAiDraft(llmResult.content);

    if (reservedTokens > chargedTokens) {
      await adminClient.schema("ap").rpc("refund_editorial_tokens", {
        p_cliente_id: claim.cliente_id,
        p_tokens_to_refund: reservedTokens - chargedTokens,
      });
      reservedTokens = chargedTokens;
    }

    const { data: completionRows, error: completionError } = await adminClient.schema("ap").rpc(
      "complete_editorial_ai_draft",
      {
        p_run_id: claim.run_id,
        p_draft: draft,
        p_provider: provider,
        p_model: model,
        p_input_tokens: llmResult.tokens.prompt,
        p_output_tokens: llmResult.tokens.completion,
        p_duration_ms: Date.now() - startedAt,
      },
    );
    if (completionError) throw new Error(completionError.message || "EDITORIAL_AI_COMPLETE_FAILED");
    const completion = Array.isArray(completionRows) ? completionRows[0] : completionRows;
    if (!completion?.applied) {
      return response(409, { error: completion?.error_code || "EDITORIAL_AI_REVISION_CONFLICT" });
    }

    console.log(JSON.stringify({
      event: "EDITORIAL_AI_DRAFT_SUCCEEDED",
      article_id: articleId,
      request_id: requestId,
      provider,
      model,
      duration_ms: Date.now() - startedAt,
    }));
    return response(200, {
      success: true,
      reused: false,
      article_id: articleId,
      request_id: requestId,
      revision_number: completion.revision_number,
      draft: completion.result,
      provider,
      model,
    });
  } catch (error) {
    const errorCode = await failRun(error);
    console.error(JSON.stringify({
      event: "EDITORIAL_AI_DRAFT_FAILED",
      article_id: articleId,
      request_id: requestId,
      provider,
      model,
      error_code: errorCode,
      duration_ms: Date.now() - startedAt,
    }));
    return response(errorCode.includes("TIMEOUT") ? 504 : 502, { error: errorCode });
  }
});
