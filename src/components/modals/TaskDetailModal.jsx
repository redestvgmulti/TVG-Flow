import React, { useState, useEffect } from 'react';
import Modal from './Modal';
import { updateTask, deleteTask, getActiveProfessionals, validateStatusChange } from '../../services/taskService';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import './TaskDetailModal.css';

const TaskDetailModal = ({ isOpen, task, onClose, onUpdate, onDelete }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [professionals, setProfessionals] = useState([]);
    const [formData, setFormData] = useState({
        status: '',
        profissional_id: '',
    });
    const [error, setError] = useState('');

    // Carregar profissionais quando abrir
    useEffect(() => {
        if (isOpen) {
            loadProfessionals();
            if (task) {
                setFormData({
                    status: task.status,
                    profissional_id: task.profissional_id,
                });
            }
        }
    }, [isOpen, task]);

    const loadProfessionals = async () => {
        try {
            const data = await getActiveProfessionals();
            setProfessionals(data);
        } catch (err) {
            console.error('Erro ao carregar profissionais:', err);
        }
    };

    const handleStatusChange = (newStatus) => {
        const validation = validateStatusChange(task.status, newStatus);
        if (!validation.isValid) {
            setError(validation.error);
            return;
        }
        setFormData({ ...formData, status: newStatus });
        setError('');
    };

    const handleSave = async () => {
        setIsSaving(true);
        setError('');

        try {
            const updates = {};

            if (formData.status !== task.status) {
                updates.status = formData.status;
            }

            if (formData.profissional_id !== task.profissional_id) {
                updates.profissional_id = formData.profissional_id;
            }

            if (Object.keys(updates).length > 0) {
                const updatedTask = await updateTask(task.id, updates);
                onUpdate && onUpdate(updatedTask);
            }

            setIsEditing(false);
            onClose();
        } catch (err) {
            setError('Erro ao salvar alterações: ' + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await deleteTask(task.id);
            onDelete && onDelete(task.id);
            onClose();
        } catch (err) {
            setError('Erro ao excluir tarefa: ' + err.message);
        } finally {
            setIsDeleting(false);
            setShowDeleteConfirm(false);
        }
    };

    if (!task) return null;

    const getStatusLabel = (status) => {
        const labels = {
            pendente: '⏳ Pendente',
            em_andamento: '🔄 Em Andamento',
            concluida: '✅ Concluída',
        };
        return labels[status] || status;
    };

    const getPriorityLabel = (priority) => {
        const labels = {
            alta: '🔴 Alta',
            media: '🟡 Média',
            baixa: '🟢 Baixa',
        };
        return labels[priority] || priority;
    };

    const footer = (
        <>
            {!isEditing ? (
                <>
                    <button
                        className="btn-delete"
                        onClick={() => setShowDeleteConfirm(true)}
                    >
                        Excluir
                    </button>
                    <button
                        className="btn-secondary"
                        onClick={onClose}
                    >
                        Fechar
                    </button>
                    <button
                        className="btn-primary"
                        onClick={() => setIsEditing(true)}
                    >
                        Editar
                    </button>
                </>
            ) : (
                <>
                    <button
                        className="btn-secondary"
                        onClick={() => {
                            setIsEditing(false);
                            setFormData({
                                status: task.status,
                                profissional_id: task.profissional_id,
                            });
                            setError('');
                        }}
                        disabled={isSaving}
                    >
                        Cancelar
                    </button>
                    <button
                        className="btn-primary"
                        onClick={handleSave}
                        disabled={isSaving}
                    >
                        {isSaving ? 'Salvando...' : 'Salvar'}
                    </button>
                </>
            )}
        </>
    );

    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={task.titulo}
                footer={footer}
                size="large"
            >
                <div className="task-detail">
                    {error && (
                        <div className="task-detail-error">
                            {error}
                        </div>
                    )}

                    {/* Status e Prioridade */}
                    <div className="task-detail-row">
                        <div className="task-detail-field">
                            <label>Status</label>
                            {isEditing ? (
                                <select
                                    value={formData.status}
                                    onChange={(e) => handleStatusChange(e.target.value)}
                                    className="task-detail-select"
                                >
                                    <option value="pendente">⏳ Pendente</option>
                                    <option value="em_andamento">🔄 Em Andamento</option>
                                    <option value="concluida">✅ Concluída</option>
                                </select>
                            ) : (
                                <div className={`task-detail-badge status-${task.status}`}>
                                    {getStatusLabel(task.status)}
                                </div>
                            )}
                        </div>

                        <div className="task-detail-field">
                            <label>Prioridade</label>
                            <div className={`task-detail-badge priority-${task.prioridade}`}>
                                {getPriorityLabel(task.prioridade)}
                            </div>
                        </div>
                    </div>

                    {/* Cliente e Profissional */}
                    <div className="task-detail-row">
                        <div className="task-detail-field">
                            <label>Cliente</label>
                            <div className="task-detail-value">
                                {task.clientes?.nome || 'Sem cliente'}
                            </div>
                        </div>

                        <div className="task-detail-field">
                            <label>Profissional</label>
                            {isEditing ? (
                                <select
                                    value={formData.profissional_id}
                                    onChange={(e) => setFormData({ ...formData, profissional_id: e.target.value })}
                                    className="task-detail-select"
                                >
                                    {professionals.map((prof) => (
                                        <option key={prof.id} value={prof.id}>
                                            {prof.nome}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <div className="task-detail-value">
                                    {task.profissionais?.nome || 'Não atribuída'}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Departamento e Deadline */}
                    <div className="task-detail-row">
                        <div className="task-detail-field">
                            <label>Departamento</label>
                            {task.departamentos && (
                                <div
                                    className="task-detail-department"
                                    style={{
                                        backgroundColor: `${task.departamentos.cor_hex}20`,
                                        color: task.departamentos.cor_hex,
                                        borderColor: `${task.departamentos.cor_hex}40`,
                                    }}
                                >
                                    {task.departamentos.nome}
                                </div>
                            )}
                        </div>

                        <div className="task-detail-field">
                            <label>Deadline</label>
                            <div className="task-detail-value">
                                {new Date(task.deadline).toLocaleString('pt-BR')}
                                <span className="task-detail-relative">
                                    ({formatDistanceToNow(new Date(task.deadline), { locale: ptBR, addSuffix: true })})
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Descrição */}
                    {task.descricao && (
                        <div className="task-detail-field">
                            <label>Descrição</label>
                            <div className="task-detail-description">
                                {task.descricao}
                            </div>
                        </div>
                    )}

                    {/* Datas de criação e atualização */}
                    <div className="task-detail-meta">
                        <span>Criada {formatDistanceToNow(new Date(task.created_at), { locale: ptBR, addSuffix: true })}</span>
                        {task.updated_at && task.updated_at !== task.created_at && (
                            <>
                                <span className="task-separator">•</span>
                                <span>Atualizada {formatDistanceToNow(new Date(task.updated_at), { locale: ptBR, addSuffix: true })}</span>
                            </>
                        )}
                    </div>
                </div>
            </Modal>

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
                <Modal
                    isOpen={showDeleteConfirm}
                    onClose={() => setShowDeleteConfirm(false)}
                    title="Confirmar Exclusão"
                    size="small"
                    footer={
                        <>
                            <button
                                className="btn-secondary"
                                onClick={() => setShowDeleteConfirm(false)}
                                disabled={isDeleting}
                            >
                                Cancelar
                            </button>
                            <button
                                className="btn-danger"
                                onClick={handleDelete}
                                disabled={isDeleting}
                            >
                                {isDeleting ? 'Excluindo...' : 'Excluir'}
                            </button>
                        </>
                    }
                >
                    <p>Tem certeza que deseja excluir a tarefa <strong>{task.titulo}</strong>?</p>
                    <p className="text-danger">Esta ação não pode ser desfeita.</p>
                </Modal>
            )}
        </>
    );
};

export default TaskDetailModal;
