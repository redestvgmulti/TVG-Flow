import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

export default function SuperAdminRoute({ children }) {
    const { role, loading } = useAuth()

    if (loading) {
        return <div className="loading-screen">Carregando...</div>
    }

    if (role !== 'super_admin') {
        return <Navigate to="/" replace />
    }

    return children
}
