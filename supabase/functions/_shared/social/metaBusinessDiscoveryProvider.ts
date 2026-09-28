import {
  type InstagramRadarCollection,
  type InstagramRadarItem,
  type InstagramRadarProvider,
  type InstagramRadarSource,
} from "./instagramRadarProvider.ts";
import { normalizeInstagramPermalink, normalizeInstagramProfile } from "./instagramProfile.mjs";

const META_GRAPH_ORIGIN = "https://graph.facebook.com";
const META_TIMEOUT_MS = 10_000;

type FetchImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type GraphMedia = {
  id?: unknown;
  caption?: unknown;
  media_type?: unknown;
  media_url?: unknown;
  thumbnail_url?: unknown;
  permalink?: unknown;
  timestamp?: unknown;
};

type GraphDiscovery = {
  username?: unknown;
  name?: unknown;
  media?: {
    data?: unknown;
    paging?: { next?: unknown; cursors?: { after?: unknown } };
  };
};

type GraphResponse = { business_discovery?: GraphDiscovery | null; error?: { code?: unknown; type?: unknown } };

export type MetaBusinessDiscoveryProviderOptions = {
  graphApiVersion: string;
  instagramUserId: string;
  pageAccessToken: string;
  fetchImpl?: FetchImplementation;
};

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

function validTimestamp(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mediaType(mediaType: unknown, permalink: string) {
  if (mediaType === "IMAGE") return "feed" as const;
  if (mediaType === "CAROUSEL_ALBUM") return "carousel" as const;
  if (mediaType === "VIDEO") return permalink.includes("/reel/") ? "reel" as const : "feed" as const;
  return "unknown" as const;
}

function graphError(response: Response, body: GraphResponse) {
  const code = Number(body.error?.code);
  if ([4, 17, 32, 613].includes(code) || response.status === 429) {
    return { code: "META_BUSINESS_DISCOVERY_RATE_LIMITED", retryable: true, unsupported: false };
  }
  if (code === 190 || response.status === 401) {
    return { code: "META_BUSINESS_DISCOVERY_TOKEN_INVALID", retryable: false, unsupported: false };
  }
  if (code === 10 || response.status === 403) {
    return { code: "META_BUSINESS_DISCOVERY_PERMISSION_DENIED", retryable: false, unsupported: false };
  }
  return { code: "META_BUSINESS_DISCOVERY_FAILED", retryable: response.status >= 500, unsupported: false };
}

function hasNextPage(discovery: GraphDiscovery) {
  const paging = discovery.media?.paging;
  return typeof paging?.next === "string" && paging.next.length > 0 ||
    typeof paging?.cursors?.after === "string" && paging.cursors.after.length > 0;
}

function validateLimits(
  limits: { maxSources: number; maxItemsPerSource: number; maxItemsTotal: number; maxCalls: number },
  sourceCount: number,
) {
  const values = Object.values(limits);
  if (!values.every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("META_BUSINESS_DISCOVERY_LIMITS_INVALID");
  }
  const plannedSources = Math.min(sourceCount, limits.maxSources);
  if (plannedSources > limits.maxCalls) throw new Error("META_BUSINESS_DISCOVERY_LIMITS_INVALID");
}

function collection(
  sourceId: string,
  startedAt: number,
  calls: number,
  partial: Partial<InstagramRadarCollection>,
): InstagramRadarCollection {
  return {
    sourceId,
    provider: "meta_business_discovery",
    items: [],
    capability: "unknown",
    complete: false,
    telemetry: { durationMs: Math.max(0, Date.now() - startedAt), calls, billedResults: null, costUsd: null },
    ...partial,
  };
}

/** Pure Graph API adapter. It deliberately owns neither environment nor database access. */
export class MetaBusinessDiscoveryProvider implements InstagramRadarProvider {
  readonly name = "meta_business_discovery" as const;
  readonly #fetch: FetchImplementation;

  constructor(private readonly options: MetaBusinessDiscoveryProviderOptions) {
    if (!/^v\d+\.\d+$/.test(options.graphApiVersion) || !options.instagramUserId || !options.pageAccessToken) {
      throw new Error("META_BUSINESS_DISCOVERY_CONFIGURATION_INVALID");
    }
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async collect({ sources, newerThan, limits }: Parameters<InstagramRadarProvider["collect"]>[0]) {
    validateLimits(limits, sources.length);
    const results: InstagramRadarCollection[] = [];
    let totalItems = 0;
    let calls = 0;

    for (const source of sources.slice(0, limits.maxSources)) {
      const startedAt = Date.now();
      let profile: { username: string };
      try {
        profile = normalizeInstagramProfile(source.username);
      } catch {
        results.push(collection(source.id, startedAt, calls, {
          error: { code: "META_BUSINESS_DISCOVERY_UNSUPPORTED", retryable: false },
          capability: "unsupported",
          complete: true,
        }));
        continue;
      }
      const cutoff = newerThan[source.id];
      const cutoffTime = cutoff === null || cutoff === undefined ? null : new Date(cutoff).getTime();
      if (cutoffTime !== null && Number.isNaN(cutoffTime)) throw new Error("META_BUSINESS_DISCOVERY_CURSOR_INVALID");

      const itemLimit = Math.min(limits.maxItemsPerSource, limits.maxItemsTotal - totalItems);
      if (itemLimit <= 0) {
        results.push(collection(source.id, startedAt, calls, { capability: "supported", complete: true }));
        continue;
      }
      const fields = `business_discovery.username(${profile.username}){username,name,profile_picture_url,media.limit(${itemLimit}){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp}}`;
      const url = new URL(`/${this.options.graphApiVersion}/${this.options.instagramUserId}`, META_GRAPH_ORIGIN);
      url.searchParams.set("fields", fields);
      const signal = AbortSignal.timeout(META_TIMEOUT_MS);

      let response: Response;
      let body: GraphResponse;
      try {
        calls += 1;
        response = await this.#fetch(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${this.options.pageAccessToken}` },
          redirect: "error",
          signal,
        });
        body = await response.json().catch(() => ({})) as GraphResponse;
      } catch (error) {
        const timeout = signal.aborted || error instanceof DOMException && error.name === "TimeoutError";
        results.push(collection(source.id, startedAt, calls, {
          error: { code: timeout ? "META_BUSINESS_DISCOVERY_TIMEOUT" : "META_BUSINESS_DISCOVERY_FAILED", retryable: true },
        }));
        continue;
      }

      if (!response.ok || body.error) {
        const mapped = graphError(response, body);
        results.push(collection(source.id, startedAt, calls, {
          error: { code: mapped.code, retryable: mapped.retryable },
          capability: mapped.unsupported ? "unsupported" : "unknown",
          complete: mapped.unsupported,
        }));
        continue;
      }

      const discovery = body.business_discovery;
      if (!discovery || typeof discovery.username !== "string" || !discovery.username) {
        results.push(collection(source.id, startedAt, calls, {
          error: { code: "META_BUSINESS_DISCOVERY_UNSUPPORTED", retryable: false },
          capability: "unsupported",
          complete: true,
        }));
        continue;
      }

      const sourceUsername = discovery.username.toLowerCase();
      const sourceName = typeof discovery.name === "string" && discovery.name ? discovery.name : null;
      const media = Array.isArray(discovery.media?.data) ? discovery.media.data as GraphMedia[] : [];
      const items: InstagramRadarItem[] = [];
      for (const candidate of media) {
        if (items.length >= itemLimit || totalItems + items.length >= limits.maxItemsTotal) break;
        const canonicalUrl = typeof candidate.permalink === "string" ? normalizeInstagramPermalink(candidate.permalink) : null;
        const publishedAt = validTimestamp(candidate.timestamp);
        if (typeof candidate.id !== "string" || !candidate.id || !canonicalUrl || !publishedAt) continue;
        if (cutoffTime !== null && new Date(publishedAt).getTime() < cutoffTime) continue;
        const thumbnailUrl = safeHttpsUrl(candidate.thumbnail_url) ?? safeHttpsUrl(candidate.media_url);
        items.push({
          externalId: candidate.id,
          canonicalUrl,
          sourceUsername,
          sourceName,
          caption: typeof candidate.caption === "string" ? candidate.caption : "",
          publishedAt,
          thumbnailUrl,
          mediaType: mediaType(candidate.media_type, canonicalUrl),
        });
      }
      totalItems += items.length;
      results.push(collection(source.id, startedAt, calls, {
        items,
        capability: "supported",
        // This PR intentionally performs one Graph call per source. A cursor
        // means the future worker must not advance its high-water mark yet.
        complete: !hasNextPage(discovery),
      }));
    }
    return results;
  }
}
