
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Users, UserPlus, Search, Mail, Shield, User, CheckCircle, XCircle, Edit
} from 'lucide-react'
import { toast } from 'sonner'
import { professionalsService } from '../../../services/professionals'

export default function ProfessionalsList() {
    const navigate = useNavigate()
    const [professionals, setProfessionals] = useState([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        loadData()
    }, [])

    async function loadData() {
        try {
            setLoading(true)
            const data = await professionalsService.list()
            setProfessionals(data || [])
        } catch (error) {
            console.error('Failed to load professionals', error)
            toast.error('Erro ao carregar lista de profissionais')
        } finally {
            setLoading(false)
        }
    }

    const filtered = professionals.filter(p =>
        p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.email.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <div>
                        <h2>Gestão de Profissionais</h2>
                    </div>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando equipe...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in space-y-6">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Gestão de Profissionais</h2>
                    <p className="text-muted mt-1">Gerencie o acesso e permissões da sua equipe.</p>
                </div>
                <button
                    onClick={() => navigate('/admin/professionals/new')}
                    className="btn btn-primary flex items-center gap-2 shadow-lg shadow-blue-200/50"
                >
                    <UserPlus size={18} />
                    Novo Profissional
                </button>
            </div>

            {/* Toolbar */}
            <div className="card mb-8 p-4 flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nome ou e-mail..."
                        className="input pl-10"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="text-sm text-muted hidden md:block border-l pl-4 border-slate-200">
                    Mostrando <strong>{filtered.length}</strong> membros
                </div>
            </div>

            {/* Table Card */}
            <div className="table-card">
                <div className="table-header border-b border-slate-100">
                    <h3 className="table-title flex items-center gap-2">
                        <Users size={18} className="text-muted" />
                        <span className="font-semibold text-slate-700">Equipe Cadastrada</span>
                    </h3>
                </div>

                {filtered.length === 0 ? (
                    <div className="empty-state py-12">
                        <div className="empty-icon mb-4" style={{ opacity: 0.1 }}><Users size={64} /></div>
                        <p className="empty-text text-lg font-medium text-slate-600">Nenhum profissional encontrado</p>
                        <p className="text-slate-400 mb-6">Tente ajustar sua busca ou adicione um novo membro.</p>
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} className="btn btn-ghost text-primary hover:bg-blue-50">
                                Limpar busca
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th className="py-4 pl-6">Profissional</th>
                                    <th className="py-4">Função</th>
                                    <th className="py-4">Departamento</th>
                                    <th className="py-4">Status</th>
                                    <th className="py-4 pr-6" style={{ textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(prof => (
                                    <tr key={prof.id} className="hover:bg-slate-50/80 transition-all border-b border-slate-50 last:border-0">
                                        <td className="py-5 pl-6">
                                            <div className="flex flex-col gap-1.5">
                                                <div className="font-bold text-slate-800 text-base">{prof.nome}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} className="text-sm text-slate-500">
                                                    <Mail size={14} className="text-slate-400" />
                                                    {prof.email}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="py-5">
                                            <span className={`badge ${prof.role === 'admin' ? 'badge-primary' : 'badge-warning'} gap-1.5 px-3 py-1.5 text-xs ring-1 ring-inset ${prof.role === 'admin' ? 'ring-blue-100' : 'ring-yellow-100'}`}>
                                                {prof.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                                                {prof.role === 'admin' ? 'Administrador' : 'Profissional'}
                                            </span>
                                        </td>
                                        <td className="py-5">
                                            <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                                                {prof.areas?.nome || <span className="text-slate-400 italic font-normal">Sem área</span>}
                                            </span>
                                        </td>
                                        <td className="py-5">
                                            <span className={`badge ${prof.ativo ? 'badge-success' : 'badge-danger'} gap-1.5 px-3 py-1.5 ring-1 ring-inset ${prof.ativo ? 'ring-green-100' : 'ring-red-100'}`}>
                                                {prof.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {prof.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td className="py-5 pr-6" style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => navigate(`/admin/professionals/${prof.id}/edit`)}
                                                className="btn-icon p-2.5 hover:bg-white hover:text-blue-600 hover:shadow-md border border-transparent hover:border-slate-100 rounded-lg transition-all text-slate-400 bg-slate-50"
                                                title="Editar"
                                            >
                                                <Edit size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    )
}
