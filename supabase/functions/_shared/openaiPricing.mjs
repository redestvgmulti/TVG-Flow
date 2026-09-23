// Standard short-context text pricing captured from the official OpenAI model
// pages on 2026-09-07. Keep the version when changing any rate.
export const OPENAI_PRICING_VERSION = "openai-standard-2026-09-07";

const PRICES_PER_MILLION_USD = Object.freeze({
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50 },
  "gpt-5.6-sol": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6": { input: 4, cachedInput: 0.4, output: 20 },
  "gpt-5.6-terra": { input: 2, cachedInput: 0.2, output: 12 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
});

export function requirePricedOpenAIModel(model) {
  const normalized = typeof model === "string" ? model.trim() : "";
  if (!Object.hasOwn(PRICES_PER_MILLION_USD, normalized)) {
    const error = new Error("OPENAI_CHAT_MODEL_UNSUPPORTED");
    error.code = "OPENAI_CHAT_MODEL_UNSUPPORTED";
    throw error;
  }
  return normalized;
}

export function estimateOpenAICost({ model, inputTokens, cachedInputTokens, outputTokens }) {
  const normalized = requirePricedOpenAIModel(model);
  const rates = PRICES_PER_MILLION_USD[normalized];
  const input = Math.max(0, Number(inputTokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(cachedInputTokens) || 0));
  const output = Math.max(0, Number(outputTokens) || 0);
  const cost = ((input - cached) * rates.input + cached * rates.cachedInput + output * rates.output) / 1_000_000;
  return Number(cost.toFixed(8));
}
