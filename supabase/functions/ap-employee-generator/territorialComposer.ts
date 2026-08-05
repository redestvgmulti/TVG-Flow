export const TERRITORIAL_COMPOSER_CONTRACT = "territorial_composer_v1";
export const TERRITORIAL_COMPOSER_MODES = [
  "editorial",
  "cities",
  "individual",
] as const;

export type TerritorialComposerMode = typeof TERRITORIAL_COMPOSER_MODES[number];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

export function normalizeComposerMode(
  value: unknown,
): TerritorialComposerMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return TERRITORIAL_COMPOSER_MODES.includes(
      normalized as TerritorialComposerMode,
    )
    ? normalized as TerritorialComposerMode
    : null;
}

export type ComposerValidationFailure = {
  code: string;
  message: string;
  status: number;
};

export function validateTerritorialComposerIntent(input: {
  mode: TerritorialComposerMode | null;
  contentType: string;
  regionId: unknown;
  cityId: unknown;
  visualTitleId: unknown;
  manualSlots: unknown;
  rawVisualModel: unknown;
}): ComposerValidationFailure | null {
  if (!input.mode) {
    return {
      code: "COMPOSER_MODE_INVALID",
      message: "Selecione o modo de composicao.",
      status: 400,
    };
  }
  if (
    input.rawVisualModel !== undefined && input.rawVisualModel !== null &&
    input.rawVisualModel !== ""
  ) {
    return {
      code: "VISUAL_MODEL_NOT_ALLOWED",
      message: "A finalidade visual nao pertence ao novo compositor.",
      status: 400,
    };
  }

  const slots = Array.isArray(input.manualSlots) ? input.manualSlots : [];
  if (!Array.isArray(input.manualSlots)) {
    return {
      code: "MANUAL_SLOTS_INVALID",
      message: "Os slots manuais sao invalidos.",
      status: 400,
    };
  }
  if (slots.length > 3) {
    return {
      code: "MANUAL_SLOT_LIMIT_EXCEEDED",
      message: "Use no maximo tres slots inferiores.",
      status: 400,
    };
  }

  const seenSlots = new Set<string>();
  for (const slot of slots) {
    if (!isRecord(slot)) {
      return {
        code: "MANUAL_SLOT_INVALID",
        message: "Um slot manual e invalido.",
        status: 400,
      };
    }
    const slotName = slot.slot;
    const sourceType = slot.source_type;
    if (
      !["footer_slot_1", "footer_slot_2", "footer_slot_3"].includes(
        String(slotName),
      ) ||
      !["region", "sponsor"].includes(String(sourceType)) ||
      !isUuid(slot.source_id) ||
      seenSlots.has(String(slotName))
    ) {
      return {
        code: "MANUAL_SLOT_INVALID",
        message: "Um slot manual e invalido ou duplicado.",
        status: 400,
      };
    }
    seenSlots.add(String(slotName));
  }

  if (input.mode === "editorial") {
    if (
      !isUuid(input.regionId) || !isUuid(input.visualTitleId) ||
      input.cityId || slots.length
    ) {
      return {
        code: "EDITORIAL_INTENT_INVALID",
        message: "Selecione um selo editorial e uma regiao.",
        status: 400,
      };
    }
  }

  if (input.mode === "cities") {
    if (
      !isUuid(input.cityId) || input.regionId || input.visualTitleId ||
      slots.length
    ) {
      return {
        code: "CITY_INTENT_INVALID",
        message: "Selecione uma cidade valida.",
        status: 400,
      };
    }
  }

  if (input.mode === "individual") {
    if (input.regionId || input.cityId || slots.length < 1) {
      return {
        code: "INDIVIDUAL_INTENT_INVALID",
        message: "Preencha entre um e tres slots inferiores.",
        status: 400,
      };
    }
    if (input.contentType === "story") {
      if (input.visualTitleId) {
        return {
          code: "STORY_VISUAL_TITLE_FORBIDDEN",
          message: "Stories Individual nao utiliza selo visual.",
          status: 400,
        };
      }
    } else if (!isUuid(input.visualTitleId)) {
      return {
        code: "VISUAL_TITLE_REQUIRED",
        message: "Selecione um selo para esta arte.",
        status: 400,
      };
    }
  }

  return null;
}

export async function territorialComposerEnabled(
  supabase: any,
  clienteId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .schema("ap")
    .from("territorial_composer_features")
    .select("enabled")
    .eq("cliente_id", clienteId)
    .maybeSingle();

  if (error) {
    // Before the additive migration exists, every tenant remains on the legacy
    // flow. Other database failures are surfaced instead of enabling silently.
    if (
      error.code === "42P01" || error.code === "PGRST205" ||
      /territorial_composer_features.*does not exist|Could not find.*territorial_composer_features/i
        .test(error.message || "")
    ) {
      return false;
    }
    throw new Error("TERRITORIAL_COMPOSER_FLAG_READ_FAILED");
  }
  return data?.enabled === true;
}
