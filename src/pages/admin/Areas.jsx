
import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import {
    Layout, Plus, Search, CheckCircle, XCircle, Building2, Trash2
} from 'lucide-react'

function Areas() {
    const [areas, setAreas] = useState([])
    const [loading, setLoading] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [newArea, setNewArea] = useState({ nome: '', ativo: true })
    const [creating, setCreating] = useState(false)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })
    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        fetchAreas()
    }, [])

    useEffect(() => {
        if (feedback.show) {
            const timer = setTimeout(() => {
                setFeedback({ show: false, type: '', message: '' })
            }, 5000)
            return () => clearTimeout(timer)
        }
    }, [feedback.show])

    async function fetchAreas() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('areas')
                .select('id, nome, ativo, created_at')
                .order('nome')

            if (error) throw error
            setAreas(data || [])
        } catch (error) {
            console.error('Erro ao buscar setores:', error)
            showFeedback('error', 'Falha ao carregar setores')
        } finally {
            setLoading(false)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    async function handleAddArea(e) {
        e.preventDefault()

        if (!newArea.nome.trim()) {
            showFeedback('error', 'Por favor, preencha o nome do setor')
            return
        }

        setCreating(true)

        try {
            const { error } = await supabase
                .from('areas')
                .insert([{
                    nome: newArea.nome,
                    ativo: newArea.ativo
                }])

            if (error) throw error

            setNewArea({ nome: '', ativo: true })
            setShowAddModal(false)
            showFeedback('success', 'Setor criado com sucesso!')
            await fetchAreas()
        } catch (error) {
            console.error('Erro ao criar setor:', error)
            showFeedback('error', 'Falha ao criar setor: ' + error.message)
        } finally {
            setCreating(false)
        }
    }

    async function handleToggleStatus(area) {
        const newStatus = !area.ativo
        const action = newStatus ? 'ativar' : 'desativar'

        if (!confirm(`Deseja ${action} o setor "${area.nome}"?`)) {
            return
        }

        try {
            const { error } = await supabase
                .from('areas')
                .update({ ativo: newStatus })
                .eq('id', area.id)

            if (error) throw error

            showFeedback('success', `Setor ${newStatus ? 'ativado' : 'desativado'} com sucesso`)
            await fetchAreas()
        } catch (error) {
            console.error('Erro ao atualizar setor:', error)
            showFeedback('error', 'Falha ao atualizar setor')
        }
    }

    const filtered = areas.filter(area =>
        area.nome.toLowerCase().includes(searchTerm.toLowerCase())
    )

    if (loading) {
        return (
            <div className="animation-fade-in">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                    <div>
                        <h2>Setores</h2>
                    </div>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando setores...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in space-y-6">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Setores</h2>
                    <p className="text-muted mt-1">Gerencie os departamentos e áreas da empresa.</p>
                </div>
                <button
                    onClick={() => setShowAddModal(true)}
                    className="btn btn-primary flex items-center gap-2 shadow-lg shadow-blue-200/50"
                >
                    <Plus size={18} />
                    Adicionar Setor
                </button>
            </div>

            {feedback.show && (
                <div className={`card mb-6 p-4 border-${feedback.type === 'success' ? 'success' : 'danger'} bg-${feedback.type === 'success' ? 'success' : 'danger'}-subtle`}>
                    <p className={`text-${feedback.type === 'success' ? 'success' : 'danger'} font-medium m-0`}>
                        {feedback.message}
                    </p>
                </div>
            )}

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
                                color: '#94a3b8'
                            }}
                        />
                    )}
                    <input
                        type="text"
                        placeholder="Buscar setor..."
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
                    Mostrando <strong>{filtered.length}</strong> setores
                </div>
            </div>

            <div className="table-card">
                <div className="table-header border-b border-slate-100">
                    <h3 className="table-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Layout size={18} className="text-muted" />
                        <span className="font-semibold text-slate-700">Departamentos Cadastrados</span>
                    </h3>
                </div>

                {filtered.length === 0 ? (
                    <div className="empty-state py-12">
                        <div className="empty-icon mb-4" style={{ opacity: 0.1 }}><Building2 size={64} /></div>
                        <p className="empty-text text-lg font-medium text-slate-600">Nenhum setor encontrado</p>
                        <p className="text-slate-400 mb-6">Crie seu primeiro setor para organizar os profissionais</p>
                        <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                            Criar Primeiro Setor
                        </button>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th style={{ padding: '1.5rem', paddingLeft: '2rem', textAlign: 'left' }}>Nome</th>
                                    <th style={{ padding: '1.5rem', textAlign: 'left' }}>Status</th>
                                    <th style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(area => (
                                    <tr key={area.id} className="hover:bg-slate-50/80 transition-all border-b border-slate-50 last:border-0">
                                        <td style={{ padding: '1.5rem', paddingLeft: '2rem', fontWeight: 500, color: '#1e293b' }}>
                                            {area.nome}
                                        </td>
                                        <td style={{ padding: '1.5rem' }}>
                                            <span className={`badge ${area.ativo ? 'badge-success' : 'badge-danger'} gap-1.5 px-3 py-1.5 ring-1 ring-inset ${area.ativo ? 'ring-green-100' : 'ring-red-100'}`}>
                                                {area.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                {area.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleToggleStatus(area)}
                                                className="btn-icon p-2.5 hover:bg-white hover:text-blue-600 hover:shadow-md border border-transparent hover:border-slate-100 rounded-lg transition-all text-slate-400 bg-slate-50"
                                                title={area.ativo ? 'Desativar' : 'Ativar'}
                                            >
                                                {area.ativo ? <XCircle size={18} /> : <CheckCircle size={18} />}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Area Modal */}
            {showAddModal && (
                <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Adicionar Setor</h3>
                            <button className="modal-close" onClick={() => setShowAddModal(false)}>×</button>
                        </div>
                        <form onSubmit={handleAddArea}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="nome">Nome do Setor *</label>
                                    <input
                                        id="nome"
                                        type="text"
                                        className="input"
                                        value={newArea.nome}
                                        onChange={(e) => setNewArea({ ...newArea, nome: e.target.value })}
                                        placeholder="Ex: Marketing, TI, RH"
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={newArea.ativo}
                                            onChange={(e) => setNewArea({ ...newArea, ativo: e.target.checked })}
                                            style={{ width: '16px', height: '16px' }}
                                        />
                                        <span className="text-sm font-medium">Setor Ativo</span>
                                    </label>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="btn btn-secondary"
                                    disabled={creating}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary shadow-lg shadow-blue-200/50"
                                    disabled={creating}
                                >
                                    {creating ? 'Criando...' : 'Criar Setor'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Areas
