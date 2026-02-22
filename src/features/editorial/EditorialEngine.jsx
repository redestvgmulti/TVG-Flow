import React, { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { resolveClienteId } from '../../services/resolveClienteId'
import { Save, Plus, Trash2, Cpu, Brain, Zap, RefreshCw, AlertCircle, FileText, CheckCircle2 } from 'lucide-react'
import '../../styles/EditorialEngine.css'

export default function EditorialEngine() {
    const { professionalId, role } = useAuth()
    const [clienteId, setClienteId] = useState(null)
    const [loading, setLoading] = useState(false)
    const [clienteLoading, setClienteLoading] = useState(true)
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
        has_api_key: false // Readonly from backend
    })
    const [newApiKey, setNewApiKey] = useState('')

    const [activePrompt, setActivePrompt] = useState('')
    const [promptHistory, setPromptHistory] = useState([])

    const [rules, setRules] = useState([])
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

    // 1. Resolve clienteId — works for admin AND profissional
    useEffect(() => {
        if (!professionalId) return
        resolveClienteId(professionalId, role).then(id => {
            if (id) setClienteId(id)
            setClienteLoading(false)
        })
    }, [professionalId, role])

    // 2. Fetch editorial data when clienteId is ready
    useEffect(() => {
        if (!clienteId) return
        fetchData()
    }, [clienteId])

    const fetchData = async () => {
        setLoading(true)
        try {
            const [settingsRes, promptRes, ragRes] = await Promise.all([
                supabase.functions.invoke('ap-editorial-settings'),
                supabase.functions.invoke('ap-editorial-prompt'),
                supabase.functions.invoke('ap-editorial-rag-upload'),
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
            if (promptRes.data && !promptRes.error) setPromptHistory(Array.isArray(promptRes.data) ? promptRes.data : [])
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

            if (fnErr) throw fnErr

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
            const { error: fnErr, data } = await supabase.functions.invoke('ap-editorial-prompt', {
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

    const addRule = async (type) => {
        const val = prompt(`Digite a regra (tipo: ${type}):`)
        if (!val) return

        try {
            const { error: dbErr } = await supabase.from('ap.editorial_rules').insert({ cliente_id: clienteId, rule_type: type, value: val })
            if (dbErr) throw dbErr
            const { data } = await supabase.from('ap.editorial_rules').select('*').eq('cliente_id', clienteId)
            setRules(data)
        } catch (err) {
            alert(err.message)
        }
    }

    const deleteRule = async (id) => {
        try {
            const { error: dbErr } = await supabase.from('ap.editorial_rules').delete().eq('id', id)
            if (dbErr) throw dbErr
            setRules(rules.filter(r => r.id !== id))
        } catch (err) {
            alert(err.message)
        }
    }

    const uploadRagFile = async (e) => {
        const file = e.target.files[0]
        if (!file) return

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
                headers: { 'Content-Type': 'application/json' },
                query: { source_document_id } // sending via query param or you can change fetch
            })
            // The above uses edge func URL queries which is non-standard for jsr client if not implemented correctly.
            // fallback: let's call our custom fetch if query args don't work reliably with supabase client

            // alternative native: supabase client doesn't support query directly easily on invoke DELETE
            const { error } = await supabase.from("ap.editorial_rag_documents").delete().eq("source_document_id", source_document_id)
            if (error) throw error;

            setRagDocs(ragDocs.filter(d => d.source_document_id !== source_document_id))
        } catch (err) {
            alert(err.message)
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
            const { data, error } = await supabase.from('ap.editorial_logs').select('prompt_snapshot').eq('id', logId).single();
            if (error) throw error;
            setPromptSnapshot(data.prompt_snapshot);
        } catch (err) {
            console.error(err);
            setPromptSnapshot("Erro ao buscar log auditado.");
        } finally {
            setLoadingSnapshot(false);
        }
    }

    if (clienteLoading) return <div style={{ padding: 40, color: '#A0A0A0' }}>Iniciando Motor Editorial...</div>

    if (!clienteId) return (
        <div style={{ padding: 40, color: '#EF4444' }}>
            Usuário sem tenant ativo vinculado. O Motor Editorial requer um vínculo em <strong>cliente_profissionais</strong>.
        </div>
    )

    if (loading) return <div style={{ padding: 40, color: '#A0A0A0' }}>Carregando configurações...</div>


    return (
        <div className="motor-editorial-container">
            <div className="motor-editorial-header">
                <h2><Brain size={24} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8, color: 'var(--color-primary)' }} /> Motor Editorial IA</h2>
                <p>Pipeline de Inteligência Artificial para curadoria, edição e padronização (Enterprise V2).</p>
            </div>

            {error && <div style={{ padding: 12, backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#EF4444', borderRadius: 6 }}>{error}</div>}
            {success && <div style={{ padding: 12, backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10B981', borderRadius: 6 }}>{success}</div>}

            {/* 1. CONFIGURAÇÃO TÉCNICA */}
            <div className="editorial-section">
                <h3><Cpu size={18} /> Núcleo de Processamento</h3>
                <div className="editorial-row">
                    <div className="editorial-form-group">
                        <label>OpenAI API Key (Vault Seguro)</label>
                        <input
                            type="password"
                            className="editorial-input"
                            placeholder={settings.has_api_key ? "•••••••••••••••• (Chave salva no Cofre)" : "sk-..."}
                            value={newApiKey}
                            onChange={e => setNewApiKey(e.target.value)}
                        />
                        <span style={{ fontSize: 11, color: '#888' }}>As chaves NUNCA são salvas em texto puro ou retornadas pela API.</span>
                    </div>
                    <div className="editorial-form-group">
                        <label>Modelo Primário</label>
                        <select className="editorial-select" value={settings.model_primary} onChange={e => setSettings({ ...settings, model_primary: e.target.value })}>
                            <option value="gpt-4o-mini">GPT-4o Mini (Recomendado, Rápido)</option>
                            <option value="gpt-4o">GPT-4o (Avançado, Oneroso)</option>
                        </select>
                    </div>
                </div>
                <div className="editorial-row">
                    <div className="editorial-form-group">
                        <label>Modelo de Fallback</label>
                        <select className="editorial-select" value={settings.model_fallback} onChange={e => setSettings({ ...settings, model_fallback: e.target.value })}>
                            <option value="gpt-4o-mini">GPT-4o Mini</option>
                            <option value="gpt-4o">GPT-4o (Avançado)</option>
                            <option value="gpt-3.5-turbo">GPT-3.5 Turbo (Legado)</option>
                        </select>
                    </div>
                    <div className="editorial-form-group">
                        <label>Temperatura (0 a 2)</label>
                        <input type="number" step="0.1" min="0" max="2" className="editorial-input" value={settings.temperature} onChange={e => setSettings({ ...settings, temperature: parseFloat(e.target.value) })} />
                    </div>
                    <div className="editorial-form-group auto-width" style={{ justifyContent: 'flex-end', paddingBottom: 2 }}>
                        <button className="editorial-button" onClick={saveSettings} disabled={saving}>
                            <Save size={16} /> Salvar Motor
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. IDENTIDADE (PROMPT) */}
            <div className="editorial-section">
                <h3><FileText size={18} /> Personalidade e Prompt de Sistema</h3>
                <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ color: '#E0E0E0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
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

            {/* 3. REGRAS (CONSTRAINTS) */}
            <div className="editorial-section">
                <h3><AlertCircle size={18} /> Regras Inegociáveis</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="editorial-button secondary" onClick={() => addRule('forbidden')}><Plus size={14} /> Palavra Proibida</button>
                    <button className="editorial-button secondary" onClick={() => addRule('mandatory')}><Plus size={14} /> Termo Obrigatório</button>
                    <button className="editorial-button secondary" onClick={() => addRule('substitution')}><Plus size={14} /> Substituição</button>
                </div>

                {rules.length === 0 ? <div className="editorial-empty-state">Nenhuma regra definida. A IA está livre.</div> : (
                    <table className="editorial-table">
                        <thead>
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
                                            backgroundColor: r.rule_type === 'forbidden' ? 'rgba(239,68,68,0.2)' : r.rule_type === 'mandatory' ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)',
                                            color: r.rule_type === 'forbidden' ? '#EF4444' : r.rule_type === 'mandatory' ? '#10B981' : '#F59E0B'
                                        }}>
                                            {r.rule_type.toUpperCase()}
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
                )}
            </div>

            {/* 4. HUMANIZAÇÃO */}
            <div className="editorial-section">
                <h3><Zap size={18} /> Controle de Estilo e Humanização</h3>
                <div className="editorial-row">
                    <div className="editorial-slider-container" style={{ flex: 1 }}>
                        <div className="editorial-slider-header">
                            <label>Formalidade</label>
                            <span className="editorial-slider-value">{humanization.formality_level}%</span>
                        </div>
                        <input type="range" min="0" max="100" className="editorial-slider" value={humanization.formality_level} onChange={e => setHumanization({ ...humanization, formality_level: parseInt(e.target.value) })} />
                        <span style={{ fontSize: 11, color: '#888', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Informal</span><span>Acadêmico</span>
                        </span>
                    </div>

                    <div className="editorial-slider-container" style={{ flex: 1 }}>
                        <div className="editorial-slider-header">
                            <label>Criatividade / Storytelling</label>
                            <span className="editorial-slider-value">{humanization.creativity_level}%</span>
                        </div>
                        <input type="range" min="0" max="100" className="editorial-slider" value={humanization.creativity_level} onChange={e => setHumanization({ ...humanization, creativity_level: parseInt(e.target.value) })} />
                        <span style={{ fontSize: 11, color: '#888', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Fatos Secos</span><span>Metáforas Ricas</span>
                        </span>
                    </div>

                    <div className="editorial-slider-container" style={{ flex: 1 }}>
                        <div className="editorial-slider-header">
                            <label>Densidade Técnica</label>
                            <span className="editorial-slider-value">{humanization.technical_level}%</span>
                        </div>
                        <input type="range" min="0" max="100" className="editorial-slider" value={humanization.technical_level} onChange={e => setHumanization({ ...humanization, technical_level: parseInt(e.target.value) })} />
                        <span style={{ fontSize: 11, color: '#888', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Leigo</span><span>Especializado</span>
                        </span>
                    </div>
                </div>

                <div style={{ marginTop: 16 }}>
                    <label style={{ color: '#E0E0E0', fontSize: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={humanization.anti_ai_variation} onChange={e => setHumanization({ ...humanization, anti_ai_variation: e.target.checked })} />
                        Forçar Diretriz Anti-IA (Proíbe "Mergulhe Fundo", "Em Resumo", "É importante ressaltar")
                    </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                    <button className="editorial-button" onClick={saveSettings} disabled={saving}><Save size={14} /> Salvar Parâmetros</button>
                </div>
            </div>

            {/* 5. RAG (BASE DE CONHECIMENTO) */}
            <div className="editorial-section">
                <h3><Brain size={18} /> Adestramento Contextual (RAG)</h3>
                <p style={{ margin: 0, fontSize: 13, color: '#A0A0A0' }}>Faça upload de documentos texto (PDF/Word não suportados por enquanto, use .txt) para injetar conhecimento privado no pipeline editorial.</p>

                <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                    <input type="file" accept=".txt" onChange={uploadRagFile} disabled={saving} style={{ color: '#DDD', fontSize: 14 }} />
                </div>

                {ragDocs.length === 0 ? <div className="editorial-empty-state" style={{ padding: 16 }}>A base vetorial está vazia. O modelo trabalhará apenas com o LLM puro.</div> : (
                    <table className="editorial-table">
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

            {/* 6. AVALIAÇÃO / TESTE END-TO-END */}
            <div className="editorial-section" style={{ border: '1px solid var(--color-primary)' }}>
                <h3><RefreshCw size={18} style={{ color: 'var(--color-primary)' }} /> Validação End-to-End</h3>

                <div className="editorial-row">
                    <div className="editorial-form-group" style={{ flex: 1 }}>
                        <label>Título Teste</label>
                        <input className="editorial-input" placeholder="Ex: Novo tratamento para Diabetes anunciado" value={testInput.titulo} onChange={e => setTestInput({ ...testInput, titulo: e.target.value })} />
                    </div>
                    <div className="editorial-form-group" style={{ flex: 1 }}>
                        <label>Categoria Opcional</label>
                        <input className="editorial-input" placeholder="Ex: Saúde" value={testInput.categoria} onChange={e => setTestInput({ ...testInput, categoria: e.target.value })} />
                    </div>
                </div>

                <div className="editorial-form-group">
                    <label>Conteúdo Bruto (Source News)</label>
                    <textarea className="editorial-textarea" placeholder="Cole aqui o conteúdo original do agregador para testar se os filtros funcionam e se a IA adapta o texto corretamente de acordo com seu estilo." value={testInput.conteudo} onChange={e => setTestInput({ ...testInput, conteudo: e.target.value })} />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: 16 }}>
                    <button className="editorial-button" onClick={runTest} disabled={testLoading || !testInput.titulo}>
                        {testLoading ? 'Processando (30s max)...' : 'Executar Pipeline e Injetar Dados'}
                    </button>
                    {testError && <span style={{ color: '#EF4444', fontSize: 13, fontWeight: 500 }}>{testError}</span>}
                </div>

                {testOutput && (
                    <div style={{ marginTop: 24 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8 }}>
                            <label style={{ fontSize: 14, fontWeight: 600, color: '#FFF' }}>Resultado (JSON Raw Extracted):</label>
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
                                <span className="editorial-metric-value">{testOutput.tokens} <span style={{ fontSize: 10, color: '#888', fontWeight: 'normal' }}>(~${((testOutput.tokens / 1000000) * 0.15).toFixed(4)})</span></span>
                            </div>
                            <div className="editorial-metric">
                                <span className="editorial-metric-label">Status (Auditoria)</span>
                                <span className="editorial-metric-value">{testOutput.log_id ? "Log Criptografado salvo" : "Sem Log"}</span>
                            </div>
                        </div>

                        <details style={{ marginTop: 16 }} onToggle={(e) => { if (e.target.open && !promptSnapshot) fetchSnapshot(testOutput.log_id) }}>
                            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--color-primary)', fontWeight: 500 }}>Consultar Log de Decisão (Requer Acesso Base)</summary>
                            <pre className="editorial-test-output" style={{ fontSize: 11, color: '#A0A0A0', borderColor: '#222', marginTop: 8 }}>
                                {loadingSnapshot ? "Buscando snapshot no Vault de logs..." : promptSnapshot || "Nenhum snapshot em memória"}
                            </pre>
                        </details>
                    </div>
                )}
            </div>

        </div>
    )
}
