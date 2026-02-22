import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../../services/supabase'
import { Plus, Trash2, Globe, Users } from 'lucide-react'

// ──────────────────────────────────────────────────────────
// AutoPublisherSettings — CRUD for Sources & Sponsors
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
            <motion.div
                className="ap-form-section"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
            >
                <h2>
                    <Globe size={12} />
                    Fontes RSS
                </h2>

                <div className="ap-form-row">
                    <input
                        className="ap-input"
                        placeholder="Nome"
                        value={newSource.nome}
                        onChange={e => setNewSource(p => ({ ...p, nome: e.target.value }))}
                    />
                    <input
                        className="ap-input"
                        style={{ flex: 2 }}
                        placeholder="URL do RSS"
                        value={newSource.url}
                        onChange={e => setNewSource(p => ({ ...p, url: e.target.value }))}
                    />
                    <select
                        className="ap-select"
                        value={newSource.tipo}
                        onChange={e => setNewSource(p => ({ ...p, tipo: e.target.value }))}
                    >
                        <option value="rss">RSS</option>
                        <option value="google_news_rss">Google News</option>
                    </select>
                    <button className="ap-btn-add" onClick={addSource} disabled={saving || !newSource.nome || !newSource.url}>
                        <Plus size={13} /> Adicionar
                    </button>
                </div>

                <table className="ap-table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Tipo</th>
                            <th>URL</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sources.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', color: '#1e293b', padding: '1.5rem' }}>
                                    Nenhuma fonte cadastrada
                                </td>
                            </tr>
                        )}
                        {sources.map(s => (
                            <tr key={s.id}>
                                <td style={{ color: '#e2e8f0', fontWeight: 500 }}>{s.nome}</td>
                                <td>
                                    <span style={{ fontSize: '0.7rem', background: 'rgba(255,255,255,0.06)', color: '#64748b', padding: '0.15rem 0.45rem', borderRadius: 5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        {s.tipo}
                                    </span>
                                </td>
                                <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <a href={s.url} target="_blank" rel="noreferrer" style={{ color: '#0ea5e9', textDecoration: 'none', fontSize: '0.78rem' }}>
                                        {s.url}
                                    </a>
                                </td>
                                <td>
                                    <button
                                        className={`ap-toggle ${s.ativo ? 'on' : 'off'}`}
                                        onClick={() => toggleSource(s.id, s.ativo)}
                                    >
                                        {s.ativo ? 'Ativo' : 'Inativo'}
                                    </button>
                                </td>
                                <td>
                                    <button className="ap-btn-sm" onClick={() => deleteSource(s.id)}>
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </motion.div>

            {/* ── Sponsors ───────────────────────────────── */}
            <motion.div
                className="ap-form-section"
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.06 }}
            >
                <h2>
                    <Users size={12} />
                    Patrocinadores
                </h2>

                <div className="ap-form-row">
                    <input
                        className="ap-input"
                        placeholder="Nome"
                        value={newSponsor.nome}
                        onChange={e => setNewSponsor(p => ({ ...p, nome: e.target.value }))}
                    />
                    <input
                        className="ap-input"
                        placeholder="Template ID (Placid/Bannerbear)"
                        value={newSponsor.template_id}
                        onChange={e => setNewSponsor(p => ({ ...p, template_id: e.target.value }))}
                    />
                    <input
                        className="ap-input"
                        placeholder="URL do Logo"
                        value={newSponsor.logo_url}
                        onChange={e => setNewSponsor(p => ({ ...p, logo_url: e.target.value }))}
                    />
                    <button className="ap-btn-add" onClick={addSponsor} disabled={saving || !newSponsor.nome}>
                        <Plus size={13} /> Adicionar
                    </button>
                </div>

                <table className="ap-table">
                    <thead>
                        <tr>
                            <th>Nome</th>
                            <th>Template ID</th>
                            <th>Último uso</th>
                            <th>Status</th>
                            <th></th>
                        </tr>
                    </thead>
                    <tbody>
                        {sponsors.length === 0 && (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', color: '#1e293b', padding: '1.5rem' }}>
                                    Nenhum patrocinador cadastrado
                                </td>
                            </tr>
                        )}
                        {sponsors.map(p => (
                            <tr key={p.id}>
                                <td style={{ color: '#e2e8f0', fontWeight: 500 }}>{p.nome}</td>
                                <td style={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>{p.template_id ?? '—'}</td>
                                <td>{p.ultimo_uso_at ? new Date(p.ultimo_uso_at).toLocaleDateString('pt-BR') : '—'}</td>
                                <td>
                                    <span style={{
                                        fontSize: '0.7rem', fontWeight: 600, padding: '0.2rem 0.5rem', borderRadius: 6,
                                        background: p.ativo ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)',
                                        color: p.ativo ? '#4ade80' : '#64748b',
                                        textTransform: 'uppercase', letterSpacing: '0.05em',
                                    }}>
                                        {p.ativo ? 'Ativo' : 'Inativo'}
                                    </span>
                                </td>
                                <td>
                                    <button className="ap-btn-sm" onClick={() => deleteSponsor(p.id)}>
                                        <Trash2 size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </motion.div>
        </div>
    )
}
