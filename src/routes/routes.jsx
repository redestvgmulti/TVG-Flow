import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './ProtectedRoute';
import Layout from '../components/layout/Layout';

// Auth Pages
import Login from '../pages/auth/Login';

// Admin Pages
import AdminDashboard from '../pages/admin/Dashboard';
import Profissionais from '../pages/admin/Profissionais';
import Departamentos from '../pages/admin/Departamentos';
import Clientes from '../pages/admin/Clientes';
import Tarefas from '../pages/admin/Tarefas';
import Calendario from '../pages/admin/Calendario';
import Relatorios from '../pages/admin/Relatorios';

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
                        <Layout>
                            <AdminDashboard />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/profissionais"
                element={
                    <ProtectedRoute adminOnly>
                        <Layout>
                            <Profissionais />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/departamentos"
                element={
                    <ProtectedRoute adminOnly>
                        <Layout>
                            <Departamentos />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/clientes"
                element={
                    <ProtectedRoute adminOnly>
                        <Layout>
                            <Clientes />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/tarefas"
                element={
                    <ProtectedRoute adminOnly>
                        <Layout>
                            <Tarefas />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/calendario"
                element={
                    <ProtectedRoute adminOnly>
                        <Layout>
                            <Calendario />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/admin/relatorios"
                element={
                    <ProtectedRoute adminOnly>
                        <Layout>
                            <Relatorios />
                        </Layout>
                    </ProtectedRoute>
                }
            />

            {/* Rotas Profissional */}
            <Route
                path="/profissional"
                element={
                    <ProtectedRoute>
                        <Layout>
                            <ProfissionalDashboard />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/profissional/tarefas"
                element={
                    <ProtectedRoute>
                        <Layout>
                            <MinhasTarefas />
                        </Layout>
                    </ProtectedRoute>
                }
            />
            <Route
                path="/profissional/calendario"
                element={
                    <ProtectedRoute>
                        <Layout>
                            <ProfissionalCalendario />
                        </Layout>
                    </ProtectedRoute>
                }
            />

            {/* Rota Comum - Perfil */}
            <Route
                path="/perfil"
                element={
                    <ProtectedRoute>
                        <Layout>
                            <Profile />
                        </Layout>
                    </ProtectedRoute>
                }
            />

            {/* Redirect padrão */}
            <Route path="/" element={<Navigate to="/login" replace />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
};
