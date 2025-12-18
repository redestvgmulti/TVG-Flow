
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

            {/* Toolbar - Detached Elements */}
            <div style={{ marginBottom: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div className="w-full max-w-md" style={{ position: 'relative' }}>
                    {!searchTerm && (
                        <Search
                            size={18}
                            style={{
                                position: 'absolute',
                                left: '12px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                pointerEvents: 'none',
                                color: '#94a3b8' // text-slate-400
                            }}
                        />
                    )}
                    <input
                        type="text"
                        placeholder="Buscar por nome ou e-mail..."
                        className="input"
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            width: '100%',
                            paddingLeft: !searchTerm ? '40px' : '16px'
                        }}
                    />
                </div>
                <div className="text-sm text-slate-500 font-medium bg-slate-100 px-4 py-2 rounded-full border border-slate-200">
                    Mostrando <strong>{filtered.length}</strong> membros
                </div>
            </div>

            {/* Table Card */}
            <div className="table-card">
                <div className="table-header border-b border-slate-100">
                    <h3 className="table-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                                    <th style={{ padding: '1.5rem', paddingLeft: '2rem', textAlign: 'left' }}>Profissional</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Função</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Departamento</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Status</th>
                                    <th style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(prof => (
                                    <tr key={prof.id} className="hover:bg-slate-50/80 transition-all border-b border-slate-50 last:border-0">
                                        <td style={{ padding: '1.5rem', paddingLeft: '2rem' }}>
                                            <div className="flex flex-col gap-1.5">
                                                <div className="font-bold text-slate-800 text-base">{prof.nome}</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }} className="text-sm text-slate-500">
                                                    <Mail size={14} className="text-slate-400" />
                                                    {prof.email}
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className={`badge ${prof.roles === 'admin' ? 'badge-primary' : 'badge-warning'} gap-1.5 px-3 py-1.5 text-xs ring-1 ring-inset ${prof.role === 'admin' ? 'ring-blue-100' : 'ring-yellow-100'}`}>
                                                {prof.role === 'admin' ? <Shield size={12} /> : <User size={12} />}
                                                {prof.role === 'admin' ? 'Administrador' : 'Profissional'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className="text-sm font-medium text-slate-600 bg-slate-100 px-3 py-1 rounded-full">
                                                {prof.areas?.nome || <span className="text-slate-400 italic font-normal">Sem área</span>}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className={`badge ${prof.ativo ? 'badge-success' : 'badge-danger'} gap-1.5 px-3 py-1.5 ring-1 ring-inset ${prof.ativo ? 'ring-green-100' : 'ring-red-100'}`}>
                                                {prof.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {prof.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>
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
