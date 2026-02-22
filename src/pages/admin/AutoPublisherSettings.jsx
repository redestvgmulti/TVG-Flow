import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import { Plus, Trash2, Globe, Users } from 'lucide-react'

// ──────────────────────────────────────────────────────────
// AutoPublisherSettings — FlowOS V2 Design System
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

            {/* ── Sponsors ───────────────────────────────── */}
            <div className="ap-form-section">
                <h2>
                    <Users size={16} style={{ color: 'var(--color-primary)' }} />
                    Patrocinadores Ativos
                </h2>

                <div className="ap-form-row">
                    <input
                        className="ap-input"
                        placeholder="Nome da Marca"
                        value={newSponsor.nome}
                        onChange={e => setNewSponsor(p => ({ ...p, nome: e.target.value }))}
                    />
                    <input
                        className="ap-input"
                        placeholder="ID do Template (Placid)"
                        value={newSponsor.template_id}
                        onChange={e => setNewSponsor(p => ({ ...p, template_id: e.target.value }))}
                    />
                    <input
                        className="ap-input"
                        placeholder="URL Opcional (Logo)"
                        value={newSponsor.logo_url}
                        onChange={e => setNewSponsor(p => ({ ...p, logo_url: e.target.value }))}
                    />
                    <button className="ap-btn-add" onClick={addSponsor} disabled={saving || !newSponsor.nome}>
                        <Plus size={14} /> Adicionar
                    </button>
                </div>

                <table className="ap-table">
                    <thead>
                        <tr>
                            <th>Nome / Marca</th>
                            <th>Template Integrado</th>
                            <th>Data do Último Uso</th>
                            <th>Rotação</th>
                            <th style={{ width: 60, textAlign: 'center' }}>Excluir</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sponsors.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--color-text-tertiary)' }}>
                                    Nenhum patrocinador em rotação ativa.
                                </td>
                            </tr>
                        )}
                        {sponsors.map(p => (
                            <tr key={p.id}>
                                <td style={{ fontWeight: 500 }}>{p.nome}</td>
                                <td style={{ fontFamily: 'monospace', color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                    {p.template_id ?? '—'}
                                </td>
                                <td style={{ color: 'var(--color-text-secondary)' }}>
                                    {p.ultimo_uso_at ? new Date(p.ultimo_uso_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'}
                                </td>
                                <td>
                                    <span style={{
                                        fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 4,
                                        background: p.ativo ? 'var(--color-success-bg)' : 'var(--color-bg-secondary)',
                                        color: p.ativo ? 'var(--color-success)' : 'var(--color-text-secondary)',
                                        textTransform: 'uppercase'
                                    }}>
                                        {p.ativo ? 'Em Rotação' : 'Pausado'}
                                    </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <button className="ap-btn-sm" onClick={() => deleteSponsor(p.id)} title="Excluir">
                                        <Trash2 size={14} />
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
