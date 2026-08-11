import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../services/supabase'
import { CircleAlert, CircleCheck, Eye, Info, EyeOff, Lock, Mail, TriangleAlert, X } from 'lucide-react'
import { toast } from 'sonner'
import { PageTransition } from '../components/PageTransition'
import { normalizeRole } from '../utils/roles'
import '../styles/login.css'

// O painel de marca traz um indicador de três pontos — ou seja, um carrossel.
// Em vez de pontos decorativos, as mensagens são reais e os pontos navegam.
//
// Copy deliberadamente neutra: fala de operação de conteúdo em geral, não de
// uma emissora específica, acompanhando o posicionamento global do TVG Hub.
const BRAND_SLIDES = [
    {
        title: 'Todo o conteúdo.\nUm só fluxo',
        text: 'Da pauta à publicação sem trocar de ferramenta e sem planilha paralela.',
    },
    {
        title: 'Consistência\nem escala',
        text: 'Modelos fixos mantêm cada peça dentro do padrão, por marca e por canal.',
    },
    {
        title: 'Controle\nde ponta a ponta',
        text: 'Cada equipe enxerga apenas o que lhe cabe, com trilha de auditoria completa.',
    },
]

const SLIDE_INTERVAL_MS = 6000
const SLIDE_EXIT_MS = 400
const SLIDE_ENTER_MS = 560

// O botão de SSO só aparece quando o provedor estiver realmente configurado no
// Supabase. Sem isso ele existiria apenas para falhar no clique — ver README.
const SSO_ENABLED = import.meta.env.VITE_ENABLE_GOOGLE_SSO === 'true'
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const TOAST_VARIANTS = {
    error: { Icon: CircleAlert, duration: 6200 },
    success: { Icon: CircleCheck, duration: 5200 },
    info: { Icon: Info, duration: 5200 },
    warning: { Icon: TriangleAlert, duration: 6200 },
}

function getEmailError(value, emptyMessage = 'Digite seu e-mail para continuar.') {
    const normalized = value.trim()
    if (!normalized) return emptyMessage
    if (!EMAIL_PATTERN.test(normalized)) return 'Digite um endere\u00e7o de e-mail v\u00e1lido.'
    return ''
}

function getAuthenticationToast(error) {
    const message = String(error?.message || '').toLowerCase()

    if (/network|fetch|internet|connection|offline|timeout/.test(message)) {
        return {
            variant: 'error',
            title: 'Sem conex\u00e3o com o servidor',
            description: 'Verifique sua internet e tente novamente.',
        }
    }

    if (/suspend|disabled|blocked|banned|inactive/.test(message)) {
        return {
            variant: 'warning',
            title: 'Conta indispon\u00edvel',
            description: 'Entre em contato com o suporte para continuar.',
        }
    }

    if (/invalid|credential|password|email|login|auth/.test(message)) {
        return {
            variant: 'error',
            title: 'N\u00e3o foi poss\u00edvel entrar',
            description: 'Verifique seu e-mail e sua senha e tente novamente.',
        }
    }

    return {
        variant: 'error',
        title: 'Algo n\u00e3o saiu como esperado',
        description: 'Tente novamente em alguns instantes.',
    }
}

function LoginFeedbackToast({ toastId, variant, title, description }) {
    const { Icon } = TOAST_VARIANTS[variant]
    const liveRole = variant === 'error' || variant === 'warning' ? 'alert' : 'status'

    return (
        <div className={`login-auth-toast is-${variant}`} role={liveRole} aria-live={liveRole === 'alert' ? 'assertive' : 'polite'} aria-atomic="true">
            <span className="login-auth-toast-icon" aria-hidden="true"><Icon size={17} /></span>
            <div className="login-auth-toast-copy">
                <strong>{title}</strong>
                {description && <p>{description}</p>}
            </div>
            <button type="button" className="login-auth-toast-close" onClick={() => toast.dismiss(toastId)} aria-label="Fechar aviso">
                <X size={16} aria-hidden="true" />
            </button>
        </div>
    )
}

function Login() {
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [loading, setLoading] = useState(false)
    const [fieldErrors, setFieldErrors] = useState({})
    const [slide, setSlide] = useState(0)
    const [slidePhase, setSlidePhase] = useState('idle')
    const [isPageVisible, setIsPageVisible] = useState(() => document.visibilityState !== 'hidden')
    const [isCarouselVisible, setIsCarouselVisible] = useState(
        () => !(window.matchMedia?.('(max-width: 840px)').matches ?? false),
    )
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(
        () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    )
    const transitionTimerRef = useRef(null)
    const emailInputRef = useRef(null)
    const passwordInputRef = useRef(null)

    const navigate = useNavigate()
    const { signIn } = useAuth()

    const showLoginToast = useCallback(({ variant = 'info', title, description }) => {
        const config = TOAST_VARIANTS[variant]
        toast.custom(
            (toastId) => <LoginFeedbackToast toastId={toastId} variant={variant} title={title} description={description} />,
            { id: 'login-feedback', duration: config.duration, position: 'bottom-left' },
        )
    }, [])

    const focusInvalidField = useCallback((errors) => {
        window.requestAnimationFrame(() => {
            if (errors.email) emailInputRef.current?.focus()
            else if (errors.password) passwordInputRef.current?.focus()
        })
    }, [])

    const handleEmailChange = useCallback((event) => {
        const nextEmail = event.target.value
        setEmail(nextEmail)
        setFieldErrors((current) => {
            if (!current.email) return current
            const emptyMessage = current.email.includes('redefini')
                ? 'Digite seu e-mail para receber o link de redefini\u00e7\u00e3o.'
                : 'Digite seu e-mail para continuar.'
            return { ...current, email: getEmailError(nextEmail, emptyMessage) }
        })
    }, [])

    const handlePasswordChange = useCallback((event) => {
        const nextPassword = event.target.value
        setPassword(nextPassword)
        setFieldErrors((current) => current.password
            ? { ...current, password: nextPassword ? '' : 'Digite sua senha para continuar.' }
            : current)
    }, [])

    const clearTransitionTimer = useCallback(() => {
        if (transitionTimerRef.current) {
            window.clearTimeout(transitionTimerRef.current)
            transitionTimerRef.current = null
        }
    }, [])

    const showSlide = useCallback((nextSlide) => {
        if (nextSlide === slide || slidePhase !== 'idle') return

        clearTransitionTimer()

        if (prefersReducedMotion) {
            setSlide(nextSlide)
            return
        }

        setSlidePhase('exiting')
        transitionTimerRef.current = window.setTimeout(() => {
            setSlide(nextSlide)
            setSlidePhase('entering')
            transitionTimerRef.current = window.setTimeout(() => {
                setSlidePhase('idle')
                transitionTimerRef.current = null
            }, SLIDE_ENTER_MS)
        }, SLIDE_EXIT_MS)
    }, [clearTransitionTimer, prefersReducedMotion, slide, slidePhase])

    useEffect(() => {
        const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)')
        if (!motionQuery) return undefined

        const handleMotionPreference = (event) => setPrefersReducedMotion(event.matches)
        motionQuery.addEventListener?.('change', handleMotionPreference)

        return () => motionQuery.removeEventListener?.('change', handleMotionPreference)
    }, [])

    useEffect(() => {
        const layoutQuery = window.matchMedia?.('(max-width: 840px)')
        if (!layoutQuery) return undefined

        const handleLayoutChange = (event) => setIsCarouselVisible(!event.matches)
        layoutQuery.addEventListener?.('change', handleLayoutChange)

        return () => layoutQuery.removeEventListener?.('change', handleLayoutChange)
    }, [])

    useEffect(() => {
        const handleVisibilityChange = () => {
            setIsPageVisible(document.visibilityState !== 'hidden')
        }

        document.addEventListener('visibilitychange', handleVisibilityChange)
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
    }, [])

    // Um único timeout controla o autoplay. A cada troca manual, retorno de foco
    // ou conclusão da animação, a contagem recomeça de forma previsível.
    useEffect(() => {
        if (prefersReducedMotion || !isPageVisible || !isCarouselVisible || slidePhase !== 'idle') return undefined

        const autoplayTimer = window.setTimeout(() => {
            showSlide((slide + 1) % BRAND_SLIDES.length)
        }, SLIDE_INTERVAL_MS)

        return () => window.clearTimeout(autoplayTimer)
    }, [isCarouselVisible, isPageVisible, prefersReducedMotion, showSlide, slide, slidePhase])

    useEffect(() => clearTransitionTimer, [clearTransitionTimer])

    const handleSubmit = async (e) => {
        e.preventDefault()

        const nextErrors = {
            email: getEmailError(email),
            password: password ? '' : 'Digite sua senha para continuar.',
        }
        const invalidFields = Object.fromEntries(Object.entries(nextErrors).filter(([, message]) => message))

        if (Object.keys(invalidFields).length) {
            setFieldErrors(invalidFields)
            focusInvalidField(invalidFields)
            return
        }

        setFieldErrors({})
        setLoading(true)

        try {
            const { role: rawRole } = await signIn(email, password)
            const role = normalizeRole(rawRole)

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
            showLoginToast(getAuthenticationToast(error))
            setLoading(false)
        }
    }

    // O link permanece neutro para n\u00e3o confirmar a exist\u00eancia de uma conta.
    const handleForgotPassword = useCallback(async () => {
        const target = email.trim()
        const emailError = getEmailError(target, 'Digite seu e-mail para receber o link de redefini\u00e7\u00e3o.')

        if (emailError) {
            const nextErrors = { email: emailError }
            setFieldErrors(nextErrors)
            focusInvalidField(nextErrors)
            return
        }

        setFieldErrors({})
        setLoading(true)
        try {
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(target, {
                redirectTo: `${window.location.origin}/reset-password`,
            })
            if (resetError) throw resetError
            showLoginToast({
                variant: 'success',
                title: 'Link enviado',
                description: 'Confira sua caixa de entrada e tamb\u00e9m a pasta de spam.',
            })
        } catch (error) {
            const failure = getAuthenticationToast(error)
            showLoginToast({
                variant: 'error',
                title: failure.title === 'Sem conex\u00e3o com o servidor' ? failure.title : 'N\u00e3o foi poss\u00edvel enviar o link',
                description: failure.title === 'Sem conex\u00e3o com o servidor' ? failure.description : 'Tente novamente em alguns instantes.',
            })
        } finally {
            setLoading(false)
        }
    }, [email, focusInvalidField, showLoginToast])

    const handleGoogleSignIn = useCallback(async () => {
        setLoading(true)
        try {
            const { error: oauthError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: { redirectTo: `${window.location.origin}/login` },
            })
            if (oauthError) throw oauthError
        } catch {
            showLoginToast({
                variant: 'error',
                title: 'N\u00e3o foi poss\u00edvel iniciar o acesso com Google',
                description: 'Tente novamente em alguns instantes.',
            })
            setLoading(false)
        }
    }, [showLoginToast])

    const current = BRAND_SLIDES[slide]

    return (
        <PageTransition>
            <div className="login-shell">
                <main className="login-main">
                    <div className="login-card">
                        <div className="login-wordmark">
                            <img src="/images/tvg-hub-login-brand-v2.png" alt="TVG Hub" />
                        </div>

                        <h1 className="login-title">Bem-vindo de volta</h1>
                        <p className="login-subtitle">Entre para continuar de onde parou.</p>

                        <form onSubmit={handleSubmit} className="login-form" aria-busy={loading} noValidate autoComplete="off">
                            <div className="login-field">
                                <Mail size={18} className="login-field-icon" aria-hidden="true" />
                                <input
                                    id="email"
                                    name="login_email"
                                    type="email"
                                    inputMode="email"
                                    autoComplete="off"
                                    data-lpignore="true"
                                    data-1p-ignore="true"
                                    data-bwignore="true"
                                    className="login-input"
                                    placeholder="nome@empresa.com"
                                    ref={emailInputRef}
                                    value={email}
                                    onChange={handleEmailChange}
                                    aria-invalid={fieldErrors.email ? 'true' : undefined}
                                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                                    disabled={loading}
                                    required
                                />
                                <label htmlFor="email" className="login-field-label">E-mail</label>
                                {fieldErrors.email && <p id="email-error" className="login-field-error" role="alert">{fieldErrors.email}</p>}
                            </div>

                            <div className="login-field">
                                <Lock size={18} className="login-field-icon" aria-hidden="true" />
                                <input
                                    id="password"
                                    name="login_password"
                                    type={showPassword ? 'text' : 'password'}
                                    autoComplete="off"
                                    data-lpignore="true"
                                    data-1p-ignore="true"
                                    data-bwignore="true"
                                    className="login-input has-toggle"
                                    placeholder="••••••••"
                                    ref={passwordInputRef}
                                    value={password}
                                    onChange={handlePasswordChange}
                                    aria-invalid={fieldErrors.password ? 'true' : undefined}
                                    aria-describedby={fieldErrors.password ? 'password-error' : undefined}
                                    disabled={loading}
                                    required
                                />
                                <label htmlFor="password" className="login-field-label">Senha</label>
                                <button
                                    type="button"
                                    className="login-password-toggle"
                                    onClick={() => setShowPassword(!showPassword)}
                                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                                {fieldErrors.password && <p id="password-error" className="login-field-error" role="alert">{fieldErrors.password}</p>}
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
                                {loading && <span className="login-submit-spinner" aria-hidden="true" />}
                                <span>{loading ? 'Entrando...' : 'Entrar'}</span>
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
                            <p>TVG Hub • Plataforma segura de operação de conteúdo</p>
                        </div>
                    </div>
                </main>

                <aside className="login-visual" aria-label="Mensagens institucionais do TVG Hub">
                    <img
                        className="login-visual-image"
                        src="/images/tvg-hub-login-background.png"
                        alt=""
                        aria-hidden="true"
                    />
                    <div className="login-visual-overlay" aria-hidden="true" />

                    <div className="login-carousel" aria-live="off">
                        <div
                            className={`login-carousel-content is-${slidePhase}`}
                            key={slide}
                        >
                            <h2 className="login-brand-title">{current.title}</h2>
                            <p className="login-brand-text">{current.text}</p>
                        </div>

                        <div className="login-brand-dots" aria-label="Selecionar mensagem">
                            {BRAND_SLIDES.map((item, index) => (
                                <button
                                    key={item.title}
                                    type="button"
                                    className="login-dot"
                                    aria-current={index === slide ? 'true' : undefined}
                                    aria-label={`Exibir mensagem ${index + 1} de ${BRAND_SLIDES.length}`}
                                    aria-disabled={slidePhase !== 'idle'}
                                    onClick={() => showSlide(index)}
                                >
                                </button>
                            ))}
                        </div>
                    </div>
                </aside>
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
