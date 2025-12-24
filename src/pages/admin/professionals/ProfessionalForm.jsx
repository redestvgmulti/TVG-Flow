
import { useState, useEffect } from 'react'
import { CheckCircle, Copy, RefreshCw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'
import { supabase } from '../../../services/supabase'
import '../../../styles/professional-form.css'

export default function ProfessionalForm({ initialData, onSubmit, onCancel, onDelete, isSubmitting, isEditMode = false, hideCancelButton = false }) {
    const [formData, setFormData] = useState({
        nome: '',
        email: '',
        role: 'profissional',
        area_id: null,
        ativo: true
    })

    const [recoveryLink, setRecoveryLink] = useState(null)
    const [isGeneratingLink, setIsGeneratingLink] = useState(false)

    useEffect(() => {
        if (initialData) {
            setFormData(prev => ({
                ...prev,
                ...initialData
            }))
        }
    }, [initialData])

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
                        className={`input ${isEditMode ? 'professional-form__input--disabled' : ''}`}
                        value={formData.nome}
                        onChange={e => setFormData({ ...formData, nome: e.target.value })}
                        placeholder="Ex: Ana Silva"
                        disabled={isEditMode}
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

            {/* BLOCO 2 — PERMISSÕES DO SISTEMA */}
            {isEditMode && (
                <div className="professional-form__permissions">
                    {/* Admin Confirmation Alert */}
                    {formData.role === 'admin' && initialData?.role !== 'admin' && (
                        <div className="professional-form__admin-alert">
                            <AlertTriangle size={20} className="professional-form__admin-alert-icon" />
                            <div className="professional-form__admin-alert-content">
                                <p className="professional-form__admin-alert-title">
                                    Atenção: Acesso Administrativo
                                </p>
                                <p className="professional-form__admin-alert-text">
                                    Você está concedendo permissões de administrador. Este usuário terá acesso total ao sistema.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Grid: Admin Toggle + Ativo */}
                    <div className="professional-form__grid">
                        {/* Admin Toggle */}
                        <div className="professional-form__group">
                            <label className="professional-form__label professional-form__label--spaced">
                                Acesso ao Sistema
                            </label>
                            <div className="professional-form__toggle-container">
                                <label className="professional-form__toggle">
                                    <input
                                        type="checkbox"
                                        checked={formData.role === 'admin'}
                                        onChange={e => setFormData({ ...formData, role: e.target.checked ? 'admin' : 'profissional' })}
                                    />
                                    <span className="professional-form__toggle-slider"></span>
                                </label>
                                <div>
                                    <p className="professional-form__toggle-label">
                                        {formData.role === 'admin' ? 'Administrador' : 'Profissional'}
                                    </p>
                                    <p className="professional-form__toggle-description">
                                        {formData.role === 'admin' ? 'Acesso total ao sistema' : 'Acesso básico'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Checkbox: Usuário Ativo */}
                        <div className="professional-form__checkbox-wrapper">
                            <input
                                type="checkbox"
                                id="ativo"
                                className="professional-form__checkbox"
                                checked={formData.ativo}
                                onChange={e => setFormData({ ...formData, ativo: e.target.checked })}
                            />
                            <label htmlFor="ativo" className="professional-form__checkbox-label">
                                <strong>Usuário Ativo</strong>
                                <span className="professional-form__checkbox-hint">
                                    Login habilitado
                                </span>
                            </label>
                        </div>
                    </div>
                </div>
            )}

            {/* Creation Mode Status Toggle */}
            {!isEditMode && (
                <div className="professional-form__checkbox-wrapper">
                    <input
                        type="checkbox"
                        id="ativo"
                        className="professional-form__checkbox"
                        checked={formData.ativo}
                        onChange={e => setFormData({ ...formData, ativo: e.target.checked })}
                    />
                    <label htmlFor="ativo" className="professional-form__checkbox-label">
                        <strong>Usuário Ativo</strong>
                    </label>
                </div>
            )}

            {/* BLOCO 3 — ACESSO (Ação contextual - apenas edit mode) */}
            {isEditMode && (
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
                {/* Excluir (esquerda) */}
                {isEditMode && onDelete ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="professional-form__delete-btn"
                    >
                        <AlertTriangle size={16} />
                        Excluir
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
