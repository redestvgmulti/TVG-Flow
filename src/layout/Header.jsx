import { useAuth } from '../contexts/AuthContext'
import NotificationCenter from '../components/NotificationCenter'

function Header() {
    const { user, signOut } = useAuth()

    return (
        <header className="admin-header">
            <h1>Admin Dashboard</h1>

            <div className="header-actions">
                <NotificationCenter />
                <span>{user?.email}</span>
                <button onClick={signOut} className="form-button">
                    Sign Out
                </button>
            </div>
        </header>
    )
}

export default Header
