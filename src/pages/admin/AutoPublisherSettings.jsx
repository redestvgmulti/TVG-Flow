import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import { Plus, Trash2, Globe, Users } from 'lucide-react'

const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

// ──────────────────────────────────────────────────────────
// AutoPublisherSettings — FlowOS V2 Design System
// ──────────────────────────────────────────────────────────

export default function AutoPublisherSettings() {
    const clienteId = FIXED_CLIENT_ID
    const [sources, setSources] = useState([])
    const [templates, setTemplates] = useState([])
    const [newSource, setNewSource] = useState({ nome: '', url: '', tipo: 'rss' })
    const [newTemplate, setNewTemplate] = useState({ nome: '', placid_template_uuid: '', ordem: 1, tipo: 'feed', template_set: 'default' })
    const [templateView, setTemplateView] = useState({ campaign: null, format: null })
    const campaignsList = [
        { id: 'default', label: 'Padrão', icon: '⭐', desc: 'Templates ativos no dia a dia' },
        { id: 'individuais', label: 'Individuais', icon: '👤', desc: 'Material com um único vereador' },
        { id: 'natal', label: 'Natal', icon: '🎄', desc: 'Campanha de final de ano' },
        { id: 'ano_novo', label: 'Ano Novo', icon: '🎆', desc: 'Campanha de ano novo' },
        { id: 'dia_das_mulheres', label: 'Dia das Mulheres', icon: '👩', desc: 'Homenagens de dia das mulheres' },
        { id: 'dia_dos_pais', label: 'Dia dos Pais', icon: '👨', desc: 'Homenagens de dia dos pais' }
    ]
    const [saving, setSaving] = useState(false)

    async function apConfig(resource, action, payload = null) {
        const body = { resource, action }
        if (payload) body.payload = payload

        const { data, error } = await supabase.functions.invoke('ap-config', {
            method: 'POST',
            body,
        })
        if (error) {
            console.error('[ap-config HTTP Error]', error)
            throw error
        }
        if (data && data.has_error) {
            console.error('[ap-config Data Error DETAILED]', data)
            throw new Error(`Edge Function Error: ${data.error} | Type: ${data.type}`);
        }
        return data
    }

    const fetchData = useCallback(async () => {
        const [s, t] = await Promise.all([
            apConfig('sources', 'list'),
            apConfig('templates', 'list'),
        ])
        setSources(s ?? [])
        setTemplates(t ?? [])
    }, [])

    useEffect(() => { fetchData() }, [fetchData])

    async function addSource() {
        if (!newSource.nome || !newSource.url) return
        setSaving(true)
        try {
            await apConfig('sources', 'insert', newSource)
            setNewSource({ nome: '', url: '', tipo: 'rss' })
            await fetchData()
        } catch (err) {
            console.error('[Sources]', err)
        } finally {
            setSaving(false)
        }
    }

    async function deleteSource(id) {
        await apConfig('sources', 'delete', { id })
        fetchData()
    }

    async function toggleSource(id, ativo) {
        await apConfig('sources', 'update', { id, ativo: !ativo })
        fetchData()
    }

    async function addTemplate() {
        if (!newTemplate.nome || !newTemplate.placid_template_uuid) return
        setSaving(true)
        try {
            const maxOrdem = templates
                .filter(t => t.tipo === newTemplate.tipo && (t.template_set || 'default') === newTemplate.template_set)
                .reduce((max, t) => t.ordem > max ? t.ordem : max, 0);

            await apConfig('templates', 'insert', { ...newTemplate, ordem: maxOrdem + 1, ativo: true })
            setNewTemplate({ nome: '', placid_template_uuid: '', tipo: newTemplate.tipo, template_set: newTemplate.template_set })
            await fetchData()
        } catch (err) {
            console.error('[Templates]', err)
        } finally {
            setSaving(false)
        }
    }

    async function deleteTemplate(id) {
        if (!confirm('Deseja realmente excluir este template?')) return
        await apConfig('templates', 'delete', { id })
        fetchData()
    }

    async function toggleTemplate(id, ativo) {
        await apConfig('templates', 'update', { id, ativo: !ativo })
        fetchData()
    }

    return (
        <div className="ap-settings">
            {/* ── Sources ────────────────────────────────── */}
            <div className="ap-form-section">
                <h2>
                    <Globe size={16} style={{ color: 'var(--color-primary)' }} />
                    Fontes RSS Cadastradas
                </h2>

                <div className="ap-form-row">
                    <input
                        className="ap-input"
                        placeholder="Nome (ex: Folha de SP)"
                        value={newSource.nome}
                        onChange={e => setNewSource(p => ({ ...p, nome: e.target.value }))}
                    />
                    <input
                        className="ap-input"
                        style={{ flex: 2 }}
                        placeholder="URL do Feed RSS"
                        value={newSource.url}
                        onChange={e => setNewSource(p => ({ ...p, url: e.target.value }))}
                    />
                    <select
                        className="ap-select"
                        value={newSource.tipo}
                        onChange={e => setNewSource(p => ({ ...p, tipo: e.target.value }))}
                    >
                        <option value="rss">Padrão XML / RSS</option>
                        <option value="google_news_rss">Google News RSS</option>
                    </select>
                    <button className="ap-btn-add" onClick={addSource} disabled={saving || !newSource.nome || !newSource.url}>
                        <Plus size={14} /> Adicionar
                    </button>
                </div>

                <div className="ap-table-container">
                    <table className="ap-table">
                        <thead>
                            <tr>
                                <th>Nome da Fonte</th>
                                <th>Tipo</th>
                                <th>Endereço do Feed</th>
                                <th>Status</th>
                                <th style={{ width: 60, textAlign: 'center' }}>Excluir</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sources.length === 0 && (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>
                                        Nenhuma fonte RSS configurada neste ambiente.
                                    </td>
                                </tr>
                            )}
                            {sources.map(s => (
                                <tr key={s.id}>
                                    <td style={{ fontWeight: 500 }}>{s.nome}</td>
                                    <td>
                                        <span style={{ fontSize: 11, background: 'var(--color-bg-secondary)', color: 'var(--color-text-secondary)', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                            {s.tipo}
                                        </span>
                                    </td>
                                    <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', textDecoration: 'none' }}>
                                            {s.url}
                                        </a>
                                    </td>
                                    <td>
                                        <button
                                            className={`ap-toggle ${s.ativo ? 'on' : 'off'}`}
                                            onClick={() => toggleSource(s.id, s.ativo)}
                                        >
                                            {s.ativo ? 'Ativo' : 'Pausado'}
                                        </button>
                                    </td>
                                    <td style={{ textAlign: 'center' }}>
                                        <button className="ap-btn-sm" onClick={() => deleteSource(s.id)} title="Excluir">
                                            <Trash2 size={14} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Templates Placid ────────────────────────── */}
            <div className="ap-form-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0 }}>
                        <Globe size={16} style={{ color: 'var(--color-primary)' }} />
                        Gerenciamento de Templates
                    </h2>
                    {(templateView.campaign || templateView.format) && (
                        <button
                            className="ap-btn-sm"
                            style={{ padding: '6px 12px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontWeight: 600 }}
                            onClick={() => {
                                if (templateView.format) setTemplateView({ ...templateView, format: null })
                                else setTemplateView({ campaign: null, format: null })
                            }}
                        >
                            Voltar
                        </button>
                    )}
                </div>

                {!templateView.campaign ? (
                    // TELA 1: Campanhas
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                        {campaignsList.map(camp => (
                            <div
                                key={camp.id}
                                onClick={() => {
                                    setTemplateView({ ...templateView, campaign: camp.id });
                                    setNewTemplate(p => ({ ...p, template_set: camp.id }));
                                }}
                                style={{
                                    border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', cursor: 'pointer',
                                    background: '#fff', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '16px',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.1)' }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)' }}
                            >
                                <div style={{ fontSize: '32px', background: '#f8fafc', padding: '12px', borderRadius: '12px' }}>{camp.icon}</div>
                                <div>
                                    <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#0f172a' }}>{camp.label}</h3>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>{camp.desc}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !templateView.format ? (
                    // TELA 2: Formatos
                    <div>
                        <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#334155', fontWeight: 600 }}>
                            Campanha: {campaignsList.find(c => c.id === templateView.campaign)?.label}
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                            {['feed', 'reels'].map(fmt => (
                                <div
                                    key={fmt}
                                    onClick={() => {
                                        setTemplateView({ ...templateView, format: fmt });
                                        setNewTemplate(p => ({ ...p, tipo: fmt }));
                                    }}
                                    style={{
                                        border: '1px solid #e2e8f0', borderRadius: '16px', padding: '20px', cursor: 'pointer',
                                        background: '#fff', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '16px',
                                        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#3b82f6'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.1)' }}
                                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)' }}
                                >
                                    <div style={{ width: '40px', height: '40px', background: fmt === 'feed' ? '#eff6ff' : '#ede9fe', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: fmt === 'feed' ? '#3b82f6' : '#8b5cf6', fontWeight: 700, fontSize: '16px' }}>
                                        {fmt === 'feed' ? '1:1' : '9:16'}
                                    </div>
                                    <div>
                                        <h3 style={{ margin: '0 0 4px 0', fontSize: '16px', color: '#0f172a' }}>{fmt === 'feed' ? 'Quadrado (Feed)' : 'Vertical (Reels)'}</h3>
                                        <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                                            {templates.filter(t => (t.template_set || 'default') === templateView.campaign && t.tipo === fmt).length} templates
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    // TELA 3: Tabela de Templates
                    <div>
                        <h3 style={{ marginTop: 0, marginBottom: '20px', color: '#334155', fontWeight: 600 }}>
                            {campaignsList.find(c => c.id === templateView.campaign)?.label} / {templateView.format === 'feed' ? 'Quadrado (Feed)' : 'Vertical (Reels)'}
                        </h3>
                        {/* Formulário Novo Template */}
                        <div className="ap-form-row" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                            <input
                                className="ap-input"
                                style={{ flex: 1, minWidth: '120px' }}
                                placeholder="Nome Interno"
                                value={newTemplate.nome}
                                onChange={e => setNewTemplate(p => ({ ...p, nome: e.target.value }))}
                            />
                            <input
                                className="ap-input"
                                style={{ flex: 1.5, minWidth: '150px' }}
                                placeholder="Template UUID (Placid)"
                                value={newTemplate.placid_template_uuid}
                                onChange={e => setNewTemplate(p => ({ ...p, placid_template_uuid: e.target.value }))}
                            />
                            <button className="ap-btn-add" style={{ flex: 'none' }} onClick={addTemplate} disabled={saving || !newTemplate.nome || !newTemplate.placid_template_uuid}>
                                <Plus size={14} /> Adicionar
                            </button>
                        </div>

                        <div className="ap-table-container">
                            <table className="ap-table">
                                <thead>
                                    <tr>
                                        <th>Ordem</th>
                                        <th>Nome do Template</th>
                                        <th>Placid UUID</th>
                                        <th>Uso</th>
                                        <th>Status</th>
                                        <th style={{ width: 60, textAlign: 'center' }}>Excluir</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {templates.filter(t => (t.template_set || 'default') === templateView.campaign && t.tipo === templateView.format).length === 0 && (
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>
                                                Nenhum template cadastrado nesta campanha e formato.
                                            </td>
                                        </tr>
                                    )}
                                    {templates
                                        .filter(t => (t.template_set || 'default') === templateView.campaign && t.tipo === templateView.format)
                                        .sort((a, b) => a.ordem - b.ordem)
                                        .map(t => (
                                            <tr key={t.id}>
                                                <td style={{ fontWeight: 600 }}>#{t.ordem}</td>
                                                <td style={{ fontWeight: 500 }}>{t.nome}</td>
                                                <td style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                                    {t.placid_template_uuid}
                                                </td>
                                                <td style={{ color: 'var(--color-text-secondary)' }}>
                                                    {t.uso_total}x
                                                </td>
                                                <td>
                                                    <button
                                                        className={`ap-toggle ${t.ativo ? 'on' : 'off'}`}
                                                        onClick={() => toggleTemplate(t.id, t.ativo)}
                                                    >
                                                        {t.ativo ? 'Ativo' : 'Pausado'}
                                                    </button>
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button className="ap-btn-sm" onClick={() => deleteTemplate(t.id)} title="Excluir">
                                                        <Trash2 size={14} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
