import { useState } from 'react'
import { X, Building, User, Mail, ShieldAlert } from 'lucide-react'
import { supabase } from '../../../services/supabase'
import { toast } from 'sonner'
import '../../../styles/super-admin-dashboard.css' // Reuse styles

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
        <div className="modal-backdrop-sa" onClick={onClose}>
            <div className="modal-sa" style={{ width: '500px' }} onClick={e => e.stopPropagation()}>
                <div className="sa-modal-header">
                    <h3>Nova Empresa (Onboarding)</h3>
                    <button onClick={onClose} className="sa-close-btn">
                        <X size={20} />
                    </button>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="sa-form-group">
                        <label className="sa-label">Nome da Empresa</label>
                        <div className="sa-input-wrapper">
                            <Building className="sa-input-icon" size={18} />
                            <input
                                type="text"
                                className="sa-input"
                                placeholder="Ex: Acme Corp"
                                value={formData.companyName}
                                onChange={e => setFormData({ ...formData, companyName: e.target.value })}
                                required
                            />
                        </div>
                    </div>

                    <div className="sa-form-group">
                        <label className="sa-label">CNPJ (Opcional)</label>
                        <input
                            type="text"
                            className="sa-input"
                            style={{ paddingLeft: '12px' }} // Override for no icon
                            placeholder="00.000.000/0001-00"
                            value={formData.cnpj}
                            onChange={e => setFormData({ ...formData, cnpj: e.target.value })}
                        />
                    </div>

                    <h4 className="sa-section-title">
                        <ShieldAlert size={16} className="text-primary" />
                        Primeiro Admin
                    </h4>

                    <div className="space-y-3">
                        <div className="sa-form-group">
                            <label className="sa-label">Nome Completo</label>
                            <div className="sa-input-wrapper">
                                <User className="sa-input-icon" size={16} />
                                <input
                                    type="text"
                                    className="sa-input"
                                    placeholder="Admin da Silva"
                                    value={formData.adminName}
                                    onChange={e => setFormData({ ...formData, adminName: e.target.value })}
                                    required
                                />
                            </div>
                        </div>

                        <div className="sa-form-group">
                            <label className="sa-label">E-mail Profissional</label>
                            <div className="sa-input-wrapper">
                                <Mail className="sa-input-icon" size={16} />
                                <input
                                    type="email"
                                    className="sa-input"
                                    placeholder="admin@empresa.com"
                                    value={formData.adminEmail}
                                    onChange={e => setFormData({ ...formData, adminEmail: e.target.value })}
                                    required
                                />
                            </div>
                        </div>
                    </div>

                    <div className="sa-modal-footer">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-ghost"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary"
                        >
                            {loading ? 'Criando...' : 'Criar Empresa'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    )
}
