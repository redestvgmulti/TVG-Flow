import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CHAT_IMAGE_MAX_BYTES,
  ImageValidationError,
  validateImageBytes,
} from "../supabase/functions/_shared/imageValidation.mjs";
import {
  buildImageStoragePath,
  CHAT_IMAGE_BUCKET,
  signImageAsset,
} from "../supabase/functions/_shared/chatImageAssets.mjs";
import {
  buildSafeImageEditPrompt,
  callOpenAIImageEdit,
  estimateOpenAIImageCost,
  OPENAI_IMAGE_EDIT_URL,
  OPENAI_IMAGE_PRICING_VERSION,
} from "../supabase/functions/_shared/openaiImageClient.mjs";
import {
  parseImageChatContent,
  validateChatImageDimensions,
  validateChatImageFile,
} from "../src/utils/chatImageFiles.js";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const ids = {
  tenant: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  conversation: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  run: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  asset: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
};

function fakePng(width = 512, height = 512, size = 128) {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.set([73, 72, 68, 82], 12);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

test("server validates image signature, MIME, extension, size and dimensions", () => {
  const valid = validateImageBytes({ bytes: fakePng(), declaredMime: "image/png", fileName: "foto.png" });
  assert.deepEqual(valid, { mimeType: "image/png", extension: "png", width: 512, height: 512, byteSize: 128 });
  assert.throws(
    () => validateImageBytes({ bytes: fakePng(), declaredMime: "image/jpeg", fileName: "foto.jpg" }),
    (error) => error instanceof ImageValidationError && error.code === "IMAGE_TYPE_MISMATCH",
  );
  assert.throws(
    () => validateImageBytes({ bytes: new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1), declaredMime: "image/png", fileName: "foto.png" }),
    (error) => error.code === "IMAGE_FILE_TOO_LARGE" && error.status === 413,
  );
  assert.throws(
    () => validateImageBytes({ bytes: fakePng(9000, 512), declaredMime: "image/png", fileName: "foto.png" }),
    (error) => error.code === "IMAGE_DIMENSIONS_INVALID",
  );
});

test("client blocks obvious invalid files before upload", () => {
  assert.equal(validateChatImageFile({ name: "foto.exe", type: "application/octet-stream", size: 100 }), "IMAGE_FORMAT_UNSUPPORTED");
  assert.equal(validateChatImageFile({ name: "foto.jpg", type: "image/png", size: 100 }), "IMAGE_TYPE_MISMATCH");
  assert.equal(validateChatImageFile({ name: "foto.png", type: "image/png", size: CHAT_IMAGE_MAX_BYTES + 1 }), "IMAGE_FILE_TOO_LARGE");
  assert.equal(validateChatImageFile({ name: "foto.png", type: "image/png", size: 100 }), null);
  assert.equal(validateChatImageDimensions(512, 512), null);
  assert.equal(validateChatImageDimensions(9000, 512), "IMAGE_DIMENSIONS_INVALID");
});

test("original and result always use separate immutable private object paths", () => {
  const base = { clienteId: ids.tenant, userId: ids.user, conversationId: ids.conversation, runId: ids.run };
  const original = buildImageStoragePath({ ...base, kind: "original", assetId: ids.asset, extension: "png" });
  const result = buildImageStoragePath({ ...base, kind: "result", assetId: ids.asset, extension: "png" });
  assert.equal(original, `${ids.tenant}/${ids.user}/${ids.conversation}/${ids.run}/original.png`);
  assert.equal(result, `${ids.tenant}/${ids.user}/${ids.conversation}/${ids.run}/result-${ids.asset}.png`);
  assert.notEqual(original, result);
  assert.equal(CHAT_IMAGE_BUCKET, "chat-private-images");
});

test("signed preview and download URLs expire after five minutes", async () => {
  const calls = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, CHAT_IMAGE_BUCKET);
      return {
        async createSignedUrl(path, expiresIn, options) {
          calls.push({ path, expiresIn, options });
          return { data: { signedUrl: `https://signed.example/${calls.length}` }, error: null };
        },
      };
    },
  };
  const signed = await signImageAsset(storage, {
    id: ids.asset,
    kind: "result",
    storage_path: "private/result.png",
    file_extension: "png",
    mime_type: "image/png",
    width: 512,
    height: 512,
    byte_size: 128,
  });
  assert.equal(signed.expires_in, 300);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.expiresIn === 300));
  assert.match(calls[1].options.download, /flowos-imagem-tratada/);
});

test("OpenAI image adapter uses the official edit endpoint and records fake usage/cost", async () => {
  let captured;
  const output = fakePng();
  const result = await callOpenAIImageEdit({
    apiKey: "fake-key-never-sent",
    model: "gpt-image-2",
    imageBytes: fakePng(),
    imageMimeType: "image/png",
    imageFileName: "original.png",
    prompt: buildSafeImageEditPrompt("Melhorar iluminação e reduzir ruído."),
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        model: "gpt-image-2",
        data: [{ b64_json: Buffer.from(output).toString("base64") }],
        usage: {
          input_tokens: 1400,
          input_tokens_details: { text_tokens: 100, image_tokens: 1300 },
          output_tokens: 900,
        },
      }), { status: 200, headers: { "Content-Type": "application/json", "x-request-id": "req_fake_image" } });
    },
  });
  assert.equal(captured.url, OPENAI_IMAGE_EDIT_URL);
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer fake-key-never-sent");
  assert.equal(captured.init.body.get("model"), "gpt-image-2");
  assert.equal(captured.init.body.get("quality"), "medium");
  assert.equal(captured.init.body.get("size"), "auto");
  assert.equal(captured.init.body.get("output_format"), "png");
  assert.equal(captured.init.body.get("input_fidelity"), null);
  assert.equal(result.providerRequestId, "req_fake_image");
  assert.equal(result.inputTextTokens, 100);
  assert.equal(result.inputImageTokens, 1300);
  assert.equal(result.outputImageTokens, 900);
  assert.equal(estimateOpenAIImageCost(result), 0.0379);
  assert.equal(OPENAI_IMAGE_PRICING_VERSION, "openai-image-standard-2026-09-07");
});

test("image chat JSON renders as image content without exposing internal prompts", () => {
  assert.deepEqual(parseImageChatContent('{"type":"image_edit","text":"Melhorar nitidez"}'), {
    type: "image_edit",
    text: "Melhorar nitidez",
  });
  assert.equal(parseImageChatContent("resposta comum"), null);
});

test("private schema, backend and UI preserve isolation and avoid production flows", async () => {
  const [migration, backend, chatBackend, service, component, config] = await Promise.all([
    read("supabase/migrations/20260907224500_private_chat_image_treatment.sql"),
    read("supabase/functions/ai-image-edit/index.ts"),
    read("supabase/functions/ai-chat/index.ts"),
    read("src/services/aiChatService.js"),
    read("src/components/chat/NativeChatPage.jsx"),
    read("supabase/config.toml"),
  ]);
  assert.match(migration, /'chat-private-images',[\s\S]+false,[\s\S]+10485760/);
  assert.match(migration, /ALTER TABLE ap\.ai_image_assets FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /user_id = \(SELECT auth\.uid\(\)\)[\s\S]+cliente_id = public\.require_single_operational_cliente_id\(\)/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]+ON storage\.objects/i);
  assert.doesNotMatch(migration, /GRANT (?:INSERT|UPDATE|DELETE|ALL)[\s\S]+ai_image_assets[\s\S]+authenticated/i);
  assert.match(migration, /kind = 'original'[\s\S]+source_image_id IS NULL/);
  assert.match(migration, /kind = 'result'[\s\S]+source_image_id IS NOT NULL/);
  assert.match(backend, /authorizePrivateChat/);
  assert.match(backend, /journalistic_integrity_acknowledged/);
  assert.match(backend, /upsert: false/g);
  assert.match(backend, /p_operation|claim_ai_image_run|complete_ai_image_run/);
  assert.doesNotMatch(backend, /form\.get\("(?:user_id|cliente_id)"\)/);
  assert.match(chatBackend, /signImageAsset/);
  assert.match(service, /supabase\.functions\.invoke\('ai-image-edit'/);
  assert.match(component, /Baixar imagem tratada/);
  assert.match(component, />Antes</);
  assert.match(component, />Depois</);
  assert.match(component, /revisarei o resultado antes do uso jornalístico/);
  assert.match(config, /\[functions\.ai-image-edit\]\s+verify_jwt = true/);
  assert.doesNotMatch(
    [migration, backend, chatBackend, service, component].join("\n"),
    /candidate_news|ap-employee-generator|ap-render-engine|placid|ap-images|editorial_articles|enable_editorial_r1|mynewswork/i,
  );
});
