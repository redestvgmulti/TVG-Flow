import { MetaBusinessDiscoveryProvider } from "./metaBusinessDiscoveryProvider.ts";

const source = { id: "source-1", clienteId: "tenant-1", username: "@prefeituradegoiatuba", url: "https://www.instagram.com/prefeituradegoiatuba/" };

function graphResponse(media: unknown[] = []) {
  return { business_discovery: { username: "prefeituradegoiatuba", name: "Prefeitura", media: { data: media } } };
}

function media(overrides: Record<string, unknown> = {}) {
  return {
    id: "meta-media-id",
    caption: "caption",
    media_type: "IMAGE",
    media_url: "https://cdn.instagram.test/image.jpg",
    permalink: "https://www.instagram.com/p/example/",
    timestamp: "2026-09-28T12:00:00+0000",
    ...overrides,
  };
}

function provider(fetchImpl: typeof fetch) {
  return new MetaBusinessDiscoveryProvider({
    graphApiVersion: "v24.0",
    instagramUserId: "caller-id",
    pageAccessToken: "test-page-access-token",
    fetchImpl,
  });
}

async function collect(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return await provider(fetchImpl).collect({
    sources: [source],
    newerThan: { "source-1": null },
    limits: { maxSources: 1, maxItemsPerSource: 5, maxItemsTotal: 5, maxCalls: 1 },
    ...overrides,
  });
}

Deno.test("Business Discovery normalizes official media without putting its token in the URL", async () => {
  let capturedUrl = "";
  let capturedAuthorization = "";
  let capturedRedirect = "";
  const result = await collect(async (input, init) => {
    const request = new Request(input, init);
    capturedUrl = request.url;
    capturedAuthorization = request.headers.get("Authorization") ?? "";
    capturedRedirect = request.redirect;
    return Response.json(graphResponse([
      media(),
      media({ id: "carousel", media_type: "CAROUSEL_ALBUM" }),
      media({ id: "reel", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/example/" }),
      media({ id: "video", media_type: "VIDEO" }),
      media({ id: "unknown", media_type: "STORY", caption: undefined, thumbnail_url: "https://cdn.instagram.test/thumb.jpg" }),
    ]));
  });
  const items = result[0].items;
  if (capturedUrl.includes("test-page-access-token") || capturedAuthorization !== "Bearer test-page-access-token") throw new Error("request credential contract failed");
  if (capturedRedirect !== "error" || !capturedUrl.startsWith("https://graph.facebook.com/v24.0/caller-id?")) throw new Error("request target contract failed");
  if (!new URL(capturedUrl).searchParams.get("fields")?.includes("business_discovery.username(prefeituradegoiatuba)")) throw new Error("unsafe fields contract");
  if (JSON.stringify(result).includes("test-page-access-token")) throw new Error("token leaked in result");
  if (items.map((item) => item.mediaType).join(",") !== "feed,carousel,reel,feed,unknown") throw new Error("media type mapping failed");
  if (items[0].externalId !== "meta-media-id" || items[0].canonicalUrl !== "https://www.instagram.com/p/example/") throw new Error("official identifiers not preserved");
  if (items[4].caption !== "" || items[4].thumbnailUrl !== "https://cdn.instagram.test/thumb.jpg") throw new Error("optional field normalization failed");
});

Deno.test("Business Discovery enforces item and cursor caps", async () => {
  const fetchImpl = async () => Response.json(graphResponse([media({ id: "old", timestamp: "2026-09-27T12:00:00Z" }), media({ id: "new" })]));
  const result = await collect(fetchImpl as typeof fetch, {
    newerThan: { "source-1": "2026-09-28T00:00:00Z" },
    limits: { maxSources: 1, maxItemsPerSource: 1, maxItemsTotal: 1, maxCalls: 1 },
  });
  if (result[0].items.length !== 1 || result[0].items[0].externalId !== "new") throw new Error("newerThan or item cap failed");
  await provider(fetchImpl as typeof fetch).collect({
    sources: [source, { ...source, id: "source-2" }],
    newerThan: { "source-1": null, "source-2": null },
    limits: { maxSources: 2, maxItemsPerSource: 1, maxItemsTotal: 2, maxCalls: 1 },
  }).then(() => { throw new Error("inconsistent maxCalls accepted"); }, (error) => {
    if (error.message !== "META_BUSINESS_DISCOVERY_LIMITS_INVALID") throw error;
  });
  let calls = 0;
  const cappedSources = await provider(async () => {
    calls += 1;
    return Response.json(graphResponse());
  }).collect({
    sources: [source, { ...source, id: "source-2" }],
    newerThan: { "source-1": null, "source-2": null },
    limits: { maxSources: 1, maxItemsPerSource: 1, maxItemsTotal: 1, maxCalls: 1 },
  });
  if (cappedSources.length !== 1 || calls !== 1) throw new Error("maxSources cap failed");
});

Deno.test("Business Discovery errors are deterministic and sanitized", async () => {
  const rateLimited = await collect(async () => Response.json({ error: { code: 613, message: "raw secret-adjacent Graph message" } }, { status: 400 }));
  if (rateLimited[0].error?.code !== "META_BUSINESS_DISCOVERY_RATE_LIMITED" || !rateLimited[0].error.retryable || JSON.stringify(rateLimited).includes("raw secret-adjacent")) throw new Error("rate limit mapping failed");
  const unsupported = await collect(async () => Response.json({ business_discovery: null }));
  if (unsupported[0].capability !== "unsupported" || !unsupported[0].complete || unsupported[0].items.length) throw new Error("unsupported mapping failed");
  const timeout = await collect(async () => { throw new DOMException("timeout", "TimeoutError"); });
  if (timeout[0].error?.code !== "META_BUSINESS_DISCOVERY_TIMEOUT" || !timeout[0].error.retryable) throw new Error("timeout mapping failed");
});
