/** Contract only. Production providers follow the real, read-only Meta POC. */
export type InstagramRadarProviderName = 'meta_business_discovery' | 'apify';
export type InstagramRadarMediaType = 'feed' | 'reel' | 'carousel' | 'unknown';

export interface InstagramRadarSource {
  id: string;
  clienteId: string;
  username: string;
  url: string;
}

export interface InstagramRadarItem {
  /** Numeric Instagram media ID as a string; never substitute a shortcode. */
  externalId: string;
  canonicalUrl: string;
  sourceUsername: string;
  sourceName: string | null;
  caption: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  mediaType: InstagramRadarMediaType;
}

export interface InstagramRadarCollection {
  sourceId: string;
  provider: InstagramRadarProviderName;
  items: InstagramRadarItem[];
  capability: 'supported' | 'unsupported' | 'unknown';
  error?: { code: string; retryable: boolean };
  /** False means the worker must not advance its high-water mark. */
  complete: boolean;
  telemetry: {
    durationMs: number;
    calls: number;
    usage?: Record<string, unknown>;
    /** Null means the provider did not supply a measurable value. */
    billedResults: number | null;
    costUsd: number | null;
    runId?: string;
  };
}

export interface InstagramRadarProvider {
  readonly name: InstagramRadarProviderName;
  collect(options: {
    sources: InstagramRadarSource[];
    /** Per-source media cursor with overlap, not the last successful wall-clock check. */
    newerThan: Record<string, string | null>;
    limits: { maxSources: number; maxItemsPerSource: number; maxItemsTotal: number; maxCalls: number };
  }): Promise<InstagramRadarCollection[]>;
}
