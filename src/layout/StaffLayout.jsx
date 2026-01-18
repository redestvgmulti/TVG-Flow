import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
import FloatingActionButton from './FloatingActionButton'
import PullToRefresh from '../components/PullToRefresh'
import ErrorBoundary from '../components/ErrorBoundary'

/**
 * STAFF LAYOUT
 * 
 * Layout for Staff users.
 * - Sidebar enabled for Desktop experience
 * - BottomNav for Mobile experience
 */
function StaffLayout() {
    const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false)



    return (
        <div className="admin-layout">
            <ErrorBoundary>
                <Sidebar
                    mobileMenuOpen={mobileMenuOpen}
                    onClose={() => setMobileMenuOpen(false)}
                />
            </ErrorBoundary>

            <div className="admin-main">
                <Header
                    hideMobileMenu={false}
                    onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
                    mobileMenuOpen={mobileMenuOpen}
                />

                <PullToRefresh className="admin-content">
                    <ErrorBoundary>
                        <Outlet />
                    </ErrorBoundary>
                </PullToRefresh>
            </div>

            {/* FAB for primary action (mobile only) */}
            <FloatingActionButton />

            {/* BottomNav for mobile task navigation */}
            <BottomNav />
        </div>
    )
}

export default StaffLayout
