
import { useState } from 'react'
import { CheckCircle, Copy, RefreshCw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import '../../../styles/professional-form.css'

export default function ProfessionalForm({ initialData, onSubmit, onCancel, onDelete, isSubmitting, isEditMode = false, hideCancelButton = false }) {
    const [formData, setFormData] = useState(() => ({
        nome: '',
        email: '',
        role: 'staff',
        area_id: null,
        ...(initialData || {})
    }))

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

    const handleSubmit = (e) => {
        e.preventDefault()

        const payload = isEditMode
            ? { nome: formData.nome, area_id: formData.area_id }
            : { nome: formData.nome, email: formData.email, area_id: formData.area_id, role: 'staff' }

        onSubmit(payload)
    }

    return (
        <form onSubmit={handleSubmit} className="professional-form">

            {/* BLOCO 1 — IDENTIDADE (Read-only) */}
            <div className="professional-form__identity">
                {/* Nome */}
                <div className="professional-form__group">
                    <label className="professional-form__label">
                        Nome Completo
                    </label>
                    <input
                        type="text"
                        required
                        className="input"
                        value={formData.nome}
                        onChange={e => setFormData({ ...formData, nome: e.target.value })}
                        placeholder="Ex: Ana Silva"
                    />
                </div>

                {/* Email */}
                <div className="professional-form__group">
                    <label className="professional-form__label">
                        E-mail Corporativo
                    </label>
                    <input
                        type="email"
                        required
                        className={`input ${isEditMode ? 'professional-form__input--disabled' : ''}`}
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        placeholder="usuario@empresa.com"
                        disabled={isEditMode}
                    />
                    {isEditMode && (
                        <span className="professional-form__hint">
                            O e-mail não pode ser alterado.
                        </span>
                    )}
                </div>
            </div>

            {isEditMode && (
                <div className="professional-form__permissions">
                    <div className="professional-form__group">
                        <label className="professional-form__label">Acesso ao Sistema</label>
                        <p className="professional-form__toggle-description">
                            {formData.role === 'admin'
                                ? 'Administrador — alterações de papel são exclusivas do Super Admin.'
                                : 'Staff — acesso operacional do tenant.'}
                        </p>
                    </div>
                </div>
            )}

            {/* BLOCO 3 — ACESSO (Ação contextual - apenas edit mode) */}
            {isEditMode && formData.role === 'staff' && (
                <div className="professional-form__access">
                    <h3 className="professional-form__access-title">
                        Acesso
                    </h3>

                    {!recoveryLink ? (
                        <button
                            type="button"
                            onClick={handleGenerateLink}
                            disabled={isGeneratingLink}
                            className="input professional-form__recovery-btn"
                        >
                            <RefreshCw size={16} className={isGeneratingLink ? 'animate-spin' : ''} />
                            {isGeneratingLink ? 'Gerando...' : 'Gerar novo link de redefinição'}
                        </button>
                    ) : (
                        <div className="professional-form__recovery-success">
                            {/* Feedback de sucesso */}
                            <div className="professional-form__recovery-feedback">
                                <CheckCircle size={16} className="professional-form__recovery-icon" />
                                <div className="professional-form__recovery-content">
                                    <p className="professional-form__recovery-title">
                                        Link de redefinição gerado.
                                    </p>
                                    <p className="professional-form__recovery-text">
                                        Use o botão abaixo para copiar e enviar ao usuário.
                                    </p>
                                </div>
                            </div>

                            {/* Botão Copiar */}
                            <button
                                type="button"
                                onClick={copyRecoveryLink}
                                className="professional-form__copy-btn"
                            >
                                <Copy size={16} />
                                Copiar link
                            </button>

                            {/* Microcopy de segurança */}
                            <p className="professional-form__recovery-hint">
                                O link expira automaticamente por segurança.
                            </p>
                        </div>
                    )}
                </div>
            )}

            {/* RODAPÉ — Danger Zone + CTA Final */}
            <div className="professional-form__footer">
                {/* Desativar (esquerda) */}
                {isEditMode && formData.role === 'staff' && onDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="professional-form__delete-btn"
                    >
                        <AlertTriangle size={16} />
                        Desativar
                    </button>
                ) : (
                    <div />
                )}

                {/* Cancelar + Salvar (direita) */}
                <div className="professional-form__actions">
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
