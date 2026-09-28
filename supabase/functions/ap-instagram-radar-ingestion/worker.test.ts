import { assert, assertEquals, assertMatch } from "jsr:@std/assert";
import {
  BATCH_LIMIT,
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
