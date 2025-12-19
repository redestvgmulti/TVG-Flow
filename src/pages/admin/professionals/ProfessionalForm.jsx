
import { useState, useEffect } from 'react'
import {
    User, Mail, Lock, Shield, Building2, CheckCircle, AlertTriangle, Save, X
} from 'lucide-react'
import { supabase } from '../../../services/supabase'

export default function ProfessionalForm({ initialData, onSubmit, onCancel, isSubmitting, isEditMode = false }) {
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
        onSubmit(formData)
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Nome */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Nome Completo</label>
                    <div className="relative">
                        <User className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="text"
                            required
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all"
                            placeholder="Ex: Ana Silva"
                            value={formData.nome}
                            onChange={e => setFormData({ ...formData, nome: e.target.value })}
                        />
                    </div>
                </div>

                {/* Email */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">E-mail Corporativo</label>
                    <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <input
                            type="email"
                            required
                            disabled={isEditMode}
                            className={`w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 outline-none transition-all ${isEditMode ? 'bg-slate-50 text-slate-500 cursor-not-allowed' : 'focus:border-blue-500 focus:ring-1 focus:ring-blue-500'
                                }`}
                            placeholder="ana@tvg.com"
                            value={formData.email}
                            onChange={e => setFormData({ ...formData, email: e.target.value })}
                        />
                    </div>
                    {isEditMode && <span className="text-xs text-slate-400">O e-mail não pode ser alterado.</span>}
                </div>

                {/* Senha - REMOVIDO (Fluxo de Convite) */}
                {!isEditMode && (
                    <div className="col-span-1 md:col-span-2 p-4 bg-blue-50 border border-blue-100 rounded-lg flex items-start gap-3">
                        <Mail className="text-blue-600 mt-1 shrink-0" size={20} />
                        <div>
                            <p className="font-semibold text-blue-900 text-sm">Convite por E-mail</p>
                            <p className="text-sm text-blue-700 leading-relaxed mt-0.5">
                                O funcionário receberá um e-mail com instruções para definir sua própria senha de acesso segura.
                            </p>
                        </div>
                    </div>
                )}

                {/* Role */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Função / Perfil</label>
                    <div className="relative">
                        <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <select
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all appearance-none bg-white"
                            value={formData.role}
                            onChange={e => setFormData({ ...formData, role: e.target.value })}
                        >
                            <option value="profissional">Profissional</option>
                            <option value="admin">Administrador</option>
                        </select>
                    </div>
                    {isEditMode && formData.role !== initialData?.role && (
                        <p className="text-xs text-orange-500 flex items-center gap-1 mt-1">
                            <AlertTriangle size={12} /> Alterar o perfil muda as permissões de acesso.
                        </p>
                    )}
                </div>

                {/* Area */}
                <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700">Departamento / Área</label>
                    <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                        <select
                            required
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none transition-all appearance-none bg-white"
                            value={formData.area_id || ''}
                            onChange={e => setFormData({ ...formData, area_id: e.target.value })}
                        >
                            <option value="">Selecione uma área...</option>
                            {areas.map(area => (
                                <option key={area.id} value={area.id}>{area.nome}</option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Ativo Checkbox */}
            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-lg border border-slate-100">
                <input
                    type="checkbox"
                    id="active-check"
                    className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500 border-gray-300"
                    checked={formData.ativo}
                    onChange={e => setFormData({ ...formData, ativo: e.target.checked })}
                />
                <label htmlFor="active-check" className="flex flex-col cursor-pointer">
                    <span className="font-medium text-slate-700">Usuário Ativo</span>
                    <span className="text-xs text-slate-500">Desmarcar impedirá o login imediatamente.</span>
                </label>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2"
                    disabled={isSubmitting}
                >
                    <X size={18} />
                    Cancelar
                </button>
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center gap-2 shadow-sm shadow-blue-200"
                >
                    {isSubmitting ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Salvando...
                        </>
                    ) : (
                        <>
                            <Save size={18} />
                            {isEditMode ? 'Salvar Alterações' : 'Criar Profissional'}
                        </>
                    )}
                </button>
            </div>
        </form>
    )
}
