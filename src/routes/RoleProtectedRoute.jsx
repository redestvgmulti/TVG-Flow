import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

function RoleProtectedRoute({ children, allowedRole }) {
    const { user, loading, role } = useAuth()

    if (loading) {
        return null
    }

    if (!user) {
        return <Navigate to="/login" replace />
    }

    if (role !== allowedRole) {
        // Redirect to correct dashboard based on role
        if (role === 'admin') {
            return <Navigate to="/admin" replace />
        }
        if (role === 'profissional') {
            return <Navigate to="/staff/dashboard" replace />
        }
        // If no role, redirect to login
        return <Navigate to="/login" replace />
    }

    return children
}

export default RoleProtectedRoute
