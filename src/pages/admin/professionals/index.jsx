
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Users, UserPlus, Search, Mail, Shield, User, CheckCircle, XCircle, Edit, MoreHorizontal
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
            <div className="animate-pulse space-y-4 p-6">
                <div className="h-8 w-1/3 bg-slate-200 rounded"></div>
                <div className="h-64 bg-slate-100 rounded-xl"></div>
            </div>
        )
    }

    return (
        <div className="space-y-6 fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Users className="text-blue-600" />
                        Gestão de Profissionais
                    </h1>
                    <p className="text-slate-500">Gerencie o acesso e permissões da sua equipe.</p>
                </div>
                <button
                    onClick={() => navigate('/admin/professionals/new')}
                    className="btn btn-primary flex items-center gap-2 shadow-lg shadow-blue-200"
                >
                    <UserPlus size={18} />
                    Novo Profissional
                </button>
            </div>

            {/* Toolbar */}
            <div className="bg-white/50 backdrop-blur-sm p-4 rounded-xl border border-white/40 shadow-sm flex items-center gap-4">
                <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nome ou e-mail..."
                        className="w-full pl-10 pr-4 py-2 rounded-lg bg-white border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="text-sm text-slate-500 hidden md:block">
                    Mostrando <strong>{filtered.length}</strong> membros
                </div>
            </div>

            {/* Table Card */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Profissional</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Função</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Departamento</th>
                                <th className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                                <th className="px-6 py-4 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map(prof => (
                                <tr key={prof.id} className="hover:bg-slate-50/80 transition-colors group">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600 flex items-center justify-center font-bold text-sm border border-blue-200">
                                                {prof.nome.charAt(0).toUpperCase()}
                                            </div>
                                            <div>
                                                <div className="font-medium text-slate-800">{prof.nome}</div>
                                                <div className="text-sm text-slate-500 flex items-center gap-1">
                                                    <Mail size={12} /> {prof.email}
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${prof.role === 'admin'
                                                ? 'bg-purple-50 text-purple-700 border-purple-200'
                                                : 'bg-slate-50 text-slate-600 border-slate-200'
                                            }`}>
                                            {prof.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                                            {prof.role === 'admin' ? 'Administrador' : 'Profissional'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="text-sm text-slate-600">
                                            {prof.areas?.nome || <span className="text-slate-400 italic">Sem área</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${prof.ativo
                                                ? 'bg-emerald-50 text-emerald-700'
                                                : 'bg-red-50 text-red-700'
                                            }`}>
                                            {prof.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                            {prof.ativo ? 'Ativo' : 'Inativo'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button
                                            onClick={() => navigate(`/admin/professionals/${prof.id}/edit`)}
                                            className="text-slate-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors"
                                            title="Editar"
                                        >
                                            <Edit size={18} />
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan="5" className="px-6 py-12 text-center text-slate-500">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                                                <Users size={32} className="text-slate-300" />
                                            </div>
                                            <p>Nenhum profissional encontrado.</p>
                                            {searchTerm && <button onClick={() => setSearchTerm('')} className="text-blue-600 hover:underline text-sm">Limpar busca</button>}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}
