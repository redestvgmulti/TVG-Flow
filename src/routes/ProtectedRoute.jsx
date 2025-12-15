import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute = ({ children, adminOnly = false }) => {
    const { user, profile, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex items-center justify-center" style={{ minHeight: '100vh' }}>
                <div className="spin" style={{
                    width: '48px',
                    height: '48px',
                    border: '4px solid var(--neutral-200)',
                    borderTop: '4px solid var(--primary-600)',
                    borderRadius: '50%'
                }}></div>
            </div>
        );
    }

    if (!user) {
        return <Navigate to="/login" replace />;
    }

    if (adminOnly && profile?.role !== 'admin') {
        return <Navigate to="/profissional" replace />;
    }

    return children;
};
