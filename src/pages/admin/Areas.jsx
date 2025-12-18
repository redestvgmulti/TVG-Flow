import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'

function Areas() {
    const [areas, setAreas] = useState([])
    const [loading, setLoading] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [newArea, setNewArea] = useState({ nome: '', ativo: true })
    const [creating, setCreating] = useState(false)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })

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

    if (loading) {
        return (
            <div>
                <div className="dashboard-header">
                    <h2>Setores</h2>
                </div>
                <div className="card loading-card">
                    <p className="loading-text-primary">Carregando setores...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="animation-fade-in">
            <div className="dashboard-header">
                <h2>Setores</h2>
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                    + Adicionar Setor
                </button>
            </div>

            {feedback.show && (
                <div className={`card mb-6 p-4 border-${feedback.type === 'success' ? 'success' : 'danger'} bg-${feedback.type === 'success' ? 'success' : 'danger'}-subtle`}>
                    <p className={`text-${feedback.type === 'success' ? 'success' : 'danger'} font-medium m-0`}>
                        {feedback.message}
                    </p>
                </div>
            )}

            <div className="table-card">
                <div className="table-header">
                    <h3 className="table-title">
                        {areas.length} {areas.length === 1 ? 'setor cadastrado' : 'setores cadastrados'}
                    </h3>
                </div>

                {areas.length === 0 ? (
                    <div className="empty-state">
                        <span className="empty-icon" style={{ fontSize: '48px', opacity: 0.2 }}>🏢</span>
                        <p className="empty-text">Nenhum setor cadastrado</p>
                        <p className="text-muted mb-6">Crie seu primeiro setor para organizar os profissionais</p>
                        <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                            Criar Primeiro Setor
                        </button>
                    </div>
                ) : (
                    <div className="table-container">
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>Nome</th>
                                    <th>Status</th>
                                    <th style={{ textAlign: 'right' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {areas.map(area => (
                                    <tr key={area.id}>
                                        <td style={{ fontWeight: 500 }}>{area.nome}</td>
                                        <td>
                                            <span className={`badge ${area.ativo ? 'badge-success' : 'badge-danger'}`}>
                                                {area.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <button
                                                onClick={() => handleToggleStatus(area)}
                                                className="btn btn-secondary btn-sm"
                                            >
                                                {area.ativo ? 'Desativar' : 'Ativar'}
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
                                    className="btn btn-primary"
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
