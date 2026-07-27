import { useState } from 'react'
import { Building, User, Mail, ShieldAlert } from 'lucide-react'
import { supabase } from '../../../services/supabase'
import { toast } from 'sonner'
import Modal from '../../../components/ui/Modal'

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
        <Modal
            isOpen
            onClose={onClose}
            title="Nova Empresa (Onboarding)"
            closeOnBackdrop={!loading}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn btn-secondary" disabled={loading}>
                        Cancelar
                    </button>
                    <button type="submit" form="create-tenant-form" disabled={loading} className="btn btn-black">
                        {loading ? 'Criando...' : 'Criar Empresa'}
                    </button>
                </>
            )}
        >
            <form id="create-tenant-form" onSubmit={handleSubmit}>
                <div className="input-group">
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Building size={16} /> Nome da Empresa
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

                <div className="input-group">
                    <label>CNPJ (Opcional)</label>
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

                    <div className="input-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <User size={16} /> Nome Completo
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

                    <div className="input-group">
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Mail size={16} /> E-mail Profissional
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
            </form>
        </Modal>
    )
}
