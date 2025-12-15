import React from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import '../../components/dashboard/DashboardHeader.css'; // Reusing header styles

const Profile = () => {
    const { user, profile, signOut } = useAuth();

    const handleLogout = async () => {
        try {
            await signOut();
        } catch (error) {
            console.error('Erro ao sair:', error);
        }
    };

    return (
        <div className="admin-dashboard">
            <header className="dashboard-header">
                <div className="dashboard-header-content">
                    <div>
                        <h1 className="text-xl font-bold text-slate-800">Meu Perfil</h1>
                        <p className="text-sm text-slate-500">Gerencie suas informações</p>
                    </div>
                </div>
            </header>

            <main className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
                <Card glass className="p-6">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-2xl">
                            👤
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">{profile?.nome || 'Usuário'}</h2>
                            <p className="text-slate-500">{profile?.email || user?.email}</p>
                            <span className="inline-block mt-1 px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium capitalize">
                                {profile?.role || 'Profissional'}
                            </span>
                        </div>
                    </div>

                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <label className="text-xs font-semibold text-slate-400 uppercase">Departamento</label>
                                <p className="text-slate-700 font-medium">
                                    {profile?.departamento?.nome || 'Não atribuído'}
                                </p>
                            </div>
                            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                                <label className="text-xs font-semibold text-slate-400 uppercase">ID do Usuário</label>
                                <p className="text-slate-700 font-medium text-sm font-mono truncate">
                                    {user?.id}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="mt-8 pt-6 border-t border-slate-100">
                        <Button
                            variant="danger"
                            onClick={handleLogout}
                            className="w-full md:w-auto"
                        >
                            Sair do Sistema
                        </Button>
                    </div>
                </Card>
            </main>
        </div>
    );
};

export default Profile;
