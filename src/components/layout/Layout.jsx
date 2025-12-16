import React, { useState } from 'react';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
// import './Layout.css';
import { useLocation } from 'react-router-dom';

const Layout = ({ children }) => {
    // We could add state for a mobile menu drawer here if needed
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const location = useLocation();

    // Determine if we should show the full layout or just the content
    // For now, we assume this layout is used for all protected routes

    return (
        <div className="app-layout">
            <Sidebar />

            <main className="main-content">
                <div className="content-wrapper">
                    {children}
                </div>
            </main>

            <BottomNav onMenuClick={() => setIsMenuOpen(true)} />

            {/* Mobile Menu Drawer could go here */}
            {isMenuOpen && (
                <div className="mobile-menu-overlay" onClick={() => setIsMenuOpen(false)}>
                    <div className="mobile-menu-drawer" onClick={e => e.stopPropagation()}>
                        {/* Reusing Sidebar content Logic or a simplified menu list */}
                        <h2>Menu</h2>
                        {/* Implementation of full mobile menu drawer would be next step */}
                        <Sidebar />
                    </div>
                </div>
            )}
        </div>
    );
};

export default Layout;
