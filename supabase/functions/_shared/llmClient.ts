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
  maxTokens
}: CallLLMParams): Promise<CallLLMResult> {
  let cleanBaseUrl = normalizeBaseUrl(baseUrl || '');
  let cleanModel = model.trim();

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
    if (!cleanModel.startsWith('claude')) cleanModel = 'claude-3-5-sonnet-20241022';

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
    headers['anthropic-beta'] = 'interleaved-thinking-2025-05-14'

    body = {
      model: cleanModel,
      messages: [{ role: 'user', content: prompt }],
      temperature,
      max_tokens: maxTokens
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
      messages: [{ role: 'user', content: prompt }],
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
      signal: AbortSignal.timeout(30000)
    } as RequestInit)
  } catch (e: any) {
    console.error('[llmClient] Network/timeout error calling LLM:', e)
    throw new Error('Falha ao conectar ao provedor de IA. Verifique a rede, URL base e chave.')
  }

  const textBody = await res.text()
  const jsonBody = await safeParseJson(textBody)

  if (!res.ok) {
    // Log corpo completo apenas no servidor para auditoria
    console.error('[llmClient] LLM provider error:', {
      status: res.status,
      body: jsonBody
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

    const content =
      jsonBody &&
      Array.isArray(jsonBody.content) &&
      jsonBody.content[0] &&
      (jsonBody.content[0].text ?? jsonBody.content[0].content) ||
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

