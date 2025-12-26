import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import { FolderOpen, CheckCircle, AlertCircle, ExternalLink, Settings, Building2, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/content.css'

function Content() {
    const [loading, setLoading] = useState(true)
    const [companies, setCompanies] = useState([])
    const [showConfigModal, setShowConfigModal] = useState(false)
    const [configuringCompany, setConfiguringCompany] = useState(null)
    const [configData, setConfigData] = useState({
        drive_link: '',
        ativo: true
    })

    useEffect(() => {
        fetchCompanies()
    }, [])

    async function fetchCompanies() {
        try {
            setLoading(true)

            const { data, error } = await supabase
                .from('clientes')
                .select('*')
                .order('nome')

            if (error) throw error

            // Admin Ordering Rules:
            // 1. Companies with drive_link first
            // 2. Companies without drive_link second
            // 3. Alphabetical order within each group
            const sorted = data.sort((a, b) => {
                if (a.drive_link && !b.drive_link) return -1
                if (!a.drive_link && b.drive_link) return 1
                return a.nome.localeCompare(b.nome)
            })

            setCompanies(sorted)

        } catch (error) {
            console.error('Error fetching companies:', error)
            toast.error('Erro ao carregar empresas')
        } finally {
            setLoading(false)
        }
    }

    function handleOpenConfigModal(company) {
        setConfiguringCompany(company)
        setConfigData({
            drive_link: company.drive_link || '',
            ativo: company.ativo !== undefined ? company.ativo : true
        })
        setShowConfigModal(true)
    }

    function handleCloseConfigModal() {
        setShowConfigModal(false)
        setConfiguringCompany(null)
        setConfigData({ drive_link: '', ativo: true })
    }

    async function handleCompleteConfiguration(e) {
        e.preventDefault()

        if (!configuringCompany) return

        try {
            const { error } = await supabase
                .from('clientes')
                .update({
                    drive_link: configData.drive_link || null,
                    ativo: configData.ativo
                })
                .eq('id', configuringCompany.id)

            if (error) throw error

            toast.success('Configuração concluída com sucesso!')
            handleCloseConfigModal()
            fetchCompanies()

        } catch (error) {
            console.error('Error completing configuration:', error)
            toast.error('Erro ao concluir configuração')
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

    // Check if configuration is complete
    const isConfigurationComplete = () => {
        return configData.drive_link.trim() !== ''
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
                            className={`card company-card content-card ${!company.drive_link ? 'content-card-pending' : ''}`}
                        >
                            {/* Header with Avatar */}
                            <div className="company-card-header">
                                <div className="company-avatar">
                                    {getInitials(company.nome)}
                                </div>
                                <div className="company-card-info">
                                    <h3 className="company-name">{company.nome}</h3>
                                    <span className={`content-status ${company.drive_link ? 'content-status-linked' : 'content-status-pending'}`}>
                                        {company.drive_link ? (
                                            <>
                                                <CheckCircle size={14} />
                                                Drive vinculado
                                            </>
                                        ) : (
                                            <>
                                                <AlertCircle size={14} />
                                                Configuração pendente
                                            </>
                                        )}
                                    </span>
                                </div>
                            </div>

                            {/* CTA Button */}
                            {company.drive_link ? (
                                <a
                                    href={company.drive_link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn btn-primary btn-content-access"
                                >
                                    Abrir Conteúdo
                                    <ExternalLink size={16} />
                                </a>
                            ) : (
                                <button
                                    onClick={() => handleOpenConfigModal(company)}
                                    className="btn btn-primary btn-content-access"
                                >
                                    Finalizar Configuração
                                    <Settings size={16} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="card">
                    <div className="empty-state">
                        <div className="empty-icon">
                            <Building2 size={64} />
                        </div>
                        <p className="empty-text">Nenhuma empresa cadastrada</p>
                        <p className="empty-subtitle">
                            As empresas aparecerão aqui automaticamente
                        </p>
                    </div>
                </div>
            )}

            {/* Configuration Modal */}
            {showConfigModal && configuringCompany && (
                <div className="modal-overlay" onClick={handleCloseConfigModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                Configuração da Empresa
                            </h2>
                            <button onClick={handleCloseConfigModal} className="modal-close">
                                <Plus size={20} className="modal-close-icon" />
                            </button>
                        </div>

                        <form onSubmit={handleCompleteConfiguration}>
                            <div className="modal-body">
                                {/* Company Info */}
                                <div className="config-company-info">
                                    <div className="company-avatar company-avatar-large">
                                        {getInitials(configuringCompany.nome)}
                                    </div>
                                    <h3 className="modal-company-title">
                                        {configuringCompany.nome}
                                    </h3>
                                    <p className="modal-company-description">
                                        Complete as informações abaixo para liberar esta empresa
                                    </p>
                                </div>

                                {/* Configuration Checklist */}
                                <div className="config-checklist">
                                    <h4 className="config-section-title">Checklist de Ativação</h4>

                                    {/* Drive Link */}
                                    <div className="config-item">
                                        <div className="config-item-header">
                                            <div className="config-item-status">
                                                {configData.drive_link.trim() ? (
                                                    <CheckCircle size={18} className="icon-success" />
                                                ) : (
                                                    <AlertCircle size={18} className="icon-warning" />
                                                )}
                                            </div>
                                            <label htmlFor="drive_link" className="config-item-label">
                                                Link do Google Drive *
                                            </label>
                                        </div>
                                        <input
                                            type="url"
                                            id="drive_link"
                                            value={configData.drive_link}
                                            onChange={(e) => setConfigData({ ...configData, drive_link: e.target.value })}
                                            placeholder="https://drive.google.com/drive/folders/..."
                                            required
                                            className="config-input"
                                        />
                                        <span className="config-help-text">
                                            Cole o link da pasta raiz do cliente no Google Drive
                                        </span>
                                    </div>

                                    {/* Active Status */}
                                    <div className="config-item">
                                        <div className="config-item-header">
                                            <div className="config-item-status">
                                                <CheckCircle size={18} className="icon-success" />
                                            </div>
                                            <label className="config-item-label">
                                                Status da Empresa
                                            </label>
                                        </div>
                                        <label className="checkbox-wrapper">
                                            <input
                                                type="checkbox"
                                                checked={configData.ativo}
                                                onChange={(e) => setConfigData({ ...configData, ativo: e.target.checked })}
                                            />
                                            <span>Empresa ativa</span>
                                        </label>
                                        <span className="config-help-text">
                                            Apenas empresas ativas ficam visíveis para a equipe
                                        </span>
                                    </div>
                                </div>

                                {/* Completion Status */}
                                {isConfigurationComplete() && (
                                    <div className="config-ready-banner">
                                        <CheckCircle size={20} />
                                        <span>Pronto! Todos os campos obrigatórios foram preenchidos.</span>
                                    </div>
                                )}
                            </div>

                            <div className="modal-footer">
                                <button type="button" onClick={handleCloseConfigModal} className="btn btn-secondary">
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={!isConfigurationComplete()}
                                >
                                    Concluir Configuração
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Content
