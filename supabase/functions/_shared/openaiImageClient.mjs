import { sanitizeProviderErrorCode } from "./openaiResponsesClient.mjs";

export const OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits";
export const OPENAI_IMAGE_PRICING_VERSION = "openai-image-standard-2026-09-07";

const MODEL = "gpt-image-2";
const RATES_PER_MILLION_USD = Object.freeze({ textInput: 5, imageInput: 8, imageOutput: 30 });

export class OpenAIImageError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "OpenAIImageError";
    this.code = sanitizeProviderErrorCode(code);
    this.status = status;
  }
}

export function requireOpenAIImageModel(value) {
  const model = typeof value === "string" ? value.trim() : "";
  if (model !== MODEL) throw new OpenAIImageError("OPENAI_IMAGE_MODEL_UNSUPPORTED", 500);
  return model;
}

export function buildSafeImageEditPrompt(userInstruction) {
  const instruction = String(userInstruction ?? "").replace(/\s+/g, " ").trim();
  if (!instruction || instruction.length > 1200) throw new OpenAIImageError("IMAGE_INSTRUCTION_INVALID", 400);
  return [
    "Edite esta fotografia com fidelidade jornalistica.",
    "Preserve pessoas, identidades, objetos relevantes, textos, placas, local, momento e significado factual da cena.",
    "Ajuste somente qualidade tecnica, iluminacao, contraste, cor, ruido, nitidez e pequenas imperfeicoes conforme solicitado.",
    "Nao adicione eventos, pessoas, objetos ou informacoes que nao existam na imagem original.",
    `Solicitacao do usuario: ${instruction}`,
  ].join("\n");
}

function decodeBase64(value) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    throw new OpenAIImageError("OPENAI_IMAGE_OUTPUT_INVALID", 502);
  }
}

export function estimateOpenAIImageCost({ inputTextTokens, inputImageTokens, outputImageTokens }) {
  const text = Math.max(0, Number(inputTextTokens) || 0);
  const image = Math.max(0, Number(inputImageTokens) || 0);
  const output = Math.max(0, Number(outputImageTokens) || 0);
  const cost = (text * RATES_PER_MILLION_USD.textInput + image * RATES_PER_MILLION_USD.imageInput + output * RATES_PER_MILLION_USD.imageOutput) / 1_000_000;
  return Number(cost.toFixed(8));
}

export async function callOpenAIImageEdit({ apiKey, model, imageBytes, imageMimeType, imageFileName, prompt, fetchImpl = fetch, signal }) {
  if (!apiKey?.trim()) throw new OpenAIImageError("OPENAI_API_KEY_NOT_CONFIGURED", 500);
  const requestedModel = requireOpenAIImageModel(model);
  const form = new FormData();
  form.append("model", requestedModel);
  form.append("image[]", new Blob([imageBytes], { type: imageMimeType }), imageFileName);
  form.append("prompt", prompt);
  form.append("quality", "medium");
  form.append("size", "auto");
  form.append("output_format", "png");
  form.append("moderation", "auto");
  form.append("n", "1");

  let response;
  try {
    response = await fetchImpl(OPENAI_IMAGE_EDIT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new OpenAIImageError("OPENAI_IMAGE_TIMEOUT", 504);
    throw new OpenAIImageError("OPENAI_IMAGE_NETWORK_ERROR", 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new OpenAIImageError(`OPENAI_IMAGE_HTTP_${response.status}`, 502);
  }
  if (!response.ok) throw new OpenAIImageError(data?.error?.code || `OPENAI_IMAGE_HTTP_${response.status}`, response.status === 429 ? 429 : 502);
  const encoded = data?.data?.[0]?.b64_json;
  if (typeof encoded !== "string" || !encoded) throw new OpenAIImageError("OPENAI_IMAGE_OUTPUT_MISSING", 502);

  const usage = data?.usage ?? {};
  const inputTokens = Math.max(0, Number(usage.input_tokens) || 0);
  const inputTextTokens = Math.max(0, Number(usage.input_tokens_details?.text_tokens) || 0);
  const detailedImageTokens = Math.max(0, Number(usage.input_tokens_details?.image_tokens) || 0);
  const inputImageTokens = detailedImageTokens || Math.max(0, inputTokens - inputTextTokens);
  const outputImageTokens = Math.max(0, Number(usage.output_tokens) || 0);
  if (!inputTokens || !outputImageTokens) throw new OpenAIImageError("OPENAI_IMAGE_USAGE_MISSING", 502);

  return {
    bytes: decodeBase64(encoded),
    mimeType: "image/png",
    extension: "png",
    actualModel: String(data.model ?? requestedModel).slice(0, 120),
    providerRequestId: String(response.headers.get("x-request-id") ?? data.id ?? "").slice(0, 200),
    inputTokens,
    inputTextTokens,
    inputImageTokens,
    outputTokens: outputImageTokens,
    outputImageTokens,
  };
}
