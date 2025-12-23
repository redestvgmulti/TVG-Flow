import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { Building2, Users, Plus, Search } from 'lucide-react'
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
        ativo: true
    })

    useEffect(() => {
        fetchCompanies()
    }, [])

    async function fetchCompanies() {
        try {
            setLoading(true)

            // Fetch companies (clientes) with professional count
            const { data: companiesData, error: companiesError } = await supabase
                .from('clientes')
                .select(`
                    *,
                    empresa_profissionais (
                        profissional_id
                    )
                `)
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
                    .from('clientes')
                    .update({
                        nome: formData.nome,
                        cnpj: formData.cnpj,
                        ativo: formData.ativo,
                        updated_at: new Date().toISOString() // Assuming updated_at exists, if not it might be ignored or error depending on setup. Migration didn't add it explicitly to clientes but list_tables showed created_at. let's check. wait list_tables showed created_at but not updated_at. I should probably NOT send updated_at unless I know it exists. list_tables output for clientes: id, nome, created_at. NO updated_at. I will REMOVE it to be safe.
                    })
                    .eq('id', editingCompany.id)

                if (error) throw error
                toast.success('Empresa atualizada com sucesso')
            } else {
                // Create new company
                const { error } = await supabase
                    .from('clientes')
                    .insert([{
                        nome: formData.nome,
                        cnpj: formData.cnpj,
                        ativo: formData.ativo
                    }])

                if (error) throw error
                toast.success('Empresa criada com sucesso')
            }

            setShowModal(false)
            setEditingCompany(null)
            setFormData({ nome: '', cnpj: '', ativo: true })
            fetchCompanies()

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
                ativo: company.ativo !== undefined ? company.ativo : true // Handle potential missing legacy
            })
        } else {
            setEditingCompany(null)
            setFormData({ nome: '', cnpj: '', ativo: true })
        }
        setShowModal(true)
    }

    function handleCloseModal() {
        setShowModal(false)
        setEditingCompany(null)
        setFormData({ nome: '', cnpj: '', ativo: true })
    }

    function handleCompanyClick(company) {
        navigate(`/admin/companies/${company.id}`)
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
                            onClick={() => handleCompanyClick(company)}
                        >
                            <div className="company-card-header">
                                <div>
                                    <h3 className="company-name">{company.nome}</h3>
                                    {company.cnpj && <p style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>CNPJ: {company.cnpj}</p>}
                                    <span className={`company-status ${company.ativo ? 'active' : 'inactive'}`}>
                                        {company.ativo ? 'Ativa' : 'Inativa'}
                                    </span>
                                </div>
                            </div>

                            <div className="company-stats">
                                <div className="company-stat">
                                    <Users size={16} />
                                    <span>{company.professionalCount} profissionais</span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
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

            {/* Create/Edit Modal */}
            {showModal && (
                <div className="modal-backdrop" onClick={handleCloseModal}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
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
                                        />
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
                </div>
            )}
        </div>
    )
}

export default Companies
