// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AutoPublisher — Motor Editorial: Universal LLM Client
// Provider-agnostic adapter (Anthropic, Gemini, OpenAI-like)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export interface CallLLMParams {
  apiKey: string
  baseUrl: string
  model: string
  prompt: string
  temperature: number
  maxTokens: number
  imageUrl?: string | null
  timeoutMs?: number
  jsonSchema?: Record<string, unknown> | null
}

export interface CallLLMResult {
  content: string
  tokens: {
    total: number
    prompt: number
    completion: number
  }
  raw: any
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\s+/g, '').replace(/\/+$/, '')
}

async function safeParseJson(text: string): Promise<any> {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function callLLM({
  apiKey,
  baseUrl,
  model,
  prompt,
  temperature,
  maxTokens,
  imageUrl,
  timeoutMs = 30000,
  jsonSchema,
}: CallLLMParams): Promise<CallLLMResult> {
  let cleanBaseUrl = normalizeBaseUrl(baseUrl || '');
  let cleanModel = model.trim();
  let normalizedImageUrl: string | null = null;
  if (imageUrl) {
    try {
      const parsedImageUrl = new URL(imageUrl);
      if (parsedImageUrl.protocol === 'http:' || parsedImageUrl.protocol === 'https:') {
        normalizedImageUrl = parsedImageUrl.toString();
      }
    } catch {
      normalizedImageUrl = null;
    }
  }

  // 1. AUTO-ROUTING INTELLIGENCE (Override based on API Key Prefix)
  // This makes the system resilient against client misconfiguration.
  const isAnthropicKey = apiKey.startsWith('sk-ant-');
  const isOpenAIKey = apiKey.startsWith('sk-proj-') || (apiKey.startsWith('sk-') && !isAnthropicKey && apiKey.length > 40);
  const isGeminiKey = apiKey.startsWith('AIzaSy');
  const isOpenRouterKey = apiKey.startsWith('sk-or-');

  let isAnthropic = cleanBaseUrl.includes('anthropic.com');
  let isGoogle = cleanBaseUrl.includes('googleapis.com');
  let isOpenRouter = cleanBaseUrl.includes('openrouter.ai');

  // Prefix trumps configured URL (Auto-Correction)
  if (isAnthropicKey && !isOpenRouterKey) {
    isAnthropic = true;
    isGoogle = false;
    cleanBaseUrl = 'https://api.anthropic.com';
    // Some tenants still carry the original GPT defaults or retired Claude 3
    // identifiers in editorial_settings. The active Anthropic credential is
    // authoritative for provider routing; converge those legacy model values
    // on the currently supported Sonnet compatibility target.
    if (!cleanModel.startsWith('claude') || /^claude-3(?:-|$)/.test(cleanModel)) {
      cleanModel = 'claude-sonnet-4-6';
    }

  } else if (isGeminiKey && !isOpenRouterKey) {
    isGoogle = true;
    isAnthropic = false;
    cleanBaseUrl = 'https://generativelanguage.googleapis.com';
    if (!cleanModel.includes('gemini')) cleanModel = 'gemini-1.5-flash-latest';
  } else if (isOpenRouterKey) {
    isOpenRouter = true;
    isGoogle = false;
    isAnthropic = false;
    cleanBaseUrl = 'https://openrouter.ai/api/v1';
  } else if (isOpenAIKey && !isOpenRouterKey) {
    // Default to OpenAI if it looks like a standard OpenAI key
    isAnthropic = false;
    isGoogle = false;
    cleanBaseUrl = 'https://api.openai.com/v1';
    if (!cleanModel.includes('gpt')) cleanModel = 'gpt-4o-mini';
  }

  let fetchUrl: string
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: any

  if (isAnthropic) {
    // Anthropic Messages API
    let url: URL
    try {
      url = new URL(cleanBaseUrl || 'https://api.anthropic.com')
    } catch {
      url = new URL('https://api.anthropic.com')
    }
    url.pathname = '/v1/messages'
    fetchUrl = url.toString()

    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = '2023-06-01'

    body = {
      model: cleanModel,
      messages: [{
        role: 'user',
        content: normalizedImageUrl
          ? [
              {
                type: 'image',
                source: { type: 'url', url: normalizedImageUrl },
              },
              { type: 'text', text: prompt },
            ]
          : prompt,
      }],
      temperature,
      max_tokens: maxTokens
    }
    if (jsonSchema) {
      // Tool use is supported by both the older Claude models kept in some
      // tenant settings and the current models. `output_config.format` is not
      // accepted by every historical model and caused the whole draft request
      // to fail with a provider 400. Force one schema-bound tool instead.
      body.tools = [{
        name: 'emit_editorial_draft',
        description: 'Return the prepared editorial draft.',
        input_schema: jsonSchema,
      }]
      body.tool_choice = { type: 'tool', name: 'emit_editorial_draft' }
    }
  } else if (isGoogle) {
    // Gemini Native API — generateContent?key=
    let url: URL
    try {
      url = new URL(cleanBaseUrl || 'https://generativelanguage.googleapis.com')
    } catch {
      url = new URL('https://generativelanguage.googleapis.com')
    }
    const root = `${url.protocol}//${url.host}`
    fetchUrl = `${root}/v1beta/models/${encodeURIComponent(
      cleanModel
    )}:generateContent?key=${encodeURIComponent(apiKey)}`

    body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens
      }
    }
  } else {
    // OpenAI-like chat completions (OpenAI, OpenRouter, compatibles)
    const base = cleanBaseUrl || 'https://api.openai.com/v1'
    fetchUrl = `${normalizeBaseUrl(base)}/chat/completions`

    headers['Authorization'] = `Bearer ${apiKey}`
    if (isOpenRouter) {
      headers['HTTP-Referer'] = 'https://tvgflow.com';
      headers['X-Title'] = 'AutoPublisher';
    }

    body = {
      model: cleanModel,
      messages: [{
        role: 'user',
        content: normalizedImageUrl
          ? [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: normalizedImageUrl } },
            ]
          : prompt,
      }],
      temperature,
      max_tokens: maxTokens
    }
  }

  let res
  try {
    res = await fetch(fetchUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    } as RequestInit)
  } catch (e: any) {
    console.error('[llmClient] Network/timeout error calling LLM:', e)
    const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError' || /timeout|timed out/i.test(String(e?.message ?? e))
    throw new Error(isTimeout ? 'EDITORIAL_AI_TIMEOUT' : 'EDITORIAL_AI_PROVIDER_FAILURE')
  }

  const textBody = await res.text()
  const jsonBody = await safeParseJson(textBody)

  if (!res.ok) {
    // Provider bodies may echo source material or internal policy details.
    // Keep runtime logs sanitized; callers persist only stable error codes.
    console.error('[llmClient] LLM provider error:', {
      status: res.status
    })

    let shortMessage = 'Erro ao chamar o provedor de IA.'
    if (jsonBody && typeof jsonBody === 'object') {
      const m =
        (jsonBody.error && (jsonBody.error.message || JSON.stringify(jsonBody.error))) ||
        jsonBody.message
      if (typeof m === 'string') {
        shortMessage = `LLM Error ${res.status}: ${m.slice(0, 300)}`
      } else {
        shortMessage = `LLM Error ${res.status}: ${JSON.stringify(jsonBody).slice(0, 300)}`
      }
    }

    throw new Error(shortMessage)
  }

  // Normalização de conteúdo e tokens por provider
  if (isAnthropic) {
    const usage = (jsonBody && (jsonBody.usage || {})) || {}
    const promptTokens = Number(usage.input_tokens ?? 0) || 0
    const completionTokens = Number(usage.output_tokens ?? 0) || 0
    const totalTokens = promptTokens + completionTokens

    const blocks = jsonBody && Array.isArray(jsonBody.content) ? jsonBody.content : []
    const toolBlock = jsonSchema
      ? blocks.find((block: any) => block?.type === 'tool_use' && block?.name === 'emit_editorial_draft')
      : null
    const textBlock = blocks.find((block: any) => block?.type === 'text')
    const content = toolBlock?.input
      ? JSON.stringify(toolBlock.input)
      : (textBlock?.text ?? textBlock?.content ?? '')

    return {
      content: String(content ?? ''),
      tokens: {
        total: totalTokens,
        prompt: promptTokens,
        completion: completionTokens
      },
      raw: jsonBody
    }
  }

  if (isGoogle) {
    const usage = (jsonBody && (jsonBody.usageMetadata || {})) || {}
    const totalTokens = Number(usage.totalTokenCount ?? 0) || 0
    const promptTokens = Number(usage.promptTokenCount ?? 0) || 0
    const completionTokens = Number(usage.candidatesTokenCount ?? 0) || 0

    let content = ''
    try {
      const candidates = jsonBody?.candidates ?? []
      if (candidates.length > 0) {
        const parts = candidates[0]?.content?.parts ?? []
        content = parts.map((p: any) => p?.text ?? '').join('\n\n')
      }
    } catch {
      content = ''
    }

    return {
      content: String(content ?? ''),
      tokens: {
        total: totalTokens,
        prompt: promptTokens,
        completion: completionTokens
      },
      raw: jsonBody
    }
  }

  // OpenAI-like
  const usage = (jsonBody && (jsonBody.usage || {})) || {}
  const promptTokens = Number(usage.prompt_tokens ?? 0) || 0
  const completionTokens = Number(usage.completion_tokens ?? 0) || 0
  const totalTokens = Number(usage.total_tokens ?? promptTokens + completionTokens) || 0

  const choices = jsonBody?.choices ?? []
  const firstChoice = choices[0] ?? {}
  const content =
    firstChoice?.message?.content ??
    firstChoice?.text ??
    ''

  return {
    content: String(content ?? ''),
    tokens: {
      total: totalTokens,
      prompt: promptTokens,
      completion: completionTokens
    },
    raw: jsonBody
  }
}

/**
 * Logs AI consumption for auditing.
 */
export function logAIUsage(model: string, inputTokens: number, outputTokens: number, newsId: string | null = null) {
  console.log("[AUDIT][AI_USAGE]", JSON.stringify({
    candidate_news_id: newsId,
    model_name: model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Routes to different models based on pipeline stage and task complexity.
 * Approved tiers: low-cost (summarization, tagging, classification) 
 * vs high-quality (caption, headline).
 */
export function selectModel(
  task: 'low-cost' | 'high-quality',
  tenantPreference: string | null = null
): string {
  // Low-cost tier (Efficiency)
  if (task === 'low-cost') {
    return "gpt-4o-mini";
  }
  
  // High-quality tier (Creative Excellence)
  return tenantPreference || "claude-3-5-sonnet-20241022";
}

