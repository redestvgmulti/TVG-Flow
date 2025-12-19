import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../services/supabase'
import { Lock, Check, AlertTriangle, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'

export default function ResetPassword() {
    const navigate = useNavigate()
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState('')

    // Password Strength Requirements
    const requirements = [
        { label: 'Mínimo 8 caracteres', test: p => p.length >= 8 },
        { label: 'Pelo menos uma letra maiúscula', test: p => /[A-Z]/.test(p) },
        { label: 'Pelo menos um número', test: p => /[0-9]/.test(p) }
    ]

    const allValid = requirements.every(r => r.test(password))
    const passwordsMatch = password && password === confirmPassword

    useEffect(() => {
        // Handle recovery/invite tokens from URL
        const handleAuthCallback = async () => {
            const hashParams = new URLSearchParams(window.location.hash.substring(1))
            const type = hashParams.get('type')

            // If this is a recovery or invite link, ensure we stay on this page
            if (type === 'recovery' || type === 'invite') {
                // Token will be processed automatically by Supabase
                // Just make sure we don't redirect away
                return
            }
        }

        handleAuthCallback()
    }, [])

    const handleSubmit = async (e) => {
        e.preventDefault()
        if (!allValid || !passwordsMatch) return

        setIsSubmitting(true)
        try {
            const { error } = await supabase.auth.updateUser({ password })
            if (error) throw error

            toast.success('Senha definida com sucesso! Faça login para continuar.')

            // Logout and redirect to login
            await supabase.auth.signOut()
            navigate('/login')

        } catch (err) {
            setError('Erro ao definir senha. O link pode ter expirado.')
            toast.error('Erro ao definir senha: ' + err.message)
        } finally {
            setIsSubmitting(false)
        }
    }

    if (error) {
        return (
            <div className="centered-container">
                <div className="form-container" style={{ textAlign: 'center' }}>
                    <div className="w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                        <AlertTriangle size={24} />
                    </div>
                    <h2 className="text-xl font-bold text-slate-800 mb-2">Acesso Inválido</h2>
                    <p className="text-slate-600 mb-6">{error}</p>
                    <button onClick={() => navigate('/login')} className="form-button">
                        Voltar para Login
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className="centered-container">
            <div className="form-container">
                <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                    <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '8px', color: 'var(--color-text-primary)' }}>Definir Senha</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                        Crie uma senha segura para acessar o TVG Flow.
                    </p>
                </div>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label className="text-sm font-medium text-slate-700">Nova Senha</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                className="form-input"
                                style={{ paddingLeft: '40px', paddingRight: '40px' }}
                                placeholder="••••••••"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
                            >
                                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                            </button>
                        </div>
                    </div>

                    {/* Requirements List */}
                    <div className="form-group" style={{ background: 'rgba(0,0,0,0.03)', padding: '10px', borderRadius: '8px' }}>
                        {requirements.map((req, i) => (
                            <div key={i} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                fontSize: '12px',
                                marginBottom: '4px',
                                color: req.test(password) ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                                fontWeight: req.test(password) ? 600 : 400
                            }}>
                                <div style={{
                                    width: '14px',
                                    height: '14px',
                                    borderRadius: '50%',
                                    background: req.test(password) ? 'var(--color-success-bg)' : '#e2e8f0',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}>
                                    {req.test(password) && <Check size={10} />}
                                </div>
                                {req.label}
                            </div>
                        ))}
                    </div>

                    <div className="form-group">
                        <label className="text-sm font-medium text-slate-700">Confirmar Senha</label>
                        <div style={{ position: 'relative' }}>
                            <Lock size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                            <input
                                type={showPassword ? 'text' : 'password'}
                                required
                                className="form-input"
                                style={{
                                    paddingLeft: '40px',
                                    borderColor: confirmPassword && !passwordsMatch ? 'var(--color-danger)' : undefined
                                }}
                                placeholder="••••••••"
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                            />
                        </div>
                        {confirmPassword && !passwordsMatch && (
                            <p style={{ color: 'var(--color-danger)', fontSize: '12px', marginTop: '4px' }}>As senhas não coincidem.</p>
                        )}
                    </div>

                    <button
                        type="submit"
                        disabled={!allValid || !passwordsMatch || isSubmitting}
                        className="form-button"
                    >
                        {isSubmitting ? 'Salvando...' : 'Definir Senha e Entrar'}
                    </button>
                </form>

                <div style={{ marginTop: '24px', textAlign: 'center', borderTop: '1px solid var(--color-border)', paddingTop: '16px' }}>
                    <p style={{ fontSize: '12px', color: 'var(--color-text-tertiary)' }}>TVG Flow • Sistema Administrativo Seguro</p>
                </div>
            </div>
        </div>
    )
}
