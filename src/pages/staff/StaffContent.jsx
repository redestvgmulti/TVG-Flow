import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { FolderOpen, CheckCircle, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/content.css'

function Content() {
    const [loading, setLoading] = useState(true)
    const [companies, setCompanies] = useState([])

    useEffect(() => {
        fetchCompanies()
    }, [])

    async function fetchCompanies() {
        try {
            setLoading(true)

            // Staff: only active companies with drive_link
            // Ordering: Alphabetical by name (already filtered to have drive_link)
            const { data, error } = await supabase
                .from('clientes')
                .select('*')
                .eq('ativo', true)
                .not('drive_link', 'is', null)
                .order('nome')

            if (error) throw error

            setCompanies(data || [])

        } catch (error) {
            console.error('Error fetching companies:', error)
            toast.error('Erro ao carregar empresas')
        } finally {
            setLoading(false)
        }
    }

    // Get company initials for avatar
    const getInitials = (name) => {
        return name
            .split(' ')
            .slice(0, 2)
            .map(word => word[0])
            .join('')
            .toUpperCase()
    }

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div className="companies-header">
                    <h2 className="companies-title">Conteúdo</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando empresas...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            {/* Header */}
            <div className="companies-header">
                <h2 className="companies-title">Conteúdo</h2>
            </div>

            {/* Companies Grid */}
            {companies.length > 0 ? (
                <div className="companies-grid">
                    {companies.map(company => (
                        <div
                            key={company.id}
                            className="card company-card content-card"
                        >
                            {/* Header with Avatar */}
                            <div className="company-card-header">
                                <div className="company-avatar">
                                    {getInitials(company.nome)}
                                </div>
                                <div style={{ flex: 1 }}>
                                    <h3 className="company-name">{company.nome}</h3>
                                    <span className="content-status content-status-linked">
                                        <CheckCircle size={14} />
                                        Drive vinculado
                                    </span>
                                </div>
                            </div>

                            {/* CTA Button */}
                            <a
                                href={company.drive_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-primary btn-content-access"
                            >
                                Abrir Conteúdo
                                <ExternalLink size={16} />
                            </a>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">
                            <FolderOpen size={64} />
                        </div>
                        <p className="empty-text">Nenhum conteúdo disponível no momento.</p>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Content
