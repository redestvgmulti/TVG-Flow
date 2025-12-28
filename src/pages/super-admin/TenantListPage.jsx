import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { Plus } from 'lucide-react'
import TenantList from './components/TenantList'
import CreateTenantModal from './components/CreateTenantModal'
import '../../styles/adminReports.css' // Using Reports style as requested

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
            const { data, error } = await supabase
                .from('empresas')
                .select('*')
                .eq('empresa_tipo', 'tenant')
                .order('nome')

            if (error) throw error
            setCompanies(data || [])
        } catch (error) {
            console.error(error)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="reports-container fade-in">
            {/* Header match Reports style */}
            <div className="reports-header" style={{ alignItems: 'center' }}>
                <div className="reports-title">
                    <h1>Empresas</h1>
                    <p>Visão geral dos tenants da plataforma.</p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="btn btn-primary"
                >
                    <Plus size={18} />
                    Nova Empresa
                </button>
            </div>

            {loading ? (
                <div className="reports-loading">
                    <div className="loading-spinner"></div>
                </div>
            ) : (
                <div className="reports-content">
                    <TenantList companies={companies} />
                </div>
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
