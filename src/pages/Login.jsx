import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff } from 'lucide-react'
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

            const IMMUTABLE_SUPER_ADMIN_EMAIL = 'geovanepanini@icloud.com'

            // Artificial delay for premium feel
            // Keep loading true, but we could add a specific message updates here if we wanted
            await new Promise(resolve => setTimeout(resolve, 2500))

            // Route based on role
            if (email === IMMUTABLE_SUPER_ADMIN_EMAIL && role === 'super_admin') {
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
                    <h1>Login</h1>

                    {error && <p style={{ color: 'red' }}>{error}</p>}

                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <label htmlFor="email">Email</label>
                            <input
                                id="email"
                                type="email"
                                className="form-input"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                disabled={loading}
                                required
                            />
                        </div>

                        <div className="form-group">
                            <label htmlFor="password">Password</label>
                            <div className="password-input-wrapper">
                                <input
                                    id="password"
                                    type={showPassword ? 'text' : 'password'}
                                    className="form-input"
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
                            {loading ? 'Loading...' : 'Login'}
                        </button>
                    </form>
                </div>
            </div>
        </PageTransition >
    )
}

export default Login
