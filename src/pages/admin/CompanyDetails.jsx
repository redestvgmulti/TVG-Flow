import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { ArrowLeft, Users, Plus, Trash2, Edit } from 'lucide-react'
import { toast } from 'sonner'
import '../../styles/companies.css'

function CompanyDetails() {
    const { id } = useParams()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [company, setCompany] = useState(null)
    const [professionals, setProfessionals] = useState([])
    const [allProfessionals, setAllProfessionals] = useState([])
    const [showAssignModal, setShowAssignModal] = useState(false)
    const [selectedProfessionals, setSelectedProfessionals] = useState({})
    const [sectors, setSectors] = useState({})

    useEffect(() => {
        fetchCompanyDetails()
        fetchAllProfessionals()
    }, [id])

    async function fetchCompanyDetails() {
        try {
            setLoading(true)

            // Fetch company info
            const { data: companyData, error: companyError } = await supabase
                .from('empresas')
                .select('*')
                .eq('id', id)
                .single()

            if (companyError) throw companyError
            setCompany(companyData)

            // Fetch company professionals
            const { data: professionalsData, error: professionalsError } = await supabase
                .from('empresa_profissionais')
                .select(`
                    *,
                    usuarios (
                        id,
                        nome,
                        email
                    )
                `)
                .eq('empresa_id', id)

            if (professionalsError) throw professionalsError
            setProfessionals(professionalsData || [])

        } catch (error) {
            console.error('Error fetching company details:', error)
            toast.error('Erro ao carregar detalhes da empresa')
        } finally {
            setLoading(false)
        }
    }

    async function fetchAllProfessionals() {
        try {
            const { data, error } = await supabase
                .from('usuarios')
                .select('id, nome, email')
                .eq('tipo_perfil', 'profissional')
                .eq('ativo', true)
                .order('nome')

            if (error) throw error
            setAllProfessionals(data || [])

        } catch (error) {
            console.error('Error fetching professionals:', error)
        }
    }

    async function handleAssignProfessionals() {
        try {
            const assignmentsToCreate = Object.entries(selectedProfessionals)
                .filter(([_, isSelected]) => isSelected)
                .map(([professionalId]) => ({
                    empresa_id: id,
                    profissional_id: professionalId,
                    setor: sectors[professionalId] || null
                }))

            if (assignmentsToCreate.length === 0) {
                toast.error('Selecione pelo menos um profissional')
                return
            }

            const { error } = await supabase
                .from('empresa_profissionais')
                .insert(assignmentsToCreate)

            if (error) throw error

            toast.success(`${assignmentsToCreate.length} profissional(is) vinculado(s) com sucesso`)
            setShowAssignModal(false)
            setSelectedProfessionals({})
            setSectors({})
            fetchCompanyDetails()

        } catch (error) {
            console.error('Error assigning professionals:', error)
            if (error.code === '23505') {
                toast.error('Um ou mais profissionais já estão vinculados a esta empresa')
            } else {
                toast.error('Erro ao vincular profissionais')
            }
        }
    }

    async function handleRemoveProfessional(associationId) {
        if (!confirm('Tem certeza que deseja desvincular este profissional?')) return

        try {
            const { error } = await supabase
                .from('empresa_profissionais')
                .delete()
                .eq('id', associationId)

            if (error) throw error

            toast.success('Profissional desvinculado com sucesso')
            fetchCompanyDetails()

        } catch (error) {
            console.error('Error removing professional:', error)
            toast.error('Erro ao desvincular profissional')
        }
    }

    function handleToggleProfessional(professionalId) {
        setSelectedProfessionals(prev => ({
            ...prev,
            [professionalId]: !prev[professionalId]
        }))
    }

    function handleSectorChange(professionalId, sector) {
        setSectors(prev => ({
            ...prev,
            [professionalId]: sector
        }))
    }

    // Filter out already assigned professionals
    const availableProfessionals = allProfessionals.filter(prof =>
        !professionals.some(p => p.profissional_id === prof.id)
    )

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando detalhes...</p>
                </div>
            </div>
        )
    }

    if (!company) {
        return (
            <div className="animation-fade-in">
                <div className="card">
                    <p>Empresa não encontrada</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            {/* Header */}
            <div className="company-details-header">
                <button
                    onClick={() => navigate('/admin/companies')}
                    className="company-details-back-btn"
                >
                    <ArrowLeft size={20} />
                </button>

                <div className="company-details-info">
                    <h2 className="company-details-name">{company.nome}</h2>
                    <div className="company-details-meta">
                        <span className={`company-status ${company.ativo ? 'active' : 'inactive'}`}>
                            {company.ativo ? 'Ativa' : 'Inativa'}
                        </span>
                        <span>{professionals.length} profissionais</span>
                    </div>
                </div>

                <button onClick={() => setShowAssignModal(true)} className="btn btn-primary">
                    <Plus size={20} style={{ marginRight: '8px' }} />
                    Vincular Profissionais
                </button>
            </div>

            {/* Professionals Table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border-light)' }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>
                        Profissionais Vinculados
                    </h3>
                </div>

                {professionals.length > 0 ? (
                    <table className="company-professionals-table">
                        <thead>
                            <tr>
                                <th>Nome</th>
                                <th>Email</th>
                                <th>Setor</th>
                                <th style={{ width: '100px', textAlign: 'right' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {professionals.map(prof => (
                                <tr key={prof.id}>
                                    <td style={{ fontWeight: 500 }}>{prof.usuarios.nome}</td>
                                    <td style={{ color: 'var(--color-text-secondary)' }}>
                                        {prof.usuarios.email}
                                    </td>
                                    <td>
                                        {prof.setor ? (
                                            <span style={{
                                                padding: '4px 12px',
                                                background: 'var(--color-bg-secondary, #f8f9fa)',
                                                borderRadius: '12px',
                                                fontSize: '13px'
                                            }}>
                                                {prof.setor}
                                            </span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                                                Não definido
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <button
                                            onClick={() => handleRemoveProfessional(prof.id)}
                                            className="btn-icon btn-icon-danger"
                                            title="Desvincular"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                ) : (
                    <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                        <Users size={48} style={{ opacity: 0.3, marginBottom: '16px' }} />
                        <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}>
                            Nenhum profissional vinculado a esta empresa
                        </p>
                        <button
                            onClick={() => setShowAssignModal(true)}
                            className="btn btn-primary"
                            style={{ marginTop: '16px' }}
                        >
                            <Plus size={20} style={{ marginRight: '8px' }} />
                            Vincular Profissionais
                        </button>
                    </div>
                )}
            </div>

            {/* Assign Professionals Modal */}
            {showAssignModal && (
                <div className="modal-overlay" onClick={() => setShowAssignModal(false)}>
                    <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Vincular Profissionais</h3>
                            <button onClick={() => setShowAssignModal(false)} className="modal-close-btn">×</button>
                        </div>

                        <div className="modal-body">
                            {availableProfessionals.length > 0 ? (
                                <div className="professional-list">
                                    {availableProfessionals.map(prof => (
                                        <div key={prof.id} className="professional-item">
                                            <input
                                                type="checkbox"
                                                className="professional-item-checkbox"
                                                checked={selectedProfessionals[prof.id] || false}
                                                onChange={() => handleToggleProfessional(prof.id)}
                                            />
                                            <div className="professional-item-info">
                                                <p className="professional-item-name">{prof.nome}</p>
                                                <p className="professional-item-email">{prof.email}</p>
                                            </div>
                                            {selectedProfessionals[prof.id] && (
                                                <div className="professional-item-sector">
                                                    <input
                                                        type="text"
                                                        placeholder="Setor (opcional)"
                                                        value={sectors[prof.id] || ''}
                                                        onChange={(e) => handleSectorChange(prof.id, e.target.value)}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ padding: '40px', textAlign: 'center' }}>
                                    <p style={{ color: 'var(--color-text-secondary)' }}>
                                        Todos os profissionais ativos já estão vinculados a esta empresa
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button
                                type="button"
                                onClick={() => setShowAssignModal(false)}
                                className="btn btn-secondary"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleAssignProfessionals}
                                className="btn btn-primary"
                                disabled={Object.values(selectedProfessionals).filter(Boolean).length === 0}
                            >
                                Vincular Selecionados
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}

export default CompanyDetails
