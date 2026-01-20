import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AccountBlockedScreen from '../components/AccountBlockedScreen'

function ProtectedRoute({ children }) {
    const { user, loading, accountStatus, connectionStatus, authStatus } = useAuth()

    // 🎯 CRITICAL UX FIX: Aligned with CityOS behavior
    // During boot (loading or authStatus='booting'), return null instead of LoadingScreen.
    // This allows the router to immediately render /login if no session exists,
    // eliminating intermediate "ghost" loading screens in iOS PWA.
    // The App.jsx routing will handle showing Login screen directly.
    if (loading || authStatus === 'booting') {
        return null
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
