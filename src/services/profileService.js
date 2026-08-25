import { supabase } from './supabase'

export function isMissingProfileSelfServiceFeature(error) {
    const code = String(error?.code || '')
    const message = String(error?.message || '')
    return code === 'PGRST202' || code === 'PGRST205' || code === '42883' || code === '42P01' ||
        /get_my_profile|update_my_profile|update_my_avatar|preferencias_notificacao|schema cache|does not exist/i.test(message)
}

function profileFeatureUnavailableError() {
    const error = new Error('A edição do perfil ainda não está disponível neste ambiente.')
    error.code = 'PROFILE_SELF_SERVICE_UNAVAILABLE'
    return error
}

/**
 * Perfil completo do usuário autenticado (inclui campos que a policy de
 * SELECT direta na tabela não garante para todo role, ex.: telefone/avatar).
 */
export async function getMyProfile() {
    const { data, error } = await supabase.rpc('get_my_profile')
    if (error) {
        // The self-service migration is additive. Older deployed databases
        // already expose get_current_identity, so keep the profile readable
        // while the optional telephone/avatar fields are unavailable.
        if (!isMissingProfileSelfServiceFeature(error)) throw error

        const { data: identity, error: identityError } = await supabase.rpc('get_current_identity')
        if (identityError) throw identityError
        if (!identity?.has_profile) throw new Error('Perfil não encontrado')
        return {
            ...identity,
            telefone: null,
            avatar_url: null,
            departamento_nome: null,
            departamento_cor: null,
            empresa_nome: null,
            created_at: null,
            self_service_available: false,
        }
    }
    if (!data?.has_profile) throw new Error('Perfil não encontrado')
    return { ...data, self_service_available: true }
}

export async function updateMyProfile({ nome, telefone }) {
    const { data, error } = await supabase.rpc('update_my_profile', {
        p_nome: nome,
        p_telefone: telefone || null
    })
    if (error) {
        // Never report a successful save when the additive migration has not
        // reached the current database yet.
        if (isMissingProfileSelfServiceFeature(error)) throw profileFeatureUnavailableError()
        throw error
    }
    return data
}

const AVATAR_MAX_BYTES = 5 * 1024 * 1024

export async function uploadMyAvatar(file, userId) {
    if (!file || !userId) throw new Error('Arquivo ou usuário ausente')
    if (!file.type?.startsWith('image/')) throw new Error('Envie um arquivo de imagem')
    if (file.size > AVATAR_MAX_BYTES) throw new Error('Imagem muito grande (máximo 5MB)')

    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
    const path = `${userId}/avatar-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(path, file, { cacheControl: '3600', upsert: false })
    if (uploadError) {
        if (String(uploadError?.statusCode || uploadError?.status || '') === '404' || /bucket not found/i.test(uploadError?.message || '')) {
            throw profileFeatureUnavailableError()
        }
        throw uploadError
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path)
    const avatarUrl = publicUrlData.publicUrl

    const { error: rpcError } = await supabase.rpc('update_my_avatar', { p_avatar_url: avatarUrl })
    if (rpcError) {
        // Avoid leaving an orphan public object when the database update fails.
        await supabase.storage.from('avatars').remove([path]).catch(() => {})
        if (isMissingProfileSelfServiceFeature(rpcError)) throw profileFeatureUnavailableError()
        throw rpcError
    }

    return avatarUrl
}

/**
 * Reautentica com a senha atual antes de trocar — o SDK do Supabase não
 * expõe verificação de senha isolada, então signInWithPassword cumpre esse
 * papel antes do updateUser.
 */
export async function changeMyPassword({ email, currentPassword, newPassword }) {
    const { error: reauthError } = await supabase.auth.signInWithPassword({
        email,
        password: currentPassword
    })
    if (reauthError) throw new Error('Senha atual incorreta')

    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
}

const DEFAULT_NOTIFICATION_PREFS = {
    notif_tarefa_atribuida: true,
    notif_prazo: true,
    notif_reuniao: true,
    notif_materia_publicada: false,
    digest_frequencia: 'diario'
}

export async function getMyNotificationPreferences(userId) {
    const { data, error } = await supabase
        .from('preferencias_notificacao')
        .select('notif_tarefa_atribuida, notif_prazo, notif_reuniao, notif_materia_publicada, digest_frequencia')
        .eq('profissional_id', userId)
        .maybeSingle()

    if (error) {
        if (isMissingProfileSelfServiceFeature(error)) return null
        throw error
    }
    return data || { ...DEFAULT_NOTIFICATION_PREFS }
}

export async function updateMyNotificationPreferences(userId, patch) {
    const { data, error } = await supabase
        .from('preferencias_notificacao')
        .upsert({ profissional_id: userId, ...patch }, { onConflict: 'profissional_id' })
        .select('notif_tarefa_atribuida, notif_prazo, notif_reuniao, notif_materia_publicada, digest_frequencia')
        .single()

    if (error) {
        if (isMissingProfileSelfServiceFeature(error)) throw profileFeatureUnavailableError()
        throw error
    }
    return data
}

function startOfWeek(date) {
    const d = new Date(date)
    const day = d.getDay() // 0=dom .. 6=sáb
    const diffToMonday = day === 0 ? -6 : 1 - day
    d.setDate(d.getDate() + diffToMonday)
    d.setHours(0, 0, 0, 0)
    return d
}

/**
 * Estatísticas reais de produtividade do mês, calculadas em cima de
 * `tarefas` (assigned_to = professionalId). Sem tabela de agregação própria,
 * então tudo é derivado no cliente a partir das linhas do mês/semana atual.
 */
export async function getMyMonthProductivity(professionalId) {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    const weekStart = startOfWeek(now)
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const { data, error } = await supabase
        .from('tarefas')
        .select('id, status, deadline, concluida_at')
        .eq('assigned_to', professionalId)
        .is('deleted_at', null)

    if (error) throw error

    const tasks = data || []
    const openStatuses = new Set(['pendente', 'em_progresso', 'em_execucao', 'atrasada'])
    const inProgress = tasks.filter(t => openStatuses.has(t.status)).length

    const concludedThisMonth = tasks.filter(t => {
        if (!t.concluida_at) return false
        const d = new Date(t.concluida_at)
        return d >= monthStart && d < nextMonthStart
    })

    const onTimeThisMonth = concludedThisMonth.filter(t => {
        if (!t.deadline) return true
        return new Date(t.concluida_at) <= new Date(t.deadline)
    })
    const onTimeRate = concludedThisMonth.length > 0
        ? Math.round((onTimeThisMonth.length / concludedThisMonth.length) * 100)
        : null

    const weekCounts = [0, 0, 0, 0, 0, 0, 0] // seg..dom
    concludedThisMonth
        .filter(t => {
            const d = new Date(t.concluida_at)
            return d >= weekStart && d < weekEnd
        })
        .forEach(t => {
            const d = new Date(t.concluida_at)
            const jsDay = d.getDay() // 0=dom
            const idx = jsDay === 0 ? 6 : jsDay - 1 // seg=0 .. dom=6
            weekCounts[idx] += 1
        })

    const maxWeek = Math.max(...weekCounts, 1)
    const weekBars = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((day, idx) => ({
        day,
        value: weekCounts[idx],
        height: Math.max(6, Math.round((weekCounts[idx] / maxWeek) * 62)) + 'px',
        bg: weekCounts[idx] === 0 ? '#EEF1F6' : (weekCounts[idx] >= maxWeek ? '#2563EB' : '#BFD3FA')
    }))

    const bestDayIdx = weekCounts.reduce((best, v, i) => v > weekCounts[best] ? i : best, 0)
    const bestDayLabel = weekCounts[bestDayIdx] > 0
        ? ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'][bestDayIdx]
        : null

    const lateLast14Days = tasks.filter(t => {
        if (!t.concluida_at || !t.deadline) return false
        const concluded = new Date(t.concluida_at)
        return concluded >= fourteenDaysAgo && concluded > new Date(t.deadline)
    }).length

    const productivityNote = bestDayLabel
        ? `Melhor dia da semana foi ${bestDayLabel}, com ${Math.max(...weekCounts)} tarefa${Math.max(...weekCounts) === 1 ? '' : 's'} fechada${Math.max(...weekCounts) === 1 ? '' : 's'}. ${lateLast14Days === 0 ? 'Nenhuma entrega atrasou nos últimos 14 dias.' : `${lateLast14Days} entrega${lateLast14Days === 1 ? '' : 's'} atrasou nos últimos 14 dias.`}`
        : 'Ainda não há tarefas concluídas nesta semana.'

    return {
        monthLabel: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^\w/, c => c.toUpperCase()),
        stats: [
            { value: String(concludedThisMonth.length), label: 'tarefas no mês' },
            { value: onTimeRate === null ? '—' : `${onTimeRate}%`, label: 'entregas no prazo' },
            { value: String(inProgress), label: 'em andamento' }
        ],
        weekBars,
        productivityNote
    }
}
