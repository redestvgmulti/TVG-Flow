import { useAuth } from '../contexts/AuthContext'

function Header() {
    const { user, signOut } = useAuth()

    return (
        <header className="admin-header">
            <h1>Admin Dashboard</h1>

            <div className="header-actions">
                <span>{user?.email}</span>
                <button onClick={signOut} className="form-button">
                    Sign Out
                </button>
            </div>
        </header>
    )
}

export default Header
