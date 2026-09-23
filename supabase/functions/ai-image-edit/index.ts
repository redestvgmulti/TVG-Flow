import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authorizePrivateChat, ChatAuthorizationError, UUID_PATTERN } from "../_shared/chatAuth.mjs";
import { sha256Hex } from "../_shared/chatRequest.mjs";
import { getRequiredEditorialContext, EditorialConfigurationError } from "../_shared/editorialPolicy.ts";
import {
  CHAT_IMAGE_MAX_BYTES,
  ImageValidationError,
  sha256Bytes,
  validateImageBytes,
} from "../_shared/imageValidation.mjs";
import {
  buildImageStoragePath,
  CHAT_IMAGE_BUCKET,
  signImageAsset,
} from "../_shared/chatImageAssets.mjs";
import {
  buildSafeImageEditPrompt,
  callOpenAIImageEdit,
  estimateOpenAIImageCost,
  OPENAI_IMAGE_PRICING_VERSION,
  OpenAIImageError,
  requireOpenAIImageModel,
} from "../_shared/openaiImageClient.mjs";
import { sanitizeProviderErrorCode } from "../_shared/openaiResponsesClient.mjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class ImageRequestError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.name = "ImageRequestError";
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function ownedAssets(sbAdmin: any, runId: string, clienteId: string, userId: string) {
  const { data, error } = await sbAdmin.schema("ap").from("ai_image_assets")
    .select("id, kind, storage_path, mime_type, file_extension, byte_size, width, height")
    .eq("ai_run_id", runId)
    .eq("cliente_id", clienteId)
    .eq("user_id", userId)
    .order("kind", { ascending: true });
  if (error) throw new ImageRequestError("IMAGE_ASSETS_UNAVAILABLE", 500);
  return data ?? [];
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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) throw new ImageRequestError("IMAGE_BACKEND_NOT_CONFIGURED", 500);

    const authorization = await authorizePrivateChat({
      authorization: req.headers.get("Authorization"),
      createUserClient: (token: string) => createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }),
    });

    if (!req.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
      throw new ImageRequestError("IMAGE_MULTIPART_REQUIRED", 415);
    }
    const form = await req.formData();
    if (form.get("operation") !== "image_edit") throw new ImageRequestError("CHAT_OPERATION_UNSUPPORTED");
    const requestId = form.get("request_id");
    const conversationId = form.get("conversation_id");
    const instruction = form.get("instruction");
    const acknowledged = form.get("journalistic_integrity_acknowledged");
    const image = form.get("image");
    if (typeof requestId !== "string" || !UUID_PATTERN.test(requestId)) throw new ImageRequestError("CHAT_REQUEST_ID_INVALID");
    if (typeof conversationId !== "string" || !UUID_PATTERN.test(conversationId)) throw new ImageRequestError("CHAT_CONVERSATION_ID_INVALID");
    if (typeof instruction !== "string") throw new ImageRequestError("IMAGE_INSTRUCTION_INVALID");
    if (acknowledged !== "true") throw new ImageRequestError("IMAGE_JOURNALISTIC_WARNING_REQUIRED", 409);
    if (!(image instanceof File)) throw new ImageRequestError("IMAGE_FILE_REQUIRED");

    const originalBytes = new Uint8Array(await image.arrayBuffer());
    const originalInfo = validateImageBytes({
      bytes: originalBytes,
      declaredMime: image.type,
      fileName: image.name,
      maximumBytes: CHAT_IMAGE_MAX_BYTES,
    });
    const originalHash = await sha256Bytes(originalBytes);
    const model = requireOpenAIImageModel(Deno.env.get("OPENAI_IMAGE_MODEL"));
    const providerPrompt = buildSafeImageEditPrompt(instruction);
    const promptHash = await sha256Hex(`${providerPrompt}\nORIGINAL_SHA256:${originalHash}`);

    sbAdmin = createClient<any, any>(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const editorial = await getRequiredEditorialContext(sbAdmin, authorization.clienteId);
    const userMessage = JSON.stringify({
      type: "image_edit",
      text: instruction.trim(),
      journalistic_warning_acknowledged: true,
    });
    const { data: claim, error: claimError } = await sbAdmin.schema("ap").rpc("claim_ai_image_run", {
      p_request_id: requestId,
      p_cliente_id: authorization.clienteId,
      p_user_id: authorization.userId,
      p_conversation_id: conversationId,
      p_title: "Tratamento de imagem",
      p_content: userMessage,
      p_requested_model: model,
      p_prompt_version_id: editorial.promptVersionId,
      p_prompt_hash: promptHash,
      p_pricing_version: OPENAI_IMAGE_PRICING_VERSION,
    });
    if (claimError || !claim?.run_id || !claim?.conversation_id) {
      throw new ImageRequestError(sanitizeProviderErrorCode(claimError?.message || "IMAGE_RUN_CLAIM_FAILED"), 409);
    }
    const claimedRunId = String(claim.run_id);
    runId = claimedRunId;

    if (claim.claimed !== true) {
      if (claim.status !== "completed") throw new ImageRequestError("CHAT_REQUEST_IN_PROGRESS", 409);
      const assets = await ownedAssets(sbAdmin, claimedRunId, authorization.clienteId, authorization.userId);
      const signedAssets = await Promise.all(assets.map((asset: any) => signImageAsset(sbAdmin.storage, asset)));
      return jsonResponse({ conversation_id: claim.conversation_id, run_id: claimedRunId, attachments: signedAssets, replayed: true });
    }

    const originalAssetId = crypto.randomUUID();
    const originalPath = buildImageStoragePath({
      clienteId: authorization.clienteId,
      userId: authorization.userId,
      conversationId: claim.conversation_id,
      runId: claimedRunId,
      kind: "original",
      assetId: originalAssetId,
      extension: originalInfo.extension,
    });
    const { data: existingOriginal, error: existingOriginalError } = await sbAdmin.schema("ap").from("ai_image_assets")
      .select("id, content_sha256, storage_path")
      .eq("ai_run_id", claimedRunId)
      .eq("cliente_id", authorization.clienteId)
      .eq("user_id", authorization.userId)
      .eq("kind", "original")
      .maybeSingle();
    if (existingOriginalError) throw new ImageRequestError("IMAGE_ASSETS_UNAVAILABLE", 500);

    if (existingOriginal) {
      if (existingOriginal.content_sha256 !== originalHash || existingOriginal.storage_path !== originalPath) {
        throw new ImageRequestError("IMAGE_RETRY_CONTEXT_CHANGED", 409);
      }
    } else {
      const { error: uploadError } = await sbAdmin.storage.from(CHAT_IMAGE_BUCKET).upload(originalPath, originalBytes, {
        contentType: originalInfo.mimeType,
        cacheControl: "300",
        upsert: false,
      });
      if (uploadError) throw new ImageRequestError("IMAGE_ORIGINAL_UPLOAD_FAILED", 500);
      const { error: registerError } = await sbAdmin.schema("ap").rpc("register_ai_image_original", {
        p_run_id: claimedRunId,
        p_asset_id: originalAssetId,
        p_cliente_id: authorization.clienteId,
        p_user_id: authorization.userId,
        p_storage_path: originalPath,
        p_mime_type: originalInfo.mimeType,
        p_file_extension: originalInfo.extension,
        p_byte_size: originalInfo.byteSize,
        p_width: originalInfo.width,
        p_height: originalInfo.height,
        p_content_sha256: originalHash,
      });
      if (registerError) {
        await sbAdmin.storage.from(CHAT_IMAGE_BUCKET).remove([originalPath]);
        throw new ImageRequestError("IMAGE_ORIGINAL_REGISTER_FAILED", 500);
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    let providerResult;
    try {
      providerResult = await callOpenAIImageEdit({
        apiKey: openaiApiKey,
        model,
        imageBytes: originalBytes,
        imageMimeType: originalInfo.mimeType,
        imageFileName: `original.${originalInfo.extension}`,
        prompt: providerPrompt,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const resultInfo = validateImageBytes({
      bytes: providerResult.bytes,
      declaredMime: providerResult.mimeType,
      fileName: `result.${providerResult.extension}`,
      maximumBytes: 15 * 1024 * 1024,
    });
    const resultHash = await sha256Bytes(providerResult.bytes);
    const resultAssetId = crypto.randomUUID();
    const resultPath = buildImageStoragePath({
      clienteId: authorization.clienteId,
      userId: authorization.userId,
      conversationId: claim.conversation_id,
      runId: claimedRunId,
      kind: "result",
      assetId: resultAssetId,
      extension: "png",
    });
    const { error: resultUploadError } = await sbAdmin.storage.from(CHAT_IMAGE_BUCKET).upload(resultPath, providerResult.bytes, {
      contentType: "image/png",
      cacheControl: "300",
      upsert: false,
    });
    if (resultUploadError) throw new ImageRequestError("IMAGE_RESULT_UPLOAD_FAILED", 500);

    const costEstimate = estimateOpenAIImageCost(providerResult);
    const { data: completed, error: completeError } = await sbAdmin.schema("ap").rpc("complete_ai_image_run", {
      p_run_id: claimedRunId,
      p_asset_id: resultAssetId,
      p_storage_path: resultPath,
      p_mime_type: resultInfo.mimeType,
      p_file_extension: resultInfo.extension,
      p_byte_size: resultInfo.byteSize,
      p_width: resultInfo.width,
      p_height: resultInfo.height,
      p_content_sha256: resultHash,
      p_content: JSON.stringify({ type: "image_edit_result", text: "Imagem tratada pronta para revisão e download." }),
      p_actual_model: providerResult.actualModel,
      p_provider_request_id: providerResult.providerRequestId,
      p_input_tokens: providerResult.inputTokens,
      p_input_text_tokens: providerResult.inputTextTokens,
      p_input_image_tokens: providerResult.inputImageTokens,
      p_output_tokens: providerResult.outputTokens,
      p_output_image_tokens: providerResult.outputImageTokens,
      p_cost_estimate: costEstimate,
      p_latency_ms: Date.now() - startedAt,
    });
    if (completeError || !completed?.message_id) {
      await sbAdmin.storage.from(CHAT_IMAGE_BUCKET).remove([resultPath]);
      throw new ImageRequestError("IMAGE_COMPLETION_PERSIST_FAILED", 500);
    }

    const assets = await ownedAssets(sbAdmin, claimedRunId, authorization.clienteId, authorization.userId);
    const signedAssets = await Promise.all(assets.map((asset: any) => signImageAsset(sbAdmin.storage, asset)));
    return jsonResponse({
      conversation_id: claim.conversation_id,
      message_id: completed.message_id,
      run_id: claimedRunId,
      attachments: signedAssets,
      model: providerResult.actualModel,
      usage: {
        input_tokens: providerResult.inputTokens,
        input_text_tokens: providerResult.inputTextTokens,
        input_image_tokens: providerResult.inputImageTokens,
        output_image_tokens: providerResult.outputImageTokens,
      },
      replayed: false,
    });
  } catch (error) {
    const status = error instanceof ChatAuthorizationError || error instanceof ImageRequestError || error instanceof ImageValidationError || error instanceof OpenAIImageError
      ? error.status
      : error instanceof EditorialConfigurationError
      ? 409
      : 500;
    const code = error instanceof ChatAuthorizationError || error instanceof ImageRequestError || error instanceof ImageValidationError || error instanceof OpenAIImageError || error instanceof EditorialConfigurationError
      ? error.code
      : "IMAGE_INTERNAL_ERROR";
    if (runId && sbAdmin && code !== "CHAT_REQUEST_IN_PROGRESS") {
      await sbAdmin.schema("ap").rpc("fail_ai_chat_run", {
        p_run_id: runId,
        p_error_code: sanitizeProviderErrorCode(code),
        p_latency_ms: Date.now() - startedAt,
      });
    }
    console.error("[ai-image-edit] request failed", { runId, code, status });
    return jsonResponse({ error: code }, status);
  }
});
