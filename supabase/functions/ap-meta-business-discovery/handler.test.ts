import { createMetaBusinessDiscoveryHandler } from "./handler.ts";

const cors = { "Access-Control-Allow-Origin": "https://app.test" };
const actor = { clienteId: "tenant-a", userId: "user-a", role: "admin" as const };
const connection = {
  status: "connected",
  instagram_user_id: "caller-id",
  graph_api_version: "v24.0",
  token_secret_ref: "vault-ref",
  granted_scopes: ["pages_show_list", "pages_read_engagement", "instagram_basic", "business_management"],
  capabilities: { radar_read: true },
  expires_at: null,
};

function adminMock({ row = connection, secret = "page-token", connectionError = null, secretError = null }: Record<string, unknown> = {}) {
  return {
    schema: () => ({
      from: () => {
        const query: Record<string, unknown> = {};
        query.select = () => query;
        query.eq = () => query;
        query.order = () => query;
        query.maybeSingle = async () => ({ data: row, error: connectionError });
        return query;
      },
      rpc: async () => ({ data: secret, error: secretError }),
    }),
  };
}

function handler(options: Record<string, unknown> = {}) {
  const providerFactory = class {
    constructor(_options: unknown) {}
    async collect() {
      return [options.providerResult ?? {
        sourceId: "poc", provider: "meta_business_discovery", capability: "supported", complete: true,
        items: [{ externalId: "media-1", canonicalUrl: "https://www.instagram.com/p/example/", sourceUsername: "prefeitura", sourceName: "Prefeitura", caption: "", publishedAt: "2026-09-28T00:00:00.000Z", thumbnailUrl: null, mediaType: "feed" }],
        telemetry: { durationMs: 1, calls: 1, billedResults: null, costUsd: null },
      }];
    }
  };
  return createMetaBusinessDiscoveryHandler({
    createAdminClient: () => adminMock(options) as never,
    requireMetaAdmin: async () => actor,
    metaCorsHeaders: () => cors,
    providerFactory: providerFactory as never,
    now: () => Date.parse("2026-09-28T00:00:00Z"),
  });
}

function request(body: Record<string, unknown>, method = "POST") {
  return new Request("https://functions.test", { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined });
}

Deno.test("Business Discovery endpoint derives its tenant and returns only safe provider output", async () => {
  const response = await handler()(request({ input: "@prefeitura", cliente_id: "other-tenant" }));
  if (response.status !== 400 || (await response.json()).error !== "META_RADAR_INPUT_INVALID") throw new Error("body tenant was accepted");
  const success = await handler()(request({ input: "https://www.instagram.com/prefeitura/", limit: 5 }));
  const body = await success.json();
  if (success.status !== 200 || body.target.username !== "prefeitura" || body.count !== 1 || body.capability !== "supported" || body.complete !== true || JSON.stringify(body).includes("vault-ref")) throw new Error("safe success contract failed");
  const incomplete = await handler({ providerResult: {
    sourceId: "poc", provider: "meta_business_discovery", capability: "supported", complete: false,
    items: [], telemetry: { durationMs: 1, calls: 1, billedResults: null, costUsd: null },
  } })(request({ input: "@prefeitura" }));
  const incompleteBody = await incomplete.json();
  if (incomplete.status !== 200 || incompleteBody.complete !== false || incompleteBody.capability !== "supported") throw new Error("incomplete success became an endpoint failure");
});

Deno.test("Business Discovery endpoint fails closed for connection, capability, expiry and Vault failures", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ row: null }, "META_RADAR_CONNECTION_UNAVAILABLE"],
    [{ row: { ...connection, status: "disconnected" } }, "META_RADAR_CONNECTION_UNAVAILABLE"],
    [{ row: { ...connection, token_secret_ref: null } }, "META_RADAR_CONNECTION_UNAVAILABLE"],
    [{ row: { ...connection, capabilities: { radar_read: false } } }, "META_RADAR_CAPABILITY_UNAVAILABLE"],
    [{ row: { ...connection, granted_scopes: connection.granted_scopes.slice(0, 3) } }, "META_RADAR_CAPABILITY_UNAVAILABLE"],
    [{ row: { ...connection, expires_at: "2020-01-01T00:00:00Z" } }, "META_RADAR_CONNECTION_EXPIRED"],
    [{ secret: null }, "META_RADAR_SECRET_UNAVAILABLE"],
  ];
  for (const [options, expected] of cases) {
    const response = await handler(options)(request({ input: "@prefeitura" }));
    if ((await response.json()).error !== expected) throw new Error(`expected ${expected}`);
  }
  const invalid = await handler()(request({ input: "https://instagram.com/reel/nope/" }));
  if ((await invalid.json()).error !== "META_RADAR_INPUT_INVALID") throw new Error("invalid input accepted");
  const limit = await handler()(request({ input: "@prefeitura", limit: 6 }));
  if ((await limit.json()).error !== "META_RADAR_LIMIT_INVALID") throw new Error("limit accepted");
});
