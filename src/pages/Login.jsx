import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Mail, Lock } from 'lucide-react'
import { PageTransition } from '../components/PageTransition'
import { normalizeRole } from '../utils/roles'
import LoadingScreen from '../components/LoadingScreen'

function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const navigate = useNavigate()
    const { signIn } = useAuth()


    // ... existing imports

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        // DEBUG: Alert to confirm function is running
        // alert('DEBUG: 1. Botão clicado! Iniciando login...')

        try {
            const { role: rawRole } = await signIn(email, password)
            const role = normalizeRole(rawRole)

            // Route based on role
            if (role === 'super_admin') {
                navigate('/platform')
            } else if (role === 'admin') {
                navigate('/admin')
            } else if (role === 'staff') {
                navigate('/staff/dashboard')
            } else {
                throw new Error('Invalid role or unauthorized access')
            }
        } catch (error) {
            setError(error.message)
            setLoading(false)
        }
    }

    if (loading && !error) {
        return <LoadingScreen message="Acessando o sistema..." />
    }



    return (
        <PageTransition>
            <div className="centered-container">
                <div className="form-container">
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--color-text-primary)' }}>Login</h1>
                        <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                            Acesse sua conta para continuar no TVG Flow.
                        </p>
                    </div>

                    {error && (
                        <p style={{ color: 'var(--color-danger)', fontSize: '13px', marginBottom: '16px', textAlign: 'center' }}>
                            {error}
                        </p>
                    )}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="email">Email</label>
                            <div style={{ position: 'relative' }}>
                                <Mail size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    className="form-input"
                                    style={{ paddingLeft: '40px' }}
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={loading}
                                    required
                                />
                            </div>
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">Senha</label>
                            <div className="password-input-wrapper">
                                <Lock size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <input
                                    id="password"
                                    name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    className="form-input"
                                    style={{ paddingLeft: '40px' }}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                    required
                                />
                                <button
                                    type="button"
                                    className="password-toggle-btn"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>

                        <button type="submit" className="form-button" disabled={loading}>
                            {loading ? 'Entrando...' : 'Entrar'}
                        </button>
                    </form>

                    <div style={{ marginTop: '24px', textAlign: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                        <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>TVG Flow • Sistema Administrativo Seguro</p>
                    </div>
                </div>
            </div>
        </PageTransition >
    )
}

export default Login
