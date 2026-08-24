import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../services/supabase'
import { toast } from 'sonner'
import {
    Plus, Trash2, Globe, Cpu, Shield, Brain, Zap, RefreshCw, Award,
    Save, UploadCloud, FileText, CheckCircle2, AlertCircle,
} from 'lucide-react'
import AutoPublisherMasterV1Settings from './AutoPublisherMasterV1Settings'
import { formatRelativeTime } from '../../utils/dateUtils'
import '../../styles/AutoPublisherSettingsPremium.css'

// The editorial edge functions (ap-editorial-settings/-prompt/-rag-upload)
// are intentionally single-tenant today (`MODE: SINGLE-TENANT (TVG only)` in
// their headers) and always resolve to this cliente_id server-side no matter
// what's sent. Reads and writes below must stay pinned to the same constant
// or a rule/doc written under a different id would silently vanish from the
// next GET.
const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

const SECTIONS = [
    { key: 'fontes', label: 'Fontes de conteúdo', icon: Globe },
    { key: 'motor', label: 'Motor de IA', icon: Cpu },
    { key: 'regras', label: 'Regras e tom de voz', icon: Shield },
    { key: 'conhecimento', label: 'Base de conhecimento', icon: Brain },
    { key: 'automacao', label: 'Automação', icon: Zap },
    { key: 'validacao', label: 'Validação', icon: RefreshCw },
    { key: 'artes', label: 'Selos e patrocinadores', icon: Award },
]

const RULE_TYPES = [
    { key: 'forbidden', label: 'Palavra proibida', bg: '#FEF2F2', color: '#B91C1C', border: '#FECACA', placeholder: 'ex: lamentavelmente' },
    { key: 'mandatory', label: 'Termo obrigatório', bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0', placeholder: 'ex: Prefeitura Municipal' },
    { key: 'priority_topic', label: 'Pauta prioritária', bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE', placeholder: 'ex: mobilidade urbana' },
    { key: 'substitution', label: 'Substituição', bg: '#FFFBEB', color: '#B45309', border: '#FDE68A', placeholder: 'ex: termo antigo → termo novo' },
]

const DEFAULT_EDITORIAL = {
    model_primary: 'gpt-4o-mini',
    model_fallback: 'gpt-4o',
    temperature: 0.7,
    max_tokens: 400,
    system_prompt_override: false,
    override_prompt_text: '',
    api_base_url: '',
    has_api_key: false,
}

const DEFAULT_HUMANIZATION = {
    formality_level: 50,
    creativity_level: 50,
    technical_level: 30,
    anti_ai_variation: true,
}

const DEFAULT_AUTOMATION = {
    ingestion_enabled: true,
    auto_approve: false,
    auto_approve_threshold: 7,
    notify_team: true,
    publish_on_quiet: true,
    daily_cap: '',
    quiet_start: '23:00',
    quiet_end: '06:00',
}

function detectProvider(apiBaseUrl) {
    const url = (apiBaseUrl || '').toLowerCase()
    if (!url) return 'openai'
    if (url.includes('anthropic.com')) return 'anthropic'
    if (url.includes('googleapis.com')) return 'gemini'
    return 'openai'
}

function Toggle({ on, onClick, disabled }) {
    return (
        <button type="button" className={`aps-toggle${on ? ' on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={on}>
            <span className="aps-toggle-knob" />
        </button>
    )
}

export default function AutoPublisherSettings({ clienteId, clienteError }) {
    const [section, setSection] = useState('fontes')
    const [loading, setLoading] = useState(true)

    // ── Fontes ──────────────────────────────────────────────
    const [sources, setSources] = useState([])
    const [newSource, setNewSource] = useState({ nome: '', url: '', tipo: 'rss' })
    const [sourceError, setSourceError] = useState('')
    const [sourceSaving, setSourceSaving] = useState(false)

    // ── Motor de IA (editorial_settings) ───────────────────
    const [editorialLoaded, setEditorialLoaded] = useState(DEFAULT_EDITORIAL)
    const [editorial, setEditorial] = useState(DEFAULT_EDITORIAL)
    const [newApiKey, setNewApiKey] = useState('')
    const [activePromptLoaded, setActivePromptLoaded] = useState('')
    const [activePrompt, setActivePrompt] = useState('')
    const [promptMeta, setPromptMeta] = useState(null)
    const [savingPromptVersion, setSavingPromptVersion] = useState(false)

    // ── Regras + tom de voz ─────────────────────────────────
    const [rules, setRules] = useState([])
    const [activeRuleType, setActiveRuleType] = useState(null)
    const [ruleInput, setRuleInput] = useState('')
    const [humanizationLoaded, setHumanizationLoaded] = useState(DEFAULT_HUMANIZATION)
    const [humanization, setHumanization] = useState(DEFAULT_HUMANIZATION)

    // ── Base de conhecimento (RAG) ──────────────────────────
    const [ragDocs, setRagDocs] = useState([])
    const [ragDragging, setRagDragging] = useState(false)
    const [ragBusy, setRagBusy] = useState(false)

    // ── Automação (system_config) ───────────────────────────
    const [automation, setAutomation] = useState(DEFAULT_AUTOMATION)

    // ── Validação ────────────────────────────────────────────
    const [testInput, setTestInput] = useState({ titulo: '', conteudo: '', categoria: '' })
    const [testOutput, setTestOutput] = useState(null)
    const [testLoading, setTestLoading] = useState(false)
    const [testError, setTestError] = useState('')
    const [promptSnapshot, setPromptSnapshot] = useState(null)
    const [loadingSnapshot, setLoadingSnapshot] = useState(false)

    // ── Draft save (Motor de IA + Tom de voz) ───────────────
    const [savingDraft, setSavingDraft] = useState(false)
    const [savedFlash, setSavedFlash] = useState(false)

    const isAnthropic = !!(editorial.api_base_url && editorial.api_base_url.toLowerCase().includes('anthropic.com'))
    const draftDirty = useMemo(() => (
        JSON.stringify(editorial) !== JSON.stringify(editorialLoaded) ||
        JSON.stringify(humanization) !== JSON.stringify(humanizationLoaded) ||
        !!newApiKey
    ), [editorial, editorialLoaded, humanization, humanizationLoaded, newApiKey])

    // ── apConfig — generic gateway used for Fontes (ap.sources) ──
    const apConfig = useCallback(async (resource, action, payload = null) => {
        const body = { resource, action, cliente_id: clienteId }
        if (payload) body.payload = payload
        const { data, error } = await supabase.functions.invoke('ap-config', { method: 'POST', body })
        if (error) throw error
        if (data && data.has_error) throw new Error(`Edge Function Error: ${data.error} | Type: ${data.type}`)
        return data
    }, [clienteId])

    // ── Load everything ──────────────────────────────────────
    const fetchAll = useCallback(async () => {
        if (!clienteId) return
        setLoading(true)
        try {
            const [sourcesRes, editorialRes, ragRes, configRes] = await Promise.all([
                apConfig('sources', 'list'),
                supabase.functions.invoke('ap-editorial-settings', { method: 'GET' }),
                supabase.functions.invoke('ap-editorial-rag-upload', { method: 'GET' }),
                supabase.schema('ap').from('system_config').select('*').eq('cliente_id', clienteId).maybeSingle(),
            ])

            setSources(sourcesRes ?? [])

            if (editorialRes.error) throw new Error(editorialRes.error.message || 'Erro ao carregar o Motor de IA')
            const es = editorialRes.data?.settings
            if (es) {
                const merged = { ...DEFAULT_EDITORIAL, ...es }
                setEditorial(merged)
                setEditorialLoaded(merged)
            }
            if (editorialRes.data?.humanization) {
                setHumanization(editorialRes.data.humanization)
                setHumanizationLoaded(editorialRes.data.humanization)
            }
            if (editorialRes.data?.active_prompt) {
                setActivePrompt(editorialRes.data.active_prompt.prompt_base)
                setActivePromptLoaded(editorialRes.data.active_prompt.prompt_base)
                setPromptMeta(editorialRes.data.active_prompt)
            }
            setRules(editorialRes.data?.rules ?? [])

            if (ragRes.data && !ragRes.error) setRagDocs(Array.isArray(ragRes.data) ? ragRes.data : [])

            if (configRes.data) {
                setAutomation({
                    ingestion_enabled: configRes.data.ingestion_enabled ?? true,
                    auto_approve: configRes.data.auto_approve ?? false,
                    auto_approve_threshold: configRes.data.auto_approve_threshold ?? 7,
                    notify_team: configRes.data.notify_team ?? true,
                    publish_on_quiet: configRes.data.publish_on_quiet ?? true,
                    daily_cap: configRes.data.daily_cap ?? '',
                    quiet_start: (configRes.data.quiet_start || '23:00').slice(0, 5),
                    quiet_end: (configRes.data.quiet_end || '06:00').slice(0, 5),
                })
            }
        } catch (err) {
            console.error('[AutoPublisherSettings] fetchAll error:', err)
            toast.error('Não foi possível carregar as configurações. ' + (err.message || ''))
        } finally {
            setLoading(false)
        }
    }, [clienteId, apConfig])

    useEffect(() => { fetchAll() }, [fetchAll])

    // ── Fontes actions ───────────────────────────────────────
    async function addSource() {
        const { nome, url } = newSource
        if (!nome.trim() || !url.trim()) { setSourceError('Informe nome e URL do feed.'); return }
        setSourceSaving(true)
        setSourceError('')
        try {
            await apConfig('sources', 'insert', newSource)
            setNewSource({ nome: '', url: '', tipo: 'rss' })
            const s = await apConfig('sources', 'list')
            setSources(s ?? [])
        } catch (err) {
            console.error('[Sources]', err)
            setSourceError('Não foi possível adicionar a fonte.')
        } finally {
            setSourceSaving(false)
        }
    }

    async function toggleSource(id, ativo) {
        setSources(prev => prev.map(s => s.id === id ? { ...s, ativo: !ativo } : s))
        try {
            await apConfig('sources', 'update', { id, ativo: !ativo })
        } catch {
            toast.error('Falha ao atualizar a fonte.')
            fetchAll()
        }
    }

    async function deleteSource(id) {
        setSources(prev => prev.filter(s => s.id !== id))
        try {
            await apConfig('sources', 'delete', { id })
        } catch {
            toast.error('Falha ao remover a fonte.')
            fetchAll()
        }
    }

    // ── Regras actions (immediate — direct table, same as before) ──
    async function submitRule() {
        if (!ruleInput.trim() || !activeRuleType) return
        try {
            const { error } = await supabase.schema('ap').from('editorial_rules')
                .insert({ cliente_id: FIXED_CLIENT_ID, rule_type: activeRuleType, value: ruleInput.trim() })
            if (error) throw error
            const { data } = await supabase.schema('ap').from('editorial_rules').select('*').eq('cliente_id', FIXED_CLIENT_ID)
            setRules(data ?? [])
            setActiveRuleType(null)
            setRuleInput('')
        } catch (err) {
            toast.error('Erro ao salvar regra: ' + err.message)
        }
    }

    async function deleteRule(id) {
        setRules(prev => prev.filter(r => r.id !== id))
        try {
            const { error } = await supabase.schema('ap').from('editorial_rules').delete().eq('id', id)
            if (error) throw error
        } catch (err) {
            toast.error('Erro ao remover regra: ' + err.message)
            fetchAll()
        }
    }

    // ── RAG actions (immediate) ──────────────────────────────
    async function handleRagFile(file) {
        if (!file) return
        if (isAnthropic) { toast.error('A Anthropic não gera embeddings. Use um modelo OpenAI para enviar documentos.'); return }
        if (!editorial.has_api_key) { toast.error('Salve a chave da API antes de enviar documentos.'); return }

        const reader = new FileReader()
        reader.onload = async (evt) => {
            const content = evt.target.result
            setRagBusy(true)
            const toastId = toast.loading('Gerando vetores e anexando à base…')
            try {
                const { error } = await supabase.functions.invoke('ap-editorial-rag-upload', { method: 'POST', body: { file_name: file.name, content } })
                if (error) throw error
                toast.success('Documento adicionado à base de conhecimento.', { id: toastId })
                const ragRes = await supabase.functions.invoke('ap-editorial-rag-upload', { method: 'GET' })
                if (ragRes.data && !ragRes.error) setRagDocs(Array.isArray(ragRes.data) ? ragRes.data : [])
            } catch (err) {
                toast.error('Erro no upload: ' + err.message, { id: toastId })
            } finally {
                setRagBusy(false)
            }
        }
        reader.readAsText(file)
    }

    async function deleteRagDoc(source_document_id) {
        setRagDocs(prev => prev.filter(d => d.source_document_id !== source_document_id))
        try {
            const { error } = await supabase.functions.invoke('ap-editorial-rag-upload', { method: 'DELETE', body: { source_document_id } })
            if (error) throw error
        } catch (err) {
            toast.error('Erro ao remover documento: ' + err.message)
            fetchAll()
        }
    }

    // ── Automação actions (immediate per field) ─────────────
    async function patchAutomation(patch) {
        const next = { ...automation, ...patch }
        setAutomation(next)
        try {
            const payload = {
                cliente_id: clienteId,
                ingestion_enabled: next.ingestion_enabled,
                auto_approve: next.auto_approve,
                auto_approve_threshold: Number(next.auto_approve_threshold) || 7,
                notify_team: next.notify_team,
                publish_on_quiet: next.publish_on_quiet,
                daily_cap: next.daily_cap === '' || next.daily_cap === null ? null : Number(next.daily_cap),
                quiet_start: next.quiet_start,
                quiet_end: next.quiet_end,
            }
            const { error } = await supabase.schema('ap').from('system_config').upsert(payload, { onConflict: 'cliente_id' })
            if (error) throw error
        } catch (err) {
            console.error('[Automacao]', err)
            toast.error('Falha ao salvar automação.')
            fetchAll()
        }
    }

    // ── Motor de IA / Tom de voz draft save ─────────────────
    async function saveDraft() {
        setSavingDraft(true)
        try {
            const payload = { settings: editorial, humanization }
            if (newApiKey) payload.apiKey = newApiKey
            const { error } = await supabase.functions.invoke('ap-editorial-settings', { method: 'PUT', body: payload })
            if (error) throw error

            setEditorialLoaded(editorial)
            setHumanizationLoaded(humanization)
            if (newApiKey) { setEditorial(prev => ({ ...prev, has_api_key: true })); setNewApiKey('') }
            setSavedFlash(true)
            setTimeout(() => setSavedFlash(false), 2800)
        } catch (err) {
            toast.error(err.message || 'Erro ao salvar configurações.')
        } finally {
            setSavingDraft(false)
        }
    }

    function discardDraft() {
        setEditorial(editorialLoaded)
        setHumanization(humanizationLoaded)
        setNewApiKey('')
    }

    async function savePromptVersion() {
        if (!activePrompt.trim()) return
        setSavingPromptVersion(true)
        try {
            const { error } = await supabase.functions.invoke('ap-editorial-prompt', { method: 'POST', body: { prompt_base: activePrompt } })
            if (error) throw error
            toast.success('Nova versão do prompt salva.')
            fetchAll()
        } catch (err) {
            toast.error(err.message || 'Erro ao salvar o prompt.')
        } finally {
            setSavingPromptVersion(false)
        }
    }

    // ── Validação ────────────────────────────────────────────
    async function runTest() {
        if (!testInput.titulo) { toast.error('Informe um título para testar.'); return }
        setTestLoading(true)
        setTestError('')
        setTestOutput(null)
        setPromptSnapshot(null)
        try {
            const { data, error } = await supabase.functions.invoke('ap-editorial-test', { method: 'POST', body: testInput })
            if (error) throw error
            if (data.error) throw new Error(data.error)
            setTestOutput(data)
        } catch (err) {
            setTestError(err.message)
        } finally {
            setTestLoading(false)
        }
    }

    async function fetchSnapshot(logId) {
        if (!logId) return
        setLoadingSnapshot(true)
        try {
            const { data, error } = await supabase.schema('ap').from('editorial_logs').select('prompt_snapshot').eq('id', logId).single()
            if (error) throw error
            setPromptSnapshot(data.prompt_snapshot)
        } catch (err) {
            console.error(err)
            setPromptSnapshot('Erro ao buscar log auditado.')
        } finally {
            setLoadingSnapshot(false)
        }
    }

    // ── Rail meta ────────────────────────────────────────────
    const activeSources = sources.filter(s => s.ativo).length
    const automationActiveCount = [automation.ingestion_enabled, automation.auto_approve, automation.notify_team].filter(Boolean).length
    const metaFor = {
        fontes: sources.length ? `${activeSources} de ${sources.length} ativas` : 'Nenhuma fonte',
        motor: editorial.model_primary,
        regras: `${rules.length} ${rules.length === 1 ? 'regra ativa' : 'regras ativas'}`,
        conhecimento: `${ragDocs.length} ${ragDocs.length === 1 ? 'documento' : 'documentos'}`,
        automacao: `${automationActiveCount} de 3 ativas`,
        validacao: testOutput ? 'Último teste: ok' : 'Nunca executado',
        artes: 'Selos e patrocinadores',
    }

    const cycleSummary = automation.ingestion_enabled
        ? `Ingestão automática ativa${automation.daily_cap ? ` · até ${automation.daily_cap} matérias/dia` : ''}${!automation.publish_on_quiet ? ` · silêncio das ${automation.quiet_start} às ${automation.quiet_end}` : ''}.`
        : 'Ingestão automática desligada — só entram pautas enviadas pelo backlog.'

    if (!clienteId) {
        return (
            <div className="ap-form-section" role={clienteError ? 'alert' : 'status'}>
                {clienteError || 'Carregando cliente operacional...'}
            </div>
        )
    }

    if (loading) {
        return <div className="ap-form-section" role="status">Carregando configurações...</div>
    }

    return (
        <div className="aps-shell">
            <nav className="aps-rail" aria-label="Seções de configuração">
                {SECTIONS.map(s => {
                    const Icon = s.icon
                    return (
                        <button
                            key={s.key}
                            type="button"
                            className={`aps-rail-btn${section === s.key ? ' active' : ''}`}
                            onClick={() => setSection(s.key)}
                        >
                            <span className="aps-rail-btn-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Icon size={14} />
                                {s.label}
                            </span>
                            <span className="aps-rail-btn-meta">{metaFor[s.key]}</span>
                        </button>
                    )
                })}
                <div className="aps-cycle-box">
                    <p className="aps-cycle-box-title">Ciclo atual</p>
                    <p className="aps-cycle-box-body">{cycleSummary}</p>
                </div>
            </nav>

            <div className="aps-content">
                {section === 'fontes' && (
                    <div className="aps-card no-pad">
                        <div className="aps-card-head bordered">
                            <div>
                                <h2 className="aps-card-title"><Globe size={17} color="#2563EB" /> Fontes de conteúdo</h2>
                                <p className="aps-card-desc">Feeds varridos a cada ciclo de ingestão. Desative uma fonte para pausá-la sem perder o histórico.</p>
                            </div>
                        </div>

                        <div style={{ padding: '18px 22px', background: '#FAFBFC', borderBottom: '1px solid #F0F2F5' }}>
                            <div className="aps-field-row">
                                <div className="aps-field" style={{ flex: '1 1 170px' }}>
                                    <label>Nome da fonte</label>
                                    <input className="aps-input" placeholder="ex: Folha Regional" value={newSource.nome} onChange={e => setNewSource(p => ({ ...p, nome: e.target.value }))} />
                                </div>
                                <div className="aps-field" style={{ flex: '2 1 240px' }}>
                                    <label>URL do feed</label>
                                    <input className="aps-input" placeholder="https://exemplo.com/rss" value={newSource.url} onChange={e => setNewSource(p => ({ ...p, url: e.target.value }))} />
                                </div>
                                <div className="aps-field" style={{ flex: '1 1 160px' }}>
                                    <label>Tipo</label>
                                    <select className="aps-select" value={newSource.tipo} onChange={e => setNewSource(p => ({ ...p, tipo: e.target.value }))}>
                                        <option value="rss">Padrão XML / RSS</option>
                                        <option value="google_news_rss">Google News RSS</option>
                                        <option value="sitemap">Sitemap</option>
                                    </select>
                                </div>
                                <button type="button" className="aps-btn aps-btn-dark" onClick={addSource} disabled={sourceSaving}>
                                    <Plus size={14} /> Adicionar fonte
                                </button>
                                {sourceError && <p className="aps-error-text">{sourceError}</p>}
                            </div>
                        </div>

                        {sources.length === 0 ? (
                            <div className="aps-empty">
                                <p className="aps-empty-title">Nenhuma fonte cadastrada</p>
                                <p className="aps-empty-sub">Sem fontes ativas o AutoPublisher só recebe pautas enviadas manualmente pelo backlog.</p>
                            </div>
                        ) : (
                            <div className="aps-list">
                                {sources.map(s => (
                                    <div key={s.id} className="aps-list-row">
                                        <div className="aps-list-row-main">
                                            <div className="aps-list-row-title">
                                                {s.nome}
                                                <span className="aps-list-row-tag">{{ rss: 'RSS', google_news_rss: 'Google News', sitemap: 'Sitemap' }[s.tipo] || s.tipo}</span>
                                            </div>
                                            <span className="aps-list-row-sub">{s.url}</span>
                                        </div>
                                        <div className="aps-list-row-actions">
                                            <span style={{ fontSize: 11.5, color: 'var(--color-text-tertiary)' }}>
                                                {s.created_at ? `adicionada ${formatRelativeTime(s.created_at)}` : ''}
                                            </span>
                                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
                                                <Toggle on={s.ativo} onClick={() => toggleSource(s.id, s.ativo)} />
                                                <span style={{ fontSize: 12, fontWeight: 600, color: s.ativo ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>
                                                    {s.ativo ? 'Ativa' : 'Pausada'}
                                                </span>
                                            </label>
                                            <button type="button" className="aps-icon-btn" onClick={() => deleteSource(s.id)} aria-label="Remover fonte">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {section === 'motor' && (
                    <div className="aps-grid-2">
                        <div className="aps-card">
                            <div>
                                <h2 className="aps-card-title"><Cpu size={17} color="#2563EB" /> Modelos e credenciais</h2>
                                <p className="aps-card-desc">O fallback só entra em ação quando o primário falha ou estoura o tempo limite.</p>
                            </div>

                            <div className="aps-field">
                                <label>Chave de API</label>
                                <input type="password" className="aps-input" placeholder={editorial.has_api_key ? '•••••••••••••••• (chave salva)' : 'sk-...'} value={newApiKey} onChange={e => setNewApiKey(e.target.value)} />
                                <span className="aps-hint">Salva com segurança — nunca é exibida nem retornada pela API.</span>
                            </div>

                            <div className="aps-field">
                                <label>URL base da API</label>
                                <input className="aps-input" placeholder="Padrão: https://api.openai.com/v1" value={editorial.api_base_url || ''} onChange={e => setEditorial(p => ({ ...p, api_base_url: e.target.value }))} />
                                <span className="aps-hint">Deixe em branco para usar a OpenAI padrão.</span>
                            </div>

                            <div className="aps-field">
                                <label>Modelo primário</label>
                                <input list="aps-modelos-primarios" className="aps-input" value={editorial.model_primary} onChange={e => setEditorial(p => ({ ...p, model_primary: e.target.value }))} placeholder="ex: gpt-4o-mini" />
                                <datalist id="aps-modelos-primarios">
                                    {detectProvider(editorial.api_base_url) === 'anthropic' && <>
                                        <option value="claude-3-haiku-20240307">Claude 3 Haiku (Rápido)</option>
                                        <option value="claude-3-sonnet-20240229">Claude 3 Sonnet (Equilíbrio)</option>
                                        <option value="claude-3-opus-20240229">Claude 3 Opus (Avançado)</option>
                                    </>}
                                    {detectProvider(editorial.api_base_url) === 'gemini' && <>
                                        <option value="gemini-1.5-flash-002">Gemini 1.5 Flash 002</option>
                                        <option value="gemini-1.5-pro-002">Gemini 1.5 Pro 002</option>
                                    </>}
                                    {detectProvider(editorial.api_base_url) === 'openai' && <>
                                        <option value="gpt-4o-mini">GPT-4o Mini (Recomendado)</option>
                                        <option value="gpt-4o">GPT-4o (Avançado)</option>
                                        <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                                        <option value="gpt-4.1">GPT-4.1</option>
                                    </>}
                                </datalist>
                            </div>

                            <div className="aps-field">
                                <label>Modelo de fallback</label>
                                <input list="aps-modelos-fallback" className="aps-input" value={editorial.model_fallback} onChange={e => setEditorial(p => ({ ...p, model_fallback: e.target.value }))} placeholder="ex: gpt-4o" />
                                <datalist id="aps-modelos-fallback">
                                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                                    <option value="gpt-4o">gpt-4o</option>
                                    <option value="claude-3-sonnet-20240229">claude-3-sonnet-20240229</option>
                                </datalist>
                            </div>

                            <div className="aps-field">
                                <label>Tokens máx. por matéria</label>
                                <input className="aps-input" value={editorial.max_tokens ?? ''} onChange={e => setEditorial(p => ({ ...p, max_tokens: e.target.value === '' ? '' : Number(e.target.value) }))} />
                            </div>

                            <div className="aps-slider-block">
                                <div className="aps-slider-head">
                                    <span className="name">Temperatura</span>
                                    <span className="value">{Number(editorial.temperature ?? 0.7).toFixed(1)}</span>
                                </div>
                                <input type="range" className="aps-range" min="0" max="20" value={Math.round((editorial.temperature ?? 0.7) * 10)} onChange={e => setEditorial(p => ({ ...p, temperature: parseInt(e.target.value, 10) / 10 }))} />
                                <div className="aps-slider-scale">
                                    <span>Literal</span>
                                    <span>{(editorial.temperature ?? 0.7) <= 0.4 ? 'Reprodução fiel' : (editorial.temperature ?? 0.7) <= 0.9 ? 'Reescrita segura' : 'Texto mais livre'}</span>
                                    <span>Criativo</span>
                                </div>
                            </div>
                        </div>

                        <div className="aps-card">
                            <div>
                                <h2 className="aps-card-title"><FileText size={17} color="#7C3AED" /> Prompt base</h2>
                                <p className="aps-card-desc">A voz editorial aplicada a toda matéria antes das regras.</p>
                            </div>

                            <label className="aps-switch-row align-start">
                                <Toggle on={editorial.system_prompt_override} onClick={() => setEditorial(p => ({ ...p, system_prompt_override: !p.system_prompt_override }))} />
                                <span>
                                    <span className="aps-switch-body-label">Usar prompt fixo</span>
                                    <span className="aps-switch-body-hint">Ignora o versionamento dinâmico e usa sempre o texto abaixo.</span>
                                </span>
                            </label>

                            {editorial.system_prompt_override ? (
                                <div className="aps-field">
                                    <label>Prompt de sistema fixo</label>
                                    <textarea className="aps-textarea" rows={8} value={editorial.override_prompt_text || ''} onChange={e => setEditorial(p => ({ ...p, override_prompt_text: e.target.value }))} placeholder="Escreva o prompt fixo aqui..." />
                                </div>
                            ) : (
                                <>
                                    <div className="aps-card-head" style={{ marginBottom: -8 }}>
                                        <span />
                                        {promptMeta && <span className="aps-badge">v{promptMeta.version_number} · {formatRelativeTime(promptMeta.created_at)}</span>}
                                    </div>
                                    <textarea className="aps-textarea" rows={8} value={activePrompt} onChange={e => setActivePrompt(e.target.value)} placeholder="Você é editor de um portal regional..." />
                                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                        <button type="button" className="aps-btn aps-btn-outline" onClick={savePromptVersion} disabled={savingPromptVersion || !activePrompt.trim() || activePrompt === activePromptLoaded}>
                                            Salvar como nova versão
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}

                {section === 'regras' && (
                    <>
                        <div className="aps-card">
                            <div>
                                <h2 className="aps-card-title"><Shield size={17} color="#DC2626" /> Regras inegociáveis</h2>
                                <p className="aps-card-desc">Aplicadas depois da geração. Uma matéria que viola regra proibida volta para revisão.</p>
                            </div>

                            <div className="aps-rule-chips">
                                {RULE_TYPES.map(rt => (
                                    <button key={rt.key} type="button" className="aps-rule-chip" style={{ background: rt.bg, color: rt.color, borderColor: rt.border }} onClick={() => { setActiveRuleType(rt.key); setRuleInput('') }}>
                                        <Plus size={12} /> {rt.label}
                                    </button>
                                ))}
                            </div>

                            {activeRuleType && (
                                <div className="aps-rule-adder">
                                    <span className="aps-rule-adder-label">Nova regra · {RULE_TYPES.find(t => t.key === activeRuleType)?.label}</span>
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                        <input
                                            autoFocus
                                            className="aps-input"
                                            style={{ flex: '1 1 240px' }}
                                            placeholder={RULE_TYPES.find(t => t.key === activeRuleType)?.placeholder}
                                            value={ruleInput}
                                            onChange={e => setRuleInput(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && submitRule()}
                                        />
                                        <button type="button" className="aps-btn aps-btn-dark" onClick={submitRule} disabled={!ruleInput.trim()}>Adicionar</button>
                                        <button type="button" className="aps-btn aps-btn-outline" onClick={() => { setActiveRuleType(null); setRuleInput('') }}>Cancelar</button>
                                    </div>
                                </div>
                            )}

                            {rules.length === 0 ? (
                                <div className="aps-empty" style={{ padding: '26px', background: '#F8FAFC', borderRadius: 12 }}>
                                    <p className="aps-empty-title">Nenhuma regra ativa</p>
                                    <p className="aps-empty-sub">A IA escreve sem restrições de vocabulário.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {rules.map(r => {
                                        const meta = RULE_TYPES.find(t => t.key === r.rule_type) || RULE_TYPES[0]
                                        return (
                                            <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', border: '1px solid #EFF1F5', borderRadius: 10 }}>
                                                <span style={{ padding: '3px 9px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, background: meta.bg, color: meta.color, whiteSpace: 'nowrap' }}>{meta.label}</span>
                                                <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.value}</span>
                                                <button type="button" className="aps-icon-btn" onClick={() => deleteRule(r.id)} aria-label="Remover regra"><Trash2 size={14} /></button>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        <div className="aps-card">
                            <div>
                                <h2 className="aps-card-title"><Zap size={17} color="#D97706" /> Tom de voz</h2>
                                <p className="aps-card-desc">Calibra o texto final sem reescrever o prompt.</p>
                            </div>

                            {[
                                { key: 'formality_level', label: 'Formalidade', low: 'Coloquial', high: 'Institucional' },
                                { key: 'creativity_level', label: 'Criatividade', low: 'Factual', high: 'Autoral' },
                                { key: 'technical_level', label: 'Densidade técnica', low: 'Simples', high: 'Especializada' },
                            ].map(sl => (
                                <div className="aps-slider-block" key={sl.key}>
                                    <div className="aps-slider-head">
                                        <span className="name">{sl.label}</span>
                                        <span className="value">{humanization[sl.key]}%</span>
                                    </div>
                                    <input type="range" className="aps-range" min="0" max="100" value={humanization[sl.key]} onChange={e => setHumanization(p => ({ ...p, [sl.key]: parseInt(e.target.value, 10) }))} />
                                    <div className="aps-slider-scale"><span>{sl.low}</span><span>{sl.high}</span></div>
                                </div>
                            ))}

                            <label className="aps-switch-row">
                                <Toggle on={humanization.anti_ai_variation} onClick={() => setHumanization(p => ({ ...p, anti_ai_variation: !p.anti_ai_variation }))} />
                                <span>
                                    <span className="aps-switch-body-label">Variação anti-IA</span>
                                    <span className="aps-switch-body-hint">Quebra padrões repetitivos de frase entre matérias do mesmo dia.</span>
                                </span>
                            </label>
                        </div>
                    </>
                )}

                {section === 'conhecimento' && (
                    <div className="aps-card">
                        <div>
                            <h2 className="aps-card-title"><Brain size={17} color="#7C3AED" /> Base de conhecimento</h2>
                            <p className="aps-card-desc">Documentos consultados durante a redação: manual de estilo, nomes oficiais, histórico da cidade.</p>
                        </div>

                        {isAnthropic && (
                            <div className="aps-callout">
                                <AlertCircle size={16} />
                                <span><strong>RAG desativado:</strong> a API Anthropic informada no Motor de IA não oferece endpoint de embeddings.</span>
                            </div>
                        )}

                        <div
                            className={`aps-dropzone${ragDragging ? ' dragging' : ''}${(ragBusy || isAnthropic) ? ' disabled' : ''}`}
                            onDragOver={e => { e.preventDefault(); if (!ragBusy && !isAnthropic) setRagDragging(true) }}
                            onDragLeave={() => setRagDragging(false)}
                            onDrop={e => { e.preventDefault(); setRagDragging(false); if (!ragBusy && !isAnthropic && e.dataTransfer.files?.[0]) handleRagFile(e.dataTransfer.files[0]) }}
                            onClick={() => { if (!ragBusy && !isAnthropic) document.getElementById('aps-rag-upload').click() }}
                        >
                            <input id="aps-rag-upload" type="file" accept=".txt" style={{ display: 'none' }} disabled={ragBusy || isAnthropic}
                                onChange={e => { const f = e.target.files?.[0]; handleRagFile(f); e.target.value = null }} />
                            <UploadCloud size={22} color="#7C3AED" />
                            <span className="aps-dropzone-title">Arraste um arquivo .txt</span>
                            <span className="aps-dropzone-sub">Até 1 MB por documento · indexação em poucos segundos</span>
                        </div>

                        {ragDocs.length === 0 ? (
                            <div className="aps-empty" style={{ padding: 22, background: '#F8FAFC', borderRadius: 12 }}>
                                <p className="aps-empty-sub" style={{ margin: 0 }}>A base está vazia — o modelo trabalha só com o prompt base.</p>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {ragDocs.map(d => (
                                    <div key={d.source_document_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 13px', border: '1px solid #EFF1F5', borderRadius: 10 }}>
                                        <div className="aps-doc-icon"><FileText size={14} /></div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</span>
                                            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                                {d.chunk_count} {d.chunk_count === 1 ? 'trecho' : 'trechos'} · enviado {formatRelativeTime(d.created_at)}
                                            </span>
                                        </div>
                                        <span className="aps-doc-status">Indexado</span>
                                        <button type="button" className="aps-icon-btn" onClick={() => deleteRagDoc(d.source_document_id)} aria-label="Remover documento"><Trash2 size={14} /></button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {section === 'automacao' && (
                    <>
                        <div className="aps-card no-pad">
                            <div className="aps-card-head bordered">
                                <div>
                                    <h2 className="aps-card-title"><Zap size={17} color="#0F766E" /> Automação</h2>
                                    <p className="aps-card-desc">O que o AutoPublisher pode fazer sem alguém confirmar. Cada campo salva assim que você altera.</p>
                                </div>
                            </div>

                            <div className="aps-automation-row">
                                <Toggle on={automation.ingestion_enabled} onClick={() => patchAutomation({ ingestion_enabled: !automation.ingestion_enabled })} />
                                <div className="aps-automation-row-body">
                                    <span className="aps-switch-body-label">Ingestão automática</span>
                                    <span className="aps-switch-body-hint">Varre as fontes ativas periodicamente. Também pode ser pausada no topo da página.</span>
                                </div>
                                <span className="aps-automation-state" style={{ color: automation.ingestion_enabled ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                    {automation.ingestion_enabled ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>

                            <div className="aps-automation-row">
                                <Toggle on={automation.auto_approve} onClick={() => patchAutomation({ auto_approve: !automation.auto_approve })} />
                                <div className="aps-automation-row-body">
                                    <span className="aps-switch-body-label">Aprovar matérias com score alto</span>
                                    <span className="aps-switch-body-hint">
                                        Dispensa revisão humana quando o score da matéria atinge{' '}
                                        <input
                                            type="number" step="0.1" className="aps-input"
                                            style={{ display: 'inline-block', width: 64, padding: '2px 6px', marginLeft: 4 }}
                                            value={automation.auto_approve_threshold}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => setAutomation(p => ({ ...p, auto_approve_threshold: e.target.value }))}
                                            onBlur={() => patchAutomation({ auto_approve_threshold: automation.auto_approve_threshold })}
                                        />
                                        {' '}ou mais. Use com cautela.
                                    </span>
                                </div>
                                <span className="aps-automation-state" style={{ color: automation.auto_approve ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                    {automation.auto_approve ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>

                            <div className="aps-automation-row">
                                <Toggle on={automation.notify_team} onClick={() => patchAutomation({ notify_team: !automation.notify_team })} />
                                <div className="aps-automation-row-body">
                                    <span className="aps-switch-body-label">Avisar a equipe a cada lote</span>
                                    <span className="aps-switch-body-hint">Notificação no painel quando novas matérias entram para revisão.</span>
                                </div>
                                <span className="aps-automation-state" style={{ color: automation.notify_team ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                    {automation.notify_team ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>

                            <div className="aps-automation-row">
                                <Toggle on={!automation.publish_on_quiet} onClick={() => patchAutomation({ publish_on_quiet: !automation.publish_on_quiet })} />
                                <div className="aps-automation-row-body">
                                    <span className="aps-switch-body-label">Bloquear publicação na janela de silêncio</span>
                                    <span className="aps-switch-body-hint">Impede publicações no período configurado ao lado quando ativado.</span>
                                </div>
                                <span className="aps-automation-state" style={{ color: !automation.publish_on_quiet ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}>
                                    {!automation.publish_on_quiet ? 'Ativo' : 'Inativo'}
                                </span>
                            </div>

                            <div className="aps-automation-grid">
                                <div className="aps-field">
                                    <label>Limite de matérias por dia</label>
                                    <input
                                        className="aps-input" placeholder="Sem limite"
                                        value={automation.daily_cap}
                                        onChange={e => setAutomation(p => ({ ...p, daily_cap: e.target.value.replace(/[^0-9]/g, '') }))}
                                        onBlur={() => patchAutomation({ daily_cap: automation.daily_cap })}
                                    />
                                </div>
                                <div className="aps-field">
                                    <label>Janela de silêncio</label>
                                    <div className="aps-quiet-row">
                                        <input type="time" className="aps-input" value={automation.quiet_start}
                                            onChange={e => setAutomation(p => ({ ...p, quiet_start: e.target.value }))}
                                            onBlur={() => patchAutomation({ quiet_start: automation.quiet_start })} />
                                        <span>até</span>
                                        <input type="time" className="aps-input" value={automation.quiet_end}
                                            onChange={e => setAutomation(p => ({ ...p, quiet_end: e.target.value }))}
                                            onBlur={() => patchAutomation({ quiet_end: automation.quiet_end })} />
                                    </div>
                                </div>
                            </div>

                            <div style={{ padding: '0 22px 20px' }}>
                                <p className="aps-hint" style={{ margin: 0 }}>
                                    O intervalo de coleta (frequência da varredura de fontes) é definido pela infraestrutura do pipeline e não é editável por aqui.
                                </p>
                            </div>
                        </div>
                    </>
                )}

                {section === 'validacao' && (
                    <div className="aps-card">
                        <div>
                            <h2 className="aps-card-title"><RefreshCw size={17} color="#2563EB" /> Testar antes de salvar</h2>
                            <p className="aps-card-desc">Roda uma matéria fictícia por todo o pipeline com as configurações atuais.</p>
                        </div>

                        <div className="aps-field-row">
                            <div className="aps-field" style={{ flex: 1 }}>
                                <label>Título de teste</label>
                                <input className="aps-input" placeholder="Ex: Novo tratamento para diabetes anunciado" value={testInput.titulo} onChange={e => setTestInput(p => ({ ...p, titulo: e.target.value }))} />
                            </div>
                            <div className="aps-field" style={{ flex: 1 }}>
                                <label>Categoria (opcional)</label>
                                <input className="aps-input" placeholder="Ex: Saúde" value={testInput.categoria} onChange={e => setTestInput(p => ({ ...p, categoria: e.target.value }))} />
                            </div>
                        </div>

                        <div className="aps-field">
                            <label>Conteúdo bruto da matéria</label>
                            <textarea className="aps-textarea" rows={4} placeholder="Cole o conteúdo original da matéria..." value={testInput.conteudo} onChange={e => setTestInput(p => ({ ...p, conteudo: e.target.value }))} />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                            <button type="button" className="aps-btn aps-btn-dark" onClick={runTest} disabled={testLoading || !testInput.titulo}>
                                {testLoading ? 'Rodando pipeline…' : 'Rodar teste'}
                            </button>
                            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Não consome cota de publicação.</span>
                            {testError && <span style={{ color: 'var(--color-danger)', fontSize: 13, fontWeight: 500 }}>{testError}</span>}
                        </div>

                        {testOutput && (
                            <div className="aps-test-output">
                                <div className="aps-test-output-head">
                                    <span>Resultado</span>
                                    <span style={{ fontWeight: 500 }}>{testOutput.model} · {testOutput.tokens} tokens</span>
                                </div>
                                <pre className="aps-test-pre">{JSON.stringify(testOutput.parsed, null, 2)}</pre>
                            </div>
                        )}

                        {testOutput && (
                            <div className="aps-metrics-bar">
                                <div className="aps-metric">
                                    <span className="aps-metric-label">Modelo usado</span>
                                    <span className="aps-metric-value" style={{ fontSize: 14 }}>{testOutput.model}</span>
                                </div>
                                <div className="aps-metric">
                                    <span className="aps-metric-label">Tokens</span>
                                    <span className="aps-metric-value">{testOutput.tokens}</span>
                                </div>
                                <div className="aps-metric">
                                    <span className="aps-metric-label">Auditoria</span>
                                    <span className="aps-metric-value" style={{ fontSize: 14 }}>{testOutput.log_id ? 'Registrado' : 'Não registrado'}</span>
                                </div>
                            </div>
                        )}

                        {testOutput?.log_id && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <button type="button" className="aps-btn aps-btn-outline" style={{ alignSelf: 'flex-start' }} onClick={() => fetchSnapshot(testOutput.log_id)} disabled={loadingSnapshot}>
                                    {loadingSnapshot ? 'Carregando…' : 'Ver prompt e rastro RAG'}
                                </button>
                                {promptSnapshot && <pre className="aps-test-pre">{promptSnapshot}</pre>}
                            </div>
                        )}
                    </div>
                )}

                {section === 'artes' && (
                    <AutoPublisherMasterV1Settings clienteId={clienteId} clienteError={clienteError} />
                )}

                {draftDirty && (section === 'motor' || section === 'regras') && (
                    <div className="aps-savebar">
                        <div className="aps-savebar-status">
                            <span className="aps-savebar-dot" />
                            <span className="aps-savebar-text">Alterações não salvas em Motor de IA / Tom de voz</span>
                        </div>
                        <div className="aps-savebar-actions">
                            <button type="button" className="aps-btn aps-btn-outline" onClick={discardDraft}>Descartar</button>
                            <button type="button" className="aps-btn aps-btn-primary" onClick={saveDraft} disabled={savingDraft}>
                                <Save size={14} /> {savingDraft ? 'Salvando…' : 'Salvar alterações'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {savedFlash && (
                <div className="aps-saved-toast">
                    <CheckCircle2 size={15} color="#6EE7B7" />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Configurações salvas · aplicadas no próximo ciclo</span>
                </div>
            )}
        </div>
    )
}
