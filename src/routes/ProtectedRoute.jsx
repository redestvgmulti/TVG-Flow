import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AccountBlockedScreen from '../components/AccountBlockedScreen'

function ProtectedRoute({ children }) {
    const { user, loading, accountStatus, connectionStatus, authStatus } = useAuth()

    // PHASE 1: Wait for initial session bootstrap
    if (loading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 flex-col gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <div className="text-gray-500 font-medium">Iniciando Sistema...</div>
            </div>
        )
    }

    // 🔐 CRITICAL FIX: Wait for auth decision to complete
    // Don't redirect during boot - only redirect when definitively unauthenticated
    if (authStatus === 'booting') {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 flex-col gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <div className="text-gray-500 font-medium">Recuperando sessão...</div>
            </div>
        )
    }

    // 🔐 ONLY redirect when definitively unauthenticated
    if (authStatus === 'unauthenticated' || !user) {
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
