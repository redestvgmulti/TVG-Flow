import { assertEquals } from "jsr:@std/assert";
import { createInstagramRadarImageBackfillHandler } from "./handler.ts";

const scopes = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "business_management",
  "instagram_manage_insights",
  "ads_read",
];

async function withInternalWorkerSecret(
  secret: string | null,
  run: () => Promise<void>,
) {
  const previous = Deno.env.get("AP_INTERNAL_WORKER_SECRET");
  if (secret === null) Deno.env.delete("AP_INTERNAL_WORKER_SECRET");
  else Deno.env.set("AP_INTERNAL_WORKER_SECRET", secret);
  try {
    await run();
  } finally {
    if (previous === undefined) Deno.env.delete("AP_INTERNAL_WORKER_SECRET");
    else Deno.env.set("AP_INTERNAL_WORKER_SECRET", previous);
  }
}

Deno.test("image backfill rejects a missing secret before any dependency side effect", async () => {
  let adminCalls = 0;
  const handler = createInstagramRadarImageBackfillHandler({
    createAdminClient: () => {
      adminCalls += 1;
      return {} as never;
    },
  });
  await withInternalWorkerSecret("expected-secret", async () => {
    const response = await handler(
      new Request("https://worker.test", { method: "POST" }),
    );
    assertEquals(response.status, 401);
    assertEquals(await response.json(), {
      error: "INTERNAL_WORKER_AUTH_REQUIRED",
    });
    assertEquals(adminCalls, 0);
  });
});

Deno.test("image backfill rejects an incorrect secret before any dependency side effect", async () => {
  let adminCalls = 0;
  const handler = createInstagramRadarImageBackfillHandler({
    createAdminClient: () => {
      adminCalls += 1;
      return {} as never;
    },
  });
  await withInternalWorkerSecret("expected-secret", async () => {
    const response = await handler(
      new Request("https://worker.test", {
        method: "POST",
        headers: { "x-ap-internal-secret": "wrong-secret" },
      }),
    );
    assertEquals(response.status, 401);
    assertEquals(await response.json(), {
      error: "INTERNAL_WORKER_AUTH_REQUIRED",
    });
    assertEquals(adminCalls, 0);
  });
});

Deno.test("image backfill only accepts POST", async () => {
  const handler = createInstagramRadarImageBackfillHandler({
    requireTrustedInternalRequest: () => {
      throw new Error("must not authenticate a GET");
    },
  });
  const response = await handler(
    new Request("https://worker.test", { method: "GET" }),
  );
  assertEquals(response.status, 405);
  assertEquals(await response.json(), { error: "METHOD_NOT_ALLOWED" });
});

Deno.test("image backfill updates only image_url for a matching official Instagram item", async () => {
  const updates: unknown[] = [];
  const stableUrl = "https://project.supabase.co/storage/v1/object/public/ap-images/radar/instagram/image.jpg";
  const collectedRows = {
    select: () => ({
      is: () => ({
        contains: () => ({
          limit: async () => ({
            data: [{
              id: "news-a",
              cliente_id: "tenant-a",
              source_id: "source-a",
              metadata: {
                platform: "instagram",
                provider: "meta_business_discovery",
                external_id: "media-a",
              },
            }],
            error: null,
          }),
        }),
      }),
    }),
    update: (payload: unknown) => {
      updates.push(payload);
      const query = {
        eq: () => query,
        is: async () => ({ error: null }),
      };
      return query;
    },
  };
  const sources = {
    select: () => ({
      in: () => ({
        eq: async () => ({
          data: [{
            id: "source-a",
            cliente_id: "tenant-a",
            url: "https://www.instagram.com/prefeitura/",
          }],
          error: null,
        }),
      }),
    }),
  };
  const connections = {
    select: () => {
      const query = {
        eq: () => query,
        order: () => ({
          maybeSingle: async () => ({
            data: {
              instagram_user_id: "caller-a",
              graph_api_version: "v26.0",
              token_secret_ref: "vault-ref",
              granted_scopes: scopes,
              capabilities: { radar_read: true },
              expires_at: null,
            },
            error: null,
          }),
        }),
      };
      return query;
    },
  };
  const admin = {
    schema: () => ({
      from: (table: string) => table === "collected_news"
        ? collectedRows
        : table === "sources"
        ? sources
        : connections,
      rpc: async () => ({ data: "page-token", error: null }),
    }),
    storage: {},
  };
  class Provider {
    constructor(_options: unknown) {}
    async collect() {
      return [{
        sourceId: "source-a",
        provider: "meta_business_discovery" as const,
        capability: "supported" as const,
        complete: true,
        items: [{
          externalId: "media-a",
          canonicalUrl: "https://www.instagram.com/p/example/",
          sourceUsername: "prefeitura",
          sourceName: "Prefeitura",
          caption: "",
          publishedAt: "2026-09-29T12:00:00.000Z",
          thumbnailUrl: "https://cdn.example/image.jpg",
          mediaType: "feed" as const,
        }],
        telemetry: { durationMs: 1, calls: 1, billedResults: null, costUsd: null },
      }];
    }
  }
  const handler = createInstagramRadarImageBackfillHandler({
    createAdminClient: () => admin as never,
    requireTrustedInternalRequest: () => {},
    providerFactory: Provider as never,
    archiveImage: async () => stableUrl,
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  });
  const response = await handler(
    new Request("https://worker.test", { method: "POST" }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), {
    ok: true,
    candidates: 1,
    updated: 1,
    unavailable: 0,
    errors: 0,
  });
  assertEquals(updates, [{ image_url: stableUrl }]);
});
