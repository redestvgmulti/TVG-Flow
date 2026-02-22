import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { Plus, Trash2, Globe, Users } from 'lucide-react'

// ──────────────────────────────────────────────────────────
// AutoPublisherSettings — CRUD for Sources & Sponsors
// Used as a tab inside AutoPublisher.jsx
// ──────────────────────────────────────────────────────────

export default function AutoPublisherSettings({ clienteId }) {
    const [sources, setSources] = useState([])
    const [sponsors, setSponsors] = useState([])
    const [newSource, setNewSource] = useState({ nome: '', url: '', tipo: 'rss' })
    const [newSponsor, setNewSponsor] = useState({ nome: '', logo_url: '', template_id: '' })
    const [saving, setSaving] = useState(false)

    const fetchData = useCallback(async () => {
        if (!clienteId) return
        const [{ data: s }, { data: p }] = await Promise.all([
            supabase.from('ap.sources').select('*').eq('cliente_id', clienteId).order('created_at'),
            supabase.from('ap.patrocinadores').select('*').eq('cliente_id', clienteId).order('created_at'),
        ])
        setSources(s ?? [])
        setSponsors(p ?? [])
    }, [clienteId])

    useEffect(() => { fetchData() }, [fetchData])

    async function addSource() {
        if (!newSource.nome || !newSource.url) return
        setSaving(true)
        await supabase.from('ap.sources').insert({ ...newSource, cliente_id: clienteId })
        setNewSource({ nome: '', url: '', tipo: 'rss' })
        await fetchData()
        setSaving(false)
    }

    async function deleteSource(id) {
        await supabase.from('ap.sources').delete().eq('id', id)
        fetchData()
    }

    async function toggleSource(id, ativo) {
        await supabase.from('ap.sources').update({ ativo: !ativo }).eq('id', id)
        fetchData()
    }

    async function addSponsor() {
        if (!newSponsor.nome) return
        setSaving(true)
        await supabase.from('ap.patrocinadores').insert({ ...newSponsor, cliente_id: clienteId })
        setNewSponsor({ nome: '', logo_url: '', template_id: '' })
        await fetchData()
        setSaving(false)
    }

    async function deleteSponsor(id) {
        await supabase.from('ap.patrocinadores').delete().eq('id', id)
        fetchData()
    }

    const inputStyle = {
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 8,
        color: '#f1f5f9',
        padding: '0.45rem 0.75rem',
        fontSize: '0.85rem',
        outline: 'none',
        flex: 1,
        minWidth: 0,
    }

    return (
        <div>
            {/* ── Sources ─────────────────────────────────────── */}
            <div className="ap-form-section">
                <h2>
                    <Globe size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                    Fontes RSS
                </h2>

                {/* Add form */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <input
                        style={inputStyle}
                        placeholder="Nome da fonte"
                        value={newSource.nome}
                        onChange={(e) => setNewSource((p) => ({ ...p, nome: e.target.value }))}
                    />
                    <input
                        style={{ ...inputStyle, flex: 2 }}
                        placeholder="URL do RSS"
                        value={newSource.url}
                        onChange={(e) => setNewSource((p) => ({ ...p, url: e.target.value }))}
                    />
                    <select
                        style={{ ...inputStyle, flex: 'none', width: '140px' }}
                        value={newSource.tipo}
                        onChange={(e) => setNewSource((p) => ({ ...p, tipo: e.target.value }))}
                    >
                        <option value="rss">RSS</option>
                        <option value="google_news_rss">Google News</option>
                    </select>
                    <button
                        className="ap-btn primary"
                        onClick={addSource}
                        disabled={saving}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Adicionar
                    </button>
                </div>

                {/* Table */}
                <table className="ap-table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Tipo</th>
                            <th>URL</th>
                            <th>Ativo</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sources.length === 0 && (
                            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhuma fonte cadastrada</td></tr>
                        )}
                        {sources.map((s) => (
                            <tr key={s.id}>
                                <td>{s.nome}</td>
                                <td><span className="ap-badge" style={{ background: 'rgba(255,255,255,0.08)', color: '#94a3b8' }}>{s.tipo}</span></td>
                                <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#0ea5e9', textDecoration: 'none', fontSize: '0.8rem' }}>
                                        {s.url}
                                    </a>
                                </td>
                                <td>
                                    <button
                                        className={`ap-btn ${s.ativo ? 'primary' : 'ghost'}`}
                                        style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                                        onClick={() => toggleSource(s.id, s.ativo)}
                                    >
                                        {s.ativo ? 'Ativo' : 'Inativo'}
                                    </button>
                                </td>
                                <td>
                                    <button className="ap-btn danger" style={{ padding: '0.25rem 0.5rem' }} onClick={() => deleteSource(s.id)}>
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ── Sponsors ─────────────────────────────────────── */}
            <div className="ap-form-section">
                <h2>
                    <Users size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                    Patrocinadores
                </h2>

                {/* Add form */}
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                    <input
                        style={inputStyle}
                        placeholder="Nome do patrocinador"
                        value={newSponsor.nome}
                        onChange={(e) => setNewSponsor((p) => ({ ...p, nome: e.target.value }))}
                    />
                    <input
                        style={inputStyle}
                        placeholder="Template ID (Placid/Bannerbear)"
                        value={newSponsor.template_id}
                        onChange={(e) => setNewSponsor((p) => ({ ...p, template_id: e.target.value }))}
                    />
                    <input
                        style={inputStyle}
                        placeholder="URL do Logo"
                        value={newSponsor.logo_url}
                        onChange={(e) => setNewSponsor((p) => ({ ...p, logo_url: e.target.value }))}
                    />
                    <button
                        className="ap-btn primary"
                        onClick={addSponsor}
                        disabled={saving}
                        style={{ whiteSpace: 'nowrap' }}
                    >
                        <Plus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                        Adicionar
                    </button>
                </div>

                <table className="ap-table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Template ID</th>
                            <th>Último uso</th>
                            <th>Ativo</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sponsors.length === 0 && (
                            <tr><td colSpan={5} style={{ textAlign: 'center', color: '#94a3b8' }}>Nenhum patrocinador cadastrado</td></tr>
                        )}
                        {sponsors.map((p) => (
                            <tr key={p.id}>
                                <td>{p.nome}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: '#94a3b8' }}>{p.template_id ?? '—'}</td>
                                <td style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
                                    {p.ultimo_uso_at ? new Date(p.ultimo_uso_at).toLocaleDateString('pt-BR') : '—'}
                                </td>
                                <td>
                                    <span
                                        className="ap-status"
                                        style={p.ativo
                                            ? { background: 'rgba(34,197,94,0.1)', color: '#22c55e' }
                                            : { background: 'rgba(100,116,139,0.1)', color: '#94a3b8' }}
                                    >
                                        {p.ativo ? 'Ativo' : 'Inativo'}
                                    </span>
                                </td>
                                <td>
                                    <button className="ap-btn danger" style={{ padding: '0.25rem 0.5rem' }} onClick={() => deleteSponsor(p.id)}>
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
