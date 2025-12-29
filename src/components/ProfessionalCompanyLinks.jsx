
import { useState, useEffect } from 'react'
import { Plus, Trash2, CheckCircle, XCircle, Building2, Briefcase } from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../services/professionals'
import { clientService } from '../services/clientService'

export default function ProfessionalCompanyLinks({ professionalId }) {
    const [links, setLinks] = useState([])
    const [companies, setCompanies] = useState([])
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)

    // Form State
    const [selectedCompany, setSelectedCompany] = useState('')
    const [functionName, setFunctionName] = useState('')

    useEffect(() => {
        loadData()
    }, [professionalId])

    async function loadData() {
        try {
            setLoading(true)
            const [linksData, companiesData] = await Promise.all([
                professionalsService.getLinks(professionalId),
                clientService.getAll() // Assuming getAll returns list of { id, nome }
            ])
            setLinks(linksData || [])
            setCompanies(companiesData || [])
        } catch (error) {
            console.error('Error loading links data:', error)
            toast.error('Erro ao carregar vínculos')
        } finally {
            setLoading(false)
        }
    }

    const handleAddLink = async (e) => {
        e.preventDefault()
        if (!selectedCompany || !functionName.trim()) return

        setSubmitting(true)
        try {
            await professionalsService.addLink({
                empresa_id: selectedCompany,
                profissional_id: professionalId,
                funcao: functionName.trim(),
                ativo: true
            })
            toast.success('Vínculo adicionado com sucesso!')
            setFunctionName('')
            setSelectedCompany('')
            await loadData()
        } catch (error) {
            console.error('Error adding link:', error)
            if (error.message.includes('duplicate key')) {
                toast.error('Este profissional já possui esta função nesta empresa.')
            } else {
                toast.error('Erro ao adicionar vínculo')
            }
        } finally {
            setSubmitting(false)
        }
    }

    const handleDelete = async (id) => {
        if (!confirm('Tem certeza que deseja remover este vínculo?')) return

        try {
            await professionalsService.removeLink(id)
            toast.success('Vínculo removido')
            setLinks(links.filter(l => l.id !== id))
        } catch (error) {
            console.error('Delete error:', error)
            toast.error('Erro ao remover vínculo')
        }
    }

    const handleToggleStatus = async (link) => {
        try {
            const updated = await professionalsService.toggleLinkStatus(link.id, link.ativo)
            setLinks(links.map(l => l.id === link.id ? { ...l, ativo: updated.ativo } : l))
            toast.success(`Status alterado para ${updated.ativo ? 'Ativo' : 'Inativo'}`)
        } catch (error) {
            console.error('Toggle error:', error)
            toast.error('Erro ao alterar status')
        }
    }

    if (loading) return <div className="p-4 text-center text-slate-500">Carregando vínculos...</div>

    return (
        <div className="space-y-6">
            <div className="border border-slate-200 rounded-lg p-5 bg-slate-50/50">
                <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                    <Plus size={18} className="text-blue-600" />
                    Novo Vínculo Comercial
                </h3>
                <form onSubmit={handleAddLink} className="flex flex-col md:flex-row gap-3 items-end">
                    <div className="w-full md:flex-1">
                        <label className="text-xs font-medium text-slate-500 mb-1 block">Empresa (Cliente)</label>
                        <select
                            className="input w-full"
                            value={selectedCompany}
                            onChange={e => setSelectedCompany(e.target.value)}
                            required
                        >
                            <option value="">Selecione a empresa...</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.nome}</option>
                            ))}
                        </select>
                    </div>
                    <div className="w-full md:flex-1">
                        <label className="text-xs font-medium text-slate-500 mb-1 block">Função Específica</label>
                        <input
                            type="text"
                            className="input w-full"
                            placeholder="Ex: Designer Sênior"
                            value={functionName}
                            onChange={e => setFunctionName(e.target.value)}
                            required
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={submitting}
                        className="btn btn-primary w-full md:w-auto"
                    >
                        {submitting ? 'Adicionando...' : 'Adicionar'}
                    </button>
                </form>
            </div>

            <div className="space-y-3">
                <h3 className="font-medium text-slate-700 text-sm uppercase tracking-wider">Vínculos Ativos ({links.length})</h3>

                {links.length === 0 ? (
                    <p className="text-sm text-slate-400 italic">Nenhum vínculo registrado.</p>
                ) : (
                    links.map(link => (
                        <div key={link.id} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-lg shadow-sm hover:shadow-md transition-all">
                            <div className="flex items-center gap-4">
                                <div className="hidden md:flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                                    <Building2 size={20} />
                                </div>
                                <div>
                                    <h4 className="font-bold text-slate-800 flex items-center gap-2">
                                        {link.empresas?.nome || 'Empresa desconhecida'}
                                    </h4>
                                    <div className="flex items-center gap-2 text-sm text-slate-500 mt-0.5">
                                        <Briefcase size={14} />
                                        <span className="font-medium text-slate-600">{link.funcao}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handleToggleStatus(link)}
                                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${link.ativo
                                        ? 'bg-green-50 text-green-700 hover:bg-green-100'
                                        : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                        }`}
                                    title="Clique para alternar status"
                                >
                                    {link.ativo ? <CheckCircle size={14} /> : <XCircle size={14} />}
                                    {link.ativo ? 'Ativo' : 'Inativo'}
                                </button>

                                <button
                                    onClick={() => handleDelete(link.id)}
                                    className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Remover vínculo"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    )
}
