import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'
import {
    Layout, Plus, Search, CheckCircle, XCircle, Building2, Trash2, AlertTriangle
} from 'lucide-react'
import { toast } from 'sonner' // Keeping Sonner as it seems preferred by user environment now

function Areas() {
    const [areas, setAreas] = useState([])
    const [loading, setLoading] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [newArea, setNewArea] = useState({ nome: '', ativo: true })
    const [creating, setCreating] = useState(false)
    // Deletion State (New Feature)
    const [showDeleteModal, setShowDeleteModal] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState(null)
    const [linkedEmployeesCount, setLinkedEmployeesCount] = useState(0)
    const [reassignTargetId, setReassignTargetId] = useState('')
    const [deleting, setDeleting] = useState(false)

    // Feedback state from original (replaced with toast for better UX, but keeping state structure if needed?)
    // Original used 'feedback' state and 'showFeedback' helper.
    // User requested "Feedback de sucesso / erro via toast silencioso".
    // So I will replace 'showFeedback' internals with toast, but simpler to just use toast direct.
    // However, to "Restore 100%", I should stick to the structure if possible, but the user explicitly asked for "toast silencioso".
    // I will use toast, removing the local feedback state to keep it clean as per "CS Correção" but styling matching.

    const [searchTerm, setSearchTerm] = useState('')

    useEffect(() => {
        fetchAreas()
    }, [])

    async function fetchAreas() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('departamentos')
                .select('id, nome, cor_hex, created_at')
                .order('nome')

            if (error) throw error

            // Map for 'ativo' support (Legacy UI support)
            const mappedData = (data || []).map(d => ({
                ...d,
                ativo: true // Default true as column missing
            }))

            setAreas(mappedData)
        } catch (error) {
            console.error('Erro ao buscar setores:', error)
            toast.error('Falha ao carregar setores')
        } finally {
            setLoading(false)
        }
    }

    async function handleAddArea(e) {
        e.preventDefault()

        if (!newArea.nome.trim()) {
            toast.error('Por favor, preencha o nome do setor')
            return
        }

        setCreating(true)

        try {
            const { error } = await supabase
                .from('departamentos')
                .insert([{
                    nome: newArea.nome
                }])

            if (error) throw error

            setNewArea({ nome: '', ativo: true })
            setShowAddModal(false)
            toast.success('Setor criado com sucesso!')
            await fetchAreas()
        } catch (error) {
            console.error('Erro ao criar setor:', error)
            toast.error('Falha ao criar setor: ' + error.message)
        } finally {
            setCreating(false)
        }
    }

    async function handleToggleStatus(area) {
        // Mock toggle
        toast.info('Status fixo (ativo) no esquema atual.')
    }

    // --- DELETE LOGIC (NEW) ---
    async function initDelete(area) {
        setDeleteTarget(area)
        setDeleting(false)
        setReassignTargetId('')

        try {
            const { count, error } = await supabase
                .from('profissionais')
                .select('*', { count: 'exact', head: true })
                .eq('departamento_id', area.id)

            if (error) throw error
            setLinkedEmployeesCount(count || 0)
            setShowDeleteModal(true)
        } catch (error) {
            console.error(error)
            toast.error('Erro ao verificar vínculos')
        }
    }

    async function executeDelete() {
        if (!deleteTarget) return
        setDeleting(true)

        try {
            if (linkedEmployeesCount > 0) {
                if (!reassignTargetId) {
                    toast.error('Selecione um departamento de destino')
                    setDeleting(false)
                    return
                }
                const { error: reassignError } = await supabase
                    .from('profissionais')
                    .update({ departamento_id: reassignTargetId })
                    .eq('departamento_id', deleteTarget.id)
                if (reassignError) throw reassignError
            }

            const { error: deleteError } = await supabase
                .from('departamentos')
                .delete()
                .eq('id', deleteTarget.id)

            if (deleteError) throw deleteError

            toast.success('Departamento excluído com sucesso')
            setShowDeleteModal(false)
            setDeleteTarget(null)
            fetchAreas()

        } catch (error) {
            console.error(error)
            toast.error('Erro ao excluir: ' + error.message)
        } finally {
            setDeleting(false)
        }
    }

    const filtered = areas.filter(area =>
        area.nome.toLowerCase().includes(searchTerm.toLowerCase())
    )
    const reassignOptions = areas.filter(a => a.id !== deleteTarget?.id)

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

            {/* Toolbar - Refined */}
            {/* Toolbar - Refined */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-8">
                <div className="relative w-full sm:max-w-md group">
                    <div
                        className="absolute flex items-center justify-center pointer-events-none z-10 text-slate-400"
                        style={{ left: '1rem', top: '50%', transform: 'translateY(-50%)' }}
                    >
                        <Search
                            size={20}
                            className={`transition-colors duration-200 ${searchTerm ? 'text-indigo-500' : 'text-slate-400'}`}
                        />
                    </div>
                    <input
                        type="text"
                        placeholder="Buscar setor..."
                        className="input w-full pr-4 py-3 bg-white border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 rounded-xl transition-all shadow-sm !m-0"
                        style={{ paddingLeft: '3.5rem' }}
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                    />
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 px-1 sm:px-0">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider sm:hidden">Total</span>
                    <div className="text-sm font-medium text-slate-600 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm flex items-center gap-2 w-auto self-start sm:self-auto">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        <span>Mostrando <strong className="text-slate-900">{filtered.length}</strong> setores</span>
                    </div>
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
                                    <th style={{ padding: '1.5rem', textAlign: 'center' }}>Status</th>
                                    <th style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(area => (
                                    <tr key={area.id} className="hover:bg-slate-50/80 transition-all border-b border-slate-50 last:border-0">
                                        <td style={{ padding: '1.5rem', paddingLeft: '2rem', fontWeight: 500, color: '#1e293b' }}>
                                            {area.nome}
                                        </td>
                                        <td style={{ padding: '1.5rem', textAlign: 'center' }}>
                                            <div className="flex items-center justify-center">
                                                <span className={`badge ${area.ativo ? 'badge-success' : 'badge-danger'} gap-1.5 px-3 py-1.5 ring-1 ring-inset ${area.ativo ? 'ring-green-100' : 'ring-red-100'}`}>
                                                    {area.ativo ? <CheckCircle size={12} /> : <XCircle size={12} />}
                                                    {area.ativo ? 'Ativo' : 'Inativo'}
                                                </span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '1.5rem', paddingRight: '2rem', textAlign: 'right' }}>
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleToggleStatus(area)}
                                                    className="btn-icon p-2.5 hover:bg-white hover:text-blue-600 hover:shadow-md border border-transparent hover:border-slate-100 rounded-lg transition-all text-slate-400 bg-slate-50"
                                                    title={area.ativo ? 'Desativar' : 'Ativar'}
                                                >
                                                    {area.ativo ? <XCircle size={18} /> : <CheckCircle size={18} />}
                                                </button>

                                                <button
                                                    onClick={() => initDelete(area)}
                                                    className="btn-icon p-2.5 hover:bg-red-600 hover:text-white hover:shadow-md border border-transparent hover:border-red-600 rounded-lg transition-all text-slate-400 bg-slate-50"
                                                    title="Excluir"
                                                >
                                                    <Trash2 size={18} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Area Modal */}
            {
                showAddModal && (
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
                )
            }

            {/* Delete Modal (New Feature - Using Original Modal Style) */}
            {
                showDeleteModal && (
                    <div className="modal-backdrop" onClick={() => setShowDeleteModal(false)}>
                        <div className="modal" onClick={(e) => e.stopPropagation()}>
                            <div className="modal-header">
                                <h3 className="flex items-center gap-2 text-red-600">
                                    <AlertTriangle size={20} />
                                    Excluir Setor
                                </h3>
                                <button className="modal-close" onClick={() => setShowDeleteModal(false)}>×</button>
                            </div>
                            <div className="modal-body">
                                <p className="mb-4">
                                    Você está prestes a excluir o setor <strong>{deleteTarget?.nome}</strong>.
                                </p>

                                {linkedEmployeesCount > 0 ? (
                                    <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
                                        <p className="text-orange-800 text-sm font-medium mb-3">
                                            Existem <strong>{linkedEmployeesCount} funcionários</strong> neste setor.
                                        </p>
                                        <div className="input-group mb-0">
                                            <label className="text-xs font-bold text-orange-700 uppercase">
                                                Transferir para:
                                            </label>
                                            <select
                                                className="input bg-white w-full"
                                                value={reassignTargetId}
                                                onChange={e => setReassignTargetId(e.target.value)}
                                            >
                                                <option value="">Selecione um destino...</option>
                                                {reassignOptions.map(opt => (
                                                    <option key={opt.id} value={opt.id}>{opt.nome}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="text-slate-500 text-sm">
                                        Esta ação é irreversível e o departamento será removido permanentemente.
                                    </p>
                                )}
                            </div>
                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowDeleteModal(false)}
                                    className="btn btn-secondary"
                                    disabled={deleting}
                                >
                                    Cancelar
                                </button>
                                <button
                                    type="button"
                                    onClick={executeDelete}
                                    className="btn btn-primary bg-red-600 border-red-600 hover:bg-red-700"
                                    style={{ backgroundColor: '#dc2626', borderColor: '#dc2626' }}
                                    disabled={deleting}
                                >
                                    {deleting ? 'Excluindo...' : (linkedEmployeesCount > 0 ? 'Transferir e Excluir' : 'Confirmar Exclusão')}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    )
}

export default Areas
