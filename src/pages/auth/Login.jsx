import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import './Login.css';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const { signIn } = useAuth();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            console.log('Iniciando login...');
            // 1. Authenticate via Context (handles auth + profile fetch)
            const profile = await signIn(email, password);
            console.log('Login sucesso, perfil:', profile);

            // 2. Redirect based on role
            if (profile?.role === 'admin') {
                console.log('Redirecionando para /admin');
                navigate('/admin', { replace: true });
            } else {
                console.log('Redirecionando para /profissional');
                navigate('/profissional', { replace: true });
            }
        } catch (err) {
            console.error('Erro no login:', err);
            // Handle expected Supabase errors
            if (err.message.includes('JSON object requested, multiple (or no) rows returned')) {
                setError('Usuário sem perfil profissional associado. Contate o suporte.');
            } else {
                setError(err.message || 'Falha na autenticação');
            }
            setLoading(false);
        }
        // Note: We do NOT set loading(false) on success to prevent UI flicker before redirect
    };

    return (
        <div className="login-container">
            <div className="login-content">
                <Card className="login-card">
                    <div className="login-header">
                        <h1 className="login-title">TVG Flow</h1>
                        <p className="login-subtitle">Sistema de Gestão Operacional</p>
                    </div>

                    <form onSubmit={handleSubmit} className="login-form">
                        {error && (
                            <div className="login-error">
                                {error}
                            </div>
                        )}

                        <div className="form-group">
                            <label htmlFor="email" className="form-label">
                                Email
                            </label>
                            <input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                className="form-input"
                                placeholder="seu@email.com"
                                required
                                autoComplete="email"
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="password" className="form-label">
                                Senha
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="form-input"
                                placeholder="••••••••"
                                required
                                autoComplete="current-password"
                                disabled={loading}
                            />
                        </div>

                        <Button
                            type="submit"
                            variant="primary"
                            size="lg"
                            fullWidth
                            loading={loading}
                        >
                            Entrar
                        </Button>
                    </form>
                </Card>
            </div>
        </div>
    );
};

export default Login;
