import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildEditorialActionHistory,
  EditorialActionError,
  LINK_CONTENT_MIN_CHARACTERS,
  operationSystemContext,
  requireSufficientArticle,
} from "../supabase/functions/_shared/chatEditorialActions.mjs";
import { parseChatBody, sha256Hex } from "../supabase/functions/_shared/chatRequest.mjs";
import { buildChatEditorialInstructions } from "../supabase/functions/_shared/editorialPolicy.ts";
import { assertPublicHttpUrl, fetchPublicHtml } from "../supabase/functions/_shared/safeLinkFetcher.mjs";
import { callOpenAIResponses } from "../supabase/functions/_shared/openaiResponsesClient.mjs";

const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), "utf8");
const REQUEST_ID = "12345678-1234-4234-8234-123456789abc";
const OPERATIONS = [
  "generate_from_link",
  "rewrite",
  "improve_title",
  "correct",
  "summarize",
  "variations",
];

test("all editorial operations are explicit, bounded and ignore spoofed identity", () => {
  for (const operation of OPERATIONS) {
    const parsed = parseChatBody({
      operation,
      request_id: REQUEST_ID,
      message: operation === "generate_from_link" ? "https://noticias.example/materia" : "Texto editorial enviado pelo usuário.",
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cliente_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    assert.equal(parsed.operation, operation);
    assert.equal("userId" in parsed, false);
    assert.equal("clienteId" in parsed, false);
    assert.match(operationSystemContext(operation), new RegExp(operation));
  }
  assert.throws(
    () => parseChatBody({ operation: "generate_from_link", request_id: REQUEST_ID, message: `https://example.com/${"a".repeat(2048)}` }),
    /CHAT_MESSAGE_INVALID/,
  );
});

test("valid extracted link content becomes a source-only provider input and fake response", async () => {
  const content = "A reportagem confirma os fatos apurados e identifica as fontes responsáveis. ".repeat(5);
  assert.ok(content.length >= LINK_CONTENT_MIN_CHARACTERS);
  const history = buildEditorialActionHistory(
    [{ role: "user", content: "https://noticias.example/materia" }],
    "generate_from_link",
    { title: "Título extraído", content, imageUrl: "/foto.jpg", finalUrl: "https://noticias.example/materia" },
  );
  assert.match(history[0].content, /FONTE EXTRAIDA/);
  assert.match(history[0].content, /Título extraído/);
  assert.match(history[0].content, /A reportagem confirma/);

  const result = await callOpenAIResponses({
    apiKey: "fake-key",
    model: "gpt-5.6-luna",
    instructions: operationSystemContext("generate_from_link"),
    history,
    maxOutputTokens: 500,
    fetchImpl: async () => new Response(JSON.stringify({
      id: "resp_fake_editorial",
      status: "completed",
      model: "gpt-5.6-luna",
      output_text: '{"headline":"Título","body":"Matéria"}',
      usage: { input_tokens: 80, output_tokens: 20 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }),
  });
  assert.match(result.content, /"headline"/);
  assert.equal(result.providerRequestId, "resp_fake_editorial");
});

test("insufficient extraction fails before provider content can be invented", () => {
  assert.throws(
    () => requireSufficientArticle({ content: "Descrição curta", finalUrl: "https://example.com" }),
    (error) => error instanceof EditorialActionError && error.code === "LINK_CONTENT_INSUFFICIENT" && error.status === 422,
  );
});

test("existing SSRF guard blocks local/private targets and redirect rebinding", async () => {
  const publicDns = async () => ["93.184.216.34"];
  for (const url of ["http://localhost/test", "http://127.0.0.1/test", "http://10.0.0.1/test", "file:///etc/passwd"]) {
    await assert.rejects(assertPublicHttpUrl(url, publicDns), (error) => ["PRIVATE_DESTINATION", "UNSUPPORTED_PROTOCOL"].includes(error.code));
  }
  await assert.rejects(fetchPublicHtml("https://public.example/article", {
    resolveDns: async (hostname) => hostname === "public.example" ? ["93.184.216.34"] : ["169.254.169.254"],
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: "http://metadata.example/latest" } }),
  }), (error) => error.code === "PRIVATE_DESTINATION");
});

test("text actions preserve submitted text and add server-owned operation context", () => {
  for (const operation of OPERATIONS.filter((value) => value !== "generate_from_link")) {
    const history = buildEditorialActionHistory([
      { role: "assistant", content: "Resposta anterior" },
      { role: "user", content: "Texto factual que será processado." },
    ], operation);
    assert.equal(history[0].content, "Resposta anterior");
    assert.match(history[1].content, /Texto factual que será processado/);
    assert.match(history[1].content, /<conteudo>/);
  }
});

test("operation context extends the same AutoPublisher policy and changes the effective prompt hash", async () => {
  const context = {
    settings: { system_prompt_override: false },
    humanization: null,
    promptVersion: "PROMPT ATIVO DO AUTOPUBLISHER",
    promptVersionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    promptVersionNumber: 3,
    rules: [{ rule_type: "mandatory", value: "manter atribuição" }],
    ragContext: [],
  };
  const rewrite = buildChatEditorialInstructions(context, "rewrite");
  const summarize = buildChatEditorialInstructions(context, "summarize");
  assert.match(rewrite, /^PROMPT ATIVO DO AUTOPUBLISHER/);
  assert.match(rewrite, /manter atribuição/);
  assert.match(rewrite, /CONTEXTO DA OPERACAO rewrite/);
  assert.match(summarize, /CONTEXTO DA OPERACAO summarize/);
  assert.notEqual(await sha256Hex(rewrite), await sha256Hex(summarize));
});

test("backend, prompt trace, ai_runs and UI wire every operation without publishing side effects", async () => {
  const [backend, policy, migration, extractor, service, component] = await Promise.all([
    read("supabase/functions/ai-chat/index.ts"),
    read("supabase/functions/_shared/editorialPolicy.ts"),
    read("supabase/migrations/20260907213000_native_chat_editorial_actions.sql"),
    read("supabase/functions/_shared/linkArticleExtractor.ts"),
    read("src/services/aiChatService.js"),
    read("src/components/chat/NativeChatPage.jsx"),
  ]);
  assert.match(backend, /extractPublicArticle\(payload\.message\)/);
  assert.match(backend, /buildEditorialActionHistory\(history, payload\.operation, extractedArticle\)/);
  assert.match(backend, /p_operation: payload\.operation/);
  assert.match(policy, /operationSystemContext\(operation\)/);
  assert.match(extractor, /fetchPublicHtml\(rawUrl, fetchOptions\)/);
  assert.match(extractor, /og:image/);
  for (const operation of OPERATIONS) {
    assert.match(migration, new RegExp(`'${operation}'`));
    assert.match(component, new RegExp(`operation: '${operation}'`));
  }
  assert.match(service, /operation,/);
  assert.match(component, /Copiar tudo/);
  assert.match(component, /Copiar título/);
  assert.match(component, /Copiar texto/);
  assert.match(component, /LINK_CONTENT_INSUFFICIENT/);
  assert.doesNotMatch(
    [backend, policy, migration, extractor, service, component].join("\n"),
    /candidate_news|ap-employee-generator|ap-render-engine|placid|editorial_articles|enable_editorial_r1|mynewswork/i,
  );
});
