import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff } from 'lucide-react'
import { PageTransition } from '../components/PageTransition'

function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    const navigate = useNavigate()
    const { signIn } = useAuth()

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)
        setLoading(true)

        // DEBUG: Alert to confirm function is running
        alert('DEBUG: 1. Botão clicado! Iniciando login...')

        try {
            console.log('Calling signIn...')
            const { role } = await signIn(email, password)
            console.log('SignIn success, role:', role)

            if (role === 'super_admin') {
                navigate('/platform')
            } else {
                navigate('/staff/dashboard')
            }
        } catch (error) {
            console.error('Login error:', error)
            // Show alert for critical visibility
            alert('Erro no Login: ' + (error.message || 'Desconhecido'))
            setError(error.message)
            setLoading(false)
        }
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
