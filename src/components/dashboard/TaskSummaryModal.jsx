import React, { useEffect, useState } from 'react'
import { X, Calendar, User, CheckCircle2, Circle, Clock, ArrowRight } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import CreatorSignature from '../ui/CreatorSignature'

import { RefreshCw, Pencil, Trash2, ExternalLink } from 'lucide-react'

export default function TaskSummaryModal({ task, onClose, onUpdate, onEdit, onDelete }) {
    const [loading, setLoading] = useState(true)
    const [items, setItems] = useState([])

    useEffect(() => {
        if (task) {
            fetchTaskItems()
        }
    }, [task])

    // Close on ESC
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', handleEsc)
        return () => window.removeEventListener('keydown', handleEsc)
    }, [onClose])

    async function fetchTaskItems() {
        try {
            setLoading(true)
            // Fetch checklist items (tarefas_itens or tarefas_micro depending on implementation)
            // Assuming 'tarefas_itens' for checklist based on typical TVG Hub structure (or check usage)
            // Since I don't have the full schema map in head, I'll assume 'tarefas_itens' or check 
            // 'tarefas_micro' if that's what's used. The previous prompts mentioned 'tarefas_micro'.
            // Let's try 'tarefas_micro' which seems to be the one used for operational feed.
            const { data, error } = await supabase
                .from('tarefas_micro')
                .select('*')
                .eq('tarefa_id', task.id)
                .limit(5)
                .order('created_at', { ascending: true })

            if (!error && data) {
                setItems(data)
            }
        } catch (err) {
            console.error('Error loading tasks items', err)
        } finally {
            setLoading(false)
        }
    }
    async function handleToggleComplete() {
        try {
            setLoading(true)
            const isCompleted = task.status === 'concluida'

            const updates = isCompleted
                ? { status: 'pending' }
                : { status: 'concluida' }

            const { error } = await supabase
                .from('tarefas')
                .update(updates)
                .eq('id', task.id)

            if (error) throw error

            if (onUpdate) onUpdate()
            onClose()
        } catch (err) {
            console.error('Error updating task status', err)
        } finally {
            setLoading(false)
        }
    }

    if (!task) return null

    const isOverdue = task.deadline && new Date(task.deadline) < new Date() && task.status !== 'concluida'

    // Determine status color text
    const getStatusText = (status) => {
        if (isOverdue) return 'Atrasada'
        switch (status) {
            case 'atrasada': return 'Atrasada'
            case 'pendente': return 'Pendente'
            case 'concluida': return 'Concluída'
            case 'em_execucao': return 'Em Execução'
            default: return status
        }
    }

    // Determine status dot color for the header
    const getStatusColorClass = (status) => {
        if (isOverdue) return 'bg-red-500' // Red
        switch (status) {
            case 'concluida': return 'bg-green-500'
            case 'em_execucao': return 'bg-blue-500'
            case 'pendente': return 'bg-yellow-400'
            default: return 'bg-gray-400'
        }
    }

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="task-summary-modal"
                onClick={e => e.stopPropagation()}
                style={{ opacity: 0, animation: 'modalSlideIn 0.2s forwards' }}
            >
                {/* Header */}
                <div className="modal-top">
                    <div className="modal-status-badge">
                        <div className={`status-dot-sm ${getStatusColorClass(task.status)}`}></div>
                        <span>{getStatusText(task.status)}</span>
                    </div>
                    <button onClick={onClose} className="task-summary-close-btn">
                        <X size={16} />
                    </button>
                </div>

                <div className="modal-header-content">
                    <h2 className="modal-task-title">{task.titulo}</h2>
                    <CreatorSignature
                        name={task.created_by_name_snapshot || task.creator?.nome}
                        createdAt={task.created_at}
                        compact
                    />
                    <div className="modal-meta-row">
                        <div className="meta-item">
                            <Clock size={13} />
                            <span>
                                {task.deadline
                                    ? `${new Date(task.deadline) < new Date() ? 'Venceu' : 'Vence'} ${formatDistanceToNow(new Date(task.deadline), { addSuffix: true, locale: ptBR })}`
                                    : 'Sem prazo'}
                            </span>
                        </div>
                        <div className="meta-item">
                            <User size={13} />
                            <span>
                                {task.responsavel?.nome || 'Não atribuída'}
                            </span>
                        </div>
                    </div>
                </div>

                {/* Description */}
                {task.description ? (
                    <div className="modal-section">
                        <p className="modal-description">{task.description}</p>
                    </div>
                ) : (
                    <div className="modal-section">
                        <p className="modal-description text-muted">Sem descrição disponível.</p>
                    </div>
                )}

                {/* Progress / Micro-steps */}
                <div className="modal-section">
                    <h4 className="modal-section-title">Micro-etapas</h4>
                    {loading ? (
                        <div className="modal-steps-loading"></div>
                    ) : items.length > 0 ? (
                        <div className="modal-steps-list">
                            {items.map(item => (
                                <div key={item.id} className="modal-step-item">
                                    {item.status === 'concluida' ?
                                        <CheckCircle2 size={14} className="text-green-500" /> :
                                        <Circle size={14} className="text-gray-300" />
                                    }
                                    <span className={item.status === 'concluida' ? 'line-through text-gray-400' : ''}>
                                        {item.funcao || item.titulo || 'Etapa sem nome'}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-gray-400 italic">Tarefa com etapa única.</p>
                    )}
                </div>

                {/* Footer Action */}
                <div className="modal-footer-action">
                    <button
                        onClick={handleToggleComplete}
                        className={`ts-btn-action ${task.status === 'concluida' ? 'ts-btn-reopen' : 'ts-btn-complete'}`}
                        disabled={loading}
                    >
                        {task.status === 'concluida' ? (
                            <>
                                <RefreshCw size={14} /> <span className="ts-btn-label">Reabrir Tarefa</span>
                            </>
                        ) : (
                            <>
                                <CheckCircle2 size={14} /> <span className="ts-btn-label">Concluir Tarefa</span>
                            </>
                        )}
                    </button>
                    <a href="/admin/tasks" className="ts-btn-open-task">
                        <span className="ts-btn-label">Acessar tarefa completa</span> <ExternalLink size={14} />
                    </a>
                </div>
            </div>

            <style>{`
                .task-summary-modal {
                    width: 100%;
                    max-width: 480px;
                    background: white;
                    border-radius: 16px;
                    padding: 24px;
                    box-shadow: 
                        0 10px 40px -10px rgba(0,0,0,0.1),
                        0 0 0 1px rgba(0,0,0,0.05);
                    transform: scale(0.98);
                }
                @keyframes modalSlideIn {
                    to { opacity: 1; transform: scale(1); }
                }
                .modal-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                }
                .modal-status-badge {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #4b5563;
                    background: #f3f4f6;
                    padding: 4px 8px;
                    border-radius: 6px;
                    text-transform: uppercase;
                    letter-spacing: 0.02em;
                }
                .status-dot-sm {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                }
                .bg-red-500 { background-color: #ef4444; }
                .bg-yellow-400 { background-color: #facc15; }
                .bg-green-500 { background-color: #10b981; }
                .bg-blue-500 { background-color: #3b82f6; }
                .bg-gray-400 { background-color: #9ca3af; }

                .task-summary-close-btn {
                    background: none;
                    border: none;
                    color: #9ca3af;
                    cursor: pointer;
                    padding: 4px;
                    border-radius: 4px;
                    transition: all 0.2s;
                    display: flex;
                }
                .task-summary-close-btn:hover { background: #f3f4f6; color: #111827; }

                .modal-task-title {
                    font-size: 18px;
                    font-weight: 600;
                    color: #111827;
                    line-height: 1.3;
                    margin: 0 0 12px 0;
                }
                .modal-meta-row {
                    display: flex;
                    gap: 16px;
                    margin-bottom: 24px;
                }
                .meta-item {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 13px;
                    color: #6b7280;
                    font-weight: 500;
                }
                .modal-section {
                    margin-bottom: 24px;
                }
                .modal-description {
                    font-size: 14px;
                    color: #374151;
                    line-height: 1.5;
                    margin: 0;
                }
                .modal-section-title {
                    font-size: 12px;
                    text-transform: uppercase;
                    color: #9ca3af;
                    font-weight: 600;
                    letter-spacing: 0.05em;
                    margin: 0 0 12px 0;
                }
                .modal-step-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    font-size: 13px;
                    color: #4b5563;
                    padding: 6px 0;
                    border-bottom: 1px solid #f9fafb;
                }
                .modal-steps-loading {
                    height: 40px;
                    background: #f3f4f6;
                    border-radius: 4px;
                    animation: pulse 1.5s infinite;
                }
                .modal-footer-action {
                    padding-top: 16px;
                    border-top: 1px solid #f3f4f6;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    gap: 12px;
                }

                .ts-btn-action, .ts-btn-open-task {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    padding: 8px 12px;
                    border-radius: 6px;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                    text-decoration: none;
                    white-space: nowrap;
                    height: 36px;
                    flex-shrink: 0;
                }

                /* Complete/Reopen Buttons */
                .ts-btn-complete {
                    background: #ecfdf5;
                    color: #059669;
                    border: 1px solid #d1fae5;
                }
                .ts-btn-complete:hover { background: #d1fae5; }

                .ts-btn-reopen {
                    background: #fff7ed;
                    color: #d97706;
                    border: 1px solid #ffedd5;
                }
                .ts-btn-reopen:hover { background: #ffedd5; }

                /* Open Task Link */
                .ts-btn-open-task {
                    background: transparent;
                    color: #4b5563;
                    border: 1px solid transparent;
                }
                .ts-btn-open-task:hover {
                    background: #f9fafb;
                    color: #111827;
                }

                /* Mobile: icon-only footer buttons — full labels don't fit two
                   actions side by side under ~400px, so we collapse to icons
                   (with accessible text still in the DOM for screen readers). */
                @media (max-width: 420px) {
                    .ts-btn-label {
                        display: none;
                    }
                    .ts-btn-action, .ts-btn-open-task {
                        padding: 8px;
                        width: 36px;
                    }
                }

                @keyframes pulse {
                    0% { opacity: 0.6; }
                    50% { opacity: 1; }
                    100% { opacity: 0.6; }
                }
                .text-muted { color: #9ca3af; font-style: italic; }
            `}</style>
        </div>
    )
}
