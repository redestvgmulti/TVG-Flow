import { useState, useEffect } from 'react'
import { supabase } from '../../services/supabase'

function Professionals() {
    const [professionals, setProfessionals] = useState([])
    const [loading, setLoading] = useState(true)
    const [showAddModal, setShowAddModal] = useState(false)
    const [showEditModal, setShowEditModal] = useState(false)
    const [editingStaff, setEditingStaff] = useState(null)
    const [newStaff, setNewStaff] = useState({
        nome: '',
        email: '',
        role: 'profissional',
        ativo: true,
        area_id: ''
    })
    const [editStaff, setEditStaff] = useState({
        nome: '',
        role: '',
        ativo: true
    })
    const [creating, setCreating] = useState(false)
    const [updating, setUpdating] = useState(false)
    const [feedback, setFeedback] = useState({ show: false, type: '', message: '' })
    const [areas, setAreas] = useState([])

    useEffect(() => {
        fetchProfessionals()
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

    async function fetchProfessionals() {
        try {
            setLoading(true)
            const { data, error } = await supabase
                .from('profissionais')
                .select('id, nome, email, role, ativo, created_at')
                .order('created_at', { ascending: false })

            if (error) throw error
            setProfessionals(data || [])
        } catch (error) {
            console.error('Error fetching professionals:', error)
            showFeedback('error', 'Failed to load professionals')
        } finally {
            setLoading(false)
        }
    }

    async function fetchAreas() {
        try {
            const { data, error } = await supabase
                .from('areas')
                .select('id, nome')
                .eq('ativo', true)
                .order('nome')

            if (error) throw error
            setAreas(data || [])
        } catch (error) {
            console.error('Error fetching areas:', error)
        }
    }

    function showFeedback(type, message) {
        setFeedback({ show: true, type, message })
    }

    function handleOpenEditModal(professional) {
        setEditingStaff(professional)
        setEditStaff({
            nome: professional.nome,
            role: professional.role,
            ativo: professional.ativo
        })
        setShowEditModal(true)
    }

    async function handleAddStaff(e) {
        e.preventDefault()

        if (!newStaff.nome.trim() || !newStaff.email.trim()) {
            showFeedback('error', 'Please fill in all required fields')
            return
        }

        if (!newStaff.area_id) {
            showFeedback('error', 'Please select an area for the professional')
            return
        }

        setCreating(true)

        try {
            // Check for duplicate email
            const { data: existing } = await supabase
                .from('profissionais')
                .select('id')
                .eq('email', newStaff.email)
                .single()

            if (existing) {
                showFeedback('error', 'A professional with this email already exists')
                setCreating(false)
                return
            }

            const { error } = await supabase
                .from('profissionais')
                .insert([{
                    nome: newStaff.nome,
                    email: newStaff.email,
                    role: newStaff.role,
                    ativo: newStaff.ativo,
                    area_id: newStaff.area_id
                }])

            if (error) throw error

            setNewStaff({ nome: '', email: '', role: 'profissional', ativo: true, area_id: '' })
            setShowAddModal(false)
            showFeedback('success', 'Staff member added! They must sign up with this email to access the system.')
            await fetchProfessionals()
        } catch (error) {
            console.error('Error adding staff:', error)
            showFeedback('error', 'Failed to add staff member: ' + error.message)
        } finally {
            setCreating(false)
        }
    }

    async function handleUpdateStaff(e) {
        e.preventDefault()

        if (!editStaff.nome.trim()) {
            showFeedback('error', 'Name cannot be empty')
            return
        }

        // Check if role is changing
        const roleChanged = editStaff.role !== editingStaff.role
        const statusChanged = editStaff.ativo !== editingStaff.ativo

        if (roleChanged) {
            if (!confirm(`Change role from "${editingStaff.role}" to "${editStaff.role}"? This will affect their access permissions.`)) {
                return
            }
        }

        if (statusChanged && !editStaff.ativo) {
            if (!confirm(`Deactivate ${editingStaff.nome}? They will be immediately logged out and lose all access.`)) {
                return
            }
        }

        setUpdating(true)

        try {
            const { error } = await supabase
                .from('profissionais')
                .update({
                    nome: editStaff.nome,
                    role: editStaff.role,
                    ativo: editStaff.ativo
                })
                .eq('id', editingStaff.id)

            if (error) throw error

            setShowEditModal(false)
            setEditingStaff(null)

            let message = 'Staff member updated successfully'
            if (roleChanged) {
                message += '. Role change will take effect on next login.'
            }
            if (statusChanged && !editStaff.ativo) {
                message += '. User has been deactivated.'
            }

            showFeedback('success', message)
            await fetchProfessionals()
        } catch (error) {
            console.error('Error updating staff:', error)
            showFeedback('error', 'Failed to update staff member: ' + error.message)
        } finally {
            setUpdating(false)
        }
    }

    if (loading) {
        return (
            <div>
                <h2>Professionals</h2>
                <div className="card" style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <p style={{ color: 'var(--color-text-secondary)' }}>Loading professionals...</p>
                </div>
            </div>
        )
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
                <h2 style={{ margin: 0 }}>Professionals</h2>
                <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                    + Add Staff
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
                {professionals.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--color-text-secondary)' }}>
                        <p style={{ fontSize: 'var(--text-lg)', marginBottom: 'var(--space-sm)' }}>No professionals yet</p>
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-md)' }}>
                            Add your first staff member to get started
                        </p>
                        <button onClick={() => setShowAddModal(true)} className="btn btn-primary">
                            Add First Staff Member
                        </button>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '2px solid var(--color-border-light)' }}>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Name</th>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Email</th>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Role</th>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Status</th>
                                    <th style={{ padding: 'var(--space-md)', textAlign: 'left', fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {professionals.map(prof => (
                                    <tr key={prof.id} style={{ borderBottom: '1px solid var(--color-border-light)' }}>
                                        <td style={{ padding: 'var(--space-md)', fontWeight: 'var(--weight-medium)' }}>{prof.nome}</td>
                                        <td style={{ padding: 'var(--space-md)', color: 'var(--color-text-secondary)' }}>{prof.email}</td>
                                        <td style={{ padding: 'var(--space-md)' }}>
                                            <span className={`badge ${prof.role === 'admin' ? 'badge-primary' : ''}`}>
                                                {prof.role}
                                            </span>
                                        </td>
                                        <td style={{ padding: 'var(--space-md)' }}>
                                            <span className={`badge ${prof.ativo ? 'badge-success' : 'badge-danger'}`}>
                                                {prof.ativo ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td style={{ padding: 'var(--space-md)' }}>
                                            <button
                                                onClick={() => handleOpenEditModal(prof)}
                                                className="btn btn-secondary"
                                                style={{ padding: 'var(--space-xs) var(--space-sm)', fontSize: 'var(--text-sm)' }}
                                            >
                                                Edit
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Add Staff Modal */}
            {showAddModal && (
                <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Add Staff Member</h3>
                        </div>
                        <form onSubmit={handleAddStaff}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="nome">Name *</label>
                                    <input
                                        id="nome"
                                        type="text"
                                        className="input"
                                        value={newStaff.nome}
                                        onChange={(e) => setNewStaff({ ...newStaff, nome: e.target.value })}
                                        placeholder="Enter staff name"
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="email">Email *</label>
                                    <input
                                        id="email"
                                        type="email"
                                        className="input"
                                        value={newStaff.email}
                                        onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                                        placeholder="staff@example.com"
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="role">Role</label>
                                    <select
                                        id="role"
                                        className="input"
                                        value={newStaff.role}
                                        onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                                    >
                                        <option value="profissional">Professional</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="area">Área *</label>
                                    <select
                                        id="area"
                                        className="input"
                                        value={newStaff.area_id}
                                        onChange={(e) => setNewStaff({ ...newStaff, area_id: e.target.value })}
                                        required
                                    >
                                        <option value="">Selecione uma área</option>
                                        {areas.map(area => (
                                            <option key={area.id} value={area.id}>
                                                {area.nome}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="input-group">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <input
                                            type="checkbox"
                                            checked={newStaff.ativo}
                                            onChange={(e) => setNewStaff({ ...newStaff, ativo: e.target.checked })}
                                        />
                                        Active
                                    </label>
                                </div>

                                <div style={{
                                    padding: 'var(--space-md)',
                                    backgroundColor: 'var(--color-bg-subtle)',
                                    borderRadius: 'var(--radius-md)',
                                    marginTop: 'var(--space-md)'
                                }}>
                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', margin: 0 }}>
                                        <strong>Note:</strong> Staff member will need to sign up with this email address to access the system.
                                    </p>
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowAddModal(false)}
                                    className="btn btn-secondary"
                                    disabled={creating}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={creating}
                                >
                                    {creating ? 'Adding...' : 'Add Staff'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Edit Staff Modal */}
            {showEditModal && editingStaff && (
                <div className="modal-backdrop" onClick={() => setShowEditModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Edit Staff Member</h3>
                        </div>
                        <form onSubmit={handleUpdateStaff}>
                            <div className="modal-body">
                                <div className="input-group">
                                    <label htmlFor="edit-nome">Name *</label>
                                    <input
                                        id="edit-nome"
                                        type="text"
                                        className="input"
                                        value={editStaff.nome}
                                        onChange={(e) => setEditStaff({ ...editStaff, nome: e.target.value })}
                                        placeholder="Enter staff name"
                                        required
                                    />
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-email">Email (Read-only)</label>
                                    <input
                                        id="edit-email"
                                        type="email"
                                        className="input"
                                        value={editingStaff.email}
                                        disabled
                                        style={{ backgroundColor: 'var(--color-bg-subtle)', cursor: 'not-allowed' }}
                                    />
                                    <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-xs)' }}>
                                        Email cannot be changed for security reasons
                                    </p>
                                </div>

                                <div className="input-group">
                                    <label htmlFor="edit-role">Role</label>
                                    <select
                                        id="edit-role"
                                        className="input"
                                        value={editStaff.role}
                                        onChange={(e) => setEditStaff({ ...editStaff, role: e.target.value })}
                                    >
                                        <option value="profissional">Professional</option>
                                        <option value="admin">Admin</option>
                                    </select>
                                    {editStaff.role !== editingStaff.role && (
                                        <p style={{ fontSize: 'var(--text-sm)', color: '#ff9500', marginTop: 'var(--space-xs)' }}>
                                            ⚠️ Role change will affect access permissions
                                        </p>
                                    )}
                                </div>

                                <div className="input-group">
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)' }}>
                                        <input
                                            type="checkbox"
                                            checked={editStaff.ativo}
                                            onChange={(e) => setEditStaff({ ...editStaff, ativo: e.target.checked })}
                                        />
                                        Active
                                    </label>
                                    {!editStaff.ativo && editingStaff.ativo && (
                                        <p style={{ fontSize: 'var(--text-sm)', color: '#ff3b30', marginTop: 'var(--space-xs)' }}>
                                            ⚠️ Deactivating will immediately log out this user
                                        </p>
                                    )}
                                </div>
                            </div>

                            <div className="modal-footer">
                                <button
                                    type="button"
                                    onClick={() => setShowEditModal(false)}
                                    className="btn btn-secondary"
                                    disabled={updating}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    disabled={updating}
                                >
                                    {updating ? 'Updating...' : 'Update Staff'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

export default Professionals
