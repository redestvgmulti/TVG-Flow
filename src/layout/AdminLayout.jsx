import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import PullToRefresh from '../components/PullToRefresh'

function AdminLayout() {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    const handleMobileMenuToggle = () => {
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
