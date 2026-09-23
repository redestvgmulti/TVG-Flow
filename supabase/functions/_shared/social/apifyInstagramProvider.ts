import { InstagramProvider, InstagramCollectOptions, InstagramCollectionResult, InstagramItem } from "./instagramProvider.ts";

export class ApifyInstagramProvider implements InstagramProvider {
  private apiToken: string;
  private actorId = "apify~instagram-scraper";

  constructor() {
    this.apiToken = Deno.env.get("APIFY_API_TOKEN") || "";
  }

  async collect(options: InstagramCollectOptions): Promise<InstagramCollectionResult[]> {
    if (!this.apiToken) {
      throw new Error("Missing APIFY_API_TOKEN");
    }

    const results: InstagramCollectionResult[] = [];

    const profilesToScrape = options.sources.map(s => {
      const match = s.url.match(/instagram\.com\/([^/?#]+)/i);
      return match ? `https://www.instagram.com/${match[1]}/` : s.url;
    });

    const payload: any = {
      directUrls: profilesToScrape,
      resultsType: "posts",
      resultsLimit: options.maxResultsPerSource * options.sources.length,
    };

    if (options.newerThan) {
      payload.onlyPostsNewerThan = options.newerThan;
    }

    const apifyUrl = `https://api.apify.com/v2/acts/${this.actorId}/run-sync-get-dataset-items?token=${this.apiToken}`;

    const response = await fetch(apifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`Apify Actor failed with status ${response.status}`);
    }

    const items = await response.json();
    const itemsByUsername = new Map<string, InstagramItem[]>();
    const cutoffMs = options.newerThan ? new Date(options.newerThan).getTime() : 0;

    for (const item of items) {
       const publishedMs = item.timestamp ? new Date(item.timestamp).getTime() : 0;

       if (cutoffMs > 0 && publishedMs < cutoffMs) {
          continue;
       }

       const username = item.ownerUsername;
       if (!username) continue;

       let mediaType = "feed";
       let urlType = "p";
       if (item.type === "Video") {
           mediaType = "reels";
           urlType = "reel";
       }
       if (item.type === "Sidecar") mediaType = "feed";

       const normalizedItem: InstagramItem = {
           externalId: item.shortCode || item.id,
           canonicalUrl: item.shortCode ? `https://www.instagram.com/${urlType}/${item.shortCode}/` : item.url,
           originalUrl: item.url,
           sourceUsername: username,
           sourceName: item.ownerFullName || username,
           caption: item.caption || "",
           publishedAt: item.timestamp,
           thumbnailUrl: item.displayUrl,
           mediaType: mediaType
       };

       if (!itemsByUsername.has(username)) {
           itemsByUsername.set(username, []);
       }

       itemsByUsername.get(username)!.push(normalizedItem);
    }

    for (const source of options.sources) {
        let matchedUsername = "";
        const match = source.url.match(/instagram\.com\/([^/?#]+)/i);
        if (match) {
            matchedUsername = match[1];
        } else {
            matchedUsername = source.url.replace("@", "");
        }

        const sourceItems = itemsByUsername.get(matchedUsername) || [];
        const limitedItems = sourceItems.slice(0, options.maxResultsPerSource);

        results.push({
            sourceId: source.id,
            items: limitedItems,
            billedResults: limitedItems.length
        });
    }

    return results;
  }
}
