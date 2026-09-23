export interface InstagramSourceInfo {
  id: string;
  url: string;
}

export interface InstagramCollectOptions {
  sources: InstagramSourceInfo[];
  newerThan: string | null;
  maxResultsPerSource: number;
}

export interface InstagramItem {
  externalId: string;
  canonicalUrl: string;
  originalUrl: string;
  sourceUsername: string;
  sourceName: string;
  caption: string;
  publishedAt: string;
  thumbnailUrl: string;
  mediaType: string;
}

export interface InstagramCollectionResult {
  sourceId: string;
  items: InstagramItem[];
  error?: string;
  billedResults?: number;
}

export interface InstagramProvider {
  collect(options: InstagramCollectOptions): Promise<InstagramCollectionResult[]>;
}
