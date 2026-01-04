import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AccountBlockedScreen from '../components/AccountBlockedScreen'

function ProtectedRoute({ children }) {
    const { user, loading, accountStatus, connectionStatus } = useAuth()

    console.log('ProtectedRoute: loading=', loading, 'user=', user?.email)

    if (loading) {
        return <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: '100vh',
            color: '#000',
            fontSize: '24px'
        }}>
            Carregando Sistema... (Estado: {accountStatus})
        </div>
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

