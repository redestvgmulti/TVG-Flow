const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export class OpenAIProviderError extends Error {
  constructor(code, status = 502) {
    super(code);
    this.name = "OpenAIProviderError";
    this.code = sanitizeProviderErrorCode(code);
    this.status = status;
  }
}

export function sanitizeProviderErrorCode(value) {
  const normalized = String(value ?? "CHAT_PROVIDER_ERROR")
    .toUpperCase()
    .replace(/[^A-Z0-9_:-]/g, "_")
    .slice(0, 80);
  return normalized || "CHAT_PROVIDER_ERROR";
}

function outputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const parts = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

export async function callOpenAIResponses({
  apiKey,
  model,
  instructions,
  history,
  maxOutputTokens,
  fetchImpl = fetch,
  signal,
}) {
  if (!apiKey?.trim()) throw new OpenAIProviderError("OPENAI_API_KEY_NOT_CONFIGURED", 500);
  let response;
  try {
    response = await fetchImpl(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        instructions,
        input: history.map(({ role, content }) => ({ role, content })),
        max_output_tokens: maxOutputTokens,
        store: false,
      }),
      signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new OpenAIProviderError("OPENAI_TIMEOUT", 504);
    throw new OpenAIProviderError("OPENAI_NETWORK_ERROR", 502);
  }

  let data = null;
  try {
    data = await response.json();
  } catch {
    throw new OpenAIProviderError(`OPENAI_HTTP_${response.status}`, 502);
  }
  if (!response.ok) {
    throw new OpenAIProviderError(data?.error?.code || `OPENAI_HTTP_${response.status}`, 502);
  }
  if (data?.status !== "completed") {
    throw new OpenAIProviderError(data?.incomplete_details?.reason || "OPENAI_RESPONSE_INCOMPLETE", 502);
  }

  const content = outputText(data);
  if (!content) throw new OpenAIProviderError("OPENAI_EMPTY_RESPONSE", 502);

  const inputTokens = Math.max(0, Number(data.usage?.input_tokens) || 0);
  return {
    content,
    providerRequestId: String(data.id ?? "").slice(0, 200),
    actualModel: String(data.model ?? model).slice(0, 120),
    inputTokens,
    cachedInputTokens: Math.min(inputTokens, Math.max(0, Number(data.usage?.input_tokens_details?.cached_tokens) || 0)),
    outputTokens: Math.max(0, Number(data.usage?.output_tokens) || 0),
  };
}

export { OPENAI_RESPONSES_URL };
