import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../services/supabase'
import { Play, CheckCircle2, RotateCcw, PartyPopper, Activity } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import '../../styles/operationalFeed.css'

export default function OperationalFeed() {
    const [events, setEvents] = useState([])
    const [loading, setLoading] = useState(true)
    const listRef = useRef(null)

    useEffect(() => {
        fetchInitialEvents()
        const subscription = setupRealtimeSubscription()

        return () => {
            if (subscription) subscription.unsubscribe()
        }
    }, [])

    async function fetchInitialEvents() {
        try {
            setLoading(true)
            // Calculate 48h ago
            const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

            // Fetch recent micro-task activities (last 48h)
            const microPromise = supabase
                .from('tarefas_micro')
                .select(`
                    id,
                    status,
                    funcao,
                    updated_at,
                    profissionais!profissional_id(nome),
                    tarefas!tarefa_id(titulo)
                `)
                .neq('status', 'pendente') // Only show active/completed/returned
                .gt('updated_at', twoDaysAgo)
                .order('updated_at', { ascending: false })
                .limit(50)

            // Fetch recent macro-task (OS Simples) activities
            const macroPromise = supabase
                .from('tarefas')
                .select(`
                    id,
                    status,
                    updated_at,
                    profissionais!assigned_to(nome),
                    titulo
                `)
                .neq('status', 'pendente')
                .eq('has_micro_tasks', false) // Only OS Simples
                .gt('updated_at', twoDaysAgo)
                .order('updated_at', { ascending: false })
                .limit(50)

            const [microRes, macroRes] = await Promise.all([microPromise, macroPromise])

            if (microRes.error) throw microRes.error
            if (macroRes.error) throw macroRes.error

            const microEvents = (microRes.data || []).map(item => transformEvent(item, true))
            const macroEvents = (macroRes.data || []).map(item => transformEvent(item, false))

            const allEvents = [...microEvents, ...macroEvents]
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 50)

            setEvents(allEvents)
        } catch (error) {
            console.error('Error fetching feed:', error)
        } finally {
            setLoading(false)
        }
    }

    function setupRealtimeSubscription() {
        const microChannel = supabase
            .channel('operational-feed-micro')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'tarefas_micro'
                },
                async (payload) => {
                    const { data, error } = await supabase
                        .from('tarefas_micro')
                        .select(`
                            id,
                            status,
                            funcao,
                            updated_at,
                            profissionais!profissional_id(nome),
                            tarefas!tarefa_id(titulo)
                        `)
                        .eq('id', payload.new.id)
                        .single()

                    if (!error && data) {
                        handleNewEvent(data, true)
                    }
                }
            )
            .subscribe()

        const macroChannel = supabase
            .channel('operational-feed-macro')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'tarefas'
                },
                async (payload) => {
                    // Only process OS Simples
                    if (payload.new.has_micro_tasks) return;

                    const { data, error } = await supabase
                        .from('tarefas')
                        .select(`
                            id,
                            status,
                            updated_at,
                            profissionais!assigned_to(nome),
                            titulo
                        `)
                        .eq('id', payload.new.id)
                        .single()

                    if (!error && data) {
                        handleNewEvent(data, false)
                    }
                }
            )
            .subscribe()

        return {
            unsubscribe: () => {
                supabase.removeChannel(microChannel)
                supabase.removeChannel(macroChannel)
            }
        }
    }

    function handleNewEvent(rawEvent, isMicroTask) {
        const newEvent = transformEvent(rawEvent, isMicroTask)

        // Ignore if status is pending (reset)
        if (rawEvent.status === 'pendente') return

        setEvents(prev => {
            // I1: Deduplicate by ID (prevent realtime + refresh race)
            const eventId = newEvent.id
            const exists = prev.find(e => e.id === eventId)

            if (exists) {
                // Update existing event instead of duplicating
                return prev.map(e => e.id === eventId ? newEvent : e)
            }

            // Prepend new event
            const updated = [newEvent, ...prev]
            return updated.sort((a, b) => b.timestamp - a.timestamp).slice(0, 50) // Keep max 50 for scrolling
        })
    }

    function transformEvent(item, isMicroTask) {
        let type = 'unknown'
        if (item.status === 'em_progresso' || item.status === 'em_execucao' || item.status === 'fazendo') type = 'start'
        if (item.status === 'concluida' || item.status === 'feito') type = 'complete'
        if (item.status === 'devolvida') type = 'adjustment'

        const userName = item.profissionais?.nome || 'Alguém'
        const taskTitle = isMicroTask ? (item.tarefas?.titulo || 'Tarefa desconhecida') : item.titulo
        const itemName = isMicroTask ? item.funcao : 'OS Simples'

        return {
            id: item.id + '_' + item.updated_at, // Unique key for animation
            type,
            user: userName,
            action: getActionText(type, itemName),
            task: taskTitle,
            timestamp: new Date(item.updated_at)
        }
    }

    function getActionText(type, itemName) {
        switch (type) {
            case 'start':
                return <>Iniciou <strong>{itemName}</strong></>
            case 'complete':
                return <>Concluiu <strong>{itemName}</strong></>
            case 'adjustment':
                return <>Solicitou ajuste em <strong>{itemName}</strong></>
            default:
                return <>Atualizou <strong>{itemName}</strong></>
        }
    }

    function getIcon(type) {
        switch (type) {
            case 'start': return <Play size={14} fill="currentColor" />
            case 'complete': return <CheckCircle2 size={16} />
            case 'adjustment': return <RotateCcw size={14} />
            default: return <Activity size={16} />
        }
    }

    if (loading) {
        return (
            <div className="op-feed-empty">
                <div className="spinner-border text-primary" role="status"></div>
            </div>
        )
    }

    if (events.length === 0) {
        return (
            <div className="op-feed-empty">
                <Activity size={32} className="op-feed-empty-icon" />
                <p>Nenhuma atividade recente.</p>
            </div>
        )
    }

    return (
        <div className="card h-full flex flex-col">
            <div className="card-header flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Activity size={20} className="text-secondary" />
                    <h3 className="card-title">Feed Operacional</h3>
                </div>
            </div>

            <div className="op-feed-container flex-1" ref={listRef}>
                {events.map(event => (
                    <div key={event.id} className="op-event-item">
                        <div className={`op-event-icon ${event.type}`}>
                            {getIcon(event.type)}
                        </div>
                        <div className="op-event-content">
                            <div className="op-event-header">
                                <span className="op-event-user">{event.user}</span>
                                <span className="op-event-time">
                                    {formatDistanceToNow(event.timestamp, { addSuffix: true, locale: ptBR })
                                        .replace('cerca de ', '')}
                                </span>
                            </div>
                            <div className="op-event-action">
                                {event.action}
                            </div>
                            <div className="op-event-task">
                                {event.task}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
