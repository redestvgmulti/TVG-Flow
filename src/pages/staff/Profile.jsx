import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAuth } from '../../contexts/AuthContext'
import {
    Camera, Eye, EyeOff, Monitor, Smartphone,
    Mail, LogOut
} from 'lucide-react'
import { SkeletonCard } from '../../components/Skeleton'
import {
    getMyProfile, updateMyProfile, uploadMyAvatar, changeMyPassword,
    getMyNotificationPreferences, updateMyNotificationPreferences,
    getMyMonthProductivity
} from '../../services/profileService'
import '../../styles/staff-profile.css'

const ROLE_LABELS = {
    admin: 'Administrador',
    staff: 'Equipe',
    profissional: 'Colaborador',
    super_admin: 'Super Admin'
}

const PASSWORD_REQUIREMENTS = [
    { label: 'Mínimo 8 caracteres', test: p => p.length >= 8 },
    { label: 'Pelo menos uma letra maiúscula', test: p => /[A-Z]/.test(p) },
    { label: 'Pelo menos um número', test: p => /[0-9]/.test(p) }
]

const NOTIF_ROWS = [
    { key: 'notif_tarefa_atribuida', label: 'Tarefa atribuída a mim', desc: 'Assim que alguém te coloca como responsável.' },
    { key: 'notif_prazo', label: 'Prazo chegando', desc: 'Aviso um dia antes do vencimento de cada tarefa.' },
    { key: 'notif_reuniao', label: 'Reunião marcada ou remarcada', desc: 'Inclui mudança de horário e cancelamento.' },
    { key: 'notif_materia_publicada', label: 'Matéria que enviei foi publicada', desc: 'Confirmação quando a pauta sai no ar.' }
]

const DIGEST_OPTIONS = [
    { key: 'diario', label: 'Diário' },
    { key: 'semanal', label: 'Semanal' },
    { key: 'nenhum', label: 'Nenhum' }
]

function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(37, 99, 235, ${alpha})`
    const clean = hex.replace('#', '')
    const bigint = parseInt(clean.length === 3
        ? clean.split('').map(c => c + c).join('')
        : clean, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function getInitials(name) {
    if (!name) return 'U'
    return name.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()
}

function tenureLabel(createdAt) {
    if (!createdAt) return null
    const start = new Date(createdAt)
    const now = new Date()
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth())
    if (now.getDate() < start.getDate()) months -= 1
    months = Math.max(0, months)
    const years = Math.floor(months / 12)
    const remMonths = months % 12
    const parts = []
    if (years > 0) parts.push(`${years} ${years === 1 ? 'ano' : 'anos'}`)
    if (remMonths > 0 || years === 0) parts.push(`${remMonths} ${remMonths === 1 ? 'mês' : 'meses'}`)
    return parts.join(' e ') + ' de casa'
}

function memberSinceLabel(createdAt) {
    if (!createdAt) return null
    return new Date(createdAt).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function currentDeviceLabel() {
    const ua = navigator.userAgent
    const browser = /Edg\//.test(ua) ? 'Edge'
        : /Chrome\//.test(ua) ? 'Chrome'
            : /Firefox\//.test(ua) ? 'Firefox'
                : /Safari\//.test(ua) ? 'Safari'
                    : 'Navegador'
    const os = /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'macOS'
            : /Android/.test(ua) ? 'Android'
                : /iPhone|iPad/.test(ua) ? 'iOS'
                    : /Linux/.test(ua) ? 'Linux'
                        : 'Dispositivo'
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua)
    return { label: `${browser} · ${os}`, isMobile }
}

function passwordStrength(value) {
    if (!value) return { score: 0, label: '—', color: '#94A0AF' }
    let score = 0
    if (value.length >= 8) score++
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++
    if (/[0-9]/.test(value) || /[^A-Za-z0-9]/.test(value)) score++
    if (value.length < 8) score = 1
    const map = {
        1: { label: 'Fraca', color: '#DC2626' },
        2: { label: 'Média', color: '#D97706' },
        3: { label: 'Forte', color: '#059669' }
    }
    return { score, ...(map[score] || { label: 'Fraca', color: '#DC2626' }) }
}

function StaffProfile() {
    const { user, signOut } = useAuth()

    const [profile, setProfile] = useState(null)
    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState(false)
    const [reloadKey, setReloadKey] = useState(0)
    const [avatarUploading, setAvatarUploading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const fileInputRef = useRef(null)

    const [form, setForm] = useState({ nome: '', telefone: '' })
    const [savingPersonal, setSavingPersonal] = useState(false)

    const [pwd, setPwd] = useState({ atual: '', nova: '', confirma: '' })
    const [showPwd, setShowPwd] = useState(false)
    const [savingPassword, setSavingPassword] = useState(false)

    const [notif, setNotif] = useState(null)
    const [productivity, setProductivity] = useState(null)

    useEffect(() => {
        if (!user?.id) {
            setLoading(false)
            return
        }
        let mounted = true

        async function loadProfile() {
            setLoading(true)
            setLoadError(false)
            try {
                // Identity is essential. The remaining cards enrich the page
                // but must never turn a successful profile lookup into an
                // error screen when a legacy deployment lacks their tables.
                const profileData = await getMyProfile()
                if (!mounted) return
                setProfile(profileData)
                setForm({ nome: profileData.nome || '', telefone: profileData.telefone || '' })

                const [notifResult, productivityResult] = await Promise.allSettled([
                    getMyNotificationPreferences(user.id),
                    getMyMonthProductivity(profileData.id),
                ])
                if (!mounted) return

                if (notifResult.status === 'fulfilled') setNotif(notifResult.value)
                else console.warn('[Profile] Preferências indisponíveis:', notifResult.reason)

                if (productivityResult.status === 'fulfilled') setProductivity(productivityResult.value)
                else console.warn('[Profile] Produtividade indisponível:', productivityResult.reason)
            } catch (err) {
                console.error('[Profile] Falha ao carregar perfil:', err)
                if (mounted) setLoadError(true)
                toast.error('Não foi possível carregar seu perfil.')
            } finally {
                if (mounted) setLoading(false)
            }
        }

        loadProfile()

        return () => { mounted = false }
    }, [user?.id, reloadKey])

    const personalDirty = profile && (form.nome !== (profile.nome || '') || form.telefone !== (profile.telefone || ''))
    const selfServiceAvailable = profile?.self_service_available !== false

    async function handleSavePersonal() {
        if (!selfServiceAvailable) return toast.error('A edição do perfil ainda não está disponível neste ambiente.')
        if (!form.nome.trim()) return toast.error('Informe seu nome completo')
        setSavingPersonal(true)
        try {
            await updateMyProfile({ nome: form.nome.trim(), telefone: form.telefone.trim() })
            setProfile(p => ({ ...p, nome: form.nome.trim(), telefone: form.telefone.trim() || null }))
            toast.success('Dados atualizados')
        } catch (err) {
            toast.error('Erro ao salvar: ' + err.message)
        } finally {
            setSavingPersonal(false)
        }
    }

    function resetPersonal() {
        setForm({ nome: profile.nome || '', telefone: profile.telefone || '' })
    }

    async function handleAvatarFile(file) {
        if (!file || !user?.id) return
        if (!selfServiceAvailable) return toast.error('A foto do perfil ainda não está disponível neste ambiente.')
        setAvatarUploading(true)
        try {
            const avatarUrl = await uploadMyAvatar(file, user.id)
            setProfile(p => ({ ...p, avatar_url: avatarUrl }))
            toast.success('Foto atualizada')
        } catch (err) {
            toast.error(err.message || 'Erro ao enviar foto')
        } finally {
            setAvatarUploading(false)
        }
    }

    const pwdStrength = passwordStrength(pwd.nova)
    const passwordValid = PASSWORD_REQUIREMENTS.every(r => r.test(pwd.nova))
    const passwordsMatch = pwd.nova && pwd.nova === pwd.confirma
    const passwordReady = passwordValid && passwordsMatch && !!pwd.atual

    async function handleSavePassword() {
        if (!pwd.atual) return toast.error('Informe a senha atual')
        if (!passwordValid) return toast.error('A nova senha não atende aos requisitos mínimos')
        if (!passwordsMatch) return toast.error('As senhas não coincidem')

        setSavingPassword(true)
        try {
            await changeMyPassword({ email: user.email, currentPassword: pwd.atual, newPassword: pwd.nova })
            setPwd({ atual: '', nova: '', confirma: '' })
            toast.success('Senha atualizada')
        } catch (err) {
            toast.error(err.message || 'Erro ao atualizar senha')
        } finally {
            setSavingPassword(false)
        }
    }

    async function toggleNotif(key) {
        const previous = notif
        const next = { ...notif, [key]: !notif[key] }
        setNotif(next)
        try {
            await updateMyNotificationPreferences(user.id, { [key]: next[key] })
        } catch (err) {
            console.error('[Profile] Falha ao salvar notificação:', err)
            setNotif(previous)
            toast.error('Erro ao salvar preferência')
        }
    }

    async function setDigest(key) {
        const previous = notif
        setNotif(n => ({ ...n, digest_frequencia: key }))
        try {
            await updateMyNotificationPreferences(user.id, { digest_frequencia: key })
        } catch (err) {
            console.error('[Profile] Falha ao salvar preferência de resumo:', err)
            setNotif(previous)
            toast.error('Erro ao salvar preferência')
        }
    }

    if (loading) {
        return (
            <div className="animation-fade-in pb-12">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-primary mb-2">Meu Perfil</h1>
                    <p className="text-secondary">Suas informações de acesso.</p>
                </div>
                <div className="space-y-4">
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        )
    }

    if (!profile || loadError) {
        return (
            <div className="animation-fade-in pb-12">
                <div className="mb-8">
                    <h1 className="text-3xl font-bold text-primary mb-2">Meu Perfil</h1>
                </div>
                <div className="card" style={{ textAlign: 'center', padding: '48px 24px' }}>
                    <p className="text-secondary">Não foi possível carregar seu perfil. Tente novamente em instantes.</p>
                    <button
                        type="button"
                        className="btn btn-primary"
                        style={{ marginTop: 18 }}
                        onClick={() => setReloadKey(value => value + 1)}
                    >
                        Tentar novamente
                    </button>
                </div>
            </div>
        )
    }

    const device = currentDeviceLabel()

    return (
        <div className="animation-fade-in pb-12">
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-primary mb-2">Meu Perfil</h1>
                <p className="text-secondary">Nome e contato aparecem para o time nas tarefas e reuniões.</p>
            </div>

            <div className="profile-stack">
                {!selfServiceAvailable && (
                    <div className="profile-feature-notice" role="status">
                        Seu perfil está disponível para consulta. Edição de dados, foto e preferências serão habilitadas assim que a atualização do banco for concluída.
                    </div>
                )}

                {/* Header: avatar, identidade, stats do mês */}
                <div className="card profile-header-card">
                    <div
                        className={`profile-avatar-slot ${dragOver ? 'is-drag-over' : ''} ${!selfServiceAvailable ? 'is-disabled' : ''}`}
                        onClick={() => selfServiceAvailable && fileInputRef.current?.click()}
                        onDragOver={e => {
                            if (!selfServiceAvailable) return
                            e.preventDefault()
                            setDragOver(true)
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={e => {
                            e.preventDefault()
                            setDragOver(false)
                            handleAvatarFile(e.dataTransfer.files?.[0])
                        }}
                    >
                        {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.nome} />
                        ) : (
                            <span className="profile-avatar-initials">{getInitials(profile.nome)}</span>
                        )}
                        {avatarUploading && <div className="profile-avatar-overlay">Enviando…</div>}
                        <span className="profile-avatar-edit"><Camera size={12} /></span>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*"
                            hidden
                            disabled={!selfServiceAvailable}
                            onChange={e => handleAvatarFile(e.target.files?.[0])}
                        />
                    </div>

                    <div className="profile-identity">
                        <h2>{profile.nome}</h2>
                        <div className="profile-identity-meta">
                            <span className="profile-role">{ROLE_LABELS[profile.role] || profile.role}</span>
                            {profile.departamento_nome && (
                                <>
                                    <span className="profile-dot" />
                                    <span
                                        className="profile-dept-badge"
                                        style={{
                                            color: profile.departamento_cor || '#2563EB',
                                            background: hexToRgba(profile.departamento_cor, 0.1)
                                        }}
                                    >
                                        <span style={{ background: profile.departamento_cor || '#2563EB' }} />
                                        {profile.departamento_nome}
                                    </span>
                                </>
                            )}
                            {profile.empresa_nome && <span className="profile-empresa">{profile.empresa_nome}</span>}
                        </div>
                        {profile.created_at && (
                            <p className="profile-tenure">Membro desde {memberSinceLabel(profile.created_at)} · {tenureLabel(profile.created_at)}</p>
                        )}
                    </div>

                    {productivity && (
                        <div className="profile-mini-stats">
                            {productivity.stats.map(st => (
                                <div key={st.label} className="profile-mini-stat">
                                    <span className="profile-mini-stat-value">{st.value}</span>
                                    <span className="profile-mini-stat-label">{st.label}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="profile-two-col">
                    {/* Dados pessoais */}
                    <div className="card profile-section-card">
                        <div className="profile-section-header">
                            <h3>Dados pessoais</h3>
                            <p>Nome e contato aparecem para o time nas tarefas e reuniões.</p>
                        </div>
                        <div className="profile-section-body">
                            <div className="form-group">
                                <label>Nome completo</label>
                                <input
                                    className="input"
                                    value={form.nome}
                                    disabled={!selfServiceAvailable}
                                    onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>Telefone</label>
                                <input
                                    className="input"
                                    placeholder="(00) 00000-0000"
                                    value={form.telefone}
                                    disabled={!selfServiceAvailable}
                                    onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))}
                                />
                            </div>
                            <div className="form-group">
                                <label>E-mail de acesso</label>
                                <div className="profile-readonly-field">
                                    <span>{profile.email}</span>
                                    <Mail size={14} />
                                </div>
                                <span className="profile-hint">Só o administrador pode alterar o e-mail de login.</span>
                            </div>
                        </div>
                        <div className="profile-section-footer">
                            <span className={personalDirty ? 'profile-status-dirty' : 'profile-status-clean'}>
                                {personalDirty ? 'Alterações não salvas' : 'Tudo salvo'}
                            </span>
                            <div className="profile-actions">
                                {personalDirty && (
                                    <button type="button" className="btn btn-ghost" onClick={resetPersonal}>Cancelar</button>
                                )}
                                <button
                                    type="button"
                                    className="btn btn-black"
                                    disabled={!selfServiceAvailable || !personalDirty || savingPersonal}
                                    onClick={handleSavePersonal}
                                >
                                    {savingPersonal ? 'Salvando…' : 'Salvar alterações'}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Senha */}
                    <div className="card profile-section-card">
                        <div className="profile-section-header">
                            <h3>Senha</h3>
                            <p>Use uma senha que você não reutiliza em outros serviços.</p>
                        </div>
                        <div className="profile-section-body">
                            <div className="form-group">
                                <label>Senha atual</label>
                                <div className="password-input-wrapper">
                                    <input
                                        className="input"
                                        type={showPwd ? 'text' : 'password'}
                                        placeholder="••••••••"
                                        value={pwd.atual}
                                        onChange={e => setPwd(p => ({ ...p, atual: e.target.value }))}
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Nova senha</label>
                                <div className="password-input-wrapper">
                                    <input
                                        className="input"
                                        type={showPwd ? 'text' : 'password'}
                                        placeholder="Mínimo 8 caracteres"
                                        value={pwd.nova}
                                        onChange={e => setPwd(p => ({ ...p, nova: e.target.value }))}
                                    />
                                    <button type="button" className="password-toggle-btn" onClick={() => setShowPwd(v => !v)}>
                                        {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                                <div className="profile-strength">
                                    <div className="profile-strength-bars">
                                        {[1, 2, 3].map(i => (
                                            <span key={i} style={{ background: pwdStrength.score >= i ? pwdStrength.color : '#E8EAEF' }} />
                                        ))}
                                    </div>
                                    <span className="profile-strength-label" style={{ color: pwdStrength.color }}>{pwdStrength.label}</span>
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Confirmar nova senha</label>
                                <input
                                    className="input"
                                    type={showPwd ? 'text' : 'password'}
                                    placeholder="Repita a nova senha"
                                    value={pwd.confirma}
                                    onChange={e => setPwd(p => ({ ...p, confirma: e.target.value }))}
                                    style={pwd.confirma && !passwordsMatch ? { borderColor: '#FCA5A5' } : undefined}
                                />
                                {pwd.confirma && !passwordsMatch && (
                                    <span className="profile-error">As senhas não coincidem.</span>
                                )}
                            </div>
                        </div>
                        <div className="profile-section-footer profile-section-footer-end">
                            <button
                                type="button"
                                className="btn btn-black"
                                disabled={!passwordReady || savingPassword}
                                onClick={handleSavePassword}
                            >
                                {savingPassword ? 'Salvando…' : 'Atualizar senha'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Dispositivo atual */}
                <div className="card profile-section-card">
                    <div className="profile-section-header">
                        <h3>Sessão atual</h3>
                        <p>Se você não reconhecer este acesso, troque sua senha e saia imediatamente.</p>
                    </div>
                    <div className="profile-session-row">
                        <div className="profile-session-icon">
                            {device.isMobile ? <Smartphone size={16} /> : <Monitor size={16} />}
                        </div>
                        <div className="profile-session-info">
                            <div className="profile-session-title">
                                <span>{device.label}</span>
                                <span className="profile-session-badge">Este aparelho</span>
                            </div>
                            <span className="profile-session-meta">último acesso agora</span>
                        </div>
                        <button type="button" className="btn btn-secondary profile-session-signout" onClick={signOut}>
                            <LogOut size={14} /> Sair
                        </button>
                    </div>
                </div>

                {/* Notificações */}
                {notif && (
                    <div className="card profile-section-card">
                        <div className="profile-section-header">
                            <h3>Notificações</h3>
                            <p>Vale para o app e para o e-mail cadastrado.</p>
                        </div>
                        <div className="profile-notif-list">
                            {NOTIF_ROWS.map(row => (
                                <label key={row.key} className="profile-notif-row">
                                    <span
                                        className="profile-toggle"
                                        style={{ background: notif[row.key] ? '#2563EB' : '#E2E8F0' }}
                                        onClick={() => toggleNotif(row.key)}
                                    >
                                        <span style={{ left: notif[row.key] ? '16px' : '2px' }} />
                                    </span>
                                    <span className="profile-notif-text">
                                        <span className="profile-notif-label">{row.label}</span>
                                        <span className="profile-notif-desc">{row.desc}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="profile-digest-row">
                            <div>
                                <span className="profile-digest-title">Resumo do que ficou pendente</span>
                                <span className="profile-digest-desc">Um e-mail só, no fim do período.</span>
                            </div>
                            <div className="profile-digest-options">
                                {DIGEST_OPTIONS.map(opt => (
                                    <button
                                        key={opt.key}
                                        type="button"
                                        className={`profile-digest-option ${notif.digest_frequencia === opt.key ? 'is-active' : ''}`}
                                        onClick={() => setDigest(opt.key)}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Seu mês */}
                {productivity && (
                    <div className="card profile-section-card profile-productivity-card">
                        <div className="profile-section-header profile-productivity-header">
                            <div>
                                <h3>Seu mês</h3>
                                <p>Só você e seu gestor veem estes números.</p>
                            </div>
                            <span className="profile-month-label">{productivity.monthLabel}</span>
                        </div>
                        <div className="profile-week-chart">
                            {productivity.weekBars.map(wb => (
                                <div key={wb.day} className="profile-week-bar">
                                    <span className="profile-week-bar-value">{wb.value}</span>
                                    <span className="profile-week-bar-fill" style={{ height: wb.height, background: wb.bg }} />
                                    <span className="profile-week-bar-day">{wb.day}</span>
                                </div>
                            ))}
                        </div>
                        <p className="profile-productivity-note">{productivity.productivityNote}</p>
                    </div>
                )}
            </div>
        </div>
    )
}

export default StaffProfile
