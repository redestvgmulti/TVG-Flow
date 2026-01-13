import React from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import BottomNav from './BottomNav'
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

    console.log('[StaffLayout] Rendering layout')

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
                    onMenuClick={() => setMobileMenuOpen(true)}
                />

                <PullToRefresh className="admin-content">
                    <ErrorBoundary>
                        <Outlet />
                    </ErrorBoundary>
                </PullToRefresh>
            </div>

            {/* BottomNav for mobile task navigation */}
            <BottomNav />
        </div>
    )
}

export default StaffLayout
