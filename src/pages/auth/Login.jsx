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
    const { signIn, profile } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const userProfile = await signIn(email, password);

            // Redirect immediately after successful login
            // Do NOT wait for onAuthStateChange or AuthContext loading state
            if (userProfile?.role === 'admin') {
                navigate('/admin', { replace: true });
            } else {
                navigate('/profissional', { replace: true });
            }
        } catch (err) {
            console.error('Erro no login:', err);
            setError('Email ou senha inválidos');
            setLoading(false); // Only reset loading on error
        }
        // Note: loading stays true on success because we're navigating away
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
