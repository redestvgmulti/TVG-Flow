import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../services/supabase'
import { ArrowLeft, Users, Plus, Trash2, Edit, Briefcase, UserCheck } from 'lucide-react'
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
    const [functions, setFunctions] = useState({}) // Renamed from sectors

    useEffect(() => {
        fetchCompanyDetails()
        fetchAllProfessionals()
    }, [id])

    async function fetchCompanyDetails() {
        try {
            setLoading(true)

            // Fetch company info (from clientes)
            const { data: companyData, error: companyError } = await supabase
                .from('clientes')
                .select('*')
                .eq('id', id)
                .single()

            if (companyError) throw companyError
            setCompany(companyData)

            // Fetch company professionals (links)
            const { data: professionalsData, error: professionalsError } = await supabase
                .from('empresa_profissionais')
                .select(`
                    *,
                    usuarios:profissionais (
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
            // Fetch professionals from 'profissionais' view/table
            const { data, error } = await supabase
                .from('profissionais')
                .select('id, nome, email')
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
            const assignmentsToCreate = []
            console.log('Selected:', selectedProfessionals)
            console.log('Functions:', functions)

            for (const [profId, isSelected] of Object.entries(selectedProfessionals)) {
                if (isSelected) {
                    const func = functions[profId]
                    if (!func || !func.trim()) {
                        toast.error(`Informe a função para todos os profissionais selecionados`)
                        return
                    }
                    assignmentsToCreate.push({
                        empresa_id: id,
                        profissional_id: profId,
                        funcao: func.trim(),
                        ativo: true
                    })
                }
            }

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
            setFunctions({})
            fetchCompanyDetails()

        } catch (error) {
            console.error('Error assigning professionals:', error)
            if (error.code === '23505') {
                toast.error('Um ou mais profissionais já estão vinculados a esta empresa com esta função')
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
                .delete() // Assuming permissions allow delete
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

    function handleFunctionChange(professionalId, funcValue) {
        setFunctions(prev => ({
            ...prev,
            [professionalId]: funcValue
        }))
    }

    // Filter out already assigned professionals (optional logic: maybe allow same pro with DIFFERENT function? 
    // The UNIQUE constraint is (empresa_id, profissional_id, funcao).
    // So yes, a pro can be added multiple times with DIFFERENT functions.
    // Ideally we list all, but simpler to just show all active pros in the modal.
    // If I filter out those who are "fully linked" it's hard. 
    // For now, I will show ALL professionals, but maybe visually indicate if they are already linked?
    // Or just Keep it simple: Show all. If constraint fails, toaster says error.

    // Actually, preserving the "availableProfessionals" logic from before implies "one link per pro per company". but user said: "um funcionário pode estar em mais de uma empresa com funcoes diferentes"
    // AND "inclusive o funcionário nessa empresa... com funções diferentes".
    // Wait. "um funcionário pode estar em mais de uma empresa" (This is standard M:N).
    // What if "um funcionário pode estar na MESMA empresa com funções diferentes"? 
    // The UNIQUE constraint is (empresa_id, profissional_id, funcao). So YES, they can have multiple roles in the SAME company.
    // So I should NOT filter them out completely.
    // But to keep UI simple, let's list all professionals.

    // However, existing code filtered them. I will REMOVE the filter to allow multiple roles.
    const availableProfessionals = allProfessionals

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
                        {company.cnpj && <span className="company-cnpj">CNPJ: {company.cnpj}</span>}
                        <span className={`company-status ${company.ativo ? 'active' : 'inactive'}`}>
                            {company.ativo ? 'Ativa' : 'Inativa'}
                        </span>
                        <span>{professionals.length} vínculos</span>
                    </div>
                </div>

                <button onClick={() => setShowAssignModal(true)} className="btn btn-primary">
                    <Plus size={20} style={{ marginRight: '8px' }} />
                    Vincular Profissional
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
                                <th>Função na Empresa</th>
                                <th>Status</th>
                                <th style={{ width: '100px', textAlign: 'right' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {professionals.map(prof => (
                                <tr key={prof.id}>
                                    <td style={{ fontWeight: 500 }}>
                                        {prof.usuarios?.nome || 'Usuário Removido'}
                                    </td>
                                    <td style={{ color: 'var(--color-text-secondary)' }}>
                                        {prof.usuarios?.email || '-'}
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Briefcase size={14} className="text-muted" />
                                            <span style={{ fontWeight: 500, color: '#475569' }}>
                                                {prof.funcao}
                                            </span>
                                        </div>
                                    </td>
                                    <td>
                                        <span className={`status-badge ${prof.ativo ? 'status-success' : 'status-error'}`}>
                                            {prof.ativo ? 'Ativo' : 'Inativo'}
                                        </span>
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
                            Vincular Profissional
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
                            <p className="text-sm text-muted mb-4">
                                Selecione os profissionais e defina a função que exercerão <strong>nesta empresa</strong>.
                                <br />
                                <span className="text-xs text-slate-400">Um mesmo profissional pode ter múltiplas funções.</span>
                            </p>

                            {availableProfessionals.length > 0 ? (
                                <div className="professional-list">
                                    {availableProfessionals.map(prof => (
                                        <div key={prof.id} className="professional-item" style={{ alignItems: 'flex-start' }}>
                                            <div style={{ paddingTop: '4px' }}>
                                                <input
                                                    type="checkbox"
                                                    className="professional-item-checkbox"
                                                    checked={selectedProfessionals[prof.id] || false}
                                                    onChange={() => handleToggleProfessional(prof.id)}
                                                />
                                            </div>
                                            <div style={{ flex: 1 }}>
                                                <div className="professional-item-info">
                                                    <p className="professional-item-name">{prof.nome}</p>
                                                    <p className="professional-item-email">{prof.email}</p>
                                                </div>

                                                {selectedProfessionals[prof.id] && (
                                                    <div className="professional-item-sector animate-in fade-in slide-in-from-top-1" style={{ marginTop: '8px' }}>
                                                        <label className="text-xs font-medium text-slate-500 mb-1 block">
                                                            Função Específica *
                                                        </label>
                                                        <input
                                                            type="text"
                                                            className="input input-sm w-full"
                                                            placeholder="Ex: Redator, Tech Lead..."
                                                            value={functions[prof.id] || ''}
                                                            onChange={(e) => handleFunctionChange(prof.id, e.target.value)}
                                                            autoFocus
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ padding: '40px', textAlign: 'center' }}>
                                    <p style={{ color: 'var(--color-text-secondary)' }}>
                                        Nenhum profissional cadastrado no sistema.
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
                                <Plus size={16} style={{ marginRight: '6px' }} />
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
