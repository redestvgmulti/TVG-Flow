import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import { Plus, Trash2, Globe } from 'lucide-react'
import AutoPublisherMasterV1Settings from './AutoPublisherMasterV1Settings'

const FIXED_CLIENT_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

// ──────────────────────────────────────────────────────────
// AutoPublisherSettings — FlowOS V2 Design System
// ──────────────────────────────────────────────────────────

export default function AutoPublisherSettings() {
    const clienteId = FIXED_CLIENT_ID
    const [sources, setSources] = useState([])
    const [newSource, setNewSource] = useState({ nome: '', url: '', tipo: 'rss' })
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
        const s = await apConfig('sources', 'list')
        setSources(s ?? [])
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
        </div>
    )
}
