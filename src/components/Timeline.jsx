import React from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { supabase } from '../services/supabase'
import {
    MessageCircle,
    CheckCircle,
    Clock,
    User,
    AlertCircle,
    Calendar,
    Edit2,
    ArrowRight,
    Workflow,
    Trash2,
    Plus,
    MessageSquare,
    Check
} from 'lucide-react'
import '../styles/timeline.css'

/**
 * Componente Timeline - ETAPA 3
 * Renderiza timeline unificada de eventos e comentários de uma OS
 * Usa os_timeline_view do backend
 */
export default function Timeline({ osId, user }) {
    const [timeline, setTimeline] = React.useState([])
    const [loading, setLoading] = React.useState(true)
    const [error, setError] = React.useState(null)

    React.useEffect(() => {
        if (osId) {
            loadTimeline()
        }
    }, [osId])

    async function loadTimeline() {
        try {
            setLoading(true)

            const { data, error: fetchError } = await supabase
                .from('os_timeline_view')
                .select('*')
                .eq('os_id', osId)
                .order('created_at', { ascending: true })

            if (fetchError) throw fetchError

            setTimeline(data || [])
        } catch (err) {
            console.error('Erro ao carregar timeline:', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    if (loading) {
        return (
            <div className="timeline-loading">
                <Clock className="spin" size={24} />
                <p>Carregando timeline...</p>
            </div>
        )
    }

    if (error) {
        return (
            <div className="timeline-error">
                <AlertCircle size={24} />
                <p>Erro ao carregar timeline: {error}</p>
            </div>
        )
    }

    if (timeline.length === 0) {
        return (
            <div className="timeline-empty">
                <MessageCircle size={32} />
                <p>Nenhum evento ou comentário ainda</p>
            </div>
        )
    }

    return (
        <div className="timeline-container">
            <h3 className="timeline-title">
                <Clock size={18} />
                Timeline
            </h3>

            <div className="timeline-items">
                {timeline.map((item) => {
                    if (item.item_tipo === 'comentario') {
                        return (
                            <ComentarioCard
                                key={`comentario-${item.id}`}
                                comentario={item}
                                currentUser={user}
                                onRefresh={loadTimeline}
                            />
                        )
                    } else {
                        return (
                            <EventoCard
                                key={`evento-${item.id}`}
                                evento={item}
                            />
                        )
                    }
                })}
            </div>
        </div>
    )
}

/**
 * Componente ComentarioCard - ETAPA 3
 * Renderiza um comentário individual na timeline
 */
function ComentarioCard({ comentario, currentUser, onRefresh }) {
    const [isEditing, setIsEditing] = React.useState(false)
    const [editContent, setEditContent] = React.useState(comentario.texto)
    const [isDeleting, setIsDeleting] = React.useState(false)

    const isAuthor = comentario.autor_id === currentUser?.id
    const canEdit = isAuthor && isWithinEditWindow(comentario.created_at)

    function isWithinEditWindow(createdAt) {
        const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000)
        return new Date(createdAt) > fifteenMinutesAgo
    }

    async function handleEdit() {
        if (!editContent.trim()) {
            alert('Comentário não pode estar vazio')
            return
        }

        try {
            const { error } = await supabase
                .from('task_comments')
                .update({
                    content: editContent.trim(),
                    editado: true
                })
                .eq('id', comentario.id)

            if (error) throw error

            setIsEditing(false)
            onRefresh()
        } catch (err) {
            console.error('Erro ao editar comentário:', err)
            alert('Erro ao editar comentário')
        }
    }

    async function handleDelete() {
        if (!confirm('Deseja realmente excluir este comentário?')) return

        try {
            setIsDeleting(true)

            // Soft delete
            const { error } = await supabase
                .from('task_comments')
                .update({ deleted_at: new Date().toISOString() })
                .eq('id', comentario.id)

            if (error) throw error

            onRefresh()
        } catch (err) {
            console.error('Erro ao excluir comentário:', err)
            alert('Erro ao excluir comentário')
        } finally {
            setIsDeleting(false)
        }
    }

    return (
        <div className="timeline-item timeline-item-comentario">
            <div className="timeline-icon">
                <MessageCircle size={16} />
            </div>

            <div className="timeline-content">
                <div className="timeline-header">
                    <div className="timeline-author">
                        <User size={14} />
                        <strong>{comentario.autor_nome || 'Usuário desconhecido'}</strong>
                    </div>
                    <div className="timeline-meta">
                        <span className="timeline-time">
                            {formatDistanceToNow(new Date(comentario.created_at), {
                                addSuffix: true,
                                locale: ptBR
                            })}
                        </span>
                        {comentario.editado && (
                            <span className="timeline-edited">
                                <Edit2 size={12} />
                                editado
                            </span>
                        )}
                    </div>
                </div>

                {isEditing ? (
                    <div className="timeline-edit-form">
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            maxLength={5000}
                            rows={3}
                        />
                        <div className="timeline-edit-actions">
                            <button onClick={handleEdit} className="btn-primary">
                                Salvar
                            </button>
                            <button onClick={() => setIsEditing(false)} className="btn-secondary">
                                Cancelar
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <p className="timeline-text">{comentario.texto}</p>

                        {isAuthor && (
                            <div className="timeline-actions">
                                {canEdit && (
                                    <button
                                        onClick={() => setIsEditing(true)}
                                        className="timeline-btn-edit"
                                    >
                                        <Edit2 size={14} />
                                        Editar
                                    </button>
                                )}
                                <button
                                    onClick={handleDelete}
                                    disabled={isDeleting}
                                    className="timeline-btn-delete"
                                >
                                    Excluir
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

/**
 * Componente para exibir um evento do sistema
 */
function EventoCard({ evento }) {
    function getEventoInfo(evento) {
        const { tipo, metadata } = evento

        switch (tipo) {
            case 'criacao':
                return {
                    icon: Plus,
                    status: 'neutral',
                    text: 'Tarefa criada'
                }

            case 'status_alterado':
                const mapStatus = {
                    pendente: { text: 'Pendente', status: 'neutral' },
                    em_progresso: { text: 'Em Progresso', status: 'info' },
                    concluida: { text: 'Concluída', status: 'success' },
                    bloqueada: { text: 'Bloqueada', status: 'warning' },
                    cancelada: { text: 'Cancelada', status: 'danger' },
                    devolvida: { text: 'Devolvida', status: 'danger' }
                }
                const st = mapStatus[metadata.novo_status] || { text: metadata.novo_status, status: 'neutral' }
                return {
                    icon: CheckCircle,
                    status: st.status,
                    text: `Status alterado para ${st.text}`
                }

            case 'comentario_adicionado':
                return {
                    icon: MessageSquare,
                    status: 'neutral',
                    text: 'Comentário adicionado'
                }

            case 'convertida_workflow':
                return {
                    icon: Workflow,
                    status: 'info',
                    text: `Convertida em Workflow (${metadata.etapas_criadas || '?'} etapas)`
                }

            case 'prazo_alterado':
                const dataFormatada = metadata.para
                    ? format(new Date(metadata.para), "dd/MM/yyyy", { locale: ptBR })
                    : 'Sem prazo'
                return {
                    icon: Calendar,
                    status: 'warning',
                    text: `Prazo alterado para ${dataFormatada}`
                }

            case 'titulo_alterado':
                return {
                    icon: Edit2,
                    status: 'info',
                    text: `Título alterado`
                }

            case 'responsavel_reatribuido':
                return {
                    icon: User,
                    status: 'info',
                    text: 'Responsável alterado'
                }

            case 'os_excluida':
                return {
                    icon: Trash2,
                    status: 'danger',
                    text: 'Ordem de Serviço excluída'
                }

            case 'etapa_adicionada':
                return {
                    icon: Plus,
                    status: 'success',
                    text: `Etapa adicionada: ${metadata.descricao || ''}`
                }

            default:
                return {
                    icon: AlertCircle,
                    status: 'neutral',
                    text: 'Evento registrado'
                }
        }
    }

    const info = getEventoInfo(evento)
    const Icon = info.icon

    return (
        <div className="timeline-item-evento">
            <div className={`timeline-sphere sphere-${info.status}`}>
                <Icon size={14} strokeWidth={3} />
            </div>
            <div className="timeline-content-wrapper">
                <div className="timeline-event-text">
                    {info.text}
                </div>
                <div className="timeline-event-time">
                    {formatDistanceToNow(new Date(evento.created_at), {
                        addSuffix: true,
                        locale: ptBR
                    })}
                </div>
            </div>
        </div>
    )
}
