import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import { Eye, EyeOff, Mail, Lock } from 'lucide-react'
import { PageTransition } from '../components/PageTransition'
import { normalizeRole } from '../utils/roles'
import LoadingScreen from '../components/LoadingScreen'
import '../styles/login.css'

// O painel de marca do wireframe traz um indicador de três pontos — ou seja, um
// carrossel. Em vez de desenhar pontos decorativos, as três mensagens são reais
// e os pontos navegam entre elas.
const BRAND_SLIDES = [
    {
        title: 'Operação editorial em um só lugar',
        text: 'Pauta, arte e publicação no mesmo fluxo, sem planilha paralela.',
    },
    {
        title: 'Padrão visual garantido',
        text: 'Os modelos fixos mantêm toda matéria dentro da identidade da casa.',
    },
    {
        title: 'Acesso controlado por perfil',
        text: 'Cada equipe enxerga apenas o que lhe cabe, com trilha de auditoria.',
    },
]

const SLIDE_INTERVAL_MS = 6000

// O botão de SSO só aparece quando o provedor estiver realmente configurado no
// Supabase. Sem isso ele existiria apenas para falhar no clique — ver README.
const SSO_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_SSO === 'true'

function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [notice, setNotice] = useState(null)
    const [slide, setSlide] = useState(0)

    const navigate = useNavigate()
    const { signIn } = useAuth()

    // Rotação automática das mensagens de marca, respeitando quem pediu menos
    // movimento no sistema.
    useEffect(() => {
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        if (reduced) return
        const id = setInterval(
            () => setSlide(current => (current + 1) % BRAND_SLIDES.length),
            SLIDE_INTERVAL_MS,
        )
        return () => clearInterval(id)
    }, [])

    const handleSubmit = async (e) => {
        e.preventDefault()
        setError(null)
        setNotice(null)
        setLoading(true)

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

    // "Esqueceu a senha?" dispara o e-mail de redefinição. A segunda metade do
    // fluxo já existe: o link cai em /reset-password, que define a nova senha.
    const handleForgotPassword = useCallback(async () => {
        setError(null)
        setNotice(null)

        const target = email.trim()
        if (!target) {
            setError('Informe seu email para receber o link de redefinição.')
            return
        }

        setLoading(true)
        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(target, {
                redirectTo: `${window.location.origin}/reset-password`,
            })
            if (resetError) throw resetError
            // Resposta neutra de propósito: não revela se o email existe.
            setNotice('Se houver uma conta com esse email, o link de redefinição foi enviado.')
        } catch {
            setError('Não foi possível enviar o link agora. Tente novamente em instantes.')
        } finally {
            setLoading(false)
        }
    }, [email])

    const handleGoogleSignIn = useCallback(async () => {
        setError(null)
        setNotice(null)
        setLoading(true)
        try {
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/login` },
            })
            if (oauthError) throw oauthError
            // Em caso de sucesso o navegador é redirecionado para o provedor.
        } catch {
            setError('Não foi possível iniciar o acesso com Google.')
            setLoading(false)
        }
    }, [])

    if (loading && !error && !notice) {
        return <LoadingScreen message="Acessando o sistema..." />
    }

    const current = BRAND_SLIDES[slide]

    return (
        <PageTransition>
            <div className="login-shell">
                <aside className="login-brand" aria-hidden="true">
                    <div className="login-brand-wordmark">TVG Flow</div>

                    <div className="login-brand-center">
                        <div className="login-brand-figure">
                            <img src="/tvgmulti-logo.jpg" alt="" />
                        </div>
                        <h2 className="login-brand-title">{current.title}</h2>
                        <p className="login-brand-text">{current.text}</p>
                    </div>

                    <div className="login-brand-dots">
                        {BRAND_SLIDES.map((item, index) => (
                            <button
                                key={item.title}
                                type="button"
                                className="login-dot"
                                aria-current={index === slide}
                                aria-label={`Mensagem ${index + 1} de ${BRAND_SLIDES.length}`}
                                onClick={() => setSlide(index)}
                                tabIndex={-1}
                            />
                        ))}
                    </div>
                </aside>

                <main className="login-main">
                    <div className="login-card">
                        <div className="login-card-mark">
                            <img src="/tvgmulti-logo.jpg" alt="TVG Flow" />
                        </div>

                        <h1 className="login-title">Bem-vindo de volta</h1>
                        <p className="login-subtitle">Acesse sua conta para continuar no TVG Flow</p>

                        {error && (
                            <p className="login-feedback is-error" role="alert">{error}</p>
                        )}
                        {notice && (
                            <p className="login-feedback is-success" role="status">{notice}</p>
                        )}

                        <form onSubmit={handleSubmit} className="login-form">
                            <div className="login-field">
                                <Mail size={18} className="login-field-icon" aria-hidden="true" />
                                <input
                                    id="email"
                                    name="email"
                                    type="email"
                                    inputMode="email"
                                    autoComplete="email"
                                    className="login-input"
                                    placeholder="nome@empresa.com"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    disabled={loading}
                                    required
                                />
                                <label htmlFor="email" className="login-field-label">Email</label>
                            </div>

                            <div className="login-field">
                                <Lock size={18} className="login-field-icon" aria-hidden="true" />
                                <input
                                    id="password"
                                    name="password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="current-password"
                                    className="login-input has-toggle"
                                    placeholder="••••••••"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    disabled={loading}
                                    required
                                />
                                <label htmlFor="password" className="login-field-label">Senha</label>
                                <button
                                    type="button"
                                    className="login-password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>

                            <div className="login-forgot-row">
                                <button
                                    type="button"
                                    className="login-link"
                                    onClick={handleForgotPassword}
                                    disabled={loading}
                                >
                                    Esqueceu a senha?
                                </button>
                            </div>

                            <button type="submit" className="login-submit" disabled={loading}>
                                {loading ? 'Entrando...' : 'Entrar'}
                            </button>
                        </form>

                        {SSO_ENABLED && (
                            <>
                                <div className="login-divider">ou</div>
                                <button
                                    type="button"
                                    className="login-sso"
                                    onClick={handleGoogleSignIn}
                                    disabled={loading}
                                >
                                    <GoogleMark />
                                    Entrar com Google
                                </button>
                            </>
                        )}

                        <div className="login-footer">
                            <p>TVG Flow • Sistema Administrativo Seguro</p>
                        </div>
                    </div>
                </main>
            </div>
        </PageTransition>
    )
}

function GoogleMark() {
    return (
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.7 30.2.5 24 .5 14.6.5 6.5 5.8 2.6 13.6l7.8 6c1.9-5.6 7.1-9.6 13.6-10.1z" />
            <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-2.8-.4-4.1H24v7.4h12.7c-.3 2.1-1.6 5.3-4.7 7.4l7.6 5.9c4.5-4.2 6.5-10.3 6.5-16.6z" />
            <path fill="#FBBC05" d="M10.4 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .8-4.4l-7.8-6C1 16.7 0 20.2 0 24s1 7.3 2.6 10.4l7.8-6z" />
            <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.3-5.6l-7.6-5.9c-2 1.4-4.7 2.4-7.7 2.4-6.5 0-11.7-4-13.6-9.6l-7.8 6C6.5 42.2 14.6 47.5 24 47.5z" />
        </svg>
    )
}

export default Login
