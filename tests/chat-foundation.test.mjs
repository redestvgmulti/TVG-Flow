import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { authorizePrivateChat, ChatAuthorizationError } from "../supabase/functions/_shared/chatAuth.mjs";
import { boundedChatHistory, parseChatBody, sha256Hex } from "../supabase/functions/_shared/chatRequest.mjs";
import {
  buildChatEditorialInstructions,
  composeEditorialPolicy,
  getRequiredEditorialContext,
} from "../supabase/functions/_shared/editorialPolicy.ts";
import {
  estimateOpenAICost,
  OPENAI_PRICING_VERSION,
  requirePricedOpenAIModel,
} from "../supabase/functions/_shared/openaiPricing.mjs";
import {
  callOpenAIResponses,
  OPENAI_RESPONSES_URL,
} from "../supabase/functions/_shared/openaiResponsesClient.mjs";

const migrationPath = new URL("../supabase/migrations/20260907183019_secure_native_chat_foundation.sql", import.meta.url);
const functionPath = new URL("../supabase/functions/ai-chat/index.ts", import.meta.url);
const promptBuilderPath = new URL("../supabase/functions/_shared/editorialPromptBuilder.ts", import.meta.url);
const configPath = new URL("../supabase/config.toml", import.meta.url);

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function authClient({ userId, tenantId, resolverError = null }) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    rpc: async (name) => {
      if (name === "get_current_identity") {
        return { data: { id: userId, ativo: true, access_ready: true, role: "admin" }, error: null };
      }
      if (name === "require_single_operational_cliente_id") {
        return { data: resolverError ? null : tenantId, error: resolverError };
      }
      throw new Error(`unexpected RPC ${name}`);
    },
  };
}

class QueryResult {
  constructor(result) {
    this.result = result;
  }
  select() { return this; }
  eq() { return this; }
  order() { return this; }
  maybeSingle() { return Promise.resolve(this.result); }
  limit() { return Promise.resolve(this.result); }
}

function editorialClient(results) {
  return {
    schema: (schema) => {
      assert.equal(schema, "ap");
      return { from: (table) => new QueryResult(results[table]) };
    },
  };
}

test("chat tables expose the required private, tenant-bound contract", async () => {
  const sql = await readFile(migrationPath, "utf8");
  for (const table of ["ai_conversations", "ai_messages", "ai_runs"]) {
    assert.match(sql, new RegExp(`CREATE TABLE ap\\.${table}`));
    assert.match(sql, new RegExp(`ALTER TABLE ap\\.${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /user_id = \(SELECT auth\.uid\(\)\)/g);
  assert.match(sql, /cliente_id = public\.require_single_operational_cliente_id\(\)/g);
  assert.match(sql, /TO authenticated/g);
  assert.match(sql, /FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /GRANT SELECT ON TABLE ap\.ai_conversations, ap\.ai_messages, ap\.ai_runs\s+TO service_role/);
  assert.doesNotMatch(sql, /GRANT (?:INSERT|UPDATE|DELETE)[\s\S]+TO service_role/i);
  assert.doesNotMatch(sql, /GRANT\s+ALL[\s\S]+authenticated/i);
  assert.doesNotMatch(sql, /role\s*=\s*'admin'|role\s*=\s*'super_admin'/i);
  assert.match(sql, /FOREIGN KEY \(conversation_id, cliente_id, user_id\)/);
  assert.match(sql, /UNIQUE \(user_id, request_id\)/);
  assert.match(sql, /UNIQUE INDEX ai_messages_one_role_per_run_idx/);
});

test("user and tenant identities are derived from JWT and fail closed", async () => {
  const a = await authorizePrivateChat({
    authorization: "Bearer token-a",
    createUserClient: () => authClient({ userId: USER_A, tenantId: TENANT_A }),
  });
  const b = await authorizePrivateChat({
    authorization: "Bearer token-b",
    createUserClient: () => authClient({ userId: USER_B, tenantId: TENANT_B }),
  });
  assert.deepEqual(a, { userId: USER_A, clienteId: TENANT_A });
  assert.deepEqual(b, { userId: USER_B, clienteId: TENANT_B });
  assert.notDeepEqual(a, b);

  for (const message of ["OPERATIONAL_CLIENT_NOT_FOUND", "OPERATIONAL_CLIENT_SELECTION_REQUIRED"]) {
    await assert.rejects(
      authorizePrivateChat({
        authorization: "Bearer token",
        createUserClient: () => authClient({ userId: USER_A, tenantId: null, resolverError: { message } }),
      }),
      (error) => error instanceof ChatAuthorizationError && error.code === message,
    );
  }
});

test("spoofed user_id and cliente_id are ignored by request parsing", () => {
  const parsed = parseChatBody({
    operation: "chat",
    request_id: REQUEST_ID,
    message: "  Gere uma matéria  ",
    user_id: USER_B,
    cliente_id: TENANT_B,
  });
  assert.deepEqual(parsed, {
    operation: "chat",
    requestId: REQUEST_ID,
    conversationId: null,
    message: "Gere uma matéria",
    title: null,
  });
  assert.equal("userId" in parsed, false);
  assert.equal("clienteId" in parsed, false);
  assert.equal(parseChatBody({
    operation: "rewrite",
    request_id: REQUEST_ID,
    message: "Texto a reescrever",
    user_id: USER_B,
    cliente_id: TENANT_B,
  }).operation, "rewrite");
});

test("active AutoPublisher prompt, rules and humanization share one composition", async () => {
  const promptId = "44444444-4444-4444-8444-444444444444";
  const context = await getRequiredEditorialContext(editorialClient({
    editorial_settings: { data: { cliente_id: TENANT_A, is_active: true, system_prompt_override: false }, error: null },
    editorial_humanization: { data: { formality_level: 80, creativity_level: 20, technical_level: 30, anti_ai_variation: true }, error: null },
    editorial_prompt_versions: { data: { id: promptId, version_number: 7, prompt_base: "PROMPT ATIVO V7" }, error: null },
    editorial_rules: { data: [{ id: "r1", rule_type: "mandatory", value: "citar a fonte", created_at: "2026-01-01" }], error: null },
  }), TENANT_A);

  const instructions = buildChatEditorialInstructions(context);
  assert.match(instructions, /^PROMPT ATIVO V7/);
  assert.match(instructions, /citar a fonte/);
  assert.match(instructions, /Formalidade: 80%/);
  assert.equal(context.promptVersionId, promptId);
  assert.equal(context.promptVersionNumber, 7);
  assert.match(await sha256Hex(instructions), /^[0-9a-f]{64}$/);

  const testPolicy = composeEditorialPolicy({
    settings: context.settings,
    promptVersion: context.promptVersion,
    humanization: context.humanization,
    rules: context.rules,
  });
  assert.ok(instructions.startsWith(testPolicy.systemPrompt));
  assert.match(composeEditorialPolicy({
    settings: { system_prompt_override: false },
    promptVersion: "",
    humanization: null,
    rules: [],
  }).systemPrompt, /^Você é um editor sênior/);
  const builder = await readFile(promptBuilderPath, "utf8");
  assert.match(builder, /composeEditorialPolicy\(/);
  assert.match(builder, /getRequiredEditorialContext/);
});

test("missing active prompt fails explicitly", async () => {
  await assert.rejects(
    getRequiredEditorialContext(editorialClient({
      editorial_settings: { data: { cliente_id: TENANT_A, is_active: true }, error: null },
      editorial_humanization: { data: null, error: null },
      editorial_prompt_versions: { data: null, error: null },
      editorial_rules: { data: [], error: null },
    }), TENANT_A),
    /EDITORIAL_ACTIVE_PROMPT_NOT_CONFIGURED/,
  );
});

test("OpenAI adapter uses Responses API, store false and captures effective usage", async () => {
  let captured;
  const result = await callOpenAIResponses({
    apiKey: "test-key-never-sent-to-a-real-provider",
    model: "gpt-5.6-luna",
    instructions: "prompt privado",
    history: [{ role: "user", content: "olá" }],
    maxOutputTokens: 900,
    fetchImpl: async (url, init) => {
      captured = { url, init, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        id: "resp_fake_123",
        status: "completed",
        model: "gpt-5.6-luna",
        output: [{ type: "message", content: [{ type: "output_text", text: "Resposta editorial" }] }],
        usage: { input_tokens: 120, input_tokens_details: { cached_tokens: 20 }, output_tokens: 30 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(captured.url, OPENAI_RESPONSES_URL);
  assert.equal(captured.body.store, false);
  assert.equal(captured.body.model, "gpt-5.6-luna");
  assert.equal(captured.body.instructions, "prompt privado");
  assert.equal(result.providerRequestId, "resp_fake_123");
  assert.deepEqual(
    { input: result.inputTokens, cached: result.cachedInputTokens, output: result.outputTokens },
    { input: 120, cached: 20, output: 30 },
  );
  assert.equal(OPENAI_PRICING_VERSION, "openai-standard-2026-09-07");
  assert.equal(estimateOpenAICost({ model: result.actualModel, inputTokens: 120, cachedInputTokens: 20, outputTokens: 30 }), 0.0000564);
  assert.throws(() => requirePricedOpenAIModel("unknown-model"), /OPENAI_CHAT_MODEL_UNSUPPORTED/);
});

test("history ordering is stable and bounded from the newest messages", () => {
  const rowsDescending = [
    { role: "user", content: "newest" },
    { role: "assistant", content: "middle" },
    { role: "user", content: "oldest" },
  ];
  assert.deepEqual(boundedChatHistory(rowsDescending, 20), [
    { role: "user", content: "oldest" },
    { role: "assistant", content: "middle" },
    { role: "user", content: "newest" },
  ]);
  assert.deepEqual(boundedChatHistory(rowsDescending, 12), [
    { role: "assistant", content: "middle" },
    { role: "user", content: "newest" },
  ]);
});

test("run lifecycle is atomic and retry-safe by SQL contract", async () => {
  const sql = await readFile(migrationPath, "utf8");
  assert.match(sql, /CREATE OR REPLACE FUNCTION ap\.claim_ai_chat_run/);
  assert.match(sql, /WHERE user_id = p_user_id AND request_id = p_request_id[\s\S]+FOR UPDATE/);
  assert.match(sql, /IF v_run\.status = 'failed'[\s\S]+attempt_count = attempt_count \+ 1/);
  assert.match(sql, /CHAT_RETRY_CONTEXT_CHANGED/);
  assert.match(sql, /ON CONFLICT \(ai_run_id, role\) WHERE ai_run_id IS NOT NULL DO NOTHING/g);
  assert.match(sql, /CREATE OR REPLACE FUNCTION ap\.complete_ai_chat_run[\s\S]+status = 'completed'/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION ap\.fail_ai_chat_run[\s\S]+WHERE id = p_run_id AND status = 'running'/);
});

test("backend remains isolated from publishing, rendering and R1 editorial domain", async () => {
  const [source, sql, config] = await Promise.all([
    readFile(functionPath, "utf8"),
    readFile(migrationPath, "utf8"),
    readFile(configPath, "utf8"),
  ]);
  assert.match(config, /\[functions\.ai-chat\]\s+verify_jwt = true/);
  assert.match(source, /\.eq\("conversation_id", claim\.conversation_id\)[\s\S]+\.eq\("cliente_id", authorization\.clienteId\)[\s\S]+\.eq\("user_id", authorization\.userId\)/);
  assert.doesNotMatch(source, /candidate_news|ap-employee-generator|ap-render-engine|placid/i);
  assert.doesNotMatch(`${source}\n${sql}`, /editorial_articles|enable_editorial_r1|mynewswork/i);
  assert.doesNotMatch(source, /prompt_snapshot|editorial_logs/);
});
