import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export const ProtectedRoute = ({ children, adminOnly = false }) => {
    const { user, profile, loading } = useAuth();

    if (loading) {
        return (
            <div className="flex items-center justify-center">
                <div className="spin"></div>
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
