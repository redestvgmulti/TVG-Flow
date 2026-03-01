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

    // Normalize to array
    const rolesToCheck = Array.isArray(allowedRole) ? allowedRole : [allowedRole]

    // Allow 'profissional' role to access 'staff' routes
    // This fixes the blank screen for users with 'profissional' role
    const isAllowed = rolesToCheck.includes(role) || (rolesToCheck.includes('staff') && role === 'profissional')

    if (!isAllowed) {


        // Explicit handling for ALL roles - no ambiguity
        if (role === 'super_admin') {
            return <Navigate to="/platform" replace />
        }
        if (role === 'admin') {
            return <Navigate to="/admin" replace />
        }
        if (role === 'staff' || role === 'profissional') {
            // Check if we are already at the target to prevent loops
            // BUT: Since we defined isAllowed to include this case, we won't enter this block for staff/profissional mismatch anymore.
            // The only case entering here is if role is something else entirely (e.g. 'user'??) trying to access staff.

            // If I am staff/professional, I should go to staff dashboard.
            return <Navigate to="/staff/dashboard" replace />
        }
        // Only redirect to login if role is completely unknown
        return <Navigate to="/login" replace />
    }


    return children
}

export default RoleProtectedRoute
