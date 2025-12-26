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
            const { data, error } = await supabase
                .from('tarefas_micro')
                .select(`
                    id,
                    status,
                    funcao,
                    updated_at,
                    profissional:profissionais(nome),
                    tarefa:tarefas(titulo)
                `)
                .neq('status', 'pendente') // Only show active/completed/returned
                .gt('updated_at', twoDaysAgo)
                .order('updated_at', { ascending: false })
                .limit(50) // Allow scrolling for up to 50 recent events

            if (error) throw error

            const formattedEvents = data.map(transformEvent)
            setEvents(formattedEvents)
        } catch (error) {
            console.error('Error fetching feed:', error)
        } finally {
            setLoading(false)
        }
    }

    function setupRealtimeSubscription() {
        return supabase
            .channel('operational-feed')
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'tarefas_micro'
                },
                async (payload) => {
                    // Fetch full details for the updated row to get relations
                    const { data, error } = await supabase
                        .from('tarefas_micro')
                        .select(`
                            id,
                            status,
                            funcao,
                            updated_at,
                            profissional:profissionais(nome),
                            tarefa:tarefas(titulo)
                        `)
                        .eq('id', payload.new.id)
                        .single()

                    if (!error && data) {
                        handleNewEvent(data)
                    }
                }
            )
            .subscribe()
    }

    function handleNewEvent(rawEvent) {
        const newEvent = transformEvent(rawEvent)

        // Ignore if status is pending (reset)
        if (rawEvent.status === 'pendente') return

        setEvents(prev => {
            const updated = [newEvent, ...prev]
            return updated.slice(0, 50) // Keep max 50 for scrolling
        })
    }

    function transformEvent(item) {
        let type = 'unknown'
        if (item.status === 'em_progresso' || item.status === 'em_execucao' || item.status === 'fazendo') type = 'start'
        if (item.status === 'concluida' || item.status === 'feito') type = 'complete'
        if (item.status === 'devolvida') type = 'adjustment'

        return {
            id: item.id + '_' + item.updated_at, // Unique key for animation
            type,
            user: item.profissional?.nome || 'Alguém',
            action: getActionText(type, item.funcao),
            task: item.tarefa?.titulo || 'Tarefa desconhecida',
            timestamp: new Date(item.updated_at)
        }
    }

    function getActionText(type, microTaskName) {
        switch (type) {
            case 'start':
                return <>Iniciou <strong>{microTaskName}</strong></>
            case 'complete':
                return <>Concluiu <strong>{microTaskName}</strong></>
            case 'adjustment':
                return <>Solicitou ajuste em <strong>{microTaskName}</strong></>
            default:
                return <>Atualizou <strong>{microTaskName}</strong></>
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
        <div className="op-feed-container" ref={listRef}>
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
    )
}
