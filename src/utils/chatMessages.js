const HEADLINE_FIELDS = ['headline', 'title', 'titulo', 'titulo_studio']
const BODY_FIELDS = ['body', 'caption', 'legenda', 'text', 'texto', 'conteudo', 'roteiro_teleprompter']

function firstString(record, fields) {
    for (const field of fields) {
        if (typeof record?.[field] === 'string' && record[field].trim()) return record[field].trim()
    }
    return null
}

export function extractStructuredAssistantContent(content) {
    if (typeof content !== 'string') return null
    const candidate = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    if (!candidate.startsWith('{') || !candidate.endsWith('}')) return null
    try {
        const parsed = JSON.parse(candidate)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
        const headline = firstString(parsed, HEADLINE_FIELDS)
        const body = firstString(parsed, BODY_FIELDS)
        return headline || body ? { headline, body } : null
    } catch {
        return null
    }
}

export function deriveConversationTitle(message) {
    const normalized = String(message ?? '').replace(/\s+/g, ' ').trim()
    if (!normalized) return 'Nova conversa'
    return normalized.length > 72 ? `${normalized.slice(0, 69).trimEnd()}…` : normalized
}

export function assistantCopyText(content) {
    const structured = extractStructuredAssistantContent(content)
    if (!structured) return String(content ?? '')
    return [structured.headline, structured.body].filter(Boolean).join('\n\n')
}
