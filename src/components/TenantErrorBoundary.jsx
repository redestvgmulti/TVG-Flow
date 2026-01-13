import React from 'react';
import { AlertCircle, LogOut } from 'lucide-react';
import { supabase } from '../services/supabase';

class TenantErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        // You can also log the error to an error reporting service
        console.error("TenantErrorBoundary caught an error:", error, errorInfo);
    }

    handleLogout = async () => {
        try {
            await supabase.auth.signOut();
            window.location.href = '/login';
        } catch (error) {
            console.error('Error signing out:', error);
            // Force reload if signout fails
            window.location.href = '/login';
        }
    };

    render() {
        if (this.state.hasError) {
            // Check if it's the specific tenant error or a general one
            const isTenantError = this.state.error?.message?.includes('CRITICAL_INTEGRITY_VIOLATION') ||
                this.state.error?.message?.includes('ADMIN_NO_TENANT') ||
                this.state.error?.message?.includes('NO_COMPANY_ACCESS') ||
                this.state.error?.message?.includes('TENANT_LINK_REQUIRED');

            // Handling all for now in this specific boundary to catch everything
            if (isTenantError || true) {
                return (
                    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-50 p-6">
                        <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full border-l-4 border-red-500 ring-1 ring-slate-900/5">
                            <div className="flex flex-col items-center text-center">
                                <div className="bg-red-50 p-4 rounded-full mb-6">
                                    <AlertCircle size={40} className="text-red-600" />
                                </div>

                                <h2 className="text-2xl font-bold text-slate-800 mb-2">
                                    Acesso Bloqueado
                                </h2>

                                <div className="text-slate-600 mb-8 leading-relaxed">
                                    <p className="font-semibold text-lg mb-2">
                                        {isTenantError ? 'Usuário sem vínculo empresarial' : 'Erro na aplicação'}
                                    </p>
                                    <p>
                                        {isTenantError
                                            ? (this.state.error?.message?.includes('NO_COMPANY_ACCESS')
                                                ? 'Seu usuário não possui vínculo com nenhuma empresa ativa. Contate seu administrador.'
                                                : 'Seu usuário administrador está sem vínculo com uma empresa matriz (Tenant). Por motivos de segurança, o acesso foi interrompido.')
                                            : 'Ocorreu um erro inesperado que impediu o carregamento da tela.'}
                                    </p>
                                </div>

                                <div className="w-full space-y-3">
                                    <button
                                        onClick={this.handleLogout}
                                        className="btn bg-red-600 hover:bg-red-700 text-white w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-all"
                                    >
                                        <LogOut size={18} />
                                        Sair e Voltar ao Login
                                    </button>

                                    {!isTenantError && (
                                        <button
                                            onClick={() => window.location.reload()}
                                            className="btn btn-ghost text-slate-500 hover:text-slate-700 w-full"
                                        >
                                            Tentar Recarregar
                                        </button>
                                    )}
                                </div>

                                <div className="mt-8 border-t border-slate-100 pt-4 w-full">
                                    <p className="text-xs text-slate-400 font-mono">
                                        ERR: {this.state.error?.message?.split(':')[0]?.substring(0, 40) || 'UNKNOWN'}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            }
        }

        return this.props.children;
    }
}

export default TenantErrorBoundary;
