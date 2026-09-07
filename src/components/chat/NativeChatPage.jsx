import { useCallback, useEffect, useRef, useState } from 'react'
import {
    Archive,
    Bot,
    Check,
    Clipboard,
    Copy,
    FileText,
    Download,
    ImagePlus,
    Menu,
    MessageSquareText,
    Plus,
    RefreshCw,
    Send,
    Sparkles,
    X,
} from 'lucide-react'
import { toast } from 'sonner'
import * as defaultChatService from '../../services/aiChatService'
import {
    assistantCopyText,
    deriveConversationTitle,
    extractStructuredAssistantContent,
} from '../../utils/chatMessages'
import {
    CHAT_IMAGE_ACCEPT,
    parseImageChatContent,
    validateChatImageDimensions,
    validateChatImageFile,
} from '../../utils/chatImageFiles'
import '../../styles/content.css'
import '../../styles/native-chat.css'

const ERROR_MESSAGES = {
    AUTH_REQUIRED: 'Sua sessão expirou. Entre novamente para continuar.',
    CHAT_BACKEND_UNAVAILABLE: 'O chat está temporariamente indisponível.',
    EDITORIAL_ACTIVE_PROMPT_NOT_CONFIGURED: 'O prompt editorial ativo ainda não foi configurado.',
    EDITORIAL_SETTINGS_NOT_CONFIGURED: 'As configurações editoriais ainda não foram concluídas.',
    OPENAI_API_KEY_NOT_CONFIGURED: 'A integração com a OpenAI ainda não foi configurada.',
    OPENAI_CHAT_MODEL_UNSUPPORTED: 'O modelo configurado para o chat não está disponível.',
    OPENAI_TIMEOUT: 'A resposta demorou mais que o esperado.',
    INVALID_URL: 'Informe um link HTTP ou HTTPS válido.',
    UNSUPPORTED_PROTOCOL: 'Use um link que comece com http:// ou https://.',
    PRIVATE_DESTINATION: 'Esse endereço não pode ser acessado por segurança.',
    INVALID_REDIRECT: 'O link redirecionou para um endereço inválido.',
    TOO_MANY_REDIRECTS: 'O link fez redirecionamentos demais.',
    DNS_LOOKUP_FAILED: 'Não foi possível validar o endereço do link.',
    FETCH_FAILED: 'Não foi possível acessar o link informado.',
    UPSTREAM_HTTP_ERROR: 'O site recusou a extração do conteúdo.',
    REQUEST_TIMEOUT: 'O site demorou demais para responder.',
    RESPONSE_TOO_LARGE: 'A página é grande demais para ser processada.',
    UNSUPPORTED_CONTENT_TYPE: 'O link não retornou uma página de texto compatível.',
    LINK_CONTENT_INSUFFICIENT: 'Não foi possível extrair texto suficiente desse link. Cole o texto da matéria para continuar.',
    IMAGE_FILE_REQUIRED: 'Selecione uma imagem para tratar.',
    IMAGE_FILE_INVALID: 'O arquivo de imagem está vazio ou inválido.',
    IMAGE_FILE_TOO_LARGE: 'A imagem deve ter no máximo 10 MB.',
    IMAGE_FORMAT_UNSUPPORTED: 'Use uma imagem PNG, JPG ou WebP.',
    IMAGE_TYPE_MISMATCH: 'A extensão do arquivo não corresponde ao tipo da imagem.',
    IMAGE_DIMENSIONS_INVALID: 'A imagem tem dimensões inválidas ou grandes demais.',
    IMAGE_JOURNALISTIC_WARNING_REQUIRED: 'Confirme a revisão jornalística antes de tratar a imagem.',
    IMAGE_RETRY_CONTEXT_CHANGED: 'A imagem ou a instrução mudou. Envie como uma nova solicitação.',
    OPENAI_IMAGE_TIMEOUT: 'O tratamento da imagem demorou mais que o esperado.',
    OPENAI_IMAGE_MODEL_UNSUPPORTED: 'O modelo de imagem configurado não está disponível.',
    MODERATION_BLOCKED: 'O tratamento foi bloqueado pelas regras de segurança da imagem.',
    OPERATIONAL_CLIENT_NOT_FOUND: 'Nenhuma operação foi vinculada ao seu usuário.',
    OPERATIONAL_CLIENT_SELECTION_REQUIRED: 'Seu usuário possui mais de uma operação e o chat não pode escolher uma automaticamente.',
}

const EDITORIAL_ACTIONS = [
    { operation: 'chat', label: 'Conversa' },
    { operation: 'generate_from_link', label: 'Gerar matéria de link' },
    { operation: 'rewrite', label: 'Reescrever' },
    { operation: 'improve_title', label: 'Melhorar título' },
    { operation: 'correct', label: 'Corrigir' },
    { operation: 'summarize', label: 'Resumir' },
    { operation: 'variations', label: 'Variações' },
    { operation: 'image_edit', label: 'Tratar imagem' },
]

const ACTION_PLACEHOLDERS = {
    chat: 'Escreva uma mensagem...',
    generate_from_link: 'Cole o link público da matéria...',
    rewrite: 'Cole o texto que deseja reescrever...',
    improve_title: 'Cole o título que deseja melhorar...',
    correct: 'Cole o texto que deseja corrigir...',
    summarize: 'Cole o texto que deseja resumir...',
    variations: 'Cole o texto para gerar variações...',
    image_edit: 'Descreva o tratamento desejado ou use o ajuste técnico padrão...',
}

const DEFAULT_IMAGE_INSTRUCTION = 'Melhorar qualidade, iluminação, contraste, cor, redução de ruído e nitidez, preservando o conteúdo jornalístico.'

function friendlyError(error) {
    return ERROR_MESSAGES[error?.code] || 'Não foi possível concluir sua mensagem. Tente novamente.'
}

async function writeClipboard(value) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
        return
    }
    const field = document.createElement('textarea')
    field.value = value
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand('copy')
    field.remove()
    if (!copied) throw new Error('COPY_FAILED')
}

async function createImagePreview(file) {
    const previewUrl = URL.createObjectURL(file)
    try {
        const dimensions = await new Promise((resolve, reject) => {
            const image = new Image()
            image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
            image.onerror = () => reject(new Error('IMAGE_FILE_INVALID'))
            image.src = previewUrl
        })
        const dimensionsError = validateChatImageDimensions(dimensions.width, dimensions.height)
        if (dimensionsError) throw new Error(dimensionsError)
        return { file, previewUrl, ...dimensions }
    } catch (error) {
        URL.revokeObjectURL(previewUrl)
        throw error
    }
}

function ChatMessage({ message, onRetry, disabled }) {
    const [copied, setCopied] = useState(null)
    const isAssistant = message.role === 'assistant'
    const imageContent = parseImageChatContent(message.content)
    const structured = isAssistant ? extractStructuredAssistantContent(message.content) : null
    const originalImage = message.attachments?.find(attachment => attachment.kind === 'original')
    const resultImage = message.attachments?.find(attachment => attachment.kind === 'result')

    const copy = async (value, key, label) => {
        try {
            await writeClipboard(value)
            setCopied(key)
            toast.success(`${label} copiado`)
        } catch {
            toast.error('Não foi possível copiar para a área de transferência')
        }
    }

    return (
        <article className={`native-chat-message native-chat-message--${message.role}`}>
            <div className="native-chat-message-avatar" aria-hidden="true">
                {isAssistant ? <Sparkles size={17} /> : <span>Você</span>}
            </div>
            <div className="native-chat-message-content">
                <span className="native-chat-message-author">{isAssistant ? 'Assistente FlowOS' : 'Você'}</span>
                {imageContent ? (
                    <div className="native-chat-image-message">
                        <p>{imageContent.text || (isAssistant ? 'Imagem tratada pronta.' : 'Tratamento de imagem')}</p>
                        {isAssistant && originalImage && resultImage ? (
                            <div className="native-chat-image-comparison">
                                <figure><span>Antes</span><img src={originalImage.preview_url} alt="Imagem original" loading="lazy" /></figure>
                                <figure><span>Depois</span><img src={resultImage.preview_url} alt="Imagem tratada" loading="lazy" /></figure>
                            </div>
                        ) : originalImage ? (
                            <figure className="native-chat-image-single"><img src={originalImage.preview_url} alt="Imagem original enviada" loading="lazy" /></figure>
                        ) : null}
                    </div>
                ) : structured ? (
                    <div className="native-chat-structured-answer">
                        {structured.headline ? <h3>{structured.headline}</h3> : null}
                        {structured.body ? <p>{structured.body}</p> : null}
                    </div>
                ) : <p>{message.content}</p>}
                {isAssistant ? (
                    <div className="native-chat-message-actions" aria-label="Ações da resposta">
                        {!imageContent ? <button type="button" onClick={() => copy(assistantCopyText(message.content), 'response', 'Resposta')}>
                            {copied === 'response' ? <Check size={15} /> : <Copy size={15} />} Copiar tudo
                        </button> : null}
                        {!imageContent && structured?.headline ? (
                            <button type="button" onClick={() => copy(structured.headline, 'headline', 'Título')}>
                                {copied === 'headline' ? <Check size={15} /> : <Clipboard size={15} />} Copiar título
                            </button>
                        ) : null}
                        {!imageContent && structured?.body ? (
                            <button type="button" onClick={() => copy(structured.body, 'body', 'Texto')}>
                                {copied === 'body' ? <Check size={15} /> : <FileText size={15} />} Copiar texto
                            </button>
                        ) : null}
                        {imageContent && resultImage ? (
                            <a href={resultImage.download_url} download>
                                <Download size={15} /> Baixar imagem tratada
                            </a>
                        ) : null}
                        {!imageContent ? <button type="button" disabled={disabled} onClick={() => onRetry(message)}>
                            <RefreshCw size={15} /> Tentar novamente
                        </button> : null}
                    </div>
                ) : null}
            </div>
        </article>
    )
}

function NativeChatPage({ chatService = defaultChatService }) {
    const [conversations, setConversations] = useState([])
    const [activeConversationId, setActiveConversationId] = useState(null)
    const [messages, setMessages] = useState([])
    const [draft, setDraft] = useState('')
    const [selectedOperation, setSelectedOperation] = useState('chat')
    const [selectedImage, setSelectedImage] = useState(null)
    const [imageAcknowledged, setImageAcknowledged] = useState(false)
    const [loadingConversations, setLoadingConversations] = useState(true)
    const [loadingMessages, setLoadingMessages] = useState(false)
    const [creatingConversation, setCreatingConversation] = useState(false)
    const [sending, setSending] = useState(false)
    const [requestError, setRequestError] = useState(null)
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
    const messageEndRef = useRef(null)
    const textareaRef = useRef(null)
    const fileInputRef = useRef(null)
    const requestInFlightRef = useRef(false)

    const refreshConversations = useCallback(async () => {
        const items = await chatService.listChatConversations()
        setConversations(items)
        setActiveConversationId(current => items.some(item => item.id === current) ? current : items[0]?.id ?? null)
        return items
    }, [chatService])

    const loadConversation = useCallback(async (conversationId) => {
        if (!conversationId) {
            setMessages([])
            return
        }
        setLoadingMessages(true)
        try {
            const data = await chatService.getChatConversation(conversationId)
            setMessages(data.messages)
        } catch (error) {
            toast.error(friendlyError(error))
            setMessages([])
        } finally {
            setLoadingMessages(false)
        }
    }, [chatService])

    useEffect(() => {
        let active = true
        chatService.listChatConversations()
            .then(items => {
                if (!active) return
                setConversations(items)
                setActiveConversationId(items[0]?.id ?? null)
            })
            .catch(error => { if (active) toast.error(friendlyError(error)) })
            .finally(() => { if (active) setLoadingConversations(false) })
        return () => { active = false }
    }, [chatService])

    useEffect(() => {
        let active = true
        Promise.resolve().then(async () => {
            if (!active) return
            if (!activeConversationId) {
                setMessages([])
                return
            }
            setLoadingMessages(true)
            try {
                const data = await chatService.getChatConversation(activeConversationId)
                if (active) setMessages(data.messages)
            } catch (error) {
                if (active) {
                    toast.error(friendlyError(error))
                    setMessages([])
                }
            } finally {
                if (active) setLoadingMessages(false)
            }
        })
        return () => { active = false }
    }, [activeConversationId, chatService])

    useEffect(() => {
        messageEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [messages, sending, requestError])

    useEffect(() => {
        const textarea = textareaRef.current
        if (!textarea) return
        textarea.style.height = 'auto'
        textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`
    }, [draft])

    useEffect(() => () => {
        if (selectedImage?.previewUrl) URL.revokeObjectURL(selectedImage.previewUrl)
    }, [selectedImage])

    const clearSelectedImage = () => {
        setSelectedImage(null)
        setImageAcknowledged(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
    }

    const handleImageSelection = async (event) => {
        const file = event.target.files?.[0]
        const validationError = validateChatImageFile(file)
        if (validationError) {
            toast.error(friendlyError({ code: validationError }))
            event.target.value = ''
            return
        }
        try {
            const image = await createImagePreview(file)
            setSelectedImage(image)
            setImageAcknowledged(false)
            setSelectedOperation('image_edit')
            window.setTimeout(() => textareaRef.current?.focus(), 0)
        } catch (error) {
            toast.error(friendlyError({ code: error.message }))
            event.target.value = ''
        }
    }

    const handleNewConversation = async () => {
        if (creatingConversation || requestInFlightRef.current) return
        try {
            setCreatingConversation(true)
            const conversation = await chatService.createChatConversation()
            setConversations(current => [conversation, ...current.filter(item => item.id !== conversation.id)])
            setActiveConversationId(conversation.id)
            setMessages([])
            setRequestError(null)
            setMobileSidebarOpen(false)
            window.setTimeout(() => textareaRef.current?.focus(), 0)
        } catch (error) {
            toast.error(friendlyError(error))
        } finally {
            setCreatingConversation(false)
        }
    }

    const openConversation = (conversationId) => {
        if (requestInFlightRef.current || conversationId === activeConversationId) return
        setRequestError(null)
        setActiveConversationId(conversationId)
        setMobileSidebarOpen(false)
    }

    const handleArchive = async (conversationId) => {
        if (requestInFlightRef.current) return
        try {
            await chatService.archiveChatConversation(conversationId)
            const remaining = conversations.filter(item => item.id !== conversationId)
            setConversations(remaining)
            if (activeConversationId === conversationId) {
                setRequestError(null)
                setActiveConversationId(remaining[0]?.id ?? null)
                setMessages([])
            }
            toast.success('Conversa arquivada')
        } catch (error) {
            toast.error(friendlyError(error))
        }
    }

    const performSend = async ({ conversationId, message, requestId, title, operation, optimistic, imageFile, imagePreviewUrl, acknowledged }) => {
        if (requestInFlightRef.current) return false
        requestInFlightRef.current = true
        setSending(true)
        setRequestError(null)
        if (optimistic) {
            const optimisticMessage = operation === 'image_edit'
                ? JSON.stringify({ type: 'image_edit', text: message })
                : message
            setMessages(current => [...current, {
                id: `local-${requestId}`,
                role: 'user',
                content: optimisticMessage,
                status: 'completed',
                ai_run_id: requestId,
                operation,
                attachments: operation === 'image_edit' && imagePreviewUrl ? [{ kind: 'original', preview_url: imagePreviewUrl }] : [],
            }])
        }

        try {
            if (operation === 'image_edit') {
                await chatService.editChatImage({
                    conversationId,
                    requestId,
                    instruction: message,
                    imageFile,
                    acknowledged,
                })
            } else {
                await chatService.sendChatMessage({ conversationId, requestId, message, title, operation })
            }
            await Promise.all([loadConversation(conversationId), refreshConversations()])
            return true
        } catch (error) {
            await loadConversation(conversationId)
            setRequestError({
                conversationId,
                message,
                requestId,
                title,
                operation,
                imageFile,
                imagePreviewUrl,
                acknowledged,
                text: friendlyError(error),
            })
            return false
        } finally {
            requestInFlightRef.current = false
            setSending(false)
        }
    }

    const handleSubmit = async (event) => {
        event.preventDefault()
        const isImageEdit = selectedOperation === 'image_edit'
        const message = draft.trim() || (isImageEdit ? DEFAULT_IMAGE_INSTRUCTION : '')
        if (!message || requestInFlightRef.current) return
        if (isImageEdit && !selectedImage) {
            toast.error(friendlyError({ code: 'IMAGE_FILE_REQUIRED' }))
            return
        }
        if (isImageEdit && !imageAcknowledged) {
            toast.error(friendlyError({ code: 'IMAGE_JOURNALISTIC_WARNING_REQUIRED' }))
            return
        }

        let conversationId = activeConversationId
        if (!conversationId) {
            try {
                setCreatingConversation(true)
                const conversation = await chatService.createChatConversation()
                conversationId = conversation.id
                setConversations(current => [conversation, ...current])
                setActiveConversationId(conversationId)
            } catch (error) {
                toast.error(friendlyError(error))
                return
            } finally {
                setCreatingConversation(false)
            }
        }

        if (!isImageEdit) setDraft('')
        const succeeded = await performSend({
            conversationId,
            message,
            requestId: crypto.randomUUID(),
            title: deriveConversationTitle(message),
            operation: selectedOperation,
            optimistic: true,
            imageFile: selectedImage?.file,
            imagePreviewUrl: selectedImage?.previewUrl,
            acknowledged: imageAcknowledged,
        })
        if (succeeded && isImageEdit) {
            setDraft('')
            clearSelectedImage()
        }
    }

    const retryFailedRequest = async () => {
        if (!requestError || requestInFlightRef.current) return
        const succeeded = await performSend({ ...requestError, optimistic: false })
        if (succeeded && requestError.operation === 'image_edit') {
            setDraft('')
            clearSelectedImage()
        }
    }

    const retryAssistantMessage = (assistantMessage) => {
        if (requestInFlightRef.current) return
        const assistantIndex = messages.findIndex(message => message.id === assistantMessage.id)
        const previousUserMessage = messages.slice(0, assistantIndex).reverse().find(message => message.role === 'user')
        if (!previousUserMessage) return
        performSend({
            conversationId: activeConversationId,
            message: previousUserMessage.content,
            requestId: crypto.randomUUID(),
            title: null,
            operation: assistantMessage.operation || 'chat',
            optimistic: true,
        })
    }

    const handleComposerKeyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            event.currentTarget.form?.requestSubmit()
        }
    }

    const activeConversation = conversations.find(item => item.id === activeConversationId)

    return (
        <div className="native-chat-page animation-fade-in">
            <aside className={`native-chat-sidebar${mobileSidebarOpen ? ' native-chat-sidebar--open' : ''}`}>
                <div className="native-chat-sidebar-header">
                    <div><span className="native-chat-eyebrow"><Sparkles size={14} /> FlowOS AI</span><h1>Flow.IA</h1></div>
                    <button type="button" className="native-chat-mobile-close" aria-label="Fechar conversas" onClick={() => setMobileSidebarOpen(false)}><X size={20} /></button>
                </div>
                <button type="button" className="native-chat-new" onClick={handleNewConversation} disabled={creatingConversation || sending}>
                    <Plus size={18} /> {creatingConversation ? 'Criando...' : 'Nova conversa'}
                </button>
                <div className="native-chat-conversation-list" aria-label="Suas conversas">
                    {loadingConversations ? <div className="native-chat-sidebar-status">Carregando conversas...</div> : conversations.length ? conversations.map(conversation => (
                        <div key={conversation.id} className={`native-chat-conversation${conversation.id === activeConversationId ? ' native-chat-conversation--active' : ''}`}>
                            <button type="button" className="native-chat-conversation-open" onClick={() => openConversation(conversation.id)} aria-current={conversation.id === activeConversationId ? 'true' : undefined}>
                                <MessageSquareText size={17} /><span>{conversation.title}</span>
                            </button>
                            <button type="button" className="native-chat-archive" aria-label={`Arquivar ${conversation.title}`} onClick={() => handleArchive(conversation.id)}><Archive size={15} /></button>
                        </div>
                    )) : <div className="native-chat-sidebar-status">Suas conversas aparecerão aqui.</div>}
                </div>
                <div className="native-chat-private-note"><span aria-hidden="true">●</span> Histórico privado da sua conta</div>
            </aside>

            {mobileSidebarOpen ? <button type="button" className="native-chat-backdrop" aria-label="Fechar conversas" onClick={() => setMobileSidebarOpen(false)} /> : null}

            <section className="native-chat-main" aria-label="Chat editorial">
                <header className="native-chat-main-header">
                    <button type="button" className="native-chat-mobile-menu" aria-label="Abrir conversas" onClick={() => setMobileSidebarOpen(true)}><Menu size={20} /></button>
                    <div><span>Assistente editorial</span><h2>{activeConversation?.title || 'Nova conversa'}</h2></div>
                    <div className="native-chat-online"><span /> OpenAI</div>
                </header>

                <div className="native-chat-messages" aria-live="polite">
                    {loadingMessages ? <div className="native-chat-loading-state"><Bot size={24} /> Carregando histórico...</div> : messages.length ? messages.map(message => (
                        <ChatMessage key={message.id} message={message} onRetry={retryAssistantMessage} disabled={sending} />
                    )) : (
                        <div className="native-chat-welcome">
                            <div className="native-chat-welcome-icon"><Sparkles size={30} /></div>
                            <span>FlowIA</span>
                            <h2>Como posso ajudar com seu conteúdo?</h2>
                            <p>Escreva seu pedido abaixo. O assistente seguirá as configurações editoriais ativas do AutoPublisher.</p>
                        </div>
                    )}
                    {sending ? <div className="native-chat-thinking" role="status"><span /><span /><span /> {selectedOperation === 'image_edit' ? 'Tratando imagem' : 'Preparando resposta'}</div> : null}
                    {requestError ? (
                        <div className="native-chat-error" role="alert">
                            <div><strong>Não foi possível responder</strong><span>{requestError.text}</span></div>
                            <button type="button" onClick={retryFailedRequest} disabled={sending}><RefreshCw size={15} /> Tentar novamente</button>
                        </div>
                    ) : null}
                    <div ref={messageEndRef} />
                </div>

                <div className="native-chat-composer-shell">
                    <div className="native-chat-editorial-actions" aria-label="Ações editoriais">
                        {EDITORIAL_ACTIONS.map(action => (
                            <button
                                type="button"
                                key={action.operation}
                                className={selectedOperation === action.operation ? 'native-chat-editorial-action--active' : ''}
                                aria-pressed={selectedOperation === action.operation}
                                disabled={sending}
                                onClick={() => {
                                    setSelectedOperation(action.operation)
                                    window.setTimeout(() => textareaRef.current?.focus(), 0)
                                }}
                            >
                                {action.label}
                            </button>
                        ))}
                    </div>
                    {selectedImage ? (
                        <div className="native-chat-image-draft">
                            <img src={selectedImage.previewUrl} alt="Prévia da imagem selecionada" />
                            <div>
                                <strong>{selectedImage.file.name}</strong>
                                <span>{selectedImage.width} × {selectedImage.height} · {(selectedImage.file.size / 1024 / 1024).toFixed(1)} MB</span>
                                <label>
                                    <input type="checkbox" checked={imageAcknowledged} onChange={event => setImageAcknowledged(event.target.checked)} disabled={sending} />
                                    Entendo que o tratamento altera pixels e revisarei o resultado antes do uso jornalístico.
                                </label>
                            </div>
                            <button type="button" aria-label="Remover imagem" onClick={clearSelectedImage} disabled={sending}><X size={17} /></button>
                        </div>
                    ) : null}
                    <form className="native-chat-composer" onSubmit={handleSubmit}>
                        <input ref={fileInputRef} className="native-chat-file-input" type="file" accept={CHAT_IMAGE_ACCEPT} onChange={handleImageSelection} disabled={sending} />
                        <button type="button" className="native-chat-attach" aria-label="Anexar imagem" onClick={() => fileInputRef.current?.click()} disabled={sending}>
                            <ImagePlus size={19} />
                        </button>
                        <label htmlFor="native-chat-input" className="native-chat-sr-only">Mensagem para o assistente</label>
                        <textarea ref={textareaRef} id="native-chat-input" rows="1" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={handleComposerKeyDown} placeholder={ACTION_PLACEHOLDERS[selectedOperation]} maxLength={selectedOperation === 'image_edit' ? 1200 : selectedOperation === 'generate_from_link' ? 2048 : 50000} disabled={sending} />
                        <button type="submit" aria-label={selectedOperation === 'image_edit' ? 'Tratar imagem' : 'Enviar mensagem'} disabled={sending || (selectedOperation === 'image_edit' ? !selectedImage || !imageAcknowledged : !draft.trim())}>{sending ? <RefreshCw className="native-chat-spin" size={19} /> : <Send size={19} />}</button>
                        <span>Enter para enviar · Shift + Enter para quebrar linha</span>
                    </form>
                </div>
            </section>
        </div>
    )
}

export default NativeChatPage
