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

    // Wait for role to be loaded before making routing decisions
    // If user exists but role is still null, we're still loading professional data
    if (user && role === null) {
        return null // Show nothing while loading role
    }

    if (role !== allowedRole) {
        // Redirect to correct dashboard based on role
        if (role === 'admin') {
            return <Navigate to="/admin" replace />
        }
        if (role === 'profissional') {
            return <Navigate to="/staff/dashboard" replace />
        }
        // If role is loaded but doesn't match anything, redirect to login
        return <Navigate to="/login" replace />
    }

    return children
}

export default RoleProtectedRoute
