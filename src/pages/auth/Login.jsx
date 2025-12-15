import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../services/supabase';
import { getProfissionalProfile } from '../../services/auth';
import { Button } from '../../components/common/Button';
import { Card } from '../../components/common/Card';
import './Login.css';

const Login = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            // 1. Autenticar com Supabase
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (authError) {
                throw authError;
            }

            // 2. Buscar perfil do usuário
            const profile = await getProfissionalProfile(authData.user.id);

            // 3. Redirecionar baseado no role
            if (profile?.role === 'admin') {
                navigate('/admin', { replace: true });
            } else {
                navigate('/profissional', { replace: true });
            }
        } catch (err) {
            console.error('Erro no login:', err);
            setError(err.message || 'Email ou senha inválidos');
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-content">
                <Card glass className="login-card">
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
