import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AccountBlockedScreen from '../components/AccountBlockedScreen'

function ProtectedRoute({ children }) {
    const { user, loading, accountStatus, connectionStatus } = useAuth()

    // NUCLEAR OPTION: NO MORE LOADING SCREEN
    // Let the dashboard render immediately and handle its own loading states
    // This prevents the infinite "Carregando Sistema..." issue

    // RESTORED: Loading check is required for persistence
    // Without this, refresh redirects to login immediately (before auth init)
    // Wait for session check to complete (Phase 1 only)
    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 flex-col gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <div className="text-gray-500 font-medium">Iniciando Sistema...</div>
            </div>
        )
    }

    if (!user) {
        return <Navigate to="/login" replace />
    }

    // Mostrar tela de bloqueio para contas inativas/suspensas ou problemas de conexão
    if (accountStatus === 'inactive' || accountStatus === 'suspended') {
        return <AccountBlockedScreen status={accountStatus} />
    }

    // Mostrar tela de conexão se offline/reconectando
    if (connectionStatus === 'offline' || connectionStatus === 'reconnecting') {
        return <AccountBlockedScreen status={connectionStatus} />
    }

    return children
}

export default ProtectedRoute

