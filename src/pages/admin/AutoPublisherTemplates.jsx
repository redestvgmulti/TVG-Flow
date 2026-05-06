import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../services/supabase'
import * as Icons from 'lucide-react'

// ──────────────────────────────────────────────────────────
// AutoPublisherTemplates — FlowOS V2 Design System
// ──────────────────────────────────────────────────────────

export default function AutoPublisherTemplates() {
    const [templates, setTemplates] = useState([])
    const [campaigns, setCampaigns] = useState([])
    const [newTemplate, setNewTemplate] = useState({ nome: '', placid_template_uuid: '', ordem: 1, tipo: 'feed', template_set: 'default' })
    const [templateView, setTemplateView] = useState({ campaign: null, format: null })
    const [showCampaignForm, setShowCampaignForm] = useState(false)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deletingCampaign, setDeletingCampaign] = useState(null)
    const [newCampaign, setNewCampaign] = useState({ label: '', slug: '', icon: 'Plus', color: '#3b82f6', descricao: '' })
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
        const [t, c] = await Promise.all([
            apConfig('templates', 'list'),
            apConfig('template_sets', 'list')
        ])
        setTemplates(t ?? [])
        setCampaigns(c ?? [])
    }, [])

    useEffect(() => { fetchData() }, [fetchData])

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

    async function addCampaign() {
        if (!newCampaign.label || !newCampaign.slug) return
        setSaving(true)
        try {
            await apConfig('template_sets', 'insert', newCampaign)
            setNewCampaign({ label: '', slug: '', icon: 'Plus', color: '#3b82f6', descricao: '' })
            setShowCampaignForm(false)
            await fetchData()
        } catch (err) {
            console.error('[Campaigns]', err)
        } finally {
            setSaving(false)
        }
    }

    async function deleteCampaign(camp) {
        if (camp.slug === 'default') return
        setDeletingCampaign(camp)
        setShowDeleteModal(true)
    }

    async function confirmDeleteCampaign() {
        if (!deletingCampaign) return

        setSaving(true)
        try {
            await apConfig('template_sets', 'delete', { id: deletingCampaign.id })
            // toast.success(`Campanha "${deletingCampaign.label}" excluída.`) // Uncomment if toast is available
            await fetchData()
            setShowDeleteModal(false)
            setDeletingCampaign(null)
        } catch (err) {
            console.error('[Delete Campaign]', err)
            // toast.error('Erro ao excluir campanha.') // Uncomment if toast is available
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
            <div className="ap-form-section">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                    <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Icons.Globe size={16} style={{ color: 'var(--color-primary)' }} />
                        Gerenciamento de Templates
                        {!templateView.campaign && (
                            <button className="ap-btn-add" style={{ padding: '4px 8px', fontSize: '13px', marginLeft: '12px' }} onClick={() => setShowCampaignForm(!showCampaignForm)}>
                                <Icons.Plus size={14} /> Nova Campanha
                            </button>
                        )}
                    </h2>
                    {(templateView.campaign || templateView.format) && (
                        <button
                            className="ap-btn-outline"
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
                    <>
                        {showCampaignForm && (
                            <div className="ap-form-row" style={{ background: '#f8f9fa', padding: '16px', borderRadius: '12px', marginBottom: '24px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                                <input
                                    className="ap-input"
                                    placeholder="Nome da Campanha (ex: Dia das Mães)"
                                    value={newCampaign.label}
                                    onChange={e => {
                                        const label = e.target.value;
                                        const slug = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, '_');
                                        setNewCampaign(p => ({ ...p, label, slug }));
                                    }}
                                />
                                <input
                                    className="ap-input"
                                    placeholder="Identificador (slug)"
                                    value={newCampaign.slug}
                                    onChange={e => setNewCampaign(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                                />
                                <input
                                    className="ap-input"
                                    style={{ flex: 1.5 }}
                                    placeholder="Descrição (opcional)"
                                    value={newCampaign.descricao}
                                    onChange={e => setNewCampaign(p => ({ ...p, descricao: e.target.value }))}
                                />
                                <select
                                    className="ap-select"
                                    value={newCampaign.icon}
                                    onChange={e => setNewCampaign(p => ({ ...p, icon: e.target.value }))}
                                >
                                    <option value="Globe">Globo (Padrão)</option>
                                    <option value="Star">Estrela</option>
                                    <option value="Gift">Presente</option>
                                    <option value="Heart">Coração</option>
                                    <option value="User">Usuário</option>
                                    <option value="Award">Medalha</option>
                                    <option value="Sparkles">Brilho</option>
                                    <option value="Calendar">Calendário</option>
                                    <option value="Flag">Bandeira</option>
                                    <option value="Zap">Raio</option>
                                </select>
                                <input
                                    type="color"
                                    style={{ width: '40px', height: '40px', padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                                    value={newCampaign.color}
                                    onChange={e => setNewCampaign(p => ({ ...p, color: e.target.value }))}
                                    title="Cor do Ícone"
                                />
                                <button className="ap-btn-add" style={{ flex: 'none' }} onClick={addCampaign} disabled={saving || !newCampaign.label || !newCampaign.slug}>
                                    <Icons.Plus size={14} /> Salvar
                                </button>
                            </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                            {[...campaigns].sort((a, b) => {
                                if (a.slug === 'default') return -1;
                                if (b.slug === 'default') return 1;
                                return a.label.localeCompare(b.label);
                            }).map(camp => {
                                const IconComponent = Icons[camp.icon] || Icons.Globe;
                                return (
                                    <div
                                        key={camp.id}
                                        className="ap-settings-card"
                                        onClick={() => {
                                            setTemplateView({ ...templateView, campaign: camp.slug });
                                            setNewTemplate(p => ({ ...p, template_set: camp.slug }));
                                        }}
                                    >
                                        {camp.slug !== 'default' && (
                                            <button
                                                className="ap-card-delete-btn"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteCampaign(camp);
                                                }}
                                                title="Excluir Campanha"
                                            >
                                                <Icons.Trash2 size={14} />
                                            </button>
                                        )}
                                        <div className="ap-settings-card-icon">
                                            <IconComponent size={28} strokeWidth={1.5} color={camp.color || '#3b82f6'} />
                                        </div>
                                        <div className="ap-settings-card-content">
                                            <h3 className="ap-settings-card-title">{camp.label}</h3>
                                            <p className="ap-settings-card-desc">{camp.descricao}</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </>
                ) : !templateView.format ? (
                    // TELA 2: Formatos
                    <div>
                        <h3 className="ap-section-subtitle">
                            Campanha: {campaigns.find(c => c.slug === templateView.campaign)?.label || templateView.campaign}
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '16px' }}>
                            {['feed', 'reels'].map(fmt => (
                                <div
                                    key={fmt}
                                    className="ap-settings-card"
                                    onClick={() => {
                                        setTemplateView({ ...templateView, format: fmt });
                                        setNewTemplate(p => ({ ...p, tipo: fmt }));
                                    }}
                                >
                                    <div className={`ap-settings-card-icon format-${fmt}`}>
                                        {fmt === 'feed' ? '1:1' : '9:16'}
                                    </div>
                                    <div className="ap-settings-card-content">
                                        <h3 className="ap-settings-card-title">{fmt === 'feed' ? 'Quadrado (Feed)' : 'Vertical (Reels)'}</h3>
                                        <p className="ap-settings-card-desc">
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
                        <h3 className="ap-section-subtitle">
                            Campanha: {campaigns.find(c => c.slug === templateView.campaign)?.label || templateView.campaign} • Formato: {templateView.format === 'feed' ? 'Quadrado (Feed)' : 'Vertical (Reels)'}
                        </h3>
                        {/* Formulário Novo Template */}
                        <div className="ap-form-row">
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
                                onChange={e => setNewTemplate(p => ({ ...p, placid_template_uuid: e.target.value.trim() }))}
                            />
                            <button className="ap-btn-add" style={{ flex: 'none' }} onClick={addTemplate} disabled={saving || !newTemplate.nome || !newTemplate.placid_template_uuid}>
                                <Icons.Plus size={14} /> Adicionar
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
                                                        <Icons.Trash2 size={14} />
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

            {/* Modal de Exclusão de Campanha */}
            {showDeleteModal && deletingCampaign && (
                <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
                    <div className="ap-modal-content" style={{ background: '#ffffff', padding: '24px', borderRadius: '20px', width: '400px', maxWidth: '100%', boxShadow: '0 24px 48px rgba(0,0,0,0.15)', textAlign: 'center' }}>
                        <div style={{ width: '48px', height: '48px', background: '#fee2e2', color: '#ef4444', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                            <Icons.AlertTriangle size={24} />
                        </div>

                        <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: '0 0 8px 0' }}>Excluir Campanha</h2>
                        <p style={{ fontSize: '14px', color: '#64748b', lineHeight: '1.5', margin: '0 0 24px 0' }}>
                            Tem certeza que deseja excluir a campanha <strong>{deletingCampaign.label}</strong>?
                            Os templates desta campanha deixarão de ser rotacionados.
                        </p>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button
                                onClick={() => { setShowDeleteModal(false); setDeletingCampaign(null); }}
                                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={confirmDeleteCampaign}
                                disabled={saving}
                                style={{ flex: 1, padding: '12px', borderRadius: '12px', border: 'none', background: '#ef4444', color: '#fff', fontWeight: 600, fontSize: '14px', cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}
                            >
                                {saving ? 'Excluindo...' : 'Excluir'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
