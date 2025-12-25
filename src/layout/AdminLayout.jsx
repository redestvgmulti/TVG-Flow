import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import PullToRefresh from '../components/PullToRefresh'

function AdminLayout() {
    const { role } = useAuth()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    // Staff role should not have access to mobile sidebar
    const isStaff = role === 'profissional'

    const handleMobileMenuToggle = () => {
        if (isStaff) return
        setMobileMenuOpen(!mobileMenuOpen)
    }

    return (
        <div className="admin-layout">
            <Sidebar
                mobileMenuOpen={mobileMenuOpen}
                onClose={() => setMobileMenuOpen(false)}
            />

            <div className="admin-main">
                <Header
                    onMobileMenuToggle={handleMobileMenuToggle}
                    mobileMenuOpen={mobileMenuOpen}
                    hideMobileMenu={isStaff}
                />

                <PullToRefresh className="admin-content">
                    <Outlet />
                </PullToRefresh>
            </div>

            <BottomNav />
        </div>
    )
}

export default AdminLayout
