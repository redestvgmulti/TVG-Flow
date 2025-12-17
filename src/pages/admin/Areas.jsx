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
                <h2>Setores</h2>
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Carregando setores...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 style={{ margin: 0 }}>Setores</h2>
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                    + Adicionar Setor
                </button>
            </div>

            {feedback.show && (
                <div
                    className="card"
                    style={{
                        marginBottom: 'var(--space-md)',
                        padding: 'var(--space-md)',
                        backgroundColor: feedback.type === 'success' ? '#d1f4dd' : '#ffe5e5',
                        border: `1px solid ${feedback.type === 'success' ? '#34c759' : '#ff3b30'}`
                    }}
                >
                    <p style={{
                        margin: 0,
                        color: feedback.type === 'success' ? '#34c759' : '#ff3b30',
                        fontWeight: 'var(--weight-medium)'
                    }}>
                        {feedback.message}
                    </p>
                </div>
            )}

            <div className="card">
                {areas.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
                        <p style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-sm)' }}>Nenhum setor cadastrado</p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-md)' }}>
                            Crie seu primeiro setor para organizar os profissionais
                        </p>
                        <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                            Criar Primeiro Setor
                        </button>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border-light)' }}>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Nome</th>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {areas.map(area => (
                                    <tr key={area.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                                        <td style={{ padding: 'var(--space-md)', fontWeight: 'var(--weight-medium)' }}>{area.nome}</td>
                                        <td style={{ padding: 'var(--space-md)' }}>
                                            <span className={`badge ${area.ativo ? 'badge-success' : 'badge-danger'}`}>
                                                {area.ativo ? 'Ativo' : 'Inativo'}
                                            </span>
                                        </td>
                                        <td style={{ padding: 'var(--space-md)' }}>
                                            <button
                                                onClick={() => handleToggleStatus(area)}
                                                className="btn btn-secondary"
                                                style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
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
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <input
                                            type="checkbox"
                                            checked={newArea.ativo}
                                            onChange={(e) => setNewArea({ ...newArea, ativo: e.target.checked })}
                                        />
                                        Ativo
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
