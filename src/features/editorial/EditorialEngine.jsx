import React, { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { Save, Plus, Trash2, Cpu, Brain, Zap, RefreshCw, AlertCircle, FileText, CheckCircle2 } from 'lucide-react'
import { SkeletonCard } from '../../components/Skeleton'
import '../../styles/EditorialEngine.css'

const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
export default function EditorialEngine() {
    const clienteId = FIXED_CLIENT_ID
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState('')

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
            setError('Erro ao carregar dados do Motor Editorial: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    const saveSettings = async () => {
        setSaving(true)
        setError('')
        setSuccess('')
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

            setSuccess('Configurações salvas com sucesso!')
            setTimeout(() => setSuccess(''), 3000)
        } catch (err) {
            setError(err.message || 'Erro ao salvar configurações')
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

            setSuccess('Nova versão do prompt salva!')
            fetchData()
        } catch (err) {
            setError(err.message)
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
        } catch (err) {
            setError('Erro ao salvar regra: ' + err.message)
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
            setError('Erro ao deletar regra: ' + err.message)
        }
    }

    const uploadRagFile = async (e) => {
        const file = e.target.files[0]
        if (!file) return

        if (settings.api_base_url && settings.api_base_url.includes('anthropic.com')) {
            alert("A Anthropic não suporta envio de documentos RAG nativamente. Desabilite-a ou use o modelo OpenAI padrão para subir arquivos.")
            e.target.value = null
            return
        }

        if (!settings.has_api_key) {
            alert("Salve a API Key do OpenAI antes de enviar documentos para o RAG.")
            return
        }

        const reader = new FileReader()
        reader.onload = async (evt) => {
            const content = evt.target.result
            setSaving(true)
            try {
                const { error: fnErr } = await supabase.functions.invoke('ap-editorial-rag-upload', {
                    method: 'POST',
                    body: { file_name: file.name, content }
                })
                if (fnErr) throw fnErr
                alert("Upload concluído! Vetores gerados e anexados à base de conhecimento.")
                fetchData()
            } catch (err) {
                alert("Erro no upload RAG: " + err.message)
            } finally {
                setSaving(false)
                e.target.value = null // reset input
            }
        }
        reader.readAsText(file) // only accepts text for now
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
            setError('Erro ao deletar documento: ' + err.message)
        }
    }

    const runTest = async () => {
        if (!testInput.titulo) return alert("Título é obrigatório")
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

    if (loading) return (
        <div className="motor-editorial-container">
            <div className="motor-editorial-header">
                <h2><Brain size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, color: 'var(--color-primary)' }} /> Motor Editorial IA</h2>
                <p>Pipeline de Inteligência Artificial para curadoria, edição e padronização (Enterprise V2).</p>
            </div>
            <div className="editorial-cards-grid">
                {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
        </div>
    )


    return (
        <div className="motor-editorial-container">
            <div className="motor-editorial-header">
                <h2><Brain size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, color: 'var(--color-primary)' }} /> Motor Editorial IA</h2>
                <p>Pipeline de Inteligência Artificial para curadoria, edição e padronização (Enterprise V2).</p>
            </div>

            {error && <div style={{ padding: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', borderRadius: 6 }}>{error}</div>}
            {success && <div style={{ padding: 12, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10B981', borderRadius: 6 }}>{success}</div>}

            <div className="editorial-cards-grid">

                {/* CARD 1: NÚCLEO E IDENTIDADE */}
                <div className="editorial-section">
                    <h3><Cpu size={18} /> Núcleo de Processamento</h3>
                    <div className="editorial-fields-row" style={{ marginTop: 12 }}>
                        <div className="editorial-form-group">
                            <label>OpenAI API Key (Vault Seguro)</label>
                            <input
                                type="password"
                                className="editorial-input"
                                placeholder={settings.has_api_key ? "•••••••••••••••• (Chave salva no Cofre)" : "sk-..."}
                                value={newApiKey}
                                onChange={e => setNewApiKey(e.target.value)}
                            />
                            <span className="editorial-hint">As chaves NUNCA são salvas em texto puro ou retornadas pela API.</span>
                        </div>
                        <div className="editorial-form-group">
                            <label>API Base URL (Endpoint)</label>
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
                            <label>Modelo Primário</label>
                            <input
                                list="modelos-primarios"
                                className="editorial-input"
                                value={settings.model_primary}
                                onChange={e => setSettings({ ...settings, model_primary: e.target.value })}
                                placeholder="ex: gpt-4o-mini, llama3, claude-3"
                            />
                            <datalist id="modelos-primarios">
                                <option value="gpt-4o-mini">GPT-4o Mini (Recomendado, Rápido)</option>
                                <option value="gpt-4o">GPT-4o (Avançado, Oneroso)</option>
                            </datalist>
                        </div>
                        <div className="editorial-form-group">
                            <label>Modelo de Fallback</label>
                            <input
                                list="modelos-fallback"
                                className="editorial-input"
                                value={settings.model_fallback}
                                onChange={e => setSettings({ ...settings, model_fallback: e.target.value })}
                                placeholder="ex: gpt-4o, mixtral"
                            />
                            <datalist id="modelos-fallback">
                                <option value="gpt-4o-mini">GPT-4o Mini</option>
                                <option value="gpt-4o">GPT-4o (Avançado)</option>
                                <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Legado)</option>
                            </datalist>
                        </div>
                    </div>
                    <div className="editorial-save-row" style={{ marginTop: 12 }}>
                        <div className="editorial-form-group">
                            <label>Temperatura (0 a 2)</label>
                            <input type="number" step="0.1" min="0" max="2" className="editorial-input" value={settings.temperature} onChange={e => setSettings({ ...settings, temperature: parseFloat(e.target.value) })} />
                        </div>
                        <button className="editorial-button" onClick={saveSettings} disabled={saving}>
                            <Save size={16} /> Salvar Motor
                        </button>
                    </div>

                    <hr style={{ borderColor: 'var(--color-border-light, #e2e8f0)', margin: '24px 0 16px 0', borderStyle: 'solid', borderWidth: '1px 0 0 0' }} />

                    <h3><FileText size={18} /> Personalidade e Prompt de Sistema</h3>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, marginTop: 12 }}>
                        <label style={{ color: 'var(--color-text-secondary, #64748b)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={settings.system_prompt_override} onChange={e => setSettings({ ...settings, system_prompt_override: e.target.checked })} />
                            Ativar Override Estático (Ignorar versionamento dinâmico)
                        </label>
                    </div>

                    {settings.system_prompt_override ? (
                        <div className="editorial-form-group">
                            <label>Override de Prompt de Sistema (Fixo)</label>
                            <textarea className="editorial-textarea large" value={settings.override_prompt_text} onChange={e => setSettings({ ...settings, override_prompt_text: e.target.value })} placeholder="Escreva o prompt fixo aqui..." />
                        </div>
                    ) : (
                        <>
                            <div className="editorial-form-group">
                                <label>Prompt Base Atual (Versionado)</label>
                                <textarea className="editorial-textarea" value={activePrompt} onChange={e => setActivePrompt(e.target.value)} placeholder="Defina a personalidade do editor. Ex: 'Você é um editor sênior focado em neurociência...'" />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <button className="editorial-button secondary" onClick={savePrompt} disabled={saving || !activePrompt}>Salvar Nova Versão</button>
                            </div>
                        </>
                    )}
                </div>

                {/* CARD 2: REGRAS E HUMANIZAÇÃO */}
                <div className="editorial-section">
                    <h3><AlertCircle size={18} /> Regras Inegociáveis</h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                        <button className="editorial-button secondary" onClick={() => startAddRule('forbidden')}><Plus size={14} /> Palavra Proibida</button>
                        <button className="editorial-button secondary" onClick={() => startAddRule('mandatory')}><Plus size={14} /> Termo Obrigatório</button>
                        <button className="editorial-button secondary" onClick={() => startAddRule('substitution')}><Plus size={14} /> Substituição</button>
                    </div>

                    {activeRuleType && (
                        <div style={{ marginTop: 16, padding: 12, borderRadius: 8, backgroundColor: 'var(--color-bg-secondary)', border: '1px solid var(--color-border-light)' }}>
                            <label style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                Adicionando {activeRuleType === 'forbidden' ? 'Palavra Proibida' : activeRuleType === 'mandatory' ? 'Termo Obrigatório' : 'Substituição'}
                            </label>
                            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
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

                    {rules.length === 0 ? <div className="editorial-empty-state" style={{ marginTop: 12 }}>Nenhuma regra definida. A IA está livre.</div> : (
                        <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--color-border-light, #e2e8f0)', borderRadius: '6px', marginTop: '12px' }}>
                            <table className="editorial-table" style={{ margin: 0, border: 'none' }}>
                                <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--color-bg-secondary, #f8f9fa)', zIndex: 1 }}>
                                    <tr>
                                        <th>Tipo</th>
                                        <th>Regra</th>
                                        <th>Ação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rules.map(r => (
                                        <tr key={r.id}>
                                            <td>
                                                <span style={{
                                                    fontSize: 12, padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                                                    backgroundColor: r.rule_type === 'forbidden' ? 'rgba(239,68,68,0.1)' : r.rule_type === 'mandatory' ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.1)',
                                                    color: r.rule_type === 'forbidden' ? '#EF4444' : r.rule_type === 'mandatory' ? '#10B981' : '#F59E0B'
                                                }}>
                                                    {r.rule_type === 'forbidden' ? 'PROIBIDA' : r.rule_type === 'mandatory' ? 'OBRIGATÓRIO' : 'SUBSTITUIÇÃO'}
                                                </span>
                                            </td>
                                            <td>{r.value}</td>
                                            <td style={{ width: 50 }}>
                                                <button className="editorial-button danger" style={{ padding: 6, opacity: 0.7 }} onClick={() => deleteRule(r.id)}><Trash2 size={14} /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <hr style={{ borderColor: 'var(--color-border-light, #e2e8f0)', margin: '24px 0 16px 0', borderStyle: 'solid', borderWidth: '1px 0 0 0' }} />

                    <h3><Zap size={18} /> Controle de Estilo e Humanização</h3>
                    <div className="editorial-row" style={{ marginTop: 12 }}>
                        <div className="editorial-slider-container" style={{ flex: 1 }}>
                            <div className="editorial-slider-header">
                                <label>Formalidade</label>
                                <span className="editorial-slider-value">{humanization.formality_level}%</span>
                            </div>
                            <input type="range" min="0" max="100" className="editorial-slider" value={humanization.formality_level} onChange={e => setHumanization({ ...humanization, formality_level: parseInt(e.target.value) })} />
                            <span style={{ fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                <span>Informal</span><span>Acadêmico</span>
                            </span>
                        </div>

                        <div className="editorial-slider-container" style={{ flex: 1 }}>
                            <div className="editorial-slider-header">
                                <label>Criatividade</label>
                                <span className="editorial-slider-value">{humanization.creativity_level}%</span>
                            </div>
                            <input type="range" min="0" max="100" className="editorial-slider" value={humanization.creativity_level} onChange={e => setHumanization({ ...humanization, creativity_level: parseInt(e.target.value) })} />
                            <span style={{ fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                <span>Fatos Secos</span><span>Metáforas Ricas</span>
                            </span>
                        </div>

                        <div className="editorial-slider-container" style={{ flex: 1 }}>
                            <div className="editorial-slider-header">
                                <label>Densidade Técnica</label>
                                <span className="editorial-slider-value">{humanization.technical_level}%</span>
                            </div>
                            <input type="range" min="0" max="100" className="editorial-slider" value={humanization.technical_level} onChange={e => setHumanization({ ...humanization, technical_level: parseInt(e.target.value) })} />
                            <span style={{ fontSize: 11, color: '#64748b', display: 'flex', justifyContent: 'space-between' }}>
                                <span>Leigo</span><span>Especializado</span>
                            </span>
                        </div>
                    </div>

                    <div style={{ marginTop: 16 }}>
                        <label style={{ color: 'var(--color-text-secondary, #64748b)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={humanization.anti_ai_variation} onChange={e => setHumanization({ ...humanization, anti_ai_variation: e.target.checked })} />
                            Forçar Diretriz Anti-IA (Proíbe "Mergulhe Fundo", "Em Resumo", "É importante ressaltar")
                        </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                        <button className="editorial-button" onClick={saveSettings} disabled={saving}><Save size={14} /> Salvar Parâmetros</button>
                    </div>
                </div>

                {/* CARD 3: RAG (BASE DE CONHECIMENTO) */}
                <div className="editorial-section">
                    <h3><Brain size={18} /> Adestramento Contextual (RAG)</h3>
                    <p style={{ margin: '12px 0 16px 0', fontSize: 13, color: 'var(--color-text-secondary, #64748b)' }}>Faça upload de documentos texto para injetar conhecimento privado no pipeline editorial.</p>

                    {(settings.api_base_url && settings.api_base_url.includes('anthropic.com')) && (
                        <div style={{ padding: 12, backgroundColor: 'rgba(245, 158, 11, 0.1)', color: '#F59E0B', borderRadius: 6, marginBottom: 16, fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <AlertCircle size={16} /> <span><strong>RAG Desativado:</strong> A API da Anthropic preenchida acima não oferece suporte ao endpoint de Embeddings.</span>
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                        <input type="file" accept=".txt" onChange={uploadRagFile} disabled={saving || (settings.api_base_url && settings.api_base_url.includes('anthropic.com'))} style={{ color: 'var(--color-text-primary, #1e293b)', fontSize: 14 }} />
                    </div>

                    {ragDocs.length === 0 ? <div className="editorial-empty-state" style={{ marginTop: 16, padding: 16 }}>A base vetorial está vazia. O modelo trabalhará apenas com o LLM puro.</div> : (
                        <table className="editorial-table" style={{ marginTop: 16 }}>
                            <thead>
                                <tr>
                                    <th>Arquivo Fonte</th>
                                    <th>Data Ingestão</th>
                                    <th>Ação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {ragDocs.map(d => (
                                    <tr key={d.id}>
                                        <td>{d.file_name}</td>
                                        <td>{new Date(d.created_at).toLocaleDateString()}</td>
                                        <td style={{ width: 50 }}>
                                            <button className="editorial-button danger" style={{ padding: 6, opacity: 0.7 }} onClick={() => deleteRagDoc(d.source_document_id)}><Trash2 size={14} /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* CARD 4: AVALIAÇÃO / TESTE END-TO-END */}
                <div className="editorial-section" style={{ border: '1px solid var(--color-primary, #0ea5e9)' }}>
                    <h3><RefreshCw size={18} style={{ color: 'var(--color-primary, #0ea5e9)' }} /> Validação End-to-End</h3>

                    <div className="editorial-row" style={{ marginTop: 12 }}>
                        <div className="editorial-form-group" style={{ flex: 1 }}>
                            <label>Título Teste</label>
                            <input className="editorial-input" placeholder="Ex: Novo tratamento para Diabetes anunciado" value={testInput.titulo} onChange={e => setTestInput({ ...testInput, titulo: e.target.value })} />
                        </div>
                        <div className="editorial-form-group" style={{ flex: 1 }}>
                            <label>Categoria Opcional</label>
                            <input className="editorial-input" placeholder="Ex: Saúde" value={testInput.categoria} onChange={e => setTestInput({ ...testInput, categoria: e.target.value })} />
                        </div>
                    </div>

                    <div className="editorial-form-group" style={{ marginTop: 12 }}>
                        <label>Conteúdo Bruto (Source News)</label>
                        <textarea className="editorial-textarea" placeholder="Cole aqui o conteúdo original do agregador para testar se os filtros funcionam e se a IA adapta o texto corretamente de acordo com seu estilo." value={testInput.conteudo} onChange={e => setTestInput({ ...testInput, conteudo: e.target.value })} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 16, marginTop: 16 }}>
                        <button className="editorial-button" onClick={runTest} disabled={testLoading || !testInput.titulo}>
                            {testLoading ? 'Processando (30s max)...' : 'Executar Pipeline RAG'}
                        </button>
                        {testError && <span style={{ color: '#EF4444', fontSize: 13, fontWeight: 500 }}>{testError}</span>}
                    </div>

                    {testOutput && (
                        <div style={{ marginTop: 24 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                                <label style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary, #1e293b)' }}>Resultado (JSON Raw Extracted):</label>
                                <span style={{ fontSize: 11, color: '#10B981', display: 'flex', alignItems: 'center', gap: 4 }}><CheckCircle2 size={14} /> Sucesso</span>
                            </div>

                            <pre className="editorial-test-output">
                                {JSON.stringify(testOutput.parsed, null, 2)}
                            </pre>

                            <div className="editorial-metrics-bar">
                                <div className="editorial-metric">
                                    <span className="editorial-metric-label">Modelo Usado</span>
                                    <span className="editorial-metric-value">{testOutput.model}</span>
                                </div>
                                <div className="editorial-metric">
                                    <span className="editorial-metric-label">Tokens Totais (Billing)</span>
                                    <span className="editorial-metric-value">
                                        {testOutput.tokens}
                                        <span style={{ fontSize: 10, color: '#64748b', fontWeight: 'normal', marginLeft: 4 }}>
                                            (~${(((testOutput.tokens ?? 0) / 1000000) * 0.15).toFixed(4)})
                                        </span>
                                    </span>
                                </div>
                                <div className="editorial-metric">
                                    <span className="editorial-metric-label">Status (Auditoria)</span>
                                    <span className="editorial-metric-value">{testOutput.log_id ? "Salvo" : "Não Auditado"}</span>
                                </div>
                            </div>

                            {testOutput.tokens_detail && (
                                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-secondary, #64748b)' }}>
                                    <span>Prompt: {testOutput.tokens_detail.prompt} • Resposta: {testOutput.tokens_detail.completion}</span>
                                </div>
                            )}

                            {testOutput.log_id && (
                                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <button className="editorial-button secondary" onClick={() => fetchSnapshot(testOutput.log_id)} disabled={loadingSnapshot}>
                                        {loadingSnapshot ? 'Buscando...' : 'Ver Rastro RAG e Prompt Dinâmico'}
                                    </button>

                                    {promptSnapshot && (
                                        <pre style={{ fontSize: 11, color: "var(--color-text-secondary, #64748b)", background: "var(--color-bg-secondary, #f8f9fa)", padding: 12, borderRadius: 6, border: '1px solid var(--color-border-light, #cbd5e1)', whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto' }}>
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
