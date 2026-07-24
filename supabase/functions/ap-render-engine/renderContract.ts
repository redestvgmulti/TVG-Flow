export type RenderLayer = { text?: string; image?: string };
export type RenderLayers = Record<string, RenderLayer>;

export type RenderPath =
  | "legacy"
  | "master_profile_v1"
  | "master_rotation_v1";

type JsonRecord = Record<string, unknown>;

type LayerMap = {
  news_image?: string;
  headline?: string;
  tag?: string;
  visual_title?: string;
  sponsor_1?: string;
  sponsor_2?: string;
};

type SponsorAsset = {
  slot: "sponsor_1" | "sponsor_2";
  sponsor_id: string;
  bucket: string;
  path: string;
  version: string;
  sha256: string;
};

const ALLOWED_LAYER_KEYS = new Set([
  "news_image",
  "headline",
  "tag",
  "visual_title",
  "sponsor_1",
  "sponsor_2",
]);

const REELS_FIXED_LAYERS = new Set(["logo-tvg-fixo", "shadow"]);

export class RenderContractError extends Error {
  code: string;

  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "RenderContractError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function requireString(
  value: unknown,
  code: string,
  field: string,
): string {
  const normalized = stringValue(value);
  if (!normalized) throw new RenderContractError(code, field);
  return normalized;
}

function validateChecksum(value: unknown, code: string): string {
  const checksum = requireString(value, code, "sha256");
  if (!/^[0-9a-f]{64}$/.test(checksum)) {
    throw new RenderContractError(code, "sha256");
  }
  return checksum;
}

function validateAsset(
  value: unknown,
  code: string,
): {
  bucket: string;
  path: string;
  version: string;
  sha256: string;
} {
  if (!isRecord(value)) throw new RenderContractError(code);
  return {
    bucket: requireString(value.bucket, code, "bucket"),
    path: requireString(value.path, code, "path"),
    version: requireString(value.version, code, "version"),
    sha256: validateChecksum(value.sha256, code),
  };
}

function storageAssetUrl(
  supabaseUrl: string,
  asset: { bucket: string; path: string },
): string {
  const base = requireString(supabaseUrl, "ASSET_BASE_URL_INVALID", "base");
  const bucket = encodeURIComponent(asset.bucket);
  const path = asset.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${
    base.replace(/\/+$/, "")
  }/storage/v1/object/public/${bucket}/${path}`;
}

function layerName(value: unknown): string | undefined {
  return stringValue(value) || undefined;
}

function validateTemplateToken(value: unknown): string {
  const token = requireString(
    value,
    "MASTER_UUID_MISSING",
    "master_template_uuid",
  );
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(token)) {
    throw new RenderContractError("MASTER_UUID_INVALID");
  }
  return token;
}

function validateLayerMap(
  value: unknown,
  contentType: "feed" | "reels",
  sponsorCount: number,
): LayerMap {
  if (!isRecord(value)) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "not_object");
  }

  const unknown = Object.keys(value).filter((key) =>
    !ALLOWED_LAYER_KEYS.has(key)
  );
  if (unknown.length) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "unknown_key");
  }

  const map: LayerMap = {
    news_image: layerName(value.news_image),
    headline: layerName(value.headline),
    tag: layerName(value.tag),
    visual_title: layerName(value.visual_title),
    sponsor_1: layerName(value.sponsor_1),
    sponsor_2: layerName(value.sponsor_2),
  };

  if (!map.headline || !map.visual_title) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "required_layer");
  }
  if (contentType === "feed" && !map.news_image) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "news_image");
  }
  if (contentType === "reels" && map.news_image) {
    throw new RenderContractError("REELS_NEWS_IMAGE_FORBIDDEN");
  }
  if (contentType === "reels" && map.tag) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "reels_tag");
  }
  if (sponsorCount >= 1 && !map.sponsor_1) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "sponsor_1");
  }
  if (sponsorCount === 2 && !map.sponsor_2) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "sponsor_2");
  }

  const configuredNames = Object.values(map).filter(Boolean) as string[];
  if (new Set(configuredNames).size !== configuredNames.length) {
    throw new RenderContractError(
      "MASTER_LAYER_MAP_INVALID",
      "duplicate_layer",
    );
  }
  if (configuredNames.some((name) => REELS_FIXED_LAYERS.has(name))) {
    throw new RenderContractError("MASTER_LAYER_MAP_INVALID", "fixed_layer");
  }

  return map;
}

function validateSponsorSelection(
  snapshot: JsonRecord,
  candidateSponsorCount: unknown,
): { sponsorCount: number; items: SponsorAsset[] } {
  const selection = snapshot.sponsor_selection;
  if (!isRecord(selection)) {
    throw new RenderContractError("SPONSOR_SELECTION_INVALID", "missing");
  }
  if (selection.rotation_version !== "sponsor_rotation_v1") {
    throw new RenderContractError(
      "SPONSOR_SELECTION_INVALID",
      "rotation_version",
    );
  }

  const sponsorCount = Number(candidateSponsorCount);
  const requestedCount = Number(selection.requested_count);
  if (
    !Number.isInteger(sponsorCount) ||
    ![0, 1, 2].includes(sponsorCount) ||
    requestedCount !== sponsorCount
  ) {
    throw new RenderContractError("SPONSOR_COUNT_MISMATCH");
  }

  if (
    !Array.isArray(selection.items) || selection.items.length !== sponsorCount
  ) {
    throw new RenderContractError("SPONSOR_COUNT_MISMATCH");
  }

  const seenSlots = new Set<string>();
  const seenSponsors = new Set<string>();
  const items: SponsorAsset[] = [];

  for (const rawItem of selection.items) {
    if (!isRecord(rawItem)) {
      throw new RenderContractError("SPONSOR_SELECTION_INVALID", "item");
    }
    const slot = stringValue(rawItem.slot);
    if (slot !== "sponsor_1" && slot !== "sponsor_2") {
      throw new RenderContractError("SPONSOR_SLOT_INVALID");
    }
    if (seenSlots.has(slot)) {
      throw new RenderContractError("SPONSOR_SLOT_DUPLICATE");
    }
    const sponsorId = requireString(
      rawItem.sponsor_id,
      "SPONSOR_SELECTION_INVALID",
      "sponsor_id",
    );
    if (seenSponsors.has(sponsorId)) {
      throw new RenderContractError("SPONSOR_DUPLICATE");
    }
    const asset = validateAsset(rawItem, "SPONSOR_ASSET_INVALID");
    seenSlots.add(slot);
    seenSponsors.add(sponsorId);
    items.push({ slot, sponsor_id: sponsorId, ...asset });
  }

  if (sponsorCount === 1 && !seenSlots.has("sponsor_1")) {
    throw new RenderContractError("SPONSOR_SLOT_INVALID", "sponsor_1_required");
  }
  if (
    sponsorCount === 2 &&
    (!seenSlots.has("sponsor_1") || !seenSlots.has("sponsor_2"))
  ) {
    throw new RenderContractError("SPONSOR_SLOT_INVALID", "both_required");
  }

  items.sort((a, b) => a.slot.localeCompare(b.slot));
  return { sponsorCount, items };
}

export function detectRenderPath(item: JsonRecord): RenderPath {
  const snapshot = item.render_snapshot;
  const candidateVersion = stringValue(item.render_contract_version);
  if (!isRecord(snapshot)) {
    if (candidateVersion === "master_v1") {
      throw new RenderContractError("MASTER_SNAPSHOT_MISSING");
    }
    return "legacy";
  }

  const snapshotVersion = stringValue(snapshot.render_contract_version);
  const sponsorSource = stringValue(snapshot.sponsor_source);

  if (sponsorSource === "rotation_v1") {
    if (
      snapshotVersion !== "master_v1" ||
      candidateVersion !== "master_v1"
    ) {
      throw new RenderContractError(
        "MASTER_SNAPSHOT_MISSING",
        "version_mismatch",
      );
    }
    return "master_rotation_v1";
  }

  if (snapshotVersion === "master_v1" || candidateVersion === "master_v1") {
    if (
      snapshotVersion !== "master_v1" ||
      candidateVersion !== "master_v1" ||
      !isRecord(snapshot.sponsor_profile)
    ) {
      throw new RenderContractError(
        "MASTER_SNAPSHOT_MISSING",
        "profile_contract",
      );
    }
    return "master_profile_v1";
  }

  return "legacy";
}

function addImage(
  layers: RenderLayers,
  layer: string | undefined,
  image: unknown,
) {
  const url = stringValue(image);
  if (layer && url) layers[layer] = { image: url };
}

function addText(
  layers: RenderLayers,
  layer: string | undefined,
  text: unknown,
) {
  const value = stringValue(text);
  if (layer && value) layers[layer] = { text: value };
}

export function buildMasterLayers(input: {
  contentType: "feed" | "reels";
  layerMap: LayerMap;
  headline: string;
  contextTag?: string | null;
  newsImageUrl?: string | null;
  visualTitleUrl: string;
  sponsorCount: number;
  sponsorItems: Array<{ slot: "sponsor_1" | "sponsor_2"; url: string }>;
}): RenderLayers {
  if (input.sponsorItems.length !== input.sponsorCount) {
    throw new RenderContractError("SPONSOR_COUNT_MISMATCH");
  }
  const layers: RenderLayers = {};

  if (input.contentType === "feed") {
    addImage(layers, input.layerMap.news_image, input.newsImageUrl);
  }
  addText(layers, input.layerMap.headline, input.headline);
  addText(layers, input.layerMap.tag, input.contextTag || "DESTAQUE");
  addImage(layers, input.layerMap.visual_title, input.visualTitleUrl);

  for (const sponsor of input.sponsorItems) {
    addImage(layers, input.layerMap[sponsor.slot], sponsor.url);
  }

  return layers;
}

function finalNewsImage(item: JsonRecord, supabaseUrl: string): string | null {
  const direct = stringValue(item.imagem_url);
  if (direct) return direct;
  const storagePath = stringValue(item.imagem_storage);
  if (!storagePath) return null;
  return storageAssetUrl(supabaseUrl, {
    bucket: "ap-images",
    path: storagePath,
  });
}

export function prepareRotationV1Render(
  item: JsonRecord,
  supabaseUrl: string,
): {
  path: "master_rotation_v1";
  templateId: string;
  layers: RenderLayers;
} {
  if (detectRenderPath(item) !== "master_rotation_v1") {
    throw new RenderContractError(
      "MASTER_SNAPSHOT_MISSING",
      "rotation_contract",
    );
  }

  const snapshot = item.render_snapshot as JsonRecord;
  const contentType = stringValue(item.content_type);
  if (contentType !== "feed" && contentType !== "reels") {
    throw new RenderContractError("CONTENT_TYPE_INVALID");
  }

  const masterConfig = snapshot.master_config;
  if (!isRecord(masterConfig)) {
    throw new RenderContractError("MASTER_SNAPSHOT_MISSING", "master_config");
  }
  const templateId = validateTemplateToken(masterConfig.master_template_uuid);
  const { sponsorCount, items } = validateSponsorSelection(
    snapshot,
    item.sponsor_count,
  );

  // Real producer contract from Sprint B: layer_map is top-level in render_snapshot.
  const layerMap = validateLayerMap(
    snapshot.layer_map,
    contentType,
    sponsorCount,
  );
  const visualTitle = validateAsset(
    snapshot.visual_title,
    "VISUAL_TITLE_SNAPSHOT_INVALID",
  );
  const visualTitleUrl = storageAssetUrl(supabaseUrl, visualTitle);
  const newsImageUrl = contentType === "feed"
    ? finalNewsImage(item, supabaseUrl)
    : null;

  if (contentType === "feed" && !newsImageUrl) {
    throw new RenderContractError("FEED_NEWS_IMAGE_MISSING");
  }

  const headline = requireString(item.headline, "HEADLINE_MISSING", "headline");
  const sponsorItems = items.map((asset) => ({
    slot: asset.slot,
    url: storageAssetUrl(supabaseUrl, asset),
  }));

  return {
    path: "master_rotation_v1",
    templateId,
    layers: buildMasterLayers({
      contentType,
      layerMap,
      headline,
      contextTag: stringValue(item.context_tag),
      newsImageUrl,
      visualTitleUrl,
      sponsorCount,
      sponsorItems,
    }),
  };
}

export function buildProfileMasterLayers(input: {
  item: JsonRecord;
  layerMap: JsonRecord;
  supabaseUrl: string;
}): RenderLayers {
  const contentType = input.item.content_type === "reels" ? "reels" : "feed";
  const map: LayerMap = {
    news_image: layerName(input.layerMap.news_image) || "news-image",
    headline: layerName(input.layerMap.headline) || "headline_news",
    tag: layerName(input.layerMap.tag),
    visual_title: layerName(input.layerMap.visual_title) || "tag-png",
    sponsor_1: layerName(input.layerMap.sponsor_1) || "patrocinador-1",
    sponsor_2: layerName(input.layerMap.sponsor_2) || "patrocinador-2",
  };
  const blocked = contentType === "reels"
    ? REELS_FIXED_LAYERS
    : new Set<string>();
  const layers: RenderLayers = {};
  const safeAddText = (layer: string | undefined, value: unknown) => {
    if (layer && !blocked.has(layer)) addText(layers, layer, value);
  };
  const safeAddImage = (layer: string | undefined, value: unknown) => {
    if (layer && !blocked.has(layer)) addImage(layers, layer, value);
  };

  safeAddText(map.headline, input.item.headline);
  if (contentType === "feed") {
    safeAddText(map.tag, input.item.context_tag || "DESTAQUE");
    safeAddImage(map.news_image, finalNewsImage(input.item, input.supabaseUrl));
  }

  const snapshot = isRecord(input.item.render_snapshot)
    ? input.item.render_snapshot
    : {};
  if (isRecord(snapshot.visual_title)) {
    const titleAsset = snapshot.visual_title;
    const bucket = stringValue(titleAsset.bucket);
    const path = stringValue(titleAsset.path);
    if (bucket && path) {
      safeAddImage(
        map.visual_title,
        storageAssetUrl(input.supabaseUrl, { bucket, path }),
      );
    }
  }

  const profile = isRecord(snapshot.sponsor_profile)
    ? snapshot.sponsor_profile
    : {};
  const slots = isRecord(profile.slots) ? profile.slots : {};
  for (const slot of ["sponsor_1", "sponsor_2"] as const) {
    const asset = slots[slot];
    if (!isRecord(asset)) continue;
    const bucket = stringValue(asset.bucket);
    const path = stringValue(asset.path);
    if (bucket && path) {
      safeAddImage(
        map[slot],
        storageAssetUrl(input.supabaseUrl, { bucket, path }),
      );
    }
  }
  return layers;
}

export function buildLegacyLayers(
  item: JsonRecord,
  supabaseUrl: string,
): RenderLayers {
  const layers: RenderLayers = {};
  addText(layers, "headline_news", item.headline);
  addText(layers, "tag_news", item.context_tag || "DESTAQUE");
  if (item.content_type !== "reels") {
    addImage(layers, "news-image", finalNewsImage(item, supabaseUrl));
  }
  return layers;
}

export async function claimPendingRender(
  supabase: any,
  item: JsonRecord,
  claimedAt: string,
): Promise<boolean> {
  let query = supabase
    .schema("ap")
    .from("candidate_news")
    .update({ render_started_at: claimedAt })
    .eq("id", item.id)
    .eq("status", "pending_render")
    .is("render_url", null);

  const previousClaim = stringValue(item.render_started_at);
  query = previousClaim
    ? query.eq("render_started_at", previousClaim)
    : query.is("render_started_at", null);

  const { data, error } = await query.select("id");
  if (error) {
    throw new RenderContractError("RENDER_CLAIM_FAILED");
  }
  return Boolean(data?.length);
}
