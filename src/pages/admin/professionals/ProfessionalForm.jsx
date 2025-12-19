
import { useState, useEffect } from 'react'
import {
    User, Mail, Lock, Shield, Building2, CheckCircle, AlertTriangle, Save, X
} from 'lucide-react'
import { supabase } from '../../../services/supabase'

export default function ProfessionalForm({ initialData, onSubmit, onCancel, onDelete, isSubmitting, isEditMode = false, hideCancelButton = false }) {
    const [formData, setFormData] = useState({
        nome: '',
        email: '',
        // password removed - handled via email invite
        role: 'profissional',
        area_id: '',
        ativo: true
    })

    const [areas, setAreas] = useState([])

    useEffect(() => {
        if (initialData) {
            setFormData(prev => ({
                ...prev,
                ...initialData
            }))
        }
        fetchAreas()
    }, [initialData])

    async function fetchAreas() {
        try {
            const { data } = await supabase
                .from('areas')
                .select('id, nome')
                .eq('ativo', true)
                .order('nome')
            if (data) setAreas(data)
        } catch (err) {
            console.error('Error loading areas', err)
        }
    }

    const handleSubmit = (e) => {
        e.preventDefault()

        // Remove 'areas' object (join result) and ensure only updatable fields are sent
        const payload = {
            nome: formData.nome,
            email: formData.email,
            role: formData.role,
            area_id: formData.area_id,
            ativo: formData.ativo
        }

        onSubmit(payload)
    }

    return (
        <form onSubmit={handleSubmit} className="modal-detail-rows">
            {/* Nome */}
            <div className="form-group">
                <label>Nome Completo</label>
                <div style={{ position: 'relative' }}>
                    <User size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                        type="text"
                        required
                        className="input"
                        style={{ paddingLeft: '40px' }}
                        placeholder="Ex: Ana Silva"
                        value={formData.nome}
                        onChange={e => setFormData({ ...formData, nome: e.target.value })}
                    />
                </div>
            </div>

            {/* Email */}
            <div className="form-group">
                <label>E-mail Corporativo</label>
                <div style={{ position: 'relative' }}>
                    <Mail size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                    <input
                        type="email"
                        required
                        disabled={isEditMode}
                        className="input"
                        style={{ paddingLeft: '40px', backgroundColor: isEditMode ? '#f8fafc' : '#fff', color: isEditMode ? '#64748b' : 'inherit' }}
                        placeholder="ana@tvg.com"
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                    />
                </div>
                {isEditMode && <span className="text-sm text-muted">O e-mail não pode ser alterado.</span>}
            </div>

            {/* Senha - Messsage */}
            {!isEditMode && (
                <div style={{ padding: '16px', backgroundColor: '#eff6ff', border: '1px solid #dbeafe', borderRadius: '8px', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                    <Mail size={20} className="text-primary" style={{ marginTop: '4px' }} />
                    <div>
                        <p style={{ fontWeight: 600, color: '#1e3a8a', fontSize: '14px', marginBottom: '4px' }}>Convite por E-mail</p>
                        <p style={{ fontSize: '13px', color: '#1d4ed8', margin: 0 }}>
                            O funcionário receberá um e-mail com instruções para definir sua própria senha de acesso segura.
                        </p>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                {/* Role */}
                <div className="form-group">
                    <label>Função / Perfil</label>
                    <div style={{ position: 'relative' }}>
                        <Shield size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <select
                            className="input"
                            style={{ paddingLeft: '40px' }}
                            value={formData.role}
                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                        >
                            <option value="profissional">Profissional</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </div>
                    {isEditMode && formData.role !== initialData?.role && (
                        <p style={{ fontSize: '12px', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                            <AlertTriangle size={12} /> Alterar o perfil muda as permissões.
                        </p>
                    )}
                </div>

                {/* Area */}
                <div className="form-group">
                    <label>Departamento</label>
                    <div style={{ position: 'relative' }}>
                        <Building2 size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                        <select
                            required
                            className="input"
                            style={{ paddingLeft: '40px' }}
                            value={formData.area_id || ''}
                            onChange={e => setFormData({ ...formData, area_id: e.target.value })}
                        >
                            <option value="">Selecione...</option>
                            {areas.map(area => (
                                <option key={area.id} value={area.id}>{area.nome}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Ativo Checkbox */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <input
                    type="checkbox"
                    id="active-check"
                    style={{ width: '20px', height: '20px', accentColor: 'var(--color-primary)' }}
                    checked={formData.ativo}
                    onChange={e => setFormData({ ...formData, ativo: e.target.checked })}
                />
                <label htmlFor="active-check" style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer', margin: 0 }}>
                    <span style={{ fontWeight: 500, color: '#334155' }}>Usuário Ativo</span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>Desmarcar impedirá o login imediatamente.</span>
                </label>
            </div>

            {/* Actions Footer - Custom for Modal */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: isEditMode ? 'space-between' : 'flex-end', paddingTop: '16px', borderTop: '1px solid #f1f5f9', marginTop: '8px' }}>
                {isEditMode ? (
                    <button
                        type="button"
                        onClick={onDelete}
                        className="btn btn-ghost"
                        style={{ color: '#ef4444' }}
                        disabled={isSubmitting}
                    >
                        <AlertTriangle size={18} />
                        Excluir
                    </button>
                ) : <div />}

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {!hideCancelButton && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="btn btn-secondary"
                            disabled={isSubmitting}
                        >
                            Cancelar
                        </button>
                    )}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="btn btn-primary"
                    >
                        {isSubmitting ? (
                            <>Salvando...</>
                        ) : (
                            <>
                                <Save size={18} />
                                {isEditMode ? 'Salvar' : 'Criar Profissional'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </form>
    )
}
