export const EMPLOYEE_SOURCE_MODES = ["link", "text", "image"] as const;

export type EmployeeSourceMode = typeof EMPLOYEE_SOURCE_MODES[number];

export type SourceQualityInput = {
  sourceMode: unknown;
  headline: unknown;
  text: unknown;
  sourceUrl: unknown;
  imageUrl: unknown;
};

export type SourceQualityIssue = {
  code: string;
  message: string;
};

const trimmedLength = (value: unknown) =>
  typeof value === "string" ? value.trim().length : 0;

const isHttpUrl = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export function normalizeEmployeeSourceMode(
  value: unknown,
): EmployeeSourceMode | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return EMPLOYEE_SOURCE_MODES.includes(normalized as EmployeeSourceMode)
    ? normalized as EmployeeSourceMode
    : null;
}

export function inferEmployeeSourceMode(
  sourceUrl: unknown,
  imageUrl: unknown,
): EmployeeSourceMode {
  if (isHttpUrl(sourceUrl)) return "link";
  if (isHttpUrl(imageUrl)) return "image";
  return "text";
}

export function validateEmployeeSourceQuality(
  input: SourceQualityInput,
): SourceQualityIssue | null {
  const sourceMode = normalizeEmployeeSourceMode(input.sourceMode);
  if (!sourceMode) {
    return {
      code: "SOURCE_MODE_INVALID",
      message: "Escolha uma origem valida para a materia.",
    };
  }

  if (trimmedLength(input.headline) < 8) {
    return {
      code: "SOURCE_HEADLINE_TOO_SHORT",
      message: "Informe um titulo claro com pelo menos 8 caracteres.",
    };
  }

  if (sourceMode === "link" && !isHttpUrl(input.sourceUrl)) {
    return {
      code: "SOURCE_URL_REQUIRED",
      message: "Informe um link HTTP ou HTTPS valido.",
    };
  }

  if (sourceMode === "image" && !isHttpUrl(input.imageUrl)) {
    return {
      code: "SOURCE_IMAGE_REQUIRED",
      message: "Envie uma imagem valida para usar este modo.",
    };
  }

  const minimumTextLength = sourceMode === "image" ? 40 : 5;
  if (trimmedLength(input.text) < minimumTextLength) {
    return {
      code: "SOURCE_TEXT_TOO_SHORT",
      message: sourceMode === "image"
        ? "Inclua um briefing factual com pelo menos 40 caracteres para orientar a leitura da imagem."
        : "A fonte precisa ter pelo menos 5 caracteres de conteudo verificavel.",
    };
  }

  return null;
}
