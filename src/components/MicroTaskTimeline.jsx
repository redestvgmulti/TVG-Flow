import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'
import { Clock, CheckCircle, AlertTriangle, Lock } from 'lucide-react'
import { toast } from 'sonner'
import '../styles/sla-indicators.css'

function MicroTaskTimeline({ tarefaId, onRefresh }) {
    const [microTasks, setMicroTasks] = useState([])
    const [gargalo, setGargalo] = useState(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (tarefaId) {
            fetchMicroTasksWithSLA()
        }
    }, [tarefaId])

    async function fetchMicroTasksWithSLA() {
        try {
            setLoading(true)

            // Buscar micro tarefas via view SLA
            const { data: microData, error: microError } = await supabase
                .from('vw_micro_tarefas_sla')
                .select('*')
                .eq('tarefa_id', tarefaId)
                .order('created_at')

            if (microError) throw microError

            // 🔒 Filtrar apenas micro tarefas que têm SLA (deadline_at != NULL)
            const tasksWithSLA = (microData || []).filter(mt => mt.status_sla !== 'sem_sla')

            setMicroTasks(tasksWithSLA)

            // Se há micro tarefas com SLA, buscar gargalo
            if (tasksWithSLA.length > 0) {
                const { data: gargaloData, error: gargaloError } = await supabase
                    .rpc('identificar_gargalo', { p_tarefa_id: tarefaId })

                if (gargaloError) throw gargaloError
                setGargalo(gargaloData && gargaloData.length > 0 ? gargaloData[0] : null)
            }

        } catch (error) {
            console.error('Error fetching SLA data:', error)
            toast.error('Erro ao carregar SLA')
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return <div className="micro-task-timeline-loading">Carregando SLA...</div>
    }

    // Se não há micro tarefas com SLA, não renderizar
    if (microTasks.length === 0) {
        return (
            <div className="sla-empty-state">
                <p>Nenhuma micro tarefa com SLA nesta OS.</p>
                <small>Defina prazos individuais para ativar o rastreamento SLA.</small>
            </div>
        )
    }

    return (
        <div className="micro-task-timeline">
            <div className="timeline-header">
                <h4>Timeline de Etapas (SLA)</h4>
                <span className="timeline-count">{microTasks.length} etapa(s) com prazo</span>
            </div>

            <div className="timeline-stages">
                {microTasks.map((mt) => {
                    const isGargalo = gargalo && gargalo.micro_task_id === mt.id
                    const slaClass = `timeline-stage ${mt.status_sla} ${isGargalo ? 'gargalo' : ''}`

                    return (
                        <div key={mt.id} className={slaClass}>
                            {/* Profissional */}
                            <div className="stage-professional">
                                <strong>{mt.profissional_nome}</strong>
                            </div>

                            {/* Prazo */}
                            <div className="stage-deadline">
                                <Clock size={12} />
                                <span>
                                    {new Date(mt.deadline_at).toLocaleString('pt-BR', {
                                        day: '2-digit',
                                        month: '2-digit',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}
                                </span>
                            </div>

                            {/* Status */}
                            <div className={`stage-status ${mt.status_sla}`}>
                                {mt.status_sla === 'concluida' && <CheckCircle size={14} />}
                                {mt.status_sla === 'atrasada' && <AlertTriangle size={14} />}
                                {mt.status_sla === 'proximo_prazo' && <Clock size={14} />}
                                <span>{getStatusLabel(mt.status_sla)}</span>
                            </div>

                            {/* Tempo de atraso (se atrasada) */}
                            {mt.atrasada && (
                                <div className="stage-overdue-time">
                                    Atraso: {Math.round(mt.tempo_atraso_minutos / 60)}h
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Alerta de Gargalo */}
            {gargalo && (
                <div className="gargalo-alert">
                    <AlertTriangle size={16} />
                    <div>
                        <strong>Etapa travando o fluxo:</strong> {gargalo.profissional_nome}
                        <br />
                        <small>Atrasada há {Math.round(gargalo.tempo_atraso_minutos / 60)} hora(s)</small>
                    </div>
                </div>
            )}
        </div>
    )
}

function getStatusLabel(statusSLA) {
    switch (statusSLA) {
        case 'concluida': return 'Concluída'
        case 'atrasada': return 'Atrasada'
        case 'proximo_prazo': return 'Próximo ao Prazo'
        case 'no_prazo': return 'No Prazo'
        default: return 'Sem SLA'
    }
}

export default MicroTaskTimeline
