import { useState } from 'react'
import { X, Building, User, Mail, ShieldAlert } from 'lucide-react'
import { supabase } from '../../../services/supabase'
import { toast } from 'sonner'
import '../../../styles/modal.css'

export default function CreateTenantModal({ onClose, onSuccess }) {
    const [loading, setLoading] = useState(false)
    const [formData, setFormData] = useState({
        companyName: '',
        cnpj: '',
        adminName: '',
        adminEmail: ''
    })

    async function handleSubmit(e) {
        e.preventDefault()
        if (!formData.companyName || !formData.adminEmail || !formData.adminName) return

        setLoading(true)
        try {
            // Updated Flow using Edge Function to safely create Auth User + DB Tenant
            const { data, error } = await supabase.functions.invoke('create-tenant', {
                body: {
                    companyName: formData.companyName,
                    cnpj: formData.cnpj,
                    adminName: formData.adminName,
                    adminEmail: formData.adminEmail
                }
            })

            if (error) throw error
            if (!data.success) {
                console.error('Edge Function detailed error:', data)
                throw new Error(data.error || 'Erro desconhecido ao criar tenant')
            }

            toast.success('Empresa criada com sucesso!')
            toast.info(`E-mail de convite enviado para ${formData.adminEmail}`)

            onSuccess()
            onClose()
        } catch (error) {
            console.error('Error creating tenant:', error)
            toast.error('Erro ao criar empresa: ' + (error.message || 'Erro interno'))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container" onClick={e => e.stopPropagation()}>
                <div className="modal-header">
                    <h3 className="modal-title">Nova Empresa (Onboarding)</h3>
                    <button onClick={onClose} className="modal-close-btn">
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <form onSubmit={handleSubmit} className="modal-form">
                        <div className="modal-form-group">
                            <label className="modal-form-label">
                                <Building size={16} className="inline-icon" />
                                Nome da Empresa
                            </label>
                            <input
                                type="text"
                                className="input"
                                placeholder="Ex: Acme Corp"
                                value={formData.companyName}
                                onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                                required
                            />
                        </div>

                        <div className="modal-form-group">
                            <label className="modal-form-label">CNPJ (Opcional)</label>
                            <input
                                type="text"
                                className="input"
                                placeholder="00.000.000/0001-00"
                                value={formData.cnpj}
                                onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                            />
                        </div>

                        <div className="section-spacing">
                            <h4 className="section-title">
                                <ShieldAlert size={16} className="text-primary" />
                                Primeiro Admin
                            </h4>

                            <div className="modal-form-group">
                                <label className="modal-form-label">
                                    <User size={16} className="inline-icon" />
                                    Nome Completo
                                </label>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="Admin da Silva"
                                    value={formData.adminName}
                                    onChange={e => setFormData({ ...formData, adminName: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="modal-form-group">
                                <label className="modal-form-label">
                                    <Mail size={16} className="inline-icon" />
                                    E-mail Profissional
                                </label>
                                <input
                                    type="email"
                                    className="input"
                                    placeholder="admin@empresa.com"
                                    value={formData.adminEmail}
                                    onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="modal-actions">
                            <button
                                type="button"
                                onClick={onClose}
                                className="modal-btn-cancel"
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={loading}
                                className="modal-btn-submit"
                            >
                                {loading ? 'Criando...' : 'Criar Empresa'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}
