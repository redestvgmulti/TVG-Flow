import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Plus } from 'lucide-react'
import TenantList from './components/TenantList'
import CreateTenantModal from './components/CreateTenantModal'
import '../../styles/super-admin-dashboard.css'

export default function TenantListPage() {
    const [companies, setCompanies] = useState([])
    const [loading, setLoading] = useState(true)
    const [showCreateModal, setShowCreateModal] = useState(false)

    useEffect(() => {
        fetchCompanies()
    }, [])

    async function fetchCompanies() {
        try {
            setLoading(true)
            const { data, error } = await supabase.rpc('get_companies_stats')
            if (error) throw error
            setCompanies(data || [])
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="sa-dashboard fade-in">
            <div className="flex justify-between items-center mb-8">
                <div>
                    <h1 className="text-2xl font-bold text-text-primary">Empresas</h1>
                    <p className="text-text-secondary">Visão geral dos tenants da plataforma</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-hover text-white rounded-lg font-medium transition-colors"
                >
                    <Plus size={18} />
                    Nova Empresa
                </button>
            </div>

            {loading ? (
                <div>Carregando...</div>
            ) : (
                <TenantList companies={companies} />
            )}

            {showCreateModal && (
                <CreateTenantModal
                    onClose={() => setShowCreateModal(false)}
                    onSuccess={fetchCompanies}
                />
            )}
        </div>
    )
}
