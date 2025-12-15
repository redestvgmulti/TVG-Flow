import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';

// Auth Pages
import Login from '../pages/auth/Login';

// Admin Pages
import AdminDashboard from '../pages/admin/Dashboard';
import Profissionais from '../pages/admin/Profissionais';
import Departamentos from '../pages/admin/Departamentos';
import Clientes from '../pages/admin/Clientes';
import Tarefas from '../pages/admin/Tarefas';
import Calendario from '../pages/admin/Calendario';

// Profissional Pages
import ProfissionalDashboard from '../pages/profissional/Dashboard';
import MinhasTarefas from '../pages/profissional/MinhasTarefas';
import ProfissionalCalendario from '../pages/profissional/Calendario';
// Profissional Pages
import ProfissionalDashboard from '../pages/profissional/Dashboard';
import MinhasTarefas from '../pages/profissional/MinhasTarefas';
import ProfissionalCalendario from '../pages/profissional/Calendario';

// Common Pages
import Profile from '../pages/common/Profile';
export const AppRoutes = () => {
    return (
        <Routes>
            {/* Rota pública */}
            <Route path="/login" element={<Login />} />

            {/* Rotas Admin */}
            <Route
                path="/admin"
                element={
                    <ProtectedRoute adminOnly>
                        <AdminDashboard />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/profissionais"
                element={
                    <ProtectedRoute adminOnly>
                        <Profissionais />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/departamentos"
                element={
                    <ProtectedRoute adminOnly>
                        <Departamentos />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/clientes"
                element={
                    <ProtectedRoute adminOnly>
                        <Clientes />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/tarefas"
                element={
                    <ProtectedRoute adminOnly>
                        <Tarefas />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/calendario"
                element={
                    <ProtectedRoute adminOnly>
                        <Calendario />
                    </ProtectedRoute>
                }
            />

            {/* Rotas Profissional */}
            <Route
                path="/profissional"
                element={
                    <ProtectedRoute>
                        <ProfissionalDashboard />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/profissional/tarefas"
                element={
                    <ProtectedRoute>
                        <MinhasTarefas />
                    </ProtectedRoute>
                }
            />
            <Route
                path="/profissional/calendario"
                element={
                    <ProtectedRoute>
                        <ProfissionalCalendario />
                    </ProtectedRoute>
                }
            />

            {/* Rota Comum - Perfil */}
            <Route
                path="/perfil"
                element={
                    <ProtectedRoute>
                        <Profile />
                    </ProtectedRoute>
                }
            />

            {/* Redirect padrão */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
};
