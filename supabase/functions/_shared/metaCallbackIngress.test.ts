import {
  MetaCallbackIngressError,
  parseMetaCallbackIngress,
} from "./metaCallbackIngress.ts";

const secret = "fixture-dedicated-ingress-secret-at-least-32-chars";
const state = "x".repeat(43);
const endpoint = "https://project.test/functions/v1/ap-meta-oauth-callback";

function request(options: { method?: string; url?: string; secret?: string; body?: string; contentType?: string } = {}) {
  return new Request(options.url ?? endpoint, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": options.contentType ?? "application/json",
      "x-meta-callback-ingress-secret": options.secret ?? secret,
    },
    body: options.method === "GET" ? undefined : options.body ?? JSON.stringify({ code: "fixture-code", state }),
  });
}

async function assertStatus(action: () => Promise<unknown>, status: number) {
  try {
    await action();
  } catch (error) {
    if (error instanceof MetaCallbackIngressError && error.status === status) return;
    throw error;
  }
  throw new Error(`Expected ingress rejection ${status}`);
}

Deno.test("callback ingress accepts bounded JSON POST without query", async () => {
  const payload = await parseMetaCallbackIngress(request(), secret);
  if (payload.code !== "fixture-code" || payload.state !== state) throw new Error("Payload mismatch");
});

Deno.test("direct GET, POST query, and wrong ingress secret are rejected", async () => {
  await assertStatus(() => parseMetaCallbackIngress(request({ method: "GET", url: `${endpoint}?code=sensitive` }), secret), 405);
  await assertStatus(() => parseMetaCallbackIngress(request({ url: `${endpoint}?state=sensitive` }), secret), 400);
  await assertStatus(() => parseMetaCallbackIngress(request({ secret: "wrong-secret" }), secret), 403);
  await assertStatus(() => parseMetaCallbackIngress(request(), undefined), 503);
});

Deno.test("malformed and excessive callback bodies are rejected", async () => {
  await assertStatus(() => parseMetaCallbackIngress(request({ body: JSON.stringify({ code: "code", state: "invalid" }) }), secret), 400);
  await assertStatus(() => parseMetaCallbackIngress(request({ body: "{" }), secret), 400);
  await assertStatus(() => parseMetaCallbackIngress(request({ body: "x".repeat(8193) }), secret), 413);
  await assertStatus(() => parseMetaCallbackIngress(request({ contentType: "text/plain" }), secret), 415);
});
