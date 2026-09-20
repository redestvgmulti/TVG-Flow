export interface EditorialAiDraft {
  headline: string;
  body: string;
  caption: string;
  context_tag: string;
  category: string;
  location: {
    city: string | null;
    region: string | null;
    state: string | null;
  };
}

export const EDITORIAL_AI_DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    headline: { type: "string" },
    body: { type: "string" },
    caption: { type: "string" },
    context_tag: { type: "string" },
    category: { type: "string" },
    location: {
      type: "object",
      properties: {
        city: { type: ["string", "null"] },
        region: { type: ["string", "null"] },
        state: { type: ["string", "null"] },
      },
      required: ["city", "region", "state"],
      additionalProperties: false,
    },
  },
  required: ["headline", "body", "caption", "context_tag", "category", "location"],
  additionalProperties: false,
};

const ROOT_KEYS = ["body", "caption", "category", "context_tag", "headline", "location"];
const LOCATION_KEYS = ["city", "region", "state"];

export function editorialAiDraftShapeDiagnostics(content: string) {
  try {
    const parsed = JSON.parse(String(content ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { root_type: Array.isArray(parsed) ? "array" : typeof parsed };
    }
    const root = parsed as Record<string, unknown>;
    const location = root.location;
    const rootKeys = Object.keys(root);
    const result: Record<string, unknown> = {
      missing_root: ROOT_KEYS.filter((key) => !rootKeys.includes(key)),
      extra_root_count: rootKeys.filter((key) => !ROOT_KEYS.includes(key)).length,
      location_type: Array.isArray(location) ? "array" : typeof location,
    };
    if (location && typeof location === "object" && !Array.isArray(location)) {
      const locationKeys = Object.keys(location as Record<string, unknown>);
      result.missing_location = LOCATION_KEYS.filter((key) => !locationKeys.includes(key));
      result.extra_location_count = locationKeys.filter((key) => !LOCATION_KEYS.includes(key)).length;
    }
    return result;
  } catch {
    return { root_type: "invalid_json" };
  }
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`EDITORIAL_AI_INVALID_${field.toUpperCase()}`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength || normalized.includes("```")) {
    throw new Error(`EDITORIAL_AI_INVALID_${field.toUpperCase()}`);
  }
  return normalized;
}

function nullableLocation(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`EDITORIAL_AI_INVALID_LOCATION_${field.toUpperCase()}`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw new Error(`EDITORIAL_AI_INVALID_LOCATION_${field.toUpperCase()}`);
  }
  return normalized;
}

function exactKeys(value: Record<string, unknown>, expected: string[], code: string) {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(code);
  }
}

export function parseEditorialAiDraft(content: string): EditorialAiDraft {
  const trimmed = String(content ?? "").trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}") || trimmed.includes("```")) {
    throw new Error("EDITORIAL_AI_INVALID_JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("EDITORIAL_AI_INVALID_JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EDITORIAL_AI_INVALID_JSON");
  }

  const root = parsed as Record<string, unknown>;
  exactKeys(root, ROOT_KEYS, "EDITORIAL_AI_INVALID_SCHEMA");
  if (!root.location || typeof root.location !== "object" || Array.isArray(root.location)) {
    throw new Error("EDITORIAL_AI_INVALID_LOCATION");
  }
  const location = root.location as Record<string, unknown>;
  exactKeys(location, LOCATION_KEYS, "EDITORIAL_AI_INVALID_LOCATION");

  return {
    headline: requiredString(root.headline, "headline", 180),
    body: requiredString(root.body, "body", 12000),
    caption: requiredString(root.caption, "caption", 4000),
    context_tag: requiredString(root.context_tag, "context_tag", 80),
    category: requiredString(root.category, "category", 100),
    location: {
      city: nullableLocation(location.city, "city"),
      region: nullableLocation(location.region, "region"),
      state: nullableLocation(location.state, "state"),
    },
  };
}

export function providerFromBaseUrl(baseUrl: string): string {
  const normalized = String(baseUrl ?? "").toLowerCase();
  if (normalized.includes("anthropic.com")) return "anthropic";
  if (normalized.includes("googleapis.com")) return "google";
  if (normalized.includes("openrouter.ai")) return "openrouter";
  return "openai-compatible";
}

export function sanitizedAiErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "EDITORIAL_AI_FAILED");
  const known = message.match(/EDITORIAL_AI_[A-Z0-9_]+/)?.[0];
  if (known) return known.slice(0, 80);
  if (/timeout|timed out|abort/i.test(message)) return "EDITORIAL_AI_TIMEOUT";
  return "EDITORIAL_AI_PROVIDER_FAILURE";
}
