
import { useState, useEffect } from 'react'
import { CheckCircle, Copy, RefreshCw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import { supabase } from '../../../services/supabase'

export default function ProfessionalForm({ initialData, onSubmit, onCancel, onDelete, isSubmitting, isEditMode = false, hideCancelButton = false }) {
    const [formData, setFormData] = useState({
        nome: '',
        email: '',
        role: 'profissional',
        area_id: '',
        ativo: true
    })

    const [areas, setAreas] = useState([])
    const [recoveryLink, setRecoveryLink] = useState(null)
    const [isGeneratingLink, setIsGeneratingLink] = useState(false)

    const handleGenerateLink = async () => {
        if (!formData.email) return

        setIsGeneratingLink(true)
        setRecoveryLink(null)
        try {
            const response = await professionalsService.generateRecoveryLink(formData.email)
            if (response.recoveryLink) {
                setRecoveryLink(response.recoveryLink)
            }
        } catch (error) {
            console.error(error)
            toast.error("Erro ao gerar link: " + error.message)
        } finally {
            setIsGeneratingLink(false)
        }
    }

    const copyRecoveryLink = () => {
        if (recoveryLink) {
            navigator.clipboard.writeText(recoveryLink)
            toast.success('Link copiado para a área de transferência')
        }
    }

    useEffect(() => {
        if (initialData) {
            setFormData(prev => ({
                ...prev,
                ...initialData
            }))
        }
        fetchAreas()
    }, [initialData])

    async function fetchAreas() {
        try {
            const { data } = await supabase
                .from('areas')
                .select('id, nome')
                .eq('ativo', true)
                .order('nome')
            if (data) setAreas(data)
        } catch (err) {
            console.error('Error loading areas', err)
        }
    }

    const handleSubmit = (e) => {
        e.preventDefault()

        const payload = {
            nome: formData.nome,
            email: formData.email,
            role: formData.role,
            area_id: formData.area_id,
            ativo: formData.ativo
        }

        onSubmit(payload)
    }

    return (
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* ═══════════════════════════════════════════════════════════
                BLOCO 1 — IDENTIDADE (Read-only)
            ═══════════════════════════════════════════════════════════ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Nome */}
                <div className="form-group">
                    <label style={{ fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '8px', display: 'block' }}>
                        Nome Completo
                    </label>
                    <input
                        type="text"
                        required
                        className="input"
                        value={formData.nome}
                        onChange={e => setFormData({ ...formData, nome: e.target.value })}
                        placeholder="Ex: Ana Silva"
                        disabled={isEditMode}
                        style={isEditMode ? { backgroundColor: '#f8fafc', cursor: 'not-allowed' } : {}}
                    />
                </div>

                {/* Email */}
                <div className="form-group">
                    <label style={{ fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '8px', display: 'block' }}>
                        E-mail Corporativo
                    </label>
                    <input
                        type="email"
                        required
                        className="input"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        placeholder="usuario@empresa.com"
                        disabled={isEditMode}
                        style={isEditMode ? { backgroundColor: '#f8fafc', cursor: 'not-allowed' } : {}}
                    />
                    {isEditMode && (
                        <span style={{ fontSize: '12px', color: '#64748b', marginTop: '6px', display: 'block' }}>
                            O e-mail não pode ser alterado.
                        </span>
                    )}
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════
                BLOCO 2 — OPERACIONAL (Foco principal)
            ═══════════════════════════════════════════════════════════ */}
            <div style={{
                borderTop: '1px solid #e2e8f0',
                paddingTop: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px'
            }}>
                {/* Grid: Função + Departamento */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    {/* Função / Perfil */}
                    <div className="form-group">
                        <label style={{ fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '8px', display: 'block' }}>
                            Função / Perfil
                        </label>
                        <select
                            className="input"
                            value={formData.role}
                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                        >
                            <option value="profissional">Profissional</option>
                            <option value="coordenador">Coordenador</option>
                            <option value="gestor">Gestor</option>
                        </select>
                    </div>

                    {/* Departamento */}
                    <div className="form-group">
                        <label style={{ fontSize: '13px', fontWeight: 500, color: '#475569', marginBottom: '8px', display: 'block' }}>
                            Departamento
                        </label>
                        <select
                            className="input"
                            value={formData.area_id}
                            onChange={e => setFormData({ ...formData, area_id: e.target.value })}
                            required
                        >
                            <option value="">Selecione...</option>
                            {areas.map(area => (
                                <option key={area.id} value={area.id}>{area.nome}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Checkbox: Usuário Ativo */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <input
                        type="checkbox"
                        id="ativo"
                        checked={formData.ativo}
                        onChange={e => setFormData({ ...formData, ativo: e.target.checked })}
                        style={{ marginTop: '2px', cursor: 'pointer' }}
                    />
                    <label htmlFor="ativo" style={{ fontSize: '14px', color: '#334155', cursor: 'pointer', lineHeight: '1.5' }}>
                        <strong>Usuário Ativo</strong>
                        <br />
                        <span style={{ fontSize: '12px', color: '#64748b' }}>
                            Desmarcar impedirá o login imediatamente.
                        </span>
                    </label>
                </div>
            </div>

            {/* ═══════════════════════════════════════════════════════════
                BLOCO 3 — ACESSO (Ação contextual - apenas edit mode)
            ═══════════════════════════════════════════════════════════ */}
            {isEditMode && (
                <div style={{
                    borderTop: '1px solid #e2e8f0',
                    paddingTop: '24px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px'
                }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 500, color: '#475569', margin: 0 }}>
                        Acesso
                    </h3>

                    {!recoveryLink ? (
                        <button
                            type="button"
                            onClick={handleGenerateLink}
                            disabled={isGeneratingLink}
                            className="input"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                backgroundColor: 'white',
                                border: '1px solid #cbd5e1',
                                color: '#475569',
                                fontSize: '14px',
                                fontWeight: 500,
                                transition: 'all 0.2s',
                                opacity: isGeneratingLink ? 0.6 : 1
                            }}
                            onMouseEnter={(e) => !isGeneratingLink && (e.currentTarget.style.borderColor = '#3b82f6')}
                            onMouseLeave={(e) => (e.currentTarget.style.borderColor = '#cbd5e1')}
                        >
                            <RefreshCw size={16} className={isGeneratingLink ? 'animate-spin' : ''} />
                            {isGeneratingLink ? 'Gerando...' : 'Gerar novo link de redefinição'}
                        </button>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {/* Feedback de sucesso */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                padding: '12px',
                                backgroundColor: '#f0fdf4',
                                borderRadius: '8px',
                                border: '1px solid #bbf7d0'
                            }}>
                                <CheckCircle size={16} style={{ color: '#16a34a', marginTop: '2px', flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                    <p style={{ margin: 0, fontSize: '13px', color: '#15803d', fontWeight: 500 }}>
                                        Link de redefinição gerado.
                                    </p>
                                    <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#16a34a' }}>
                                        Use o botão abaixo para copiar e enviar ao usuário.
                                    </p>
                                </div>
                            </div>

                            {/* Botão Copiar */}
                            <button
                                type="button"
                                onClick={copyRecoveryLink}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    padding: '10px 16px',
                                    backgroundColor: '#3b82f6',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '8px',
                                    fontSize: '14px',
                                    fontWeight: 500,
                                    cursor: 'pointer',
                                    transition: 'background-color 0.2s',
                                    boxShadow: '0 1px 2px 0 rgb(0 0 0 / 0.05)'
                                }}
                                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2563eb'}
                                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#3b82f6'}
                            >
                                <Copy size={16} />
                                Copiar link
                            </button>

                            {/* Microcopy de segurança */}
                            <p style={{ margin: 0, fontSize: '11px', color: '#64748b', textAlign: 'center' }}>
                                O link expira automaticamente por segurança.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════════
                RODAPÉ — Danger Zone + CTA Final
            ═══════════════════════════════════════════════════════════ */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderTop: '1px solid #e2e8f0',
                paddingTop: '24px'
            }}>
                {/* Excluir (esquerda) */}
                {isEditMode && onDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            background: 'none',
                            border: 'none',
                            color: '#dc2626',
                            fontSize: '13px',
                            fontWeight: 500,
                            cursor: 'pointer',
                            padding: 0
                        }}
                    >
                        <AlertTriangle size={16} />
                        Excluir
                    </button>
                ) : (
                    <div />
                )}

                {/* Cancelar + Salvar (direita) */}
                <div style={{ display: 'flex', gap: '12px' }}>
                    {!hideCancelButton && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="btn btn-secondary"
                            disabled={isSubmitting}
                        >
                            Cancelar
                        </button>
                    )}
                    <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={isSubmitting}
                    >
                        {isSubmitting ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>
        </form>
    )
}
