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
        return (
            <div className="flex items-center justify-center h-screen bg-gray-50 flex-col gap-4">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
            </div>
        )
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
