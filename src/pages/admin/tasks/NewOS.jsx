import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import TaskForm from '../../../components/forms/TaskForm'
import { useAuth } from '../../../contexts/AuthContext'
import { usePermission } from '../../../hooks/usePermission'
import '../../../styles/admin-forms.css'

export default function NewOS() {
    const navigate = useNavigate()
    const { role, loading: authLoading } = useAuth()
    const { isSuperAdmin, isStaff, isAdmin, checkCreateOS } = usePermission()
    const [permissionChecked, setPermissionChecked] = useState(false)
    const [canPerformAction, setCanPerformAction] = useState(false)
    const [checkError, setCheckError] = useState(null)

    useEffect(() => {
        // Run permission check once auth is ready
        if (!authLoading && role) {
            async function validateAccess() {
                // If implicit role check fails, block immediately
                if (isSuperAdmin()) {
                    setCanPerformAction(false) // Super admin never creates OS
                    setPermissionChecked(true)
                    return
                }

                if (isStaff()) {
                    // Start simple: Staff logic - usually simple OS only.
                    // But here we block general access and force them to specific route if needed.
                    // For now, based on user request: "Execution Plane Only"
                    setCanPerformAction(false)
                    setPermissionChecked(true)
                    return
                }

                // For Admin, we must validate via Backend RPC too (defensive)
                // However, without a selected Tenant/Client at this stage (this is just the page load),
                // we rely on the Role for PAGE ACCESS, and the Form will validate specific Tenant/Client later.
                // UNLESS we want to pre-validate if they have ANY active tenant link? 

                // User instruction: "NewOS.jsx ... Remove client-side validation... Use canCreateOS..."
                // Since this is the initial page load, we allow access if Admin, 
                // but the form submission will be strictly gated by checkCreateOS(tenant, client).

                if (isAdmin()) {
                    setCanPerformAction(true)
                } else {
                    setCanPerformAction(false)
                }
                setPermissionChecked(true)
            }
            validateAccess()
        }
    }, [authLoading, role, isSuperAdmin, isStaff, isAdmin])

    if (authLoading || !permissionChecked) {
        return <div className="p-8 text-center text-secondary">Verificando permissões...</div>
    }

    // 🔒 RBAC CANONICAL CHECK
    // Source: public.profissionais.role via usePermission hook

    // 1. Super Admin: CONTROL PLANE ONLY (Never creates OS)
    if (isSuperAdmin()) {
        return (
            <div className="admin-page-container">
                <div className="flex flex-col items-center justify-center h-[50vh] text-center p-8">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-primary mb-2">Acesso Restrito: Super Admin</h2>
                    <p className="text-secondary max-w-md">
                        Super Admins operam no <strong>Control Plane</strong> e não devem criar ordens de serviço operacionais.
                        <br /><br />
                        Se você precisa gerenciar esta empresa, atribua o papel de <strong>Admin</strong> ao seu usuário nesta empresa.
                    </p>
                    <button onClick={() => navigate('/admin')} className="mt-6 admin-back-btn w-auto px-6">
                        Voltar ao Dashboard
                    </button>
                </div>
            </div>
        )
    }

    // 2. Staff: EXECUTION PLANE ONLY (Never creates OS directly via this route)
    if (isStaff()) {
        return (
            <div className="admin-page-container">
                <div className="flex flex-col items-center justify-center h-[50vh] text-center p-8">
                    <ShieldAlert size={48} className="text-orange-500 mb-4" />
                    <h2 className="text-xl font-bold text-primary mb-2">Acesso Negado</h2>
                    <p className="text-secondary">
                        Seu perfil ({role}) não tem permissão para criar novas Ordens de Serviço nesta interface.
                    </p>
                    <button onClick={() => navigate('/admin')} className="mt-6 admin-back-btn w-auto px-6">
                        Voltar
                    </button>
                </div>
            </div>
        )
    }

    // 3. Fallback for unknown states or implicit denials
    if (!isAdmin()) {
        return (
            <div className="admin-page-container">
                <div className="flex flex-col items-center justify-center h-[50vh] text-center p-8">
                    <ShieldAlert size={48} className="text-red-500 mb-4" />
                    <h2 className="text-xl font-bold text-primary mb-2">Erro de Permissão</h2>
                    <p className="text-secondary">
                        Não foi possível validar suas credenciais para esta operação.
                    </p>
                </div>
            </div>
        )
    }

    return (
        <div className="admin-page-container">
            {/* Header */}
            <div className="admin-page-header">
                <button
                    onClick={() => navigate('/admin')}
                    className="admin-back-btn"
                    title="Voltar"
                >
                    <ArrowLeft size={24} strokeWidth={2} />
                </button>
                <div className="admin-page-title-group">
                    <h2 className="admin-page-title">
                        Nova Ordem de Serviço
                    </h2>
                    <p className="admin-page-subtitle">
                        Preencha os dados e definições da demanda
                    </p>
                </div>
            </div>

            <div className="card">
                <TaskForm
                    onSuccess={(result) => {
                        // Optional: Navigate to detail of first created task if possible, 
                        // or just back to list with success toast (already handled by form)
                        navigate('/admin/tasks')
                    }}
                    onCancel={() => navigate('/admin/tasks')}
                />
            </div>
        </div>
    )
}
