import { assert, assertEquals, assertMatch } from "jsr:@std/assert";
import {
  BATCH_LIMIT,
  createInstagramRadarIngestionHandler,
  hasRadarReadCapability,
  instagramContentHash,
  instagramExcerpt,
  instagramTitle,
  MAX_AGE_HOURS,
  MAX_ITEMS_PER_SOURCE,
  PARSER_VERSION,
} from "./worker.ts";
import type { InstagramRadarItem } from "../_shared/social/instagramRadarProvider.ts";

const allScopes = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "business_management",
  "instagram_manage_insights",
  "ads_read",
];

function item(overrides: Partial<InstagramRadarItem> = {}): InstagramRadarItem {
  return {
    externalId: "meta-media-id",
    canonicalUrl: "https://www.instagram.com/p/example/",
    sourceUsername: "prefeitura",
    sourceName: "Prefeitura",
    caption: "Primeira linha\nSegunda linha",
    publishedAt: "2026-09-28T12:00:00.000Z",
    thumbnailUrl: "https://cdn.example/image.jpg",
    mediaType: "feed",
    ...overrides,
  };
}

Deno.test("Radar worker uses the six-scope capability fail-closed contract", () => {
  assert(
    hasRadarReadCapability({
      capabilities: { radar_read: true },
      granted_scopes: allScopes,
      instagram_user_id: "id",
      graph_api_version: "v26.0",
      token_secret_ref: "ref",
      expires_at: null,
    }),
  );
  assert(
    !hasRadarReadCapability({
      capabilities: { radar_read: true },
      granted_scopes: allScopes.slice(0, -1),
      instagram_user_id: "id",
      graph_api_version: "v26.0",
      token_secret_ref: "ref",
      expires_at: null,
    }),
  );
  assert(
    !hasRadarReadCapability({
      capabilities: { radar_read: false },
      granted_scopes: allScopes,
      instagram_user_id: "id",
      graph_api_version: "v26.0",
      token_secret_ref: "ref",
      expires_at: null,
    }),
  );
});

Deno.test("Instagram editorial mapping is deterministic and does not invent a headline", async () => {
  assertEquals(instagramTitle(item()), "Primeira linha");
  assertEquals(
    instagramTitle(item({ caption: "  \n " })),
    "Publicação de @prefeitura",
  );
  assertEquals(
    instagramExcerpt(item({ caption: "  A   legenda\ncom espaços  " })),
    "A legenda com espaços",
  );
  assertEquals(instagramExcerpt(item({ caption: "" })), null);
  assertEquals(
    await instagramContentHash(item()),
    await instagramContentHash(item()),
  );
  assert(
    (await instagramContentHash(item())) !==
      await instagramContentHash(item({ externalId: "other" })),
  );
});

Deno.test("Instagram ingestion worker contract preserves rolling-window and safe persistence boundaries", async () => {
  const source = await Deno.readTextFile(
    new URL("./worker.ts", import.meta.url),
  );
  assertEquals(BATCH_LIMIT, 25);
  assertEquals(MAX_ITEMS_PER_SOURCE, 25);
  assertEquals(MAX_AGE_HOURS, 24);
  assertEquals(PARSER_VERSION, "instagram-meta-v1");
  assertMatch(source, /\.eq\("tipo", "instagram"\)\.eq\("ativo", true\)/);
  assertMatch(
    source,
    /\.order\("last_checked_at", \{ ascending: true, nullsFirst: true \}\)/,
  );
  assertMatch(source, /\.order\("created_at", \{ ascending: true \}\)/);
  assertMatch(source, /\.rpc\(\s*"ingest_collected_news"/);
  assertMatch(source, /complete: collection\.complete/);
  assertMatch(source, /publishedAt < cutoffMs/);
  assertMatch(source, /META_RADAR_CONNECTION_UNAVAILABLE/);
  assertMatch(source, /META_RADAR_CAPABILITY_UNAVAILABLE/);
  assertMatch(source, /META_RADAR_SECRET_UNAVAILABLE/);
  assertMatch(source, /completed_with_errors/);
  assert(!source.includes("Apify"));
  assert(!source.includes('from("collected_news").insert'));
  assert(!source.includes("access_token"));
});

Deno.test("Worker response and run metadata omit captions, Vault references and raw Meta pagination", async () => {
  const source = await Deno.readTextFile(
    new URL("./worker.ts", import.meta.url),
  );
  const response = source.slice(source.lastIndexOf("return json({ ok: true"));
  assert(!response.includes("caption"));
  assert(!response.includes("token_secret_ref"));
  assert(!response.includes("paging"));
  assertMatch(source, /provider: "meta_business_discovery"/);
  assertMatch(source, /external_id: item\.externalId/);
  assertMatch(source, /discovery_complete: collection\.complete/);
});

function workerHarness(
  options: { updateError?: boolean; insertError?: boolean; created?: boolean } =
    {},
) {
  const writes: Array<{ table: string; value: Record<string, unknown> }> = [];
  const source = {
    id: "source-a",
    cliente_id: "tenant-a",
    nome: "@prefeitura",
    url: "https://www.instagram.com/prefeitura/",
    tipo: "instagram",
    consecutive_failures: 0,
  };
  const connection = {
    instagram_user_id: "caller",
    graph_api_version: "v26.0",
    token_secret_ref: "vault-ref",
    granted_scopes: allScopes,
    capabilities: { radar_read: true },
    expires_at: null,
  };
  const admin = {
    schema: () => ({
      from: (table: string) => {
        const query: any = {
          select: () => query,
          eq: () => query,
          order: () => query,
          not: () => query,
        };
        query.limit = async () => ({
          data: table === "sources" ? [source] : [],
          error: null,
        });
        query.maybeSingle = async () => ({
          data: table === "instagram_connections" ? connection : null,
          error: null,
        });
        query.update = (value: Record<string, unknown>) => ({
          eq: () => ({
            eq: async () => ({
              error: options.updateError ? { code: "x" } : null,
            }),
          }),
        });
        query.insert = async (value: Record<string, unknown>) => {
          writes.push({ table, value });
          return { error: options.insertError ? { code: "x" } : null };
        };
        return query;
      },
      rpc: async (name: string) =>
        name === "meta_read_secret"
          ? { data: "page-token", error: null }
          : { data: { created: options.created ?? true }, error: null },
    }),
  };
  class Provider {
    constructor(_options: unknown) {}
    async collect() {
      return [{
        sourceId: "source-a",
        provider: "meta_business_discovery",
        capability: "supported",
        complete: false,
        items: [item()],
        telemetry: {
          durationMs: 1,
          calls: 1,
          billedResults: null,
          costUsd: null,
        },
      }];
    }
  }
  class FakeTelemetry {
    constructor(_admin: unknown) {}
    async logStart(_value: unknown) {}
    async logSuccess(_cost: number, _value: unknown) {}
    async logError(_code: string, _cost: number, _value: unknown) {}
  }
  return {
    writes,
    handler: createInstagramRadarIngestionHandler({
      createAdminClient: () => admin as never,
      requireTrustedInternalRequest: () => {},
      providerFactory: Provider as never,
      telemetryFactory: FakeTelemetry as never,
      now: () => new Date("2026-09-28T12:00:00Z"),
    }),
  };
}

Deno.test("Worker orchestration executes a recent item and records a successful incomplete collection", async () => {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  try {
    const harness = workerHarness();
    const response = await harness.handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.ok, true);
    assertEquals(body.results[0].collected, 1);
    assertEquals(body.results[0].complete, false);
    assertEquals(
      harness.writes.filter((write) =>
        write.table === "source_ingestion_runs"
      )[0].value.status,
      "success",
    );
  } finally {
    if (oldUrl) Deno.env.set("SUPABASE_URL", oldUrl);
    else Deno.env.delete("SUPABASE_URL");
    if (oldKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    else Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("Worker turns a source-state infrastructure failure into a sanitized 500", async () => {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  try {
    const response = await workerHarness({ updateError: true }).handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    assertEquals(response.status, 500);
    assertEquals(
      (await response.json()).error,
      "RADAR_SOURCE_STATE_WRITE_FAILED",
    );
  } finally {
    if (oldUrl) Deno.env.set("SUPABASE_URL", oldUrl);
    else Deno.env.delete("SUPABASE_URL");
    if (oldKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    else Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});

Deno.test("Worker turns an ingestion-run infrastructure failure into a sanitized 500", async () => {
  const oldUrl = Deno.env.get("SUPABASE_URL");
  const oldKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  Deno.env.set("SUPABASE_URL", "https://example.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  try {
    const response = await workerHarness({ insertError: true }).handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    assertEquals(response.status, 500);
    assertEquals(
      (await response.json()).error,
      "RADAR_INGESTION_RUN_WRITE_FAILED",
    );
  } finally {
    if (oldUrl) Deno.env.set("SUPABASE_URL", oldUrl);
    else Deno.env.delete("SUPABASE_URL");
    if (oldKey) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", oldKey);
    else Deno.env.delete("SUPABASE_SERVICE_ROLE_KEY");
  }
});
