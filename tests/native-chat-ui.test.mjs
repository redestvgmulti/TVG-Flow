import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
    assistantCopyText,
    deriveConversationTitle,
    extractStructuredAssistantContent,
} from '../src/utils/chatMessages.js'

const read = relative => readFile(new URL(`../${relative}`, import.meta.url), 'utf8')

test('Flow.IA routes use one native chat and no longer read external GPT cards', async () => {
    const [admin, staff, component, navigation] = await Promise.all([
        read('src/pages/admin/AdminContent.jsx'),
        read('src/pages/staff/StaffContent.jsx'),
        read('src/components/chat/NativeChatPage.jsx'),
        read('src/config/navigation.js'),
    ])
    assert.match(admin, /<NativeChatPage/)
    assert.match(staff, /<NativeChatPage/)
    assert.doesNotMatch(`${admin}\n${staff}\n${component}`, /gpt_url|ExternalLink|assistant-images|\.from\(['"]assistentes['"]\)/)
    assert.match(component, /FlowOS AI/)
    assert.match(component, />FlowIA</)
    assert.match(component, /<h1>Flow\.IA<\/h1>/)
    assert.match(navigation, /label: 'Flow\.IA', path: '\/staff\/content'/)
    assert.match(navigation, /label: 'Flow\.IA', path: '\/admin\/content'/)
    assert.doesNotMatch(navigation, /label: 'Assistentes'/)
    assert.doesNotMatch(component, /Chat nativo FlowOS/)
    assert.match(component, /Nova conversa/)
    assert.match(component, /native-chat-conversation-list/)
    assert.match(component, /native-chat-composer/)
})

test('chat service uses current JWT and never submits user or tenant identity', async () => {
    const service = await read('src/services/aiChatService.js')
    assert.match(service, /supabase\.auth\.getSession\(\)/)
    assert.match(service, /Authorization: `Bearer \$\{session\.access_token\}`/)
    assert.match(service, /supabase\.functions\.invoke\('ai-chat'/)
    assert.doesNotMatch(service, /user_id|cliente_id/)
    assert.doesNotMatch(service, /\.from\(['"]ai_(?:conversations|messages|runs)['"]\)/)
    for (const operation of ['list_conversations', 'create_conversation', 'get_conversation', 'archive_conversation']) {
        assert.match(service, new RegExp(`operation: '${operation}'`))
    }
    assert.match(service, /operation = 'chat'/)
})

test('backend scopes list, history, create and archive to the derived identity', async () => {
    const [backend, migration] = await Promise.all([
        read('supabase/functions/ai-chat/index.ts'),
        read('supabase/migrations/20260907201345_native_chat_ui_operations.sql'),
    ])
    assert.match(backend, /operation === "list_conversations"/)
    assert.match(backend, /operation === "get_conversation"/)
    assert.match(backend, /operation === "create_conversation"/)
    assert.match(backend, /operation === "archive_conversation"/)
    assert.match(backend, /\.eq\("cliente_id", authorization\.clienteId\)/g)
    assert.match(backend, /\.eq\("user_id", authorization\.userId\)/g)
    assert.match(backend, /p_cliente_id: authorization\.clienteId/g)
    assert.match(backend, /p_user_id: authorization\.userId/g)
    assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.create_ai_conversation/)
    assert.match(migration, /CREATE OR REPLACE FUNCTION ap\.archive_ai_conversation/)
    assert.match(migration, /FROM PUBLIC, anon, authenticated, service_role/g)
    assert.doesNotMatch(migration, /GRANT EXECUTE[\s\S]+TO authenticated/)
})

test('conversation lifecycle, send guard, history reload and safe retry are wired', async () => {
    const component = await read('src/components/chat/NativeChatPage.jsx')
    assert.match(component, /createChatConversation\(\)/)
    assert.match(component, /archiveChatConversation\(conversationId\)/)
    assert.match(component, /getChatConversation\(conversationId\)/)
    assert.match(component, /requestInFlightRef\.current/)
    assert.match(component, /requestId: crypto\.randomUUID\(\)/)
    assert.match(component, /optimistic: false/)
    assert.match(component, /await Promise\.all\(\[loadConversation\(conversationId\), refreshConversations\(\)\]\)/)
    assert.match(component, /setRequestError\(\{[\s\S]+conversationId,[\s\S]+message,[\s\S]+requestId,[\s\S]+title,/)
})

test('structured responses expose response, headline and body copy actions', () => {
    const structured = extractStructuredAssistantContent('```json\n{"headline":"Título forte","caption":"Texto final"}\n```')
    assert.deepEqual(structured, { headline: 'Título forte', body: 'Texto final' })
    assert.equal(assistantCopyText('{"headline":"Título forte","body":"Corpo"}'), 'Título forte\n\nCorpo')
    assert.equal(assistantCopyText('Resposta livre'), 'Resposta livre')
    assert.equal(deriveConversationTitle('  Primeiro   pedido editorial  '), 'Primeiro pedido editorial')
    assert.equal(deriveConversationTitle('a'.repeat(90)).length, 70)
})

test('mobile layout has a drawer, touch-sized controls and bottom navigation clearance', async () => {
    const css = await read('src/styles/native-chat.css')
    assert.match(css, /@media \(max-width: 820px\)/)
    assert.match(css, /\.native-chat-sidebar--open \{ transform: translateX\(0\)/)
    assert.match(css, /\.native-chat-backdrop/)
    assert.match(css, /var\(--mobile-bottom-nav-height, 56px\)/)
    assert.match(css, /min-height: 44px/)
    assert.match(css, /env\(safe-area-inset-bottom\)/)
})

test('native chat UI has no publishing, scraping or R1 integration', async () => {
    const sources = await Promise.all([
        read('src/components/chat/NativeChatPage.jsx'),
        read('src/services/aiChatService.js'),
        read('src/utils/chatMessages.js'),
        read('supabase/migrations/20260907201345_native_chat_ui_operations.sql'),
    ])
    assert.doesNotMatch(sources.join('\n'), /candidate_news|ap-employee-generator|ap-render-engine|placid|editorial_articles|ap-link-scraper|image-upload/i)
})
