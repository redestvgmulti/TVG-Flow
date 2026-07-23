import React, { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Save, Plus, Trash2, Cpu, Brain, Zap, RefreshCw, AlertCircle, FileText, CheckCircle2, UploadCloud } from 'lucide-react'
import { SkeletonCard } from '../../components/Skeleton'
import { toast } from 'sonner'
import '../../styles/EditorialEngine.css'

const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
export default function EditorialEngine() {
    const clienteId = FIXED_CLIENT_ID
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    // Sections state
    const [settings, setSettings] = useState({
        model_primary: 'gpt-4o-mini',
        model_fallback: 'gpt-4o',
        temperature: 0.7,
        max_tokens: 400,
        system_prompt_override: false,
        override_prompt_text: '',
        api_base_url: '',
        has_api_key: false // Readonly from backend
    })
    const [newApiKey, setNewApiKey] = useState('')

    const [activePrompt, setActivePrompt] = useState('')

    const [rules, setRules] = useState([])
    const [activeRuleType, setActiveRuleType] = useState(null)
    const [ruleInput, setRuleInput] = useState('')
    const [humanization, setHumanization] = useState({
        formality_level: 50,
        creativity_level: 50,
        technical_level: 30,
        anti_ai_variation: true
    })

    const [ragDocs, setRagDocs] = useState([])
    const [isRagDragging, setIsRagDragging] = useState(false)

    const isAnthropic = !!(settings.api_base_url && settings.api_base_url.toLowerCase().includes('anthropic.com'))

    const detectProvider = () => {
        const url = (settings.api_base_url || '').toLowerCase()
        if (!url) return 'openai'
        if (url.includes('anthropic.com')) return 'anthropic'
        if (url.includes('googleapis.com')) return 'gemini'
        return 'openai'
    }

    // Test section state
    const [testInput, setTestInput] = useState({ titulo: '', conteudo: '', categoria: '' })
    const [testOutput, setTestOutput] = useState(null)
    const [testLoading, setTestLoading] = useState(false)
    const [testError, setTestError] = useState('')
    const [promptSnapshot, setPromptSnapshot] = useState(null)
    const [loadingSnapshot, setLoadingSnapshot] = useState(false)

    // Fetch editorial data on mount
    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        try {
            const [settingsRes, ragRes] = await Promise.all([
                supabase.functions.invoke('ap-editorial-settings', { method: 'GET' }),
                supabase.functions.invoke('ap-editorial-rag-upload', { method: 'GET' }),
            ])

            if (settingsRes.error) throw new Error(settingsRes.error.message || 'Erro na API de Settings')

            if (settingsRes.data?.settings) {
                setSettings(s => ({ ...s, ...settingsRes.data.settings }))
            }
            if (settingsRes.data?.humanization) {
                setHumanization(settingsRes.data.humanization)
            }
            if (settingsRes.data?.active_prompt) {
                setActivePrompt(settingsRes.data.active_prompt.prompt_base)
            }
            if (settingsRes.data?.rules) setRules(settingsRes.data.rules)
            if (ragRes.data && !ragRes.error) setRagDocs(Array.isArray(ragRes.data) ? ragRes.data : [])

        } catch (err) {
            console.error('[EditorialEngine] fetchData error:', err)
            toast.error('Não foi possível carregar o Motor Editorial. ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const saveSettings = async () => {
        setSaving(true)
        try {
            const payload = { settings, humanization }
            if (newApiKey) payload.apiKey = newApiKey

            const { error: fnErr } = await supabase.functions.invoke('ap-editorial-settings', {
                method: 'PUT',
                body: payload
            })

            if (fnErr) {
                console.error("DEBUG EDGE FUNCTION ERR:", fnErr)
                // Se context for null e for error custom, podemos tentar extrair.
                const errMsg = await (async () => {
                    try {
                        if (fnErr instanceof Response) return (await fnErr.json()).error
                        if (fnErr.context) return await fnErr.context.json().then(j => j.error).catch(() => fnErr.context.error)
                        return fnErr.message || JSON.stringify(fnErr)
                    } catch { return fnErr.message }
                })()
                throw new Error(String(errMsg))
            }

            if (newApiKey) {
                setSettings(s => ({ ...s, has_api_key: true }))
                setNewApiKey('')
            }

            toast.success('Configurações salvas.')
        } catch (err) {
            toast.error(err.message || 'Erro ao salvar configurações.')
        } finally {
            setSaving(false)
        }
    }

    const savePrompt = async () => {
        setSaving(true)
        try {
            const { error: fnErr } = await supabase.functions.invoke('ap-editorial-prompt', {
                method: 'POST',
                body: { prompt_base: activePrompt }
            })
            if (fnErr) throw fnErr

            toast.success('Nova versão do prompt salva.')
            fetchData()
        } catch (err) {
            toast.error(err.message || 'Erro ao salvar o prompt.')
        } finally {
            setSaving(false)
        }
    }

    const startAddRule = (type) => {
        setActiveRuleType(type)
        setRuleInput('')
    }

    const submitRule = async () => {
        if (!ruleInput.trim() || !activeRuleType) return

        try {
            const { error: dbErr } = await supabase.schema('ap').from('editorial_rules').insert({ cliente_id: clienteId, rule_type: activeRuleType, value: ruleInput.trim() })
            if (dbErr) throw dbErr
            const { data } = await supabase.schema('ap').from('editorial_rules').select('*').eq('cliente_id', clienteId)
            setRules(data)
            setActiveRuleType(null)
            setRuleInput('')
            toast.success('Regra adicionada.')
        } catch (err) {
            toast.error('Erro ao salvar regra: ' + err.message)
        }
    }

    const cancelAddRule = () => {
        setActiveRuleType(null)
        setRuleInput('')
    }

    const deleteRule = async (id) => {
        try {
            const { error: dbErr } = await supabase.schema('ap').from('editorial_rules').delete().eq('id', id)
            if (dbErr) throw dbErr
            setRules(rules.filter(r => r.id !== id))
        } catch (err) {
            toast.error('Erro ao remover regra: ' + err.message)
        }
    }

    const handleRagFile = async (file) => {
        if (!file) return

        if (isAnthropic) {
            toast.error('A Anthropic não gera embeddings. Use o modelo OpenAI padrão para enviar documentos.')
            return
        }

        if (!settings.has_api_key) {
            toast.error('Salve a chave da API OpenAI antes de enviar documentos.')
            return
        }

        const reader = new FileReader()
        reader.onload = async (evt) => {
            const content = evt.target.result
            setSaving(true)
            const toastId = toast.loading('Gerando vetores e anexando à base…')
            try {
                const { error: fnErr } = await supabase.functions.invoke('ap-editorial-rag-upload', {
                    method: 'POST',
                    body: { file_name: file.name, content }
                })
                if (fnErr) throw fnErr
                toast.success('Documento adicionado à base de conhecimento.', { id: toastId })
                fetchData()
            } catch (err) {
                toast.error('Erro no upload: ' + err.message, { id: toastId })
            } finally {
                setSaving(false)
            }
        }
        reader.readAsText(file) // only accepts text for now
    }

    const onRagInputChange = (e) => {
        const file = e.target.files?.[0]
        handleRagFile(file)
        e.target.value = null // reset input
    }

    const deleteRagDoc = async (source_document_id) => {
        try {
            const { error: fnErr } = await supabase.functions.invoke('ap-editorial-rag-upload', {
                method: 'DELETE',
                body: { source_document_id }
            })
            if (fnErr) throw fnErr
            setRagDocs(ragDocs.filter(d => d.source_document_id !== source_document_id))
        } catch (err) {
            toast.error('Erro ao remover documento: ' + err.message)
        }
    }

    const runTest = async () => {
        if (!testInput.titulo) return toast.error('Informe um título para testar.')
        setTestLoading(true)
        setTestError('')
        setTestOutput(null)
        setPromptSnapshot(null)
        try {
            const { data, error: fnErr } = await supabase.functions.invoke('ap-editorial-test', {
                method: 'POST',
                body: testInput
            })
            if (fnErr) throw fnErr
            if (data.error) throw new Error(data.error)
            setTestOutput(data)
        } catch (err) {
            setTestError(err.message)
        } finally {
            setTestLoading(false)
        }
    }

    const fetchSnapshot = async (logId) => {
        if (!logId) return;
        setLoadingSnapshot(true);
        try {
            const { data, error } = await supabase.schema('ap').from('editorial_logs').select('prompt_snapshot').eq('id', logId).single();
            if (error) throw error;
            setPromptSnapshot(data.prompt_snapshot);
        } catch (err) {
            console.error(err);
            setPromptSnapshot("Erro ao buscar log auditado.");
        } finally {
            setLoadingSnapshot(false);
        }
    }

    const Header = (
        <div className="motor-editorial-header">
            <span className="motor-editorial-mark"><Brain size={22} /></span>
            <div className="motor-editorial-heading">
                <h2>Motor Editorial IA</h2>
                <p>Pipeline de IA para curadoria, edição e padronização editorial.</p>
            </div>
        </div>
    )

    if (loading) return (
        <div className="motor-editorial-container">
            {Header}
            <div className="editorial-cards-grid">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
        </div>
    )

    // Rótulos coerentes: o botão que cria a regra e o chip que a exibe usam o mesmo nome.
    const RULE_LABELS = {
        forbidden: { label: 'Proibida', tone: 'danger' },
        mandatory: { label: 'Obrigatório', tone: 'success' },
        priority_topic: { label: 'Interesse', tone: 'brand' },
        substitution: { label: 'Substituição', tone: 'warn' },
    }

    const sliderFill = (val) => ({
        background: `linear-gradient(to right, var(--color-primary) ${val}%, var(--color-border) ${val}%)`
    })

    return (
        <div className="motor-editorial-container">
            {Header}

            <div className="editorial-cards-grid">

                {/* CARD 1: NÚCLEO E IDENTIDADE */}
                <div className="editorial-section">
                    <h3><Cpu size={18} /> Núcleo de Processamento</h3>
                    <div className="editorial-fields-row" style={{ marginTop: 12 }}>
                        <div className="editorial-form-group">
                            <label>Chave de API (OpenAI)</label>
                            <input
                                type="password"
                                className="editorial-input"
                                placeholder={settings.has_api_key ? "•••••••••••••••• (chave salva)" : "sk-..."}
                                value={newApiKey}
                                onChange={e => setNewApiKey(e.target.value)}
                            />
                            <span className="editorial-hint">Salva com segurança — nunca é exibida nem retornada pela API.</span>
                        </div>
                        <div className="editorial-form-group">
                            <label>URL base da API (endpoint)</label>
                            <input
                                type="text"
                                className="editorial-input"
                                placeholder={settings.api_base_url || "Padrão: https://api.openai.com/v1"}
                                value={settings.api_base_url || ''}
                                onChange={e => setSettings({ ...settings, api_base_url: e.target.value })}
                            />
                            <span className="editorial-hint">Deixe em branco para usar a OpenAI padrão.</span>
                        </div>
                    </div>
                    <div className="editorial-fields-row" style={{ marginTop: 12 }}>
                        <div className="editorial-form-group">
                            <label>Modelo primário</label>
                            <input
                                list="modelos-primarios"
                                className="editorial-input"
                                value={settings.model_primary}
                                onChange={e => setSettings({ ...settings, model_primary: e.target.value })}
                                placeholder="ex: gpt-4o-mini, llama3, claude-3"
                            />
                            <datalist id="modelos-primarios">
                                {(() => {
                                    const provider = detectProvider()
                                    if (provider === 'anthropic') {
                                        return (
                                            <>
                                                <option value="claude-3-haiku-20240307">Claude 3 Haiku (Rápido)</option>
                                                <option value="claude-3-sonnet-20240229">Claude 3 Sonnet (Equilíbrio)</option>
                                                <option value="claude-3-opus-20240229">Claude 3 Opus (Avançado)</option>
                                            </>
                                        )
                                    }
                                    if (provider === 'gemini') {
                                        return (
                                            <>
                                                <option value="gemini-1.5-flash-002">Gemini 1.5 Flash 002 (Rápido)</option>
                                                <option value="gemini-1.5-pro-002">Gemini 1.5 Pro 002 (Avançado)</option>
                                            </>
                                        )
                                    }
                                    // OpenAI / compat
                                    return (
                                        <>
                                            <option value="gpt-4o-mini">GPT-4o Mini (Recomendado, Rápido)</option>
                                            <option value="gpt-4o">GPT-4o (Avançado, Oneroso)</option>
                                            <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                                            <option value="gpt-4.1">GPT-4.1</option>
                                        </>
                                    )
                                })()}
                            </datalist>
                        </div>
                        <div className="editorial-form-group">
                            <label>Modelo de fallback</label>
                            <input
                                list="modelos-fallback"
                                className="editorial-input"
                                value={settings.model_fallback}
                                onChange={e => setSettings({ ...settings, model_fallback: e.target.value })}
                                placeholder="ex: gpt-4o, mixtral"
                            />
                            <datalist id="modelos-fallback">
                                {(() => {
                                    const provider = detectProvider()
                                    if (provider === 'anthropic') {
                                        return (
                                            <>
                                                <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                                                <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                                            </>
                                        )
                                    }
                                    if (provider === 'gemini') {
                                        return (
                                            <>
                                                <option value="gemini-1.5-flash-002">Gemini 1.5 Flash 002</option>
                                                <option value="gemini-1.5-pro-002">Gemini 1.5 Pro 002</option>
                                            </>
                                        )
                                    }
                                    // OpenAI / compat
                                    return (
                                        <>
                                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                                            <option value="gpt-4o">GPT-4o (Avançado)</option>
                                            <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Legado)</option>
                                        </>
                                    )
                                })()}
                            </datalist>
                        </div>
                    </div>
                    <div className="editorial-save-row" style={{ marginTop: 12 }}>
                        <div className="editorial-form-group">
                            <label>Temperatura (0 a 2)</label>
                            <input type="number" step="0.1" min="0" max="2" className="editorial-input" value={settings.temperature} onChange={e => setSettings({ ...settings, temperature: parseFloat(e.target.value) })} />
                        </div>
                        <button className="editorial-button" onClick={saveSettings} disabled={saving}>
                            <Save size={16} /> Salvar configurações
                        </button>
                    </div>

                    <hr className="editorial-divider" style={{ margin: '20px 0 8px' }} />

                    <h3><FileText size={18} /> Personalidade e Prompt de Sistema</h3>

                    <label className="editorial-switch" style={{ marginTop: 4 }}>
                        <input type="checkbox" checked={settings.system_prompt_override} onChange={e => setSettings({ ...settings, system_prompt_override: e.target.checked })} />
                        <span className="editorial-switch-track" />
                        <span className="editorial-switch-body">
                            <span className="editorial-switch-label">Usar prompt fixo</span>
                            <span className="editorial-switch-hint">Ignora o versionamento dinâmico e usa sempre o texto abaixo.</span>
                        </span>
                    </label>

                    {settings.system_prompt_override ? (
                        <div className="editorial-form-group">
                            <label>Prompt de sistema fixo</label>
                            <textarea className="editorial-textarea large" value={settings.override_prompt_text} onChange={e => setSettings({ ...settings, override_prompt_text: e.target.value })} placeholder="Escreva o prompt fixo aqui..." />
                        </div>
                    ) : (
                        <>
                            <div className="editorial-form-group">
                                <label>Prompt base atual (versionado)</label>
                                <textarea className="editorial-textarea" value={activePrompt} onChange={e => setActivePrompt(e.target.value)} placeholder="Defina a personalidade do editor. Ex: 'Você é um editor sênior focado em neurociência...'" />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="editorial-button secondary" onClick={savePrompt} disabled={saving || !activePrompt}>Salvar nova versão</button>
                            </div>
                        </>
                    )}
                </div>

                {/* CARD 2: REGRAS E HUMANIZAÇÃO */}
                <div className="editorial-section">
                    <h3><AlertCircle size={18} /> Regras Inegociáveis</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                        <button className="editorial-button secondary" onClick={() => startAddRule('forbidden')}><Plus size={14} /> Palavra Proibida</button>
                        <button className="editorial-button secondary" onClick={() => startAddRule('mandatory')}><Plus size={14} /> Termo Obrigatório</button>
                        <button className="editorial-button secondary" onClick={() => startAddRule('priority_topic')}><Plus size={14} /> Tópico de Interesse</button>
                        <button className="editorial-button secondary" onClick={() => startAddRule('substitution')}><Plus size={14} /> Substituição</button>
                    </div>

                    {activeRuleType && (
                        <div className="editorial-rule-adder">
                            <span className="editorial-rule-adder-label">
                                Adicionando {RULE_LABELS[activeRuleType]?.label}
                            </span>
                            <div className="editorial-rule-adder-row">
                                <input
                                    autoFocus
                                    className="editorial-input"
                                    style={{ flex: 1 }}
                                    placeholder={activeRuleType === 'substitution' ? "Ex: JSON -> JSONB" : "Digite o termo..."}
                                    value={ruleInput}
                                    onChange={e => setRuleInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && submitRule()}
                                />
                                <button className="editorial-button" onClick={submitRule} disabled={!ruleInput.trim()}>Salvar</button>
                                <button className="editorial-button secondary" onClick={cancelAddRule}>Cancelar</button>
                            </div>
                        </div>
                    )}

                    {rules.length === 0 ? <div className="editorial-empty-state" style={{ marginTop: 4 }}>Nenhuma regra definida — a IA está livre.</div> : (
                        <div className="editorial-table-wrap scroll">
                            <table className="editorial-table">
                                <thead>
                                    <tr>
                                        <th>Tipo</th>
                                        <th>Regra</th>
                                        <th style={{ width: 50 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rules.map(r => {
                                        const meta = RULE_LABELS[r.rule_type] || { label: r.rule_type, tone: 'brand' }
                                        return (
                                            <tr key={r.id}>
                                                <td>
                                                    <span className={`editorial-chip tone-${meta.tone}`}>{meta.label}</span>
                                                </td>
                                                <td>{r.value}</td>
                                                <td style={{ width: 50 }}>
                                                    <button className="editorial-button danger icon-only" onClick={() => deleteRule(r.id)} title="Remover regra"><Trash2 size={14} /></button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <hr className="editorial-divider" style={{ margin: '20px 0 8px' }} />

                    <h3><Zap size={18} /> Controle de Estilo e Humanização</h3>
                    <div className="editorial-sliders" style={{ marginTop: 4 }}>
                        <div className="editorial-slider-container" style={{ flex: 1 }}>
                            <div className="editorial-slider-header">
                                <label>Formalidade</label>
                                <span className="editorial-slider-value">{humanization.formality_level}%</span>
                            </div>
                            <input type="range" min="0" max="100" className="editorial-slider" style={sliderFill(humanization.formality_level)} value={humanization.formality_level} onChange={e => setHumanization({ ...humanization, formality_level: parseInt(e.target.value) })} />
                            <span className="editorial-slider-scale">
                                <span>Informal</span><span>Acadêmico</span>
                            </span>
                        </div>

                        <div className="editorial-slider-container" style={{ flex: 1 }}>
                            <div className="editorial-slider-header">
                                <label>Criatividade</label>
                                <span className="editorial-slider-value">{humanization.creativity_level}%</span>
                            </div>
                            <input type="range" min="0" max="100" className="editorial-slider" style={sliderFill(humanization.creativity_level)} value={humanization.creativity_level} onChange={e => setHumanization({ ...humanization, creativity_level: parseInt(e.target.value) })} />
                            <span className="editorial-slider-scale">
                                <span>Fatos Secos</span><span>Metáforas Ricas</span>
                            </span>
                        </div>

                        <div className="editorial-slider-container" style={{ flex: 1 }}>
                            <div className="editorial-slider-header">
                                <label>Densidade Técnica</label>
                                <span className="editorial-slider-value">{humanization.technical_level}%</span>
                            </div>
                            <input type="range" min="0" max="100" className="editorial-slider" style={sliderFill(humanization.technical_level)} value={humanization.technical_level} onChange={e => setHumanization({ ...humanization, technical_level: parseInt(e.target.value) })} />
                            <span className="editorial-slider-scale">
                                <span>Leigo</span><span>Especializado</span>
                            </span>
                        </div>
                    </div>

                    <label className="editorial-switch" style={{ marginTop: 12 }}>
                        <input type="checkbox" checked={humanization.anti_ai_variation} onChange={e => setHumanization({ ...humanization, anti_ai_variation: e.target.checked })} />
                        <span className="editorial-switch-track" />
                        <span className="editorial-switch-body">
                            <span className="editorial-switch-label">Forçar diretriz anti-IA</span>
                            <span className="editorial-switch-hint">Proíbe clichês como “Mergulhe fundo”, “Em resumo” e “É importante ressaltar”.</span>
                        </span>
                    </label>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <button className="editorial-button" onClick={saveSettings} disabled={saving}><Save size={14} /> Salvar configurações</button>
                    </div>
                </div>

                {/* CARD 3: RAG (BASE DE CONHECIMENTO) */}
                <div className="editorial-section">
                    <h3><Brain size={18} /> Base de Conhecimento (RAG)</h3>
                    <p style={{ margin: 0, fontSize: 13, color: 'var(--color-text-secondary)' }}>Envie documentos de texto para injetar conhecimento privado no pipeline editorial.</p>

                    {isAnthropic && (
                        <div className="editorial-callout warn">
                            <AlertCircle size={16} /> <span><b>RAG desativado:</b> a API da Anthropic informada acima não oferece endpoint de embeddings.</span>
                        </div>
                    )}

                    <div
                        className={`editorial-dropzone${isRagDragging ? ' dragging' : ''}${(saving || isAnthropic) ? ' disabled' : ''}`}
                        onDragOver={e => { e.preventDefault(); if (!saving && !isAnthropic) setIsRagDragging(true) }}
                        onDragLeave={() => setIsRagDragging(false)}
                        onDrop={e => { e.preventDefault(); setIsRagDragging(false); if (!saving && !isAnthropic && e.dataTransfer.files?.[0]) handleRagFile(e.dataTransfer.files[0]) }}
                        onClick={() => { if (!saving && !isAnthropic) document.getElementById('rag-file-upload').click() }}
                    >
                        <input id="rag-file-upload" type="file" accept=".txt" style={{ display: 'none' }} onChange={onRagInputChange} disabled={saving || isAnthropic} />
                        <div className="editorial-dropzone-icon"><UploadCloud size={20} /></div>
                        <span className="editorial-dropzone-title">Enviar documento (.txt)</span>
                        <span className="editorial-dropzone-sub">Clique ou arraste um arquivo de texto</span>
                    </div>

                    {ragDocs.length === 0 ? <div className="editorial-empty-state">A base está vazia — o modelo trabalha apenas com o LLM puro.</div> : (
                        <div className="editorial-table-wrap">
                            <table className="editorial-table">
                                <thead>
                                    <tr>
                                        <th>Arquivo fonte</th>
                                        <th>Ingerido em</th>
                                        <th style={{ width: 50 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ragDocs.map(d => (
                                        <tr key={d.id}>
                                            <td>{d.file_name}</td>
                                            <td className="editorial-tokens-detail" style={{ margin: 0 }}>{new Date(d.created_at).toLocaleDateString('pt-BR')}</td>
                                            <td style={{ width: 50 }}>
                                                <button className="editorial-button danger icon-only" onClick={() => deleteRagDoc(d.source_document_id)} title="Remover documento"><Trash2 size={14} /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* CARD 4: AVALIAÇÃO / TESTE END-TO-END */}
                <div className="editorial-section featured">
                    <h3><RefreshCw size={18} /> Validação End-to-End</h3>

                    <div className="editorial-row" style={{ marginTop: 4 }}>
                        <div className="editorial-form-group" style={{ flex: 1 }}>
                            <label>Título de teste</label>
                            <input className="editorial-input" placeholder="Ex: Novo tratamento para diabetes anunciado" value={testInput.titulo} onChange={e => setTestInput({ ...testInput, titulo: e.target.value })} />
                        </div>
                        <div className="editorial-form-group" style={{ flex: 1 }}>
                            <label>Categoria (opcional)</label>
                            <input className="editorial-input" placeholder="Ex: Saúde" value={testInput.categoria} onChange={e => setTestInput({ ...testInput, categoria: e.target.value })} />
                        </div>
                    </div>

                    <div className="editorial-form-group" style={{ marginTop: 12 }}>
                        <label>Conteúdo bruto da matéria</label>
                        <textarea className="editorial-textarea" placeholder="Cole aqui o conteúdo original do agregador para testar se os filtros funcionam e se a IA adapta o texto ao seu estilo." value={testInput.conteudo} onChange={e => setTestInput({ ...testInput, conteudo: e.target.value })} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 16, marginTop: 4 }}>
                        <button className="editorial-button" onClick={runTest} disabled={testLoading || !testInput.titulo}>
                            {testLoading ? 'Processando… (até 30s)' : 'Testar pipeline'}
                        </button>
                        {testError && <span style={{ color: 'var(--color-danger)', fontSize: 13, fontWeight: 500 }}>{testError}</span>}
                    </div>

                    {testOutput && (
                        <div style={{ marginTop: 12 }}>
                            <div className="editorial-output-head">
                                <label>Resultado do pipeline</label>
                                <span className="editorial-chip tone-success"><CheckCircle2 size={12} /> Sucesso</span>
                            </div>

                            <pre className="editorial-test-output">
                                {JSON.stringify(testOutput.parsed, null, 2)}
                            </pre>

                            <div className="editorial-metrics-bar">
                                <div className="editorial-metric">
                                    <span className="editorial-metric-label">Modelo usado</span>
                                    <span className="editorial-metric-value" style={{ fontSize: 14 }}>{testOutput.model}</span>
                                </div>
                                <div className="editorial-metric">
                                    <span className="editorial-metric-label">Tokens consumidos</span>
                                    <span className="editorial-metric-value">
                                        {testOutput.tokens}
                                        <small>≈ US$ {(((testOutput.tokens ?? 0) / 1000000) * 0.15).toFixed(4)} (estimativa)</small>
                                    </span>
                                </div>
                                <div className="editorial-metric">
                                    <span className="editorial-metric-label">Auditoria</span>
                                    <span className="editorial-metric-value" style={{ fontSize: 14 }}>{testOutput.log_id ? "Registrado" : "Não registrado"}</span>
                                </div>
                            </div>

                            {testOutput.tokens_detail && (
                                <div className="editorial-tokens-detail">
                                    Prompt: {testOutput.tokens_detail.prompt} • Resposta: {testOutput.tokens_detail.completion}
                                </div>
                            )}

                            {testOutput.log_id && (
                                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <button className="editorial-button secondary" onClick={() => fetchSnapshot(testOutput.log_id)} disabled={loadingSnapshot}>
                                        {loadingSnapshot ? 'Carregando…' : 'Ver prompt e rastro RAG'}
                                    </button>

                                    {promptSnapshot && (
                                        <pre className="editorial-snapshot">
                                            {promptSnapshot}
                                        </pre>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div> {/* /Grid */}
        </div>
    )
}
