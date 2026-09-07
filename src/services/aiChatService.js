import { supabase } from './supabase'

export class AiChatServiceError extends Error {
    constructor(code, status = null) {
        super(code)
        this.name = 'AiChatServiceError'
        this.code = code
        this.status = status
    }
}

async function readFunctionError(error) {
    try {
        const response = error?.context
        if (response && typeof response.clone === 'function') {
            const payload = await response.clone().json()
            if (typeof payload?.error === 'string') return payload.error
        }
    } catch {
        // The sanitized fallback below is enough for the UI.
    }
    return typeof error?.message === 'string' && /^[A-Z0-9_:-]+$/.test(error.message)
        ? error.message
        : 'CHAT_BACKEND_UNAVAILABLE'
}

async function invokeAiChat(body) {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.access_token) throw new AiChatServiceError('AUTH_REQUIRED', 401)

    const { data, error } = await supabase.functions.invoke('ai-chat', {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (error) throw new AiChatServiceError(await readFunctionError(error), error?.context?.status ?? null)
    if (data?.error) throw new AiChatServiceError(data.error)
    return data
}

export async function listChatConversations() {
    const data = await invokeAiChat({ operation: 'list_conversations' })
    return data?.conversations ?? []
}

export async function createChatConversation() {
    const data = await invokeAiChat({ operation: 'create_conversation' })
    if (!data?.conversation?.id) throw new AiChatServiceError('CHAT_CONVERSATION_CREATE_FAILED')
    return data.conversation
}

export async function getChatConversation(conversationId) {
    const data = await invokeAiChat({ operation: 'get_conversation', conversation_id: conversationId })
    return { conversation: data?.conversation ?? null, messages: data?.messages ?? [] }
}

export async function archiveChatConversation(conversationId) {
    return invokeAiChat({ operation: 'archive_conversation', conversation_id: conversationId })
}

export async function sendChatMessage({ conversationId, requestId, message, title, operation = 'chat' }) {
    return invokeAiChat({
        operation,
        conversation_id: conversationId,
        request_id: requestId,
        message,
        title,
    })
}

export async function editChatImage({ conversationId, requestId, instruction, imageFile, acknowledged }) {
    const form = new FormData()
    form.append('operation', 'image_edit')
    form.append('conversation_id', conversationId)
    form.append('request_id', requestId)
    form.append('instruction', instruction)
    form.append('journalistic_integrity_acknowledged', acknowledged ? 'true' : 'false')
    form.append('image', imageFile, imageFile.name)
    return invokeAiChatImage(form)
}

async function invokeAiChatImage(body) {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession()
    if (sessionError || !session?.access_token) throw new AiChatServiceError('AUTH_REQUIRED', 401)
    const { data, error } = await supabase.functions.invoke('ai-image-edit', {
        body,
        headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (error) throw new AiChatServiceError(await readFunctionError(error), error?.context?.status ?? null)
    if (data?.error) throw new AiChatServiceError(data.error)
    return data
}
