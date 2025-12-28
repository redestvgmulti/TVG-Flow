import { createPortal } from 'react-dom'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { Building2, Users, Plus, Search, Edit2 } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/companies.css'

function Companies() {
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [companies, setCompanies] = useState([])
    const [searchTerm, setSearchTerm] = useState('')
    const [showModal, setShowModal] = useState(false)
    const [editingCompany, setEditingCompany] = useState(null)
    const [formData, setFormData] = useState({
        nome: '',
        cnpj: '',
        drive_link: '',
        ativo: true
    })

    const [currentTenantId, setCurrentTenantId] = useState(null)

    useEffect(() => {
        fetchTenantContext()
    }, [])

    async function fetchTenantContext() {
        try {
            setLoading(true)
            // STRICT: Get the Tenant ID from the user's linked companies where type is 'tenant'
            const { data: { user } } = await supabase.auth.getUser()

            const { data, error } = await supabase
                .from('empresa_profissionais')
                .select(`
                    empresa_id,
                    empresas!inner (
                        id,
                        empresa_tipo
                    )
                `)
                .eq('profissional_id', user.id)
                .eq('empresas.empresa_tipo', 'tenant')
                .maybeSingle()

            if (error) throw error

            if (data) {
                setCurrentTenantId(data.empresa_id)
                fetchCompanies(data.empresa_id)
            } else {
                toast.error('Contexto de Tenant não encontrado para este usuário.')
                setLoading(false)
            }
        } catch (error) {
            console.error('Error fetching tenant context:', error)
            setLoading(false)
        }
    }

    async function fetchCompanies(tenantId) {
        if (!tenantId) return
        try {
            setLoading(true)

            // Fetch companies (clientes) with professional count
            const { data: companiesData, error: companiesError } = await supabase
                .from('empresas')
                .select(`
    *,
    empresa_profissionais(
        profissional_id
    )
        `)
                .eq('empresa_tipo', 'operacional')
                .eq('tenant_id', tenantId) // STRICT: Only companies for this tenant
                .order('nome')

            if (companiesError) throw companiesError

            // Transform data to include professional count
            const companiesWithCounts = companiesData.map(company => ({
                ...company,
                professionalCount: company.empresa_profissionais?.length || 0
            }))

            setCompanies(companiesWithCounts)

        } catch (error) {
            console.error('Error fetching companies:', error)
            toast.error('Erro ao carregar empresas')
        } finally {
            setLoading(false)
        }
    }

    async function handleSubmit(e) {
        e.preventDefault()

        try {
            if (editingCompany) {
                // Update existing company
                const { error } = await supabase
                    .from('empresas')
                    .update({
                        nome: formData.nome,
                        cnpj: formData.cnpj,
                        drive_link: formData.drive_link || null,
                        // empresa_tipo is NOT updated, stays as created
                        // tenant_id likely not updated either
                        ativo: formData.ativo // Ensure schema supports this if added
                    })
                    .eq('id', editingCompany.id)

                if (error) throw error
                toast.success('Empresa atualizada com sucesso')
            } else {
                // Create new company

                const { error } = await supabase
                    .from('empresas')
                    .insert([{
                        nome: formData.nome,
                        cnpj: formData.cnpj,
                        drive_link: formData.drive_link || null,
                        empresa_tipo: 'operacional',
                        tenant_id: currentTenantId, // STRICT: Use context tenant ID
                        // ativo: formData.ativo // Check if supported
                    }])

                if (error) throw error
                toast.success('Empresa criada com sucesso')
            }

            setShowModal(false)
            setEditingCompany(null)
            setFormData({ nome: '', cnpj: '', ativo: true })
            setFormData({ nome: '', cnpj: '', ativo: true })
            fetchCompanies(currentTenantId)

        } catch (error) {
            console.error('Error saving company:', error)
            toast.error(editingCompany ? 'Erro ao atualizar empresa' : 'Erro ao criar empresa')
        }
    }

    function handleOpenModal(company = null) {
        if (company) {
            setEditingCompany(company)
            setFormData({
                nome: company.nome,
                cnpj: company.cnpj || '',
                drive_link: company.drive_link || '',
                ativo: company.ativo !== undefined ? company.ativo : true
            })
        } else {
            setEditingCompany(null)
            setFormData({ nome: '', cnpj: '', drive_link: '', ativo: true })
        }
        setShowModal(true)
    }

    function handleCloseModal() {
        setShowModal(false)
        setEditingCompany(null)
        setFormData({ nome: '', cnpj: '', ativo: true })
    }

    function handleCompanyClick(company) {
        navigate(`/ admin / companies / ${company.id} `)
    }

    const filteredCompanies = companies.filter(company =>
        company.nome.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div className="companies-header">
                    <h2 className="companies-title">Empresas</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando empresas...</p>
                </div>
            </div>
        )
    }

    return (
        <>
            <div className="animation-fade-in">
                {/* Header */}
                <div className="companies-header">
                    <h2 className="companies-title">Empresas</h2>
                    <button onClick={() => handleOpenModal()} className="btn btn-primary">
                        <Plus size={20} style={{ marginRight: '8px' }} />
                        Nova Empresa
                    </button>
                </div>

                {/* Search */}
                <div className="card company-search-card">
                    <div className="search-wrapper">
                        <Search className="search-icon" size={20} />
                        <input
                            type="text"
                            placeholder="Buscar por nome..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input"
                        />
                    </div>
                </div>

                {/* Companies Grid */}
                {filteredCompanies.length > 0 ? (
                    <div className="companies-grid">
                        {filteredCompanies.map(company => (
                            <div
                                key={company.id}
                                className="card company-card"
                                onClick={() => navigate(`/admin/companies/${company.id}`)}
                            >
                                <div className="company-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                    <div>
                                        <h3 className="company-name">{company.nome}</h3>
                                        {company.cnpj && (
                                            <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                CNPJ: {company.cnpj}
                                            </p>
                                        )}
                                        <span className={`company-status ${company.ativo ? 'active' : 'inactive'}`}>
                                            {company.ativo ? 'Ativa' : 'Inativa'}
                                        </span>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            handleOpenModal(company)
                                        }}
                                        className="btn btn-ghost btn-sm"
                                        title="Editar empresa"
                                    >
                                        <Edit2 size={16} />
                                    </button>
                                </div>

                                <div className="company-stats">
                                    <div className="company-stat">
                                        <Users size={16} />
                                        <span>{company.professionalCount || 0} profissionais</span>
                                    </div>
                                </div>
                            </div>
                        ))}</div>
                ) : (
                    <div className="card">
                        <div className="companies-empty-state">
                            <div className="companies-empty-icon">
                                <Building2 size={64} />
                            </div>
                            <p className="companies-empty-text">
                                {searchTerm ? 'Nenhuma empresa encontrada' : 'Nenhuma empresa cadastrada'}
                            </p>
                            <p className="companies-empty-subtitle">
                                {searchTerm
                                    ? 'Tente ajustar sua busca'
                                    : 'Comece criando sua primeira empresa'}
                            </p>
                            {!searchTerm && (
                                <button onClick={() => handleOpenModal()} className="btn btn-primary">
                                    <Plus size={20} style={{ marginRight: '8px' }} />
                                    Nova Empresa
                                </button>
                            )}
                        </div>
                    </div>
                )}

            </div>

            {/* Create/Edit Modal */}
            {showModal && createPortal(
                <div className="modal-backdrop" onClick={handleCloseModal}>
                    <div className="modal company-edit-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>{editingCompany ? 'Editar Empresa' : 'Nova Empresa'}</h3>
                            <button onClick={handleCloseModal} className="modal-close">
                                <Plus size={20} style={{ transform: 'rotate(45deg)' }} />
                            </button>
                        </div>

                        <form onSubmit={handleSubmit}>
                            <div className="modal-body">
                                <div className="company-form-grid">
                                    <div className="input-group">
                                        <label htmlFor="nome">Nome da Empresa *</label>
                                        <input
                                            type="text"
                                            id="nome"
                                            value={formData.nome}
                                            onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                            required
                                            autoFocus
                                            className="form-control"
                                        />
                                    </div>

                                    <div className="input-group">
                                        <label htmlFor="cnpj">CNPJ</label>
                                        <input
                                            type="text"
                                            id="cnpj"
                                            value={formData.cnpj}
                                            onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                                            placeholder="00.000.000/0000-00"
                                            className="form-control"
                                        />
                                    </div>

                                    <div className="input-group">
                                        <label htmlFor="drive_link">
                                            Link do Drive da Empresa
                                            <span className="form-label-optional">(Opcional)</span>
                                        </label>
                                        <input
                                            type="url"
                                            id="drive_link"
                                            value={formData.drive_link}
                                            onChange={(e) => setFormData({ ...formData, drive_link: e.target.value })}
                                            placeholder="https://drive.google.com/drive/folders/..."
                                            className="form-control"
                                        />
                                        <span className="form-text-helper">
                                            Cole o link da pasta raiz do cliente no Google Drive
                                        </span>
                                    </div>

                                    <div className="input-group">
                                        <label className="checkbox-label">
                                            <input
                                                type="checkbox"
                                                checked={formData.ativo}
                                                onChange={(e) => setFormData({ ...formData, ativo: e.target.checked })}
                                            />
                                            <span>Empresa ativa</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button type="button" onClick={handleCloseModal} className="btn btn-secondary">
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary">
                                    {editingCompany ? 'Salvar Alterações' : 'Criar Empresa'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>, document.body
            )}
        </>
    )
}

export default Companies
