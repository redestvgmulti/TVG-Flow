import { RenderContractError, type RenderLayers } from "./renderContract.ts";

type JsonRecord = Record<string, unknown>;
type ComposerContentType = "feed" | "reels" | "story";

type ComposerLayerMap = {
  headline?: string;
  news_image?: string;
  visual_title?: string;
  footer_slot_1: string;
  footer_slot_2: string;
  footer_slot_3: string;
};

const CONTRACT_VERSION = "territorial_composer_v1";
const LAYER_KEYS = new Set([
  "headline",
  "news_image",
  "visual_title",
  "footer_slot_1",
  "footer_slot_2",
  "footer_slot_3",
]);

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireString(value: unknown, code: string, field: string): string {
  const normalized = stringValue(value);
  if (!normalized) throw new RenderContractError(code, field);
  return normalized;
}

function requireHttpUrl(value: unknown, code: string, field: string): string {
  const url = requireString(value, code, field);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("protocol");
    }
  } catch {
    throw new RenderContractError(code, field);
  }
  return url;
}

function requireUuid(value: unknown, code: string, field: string): string {
  const uuid = requireString(value, code, field);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(uuid)
  ) {
    throw new RenderContractError(code, field);
  }
  return uuid;
}

function validateChecksum(value: unknown, code: string): string {
  const checksum = requireString(value, code, "sha256");
  if (!/^[0-9a-f]{64}$/.test(checksum)) {
    throw new RenderContractError(code, "sha256");
  }
  return checksum;
}

function validateAsset(value: unknown, code: string): {
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
  const base = requireHttpUrl(supabaseUrl, "ASSET_BASE_URL_INVALID", "base");
  const bucket = encodeURIComponent(asset.bucket);
  const path = asset.path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${
    base.replace(/\/+$/, "")
  }/storage/v1/object/public/${bucket}/${path}`;
}

function validateTemplateToken(value: unknown): string {
  const token = requireString(
    value,
    "COMPOSER_TEMPLATE_UUID_MISSING",
    "master_template_uuid",
  );
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(token)) {
    throw new RenderContractError("COMPOSER_TEMPLATE_UUID_INVALID");
  }
  return token;
}

function validateLayerMap(
  value: unknown,
  contentType: ComposerContentType,
): ComposerLayerMap {
  if (!isRecord(value)) {
    throw new RenderContractError("COMPOSER_LAYER_MAP_INVALID", "not_object");
  }
  if (Object.keys(value).some((key) => !LAYER_KEYS.has(key))) {
    throw new RenderContractError("COMPOSER_LAYER_MAP_INVALID", "unknown_key");
  }

  const map: ComposerLayerMap = {
    headline: stringValue(value.headline) || undefined,
    footer_slot_1: requireString(
      value.footer_slot_1,
      "COMPOSER_LAYER_MAP_INVALID",
      "footer_slot_1",
    ),
    footer_slot_2: requireString(
      value.footer_slot_2,
      "COMPOSER_LAYER_MAP_INVALID",
      "footer_slot_2",
    ),
    footer_slot_3: requireString(
      value.footer_slot_3,
      "COMPOSER_LAYER_MAP_INVALID",
      "footer_slot_3",
    ),
    news_image: stringValue(value.news_image) || undefined,
    visual_title: stringValue(value.visual_title) || undefined,
  };

  if (contentType === "story") {
    if (map.visual_title) {
      throw new RenderContractError("STORY_VISUAL_TITLE_LAYER_FORBIDDEN");
    }
    if (map.headline) {
      throw new RenderContractError("STORY_HEADLINE_LAYER_FORBIDDEN");
    }
    if (map.news_image) {
      throw new RenderContractError("STORY_NEWS_IMAGE_LAYER_FORBIDDEN");
    }
  } else if (!map.headline || !map.visual_title) {
    throw new RenderContractError(
      "COMPOSER_LAYER_MAP_INVALID",
      !map.headline ? "headline" : "visual_title",
    );
  }
  if (contentType === "feed" && !map.news_image) {
    throw new RenderContractError(
      "COMPOSER_LAYER_MAP_INVALID",
      "news_image",
    );
  }
  if (contentType === "reels" && map.news_image) {
    throw new RenderContractError("REELS_NEWS_IMAGE_FORBIDDEN");
  }

  const physicalNames = Object.values(map).filter(Boolean) as string[];
  if (new Set(physicalNames).size !== physicalNames.length) {
    throw new RenderContractError(
      "COMPOSER_LAYER_MAP_INVALID",
      "duplicate_layer",
    );
  }
  return map;
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

export function isTerritorialComposerContract(item: JsonRecord): boolean {
  return stringValue(item.render_contract_version) === CONTRACT_VERSION;
}

export function prepareTerritorialComposerRender(
  item: JsonRecord,
  supabaseUrl: string,
): {
  path: "territorial_composer_v1";
  templateId: string;
  layers: RenderLayers;
} {
  const snapshot = item.render_snapshot;
  if (!isRecord(snapshot)) {
    throw new RenderContractError("COMPOSER_SNAPSHOT_MISSING");
  }
  if (
    stringValue(item.render_contract_version) !== CONTRACT_VERSION ||
    stringValue(snapshot.render_contract_version) !== CONTRACT_VERSION
  ) {
    throw new RenderContractError(
      "COMPOSER_SNAPSHOT_MISSING",
      "version_mismatch",
    );
  }

  const contentType = stringValue(item.content_type);
  if (
    contentType !== "feed" && contentType !== "reels" &&
    contentType !== "story"
  ) {
    throw new RenderContractError("CONTENT_TYPE_INVALID");
  }

  const composer = snapshot.composer;
  if (
    !isRecord(composer) ||
    stringValue(composer.content_type) !== contentType ||
    !["editorial", "cities", "individual"].includes(
      stringValue(composer.mode) || "",
    )
  ) {
    throw new RenderContractError("COMPOSER_SNAPSHOT_INVALID", "composer");
  }

  const template = snapshot.template;
  if (!isRecord(template)) {
    throw new RenderContractError("COMPOSER_SNAPSHOT_INVALID", "template");
  }
  const templateId = validateTemplateToken(template.master_template_uuid);
  const layerMap = validateLayerMap(snapshot.layer_map, contentType);
  const layers: RenderLayers = {};

  const renderContent = snapshot.render_content;
  if (!isRecord(renderContent)) {
    throw new RenderContractError(
      "COMPOSER_SNAPSHOT_INVALID",
      "render_content",
    );
  }
  if (contentType !== "story") {
    addText(
      layers,
      layerMap.headline,
      requireString(renderContent.headline, "HEADLINE_MISSING", "headline"),
    );
  }

  if (layerMap.news_image) {
    const newsImageUrl = requireHttpUrl(
      renderContent.source_image_url,
      "SOURCE_IMAGE_REQUIRED",
      "source_image_url",
    );
    addImage(layers, layerMap.news_image, newsImageUrl);
  }

  if (contentType !== "story") {
    const visualTitle = validateAsset(
      snapshot.visual_title,
      "VISUAL_TITLE_SNAPSHOT_INVALID",
    );
    addImage(
      layers,
      layerMap.visual_title,
      storageAssetUrl(supabaseUrl, visualTitle),
    );
  }

  if (!Array.isArray(snapshot.footer_slots)) {
    throw new RenderContractError("FOOTER_SLOTS_INVALID", "not_array");
  }
  if (
    snapshot.footer_slots.length < 1 ||
    snapshot.footer_slots.length > 3
  ) {
    throw new RenderContractError("FOOTER_SLOTS_INVALID", "count");
  }

  const seenSlots = new Set<string>();
  for (const rawSlot of snapshot.footer_slots) {
    if (!isRecord(rawSlot)) {
      throw new RenderContractError("FOOTER_SLOT_INVALID", "item");
    }
    const slot = stringValue(rawSlot.slot);
    if (
      slot !== "footer_slot_1" &&
      slot !== "footer_slot_2" &&
      slot !== "footer_slot_3"
    ) {
      throw new RenderContractError("FOOTER_SLOT_INVALID", "slot");
    }
    if (seenSlots.has(slot)) {
      throw new RenderContractError("FOOTER_SLOT_DUPLICATE");
    }
    if (
      !["region", "sponsor"].includes(stringValue(rawSlot.source_type) || "")
    ) {
      throw new RenderContractError("FOOTER_SLOT_INVALID", "source_type");
    }
    requireUuid(rawSlot.source_id, "FOOTER_SLOT_INVALID", "source_id");
    const asset = validateAsset(rawSlot, "FOOTER_ASSET_INVALID");
    addImage(
      layers,
      layerMap[slot],
      storageAssetUrl(supabaseUrl, asset),
    );
    seenSlots.add(slot);
  }

  if (
    Object.values(layers).some((layer) =>
      ("image" in layer && !stringValue(layer.image)) ||
      ("text" in layer && !stringValue(layer.text))
    )
  ) {
    throw new RenderContractError("EMPTY_LAYER_VALUE_FORBIDDEN");
  }

  return {
    path: "territorial_composer_v1",
    templateId,
    layers,
  };
}
