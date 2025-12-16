import React, { useState, useEffect } from 'react';
import { createTask, updateTask } from '../../services/taskService';
import { X } from 'lucide-react';
import './Modal.css';

const TaskFormModal = ({
    isOpen,
    onClose,
    onSave,
    task,
    clients = [],
    departments = [],
    professionals = []
}) => {
    const [formData, setFormData] = useState({
        titulo: '',
        descricao: '',
        cliente_id: '',
        departamento_id: '',
        profissional_id: '',
        prioridade: 'media',
        deadline: '',
        status: 'pendente',
        research_link: '',
        final_link: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (task) {
            // Format datetime-local string (YYYY-MM-DDTHH:mm)
            const deadlineRaw = task.deadline ? new Date(task.deadline) : new Date();
            const deadlineString = deadlineRaw.toISOString().slice(0, 16);

            setFormData({
                titulo: task.titulo,
                descricao: task.descricao || '',
                cliente_id: task.cliente_id,
                departamento_id: task.departamento_id,
                profissional_id: task.profissional_id || '',
                prioridade: task.prioridade,
                deadline: deadlineString,
                status: task.status,
                research_link: task.research_link || '',
                final_link: task.final_link || ''
            });
        } else {
            // Default deadline: tomorrow same time
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setMinutes(0);

            setFormData({
                titulo: '',
                descricao: '',
                cliente_id: '',
                departamento_id: '',
                profissional_id: '',
                prioridade: 'media',
                deadline: tomorrow.toISOString().slice(0, 16),
                status: 'pendente',
                research_link: '',
                final_link: ''
            });
        }
    }, [task]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (task) {
                await updateTask(task.id, formData);
            } else {
                await createTask(formData);
            }
            onSave();
        } catch (err) {
            console.error(err);
            setError('Erro ao salvar tarefa: ' + err.message);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content" style={{ maxWidth: '600px' }}>
                <div className="modal-header">
                    <h2>{task ? 'Editar Tarefa' : 'Nova Tarefa'}</h2>
                    <button onClick={onClose} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="modal-form">
                    {error && <div className="error-message">{error}</div>}

                    <div className="form-group">
                        <label>Título</label>
                        <input
                            type="text"
                            name="titulo"
                            value={formData.titulo}
                            onChange={handleChange}
                            required
                            minLength={3}
                        />
                    </div>

                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="form-group">
                            <label>Cliente</label>
                            <select
                                name="cliente_id"
                                value={formData.cliente_id}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Selecione...</option>
                                {clients.map(c => (
                                    <option key={c.id} value={c.id}>{c.nome}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Departamento</label>
                            <select
                                name="departamento_id"
                                value={formData.departamento_id}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Selecione...</option>
                                {departments.map(d => (
                                    <option key={d.id} value={d.id}>{d.nome}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div className="form-group">
                            <label>Profissional Responsável</label>
                            <select
                                name="profissional_id"
                                value={formData.profissional_id}
                                onChange={handleChange}
                                required
                            >
                                <option value="">Selecione...</option>
                                {professionals.map(p => (
                                    <option key={p.id} value={p.id}>{p.nome}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Prazo (Deadline)</label>
                            <input
                                type="datetime-local"
                                name="deadline"
                                value={formData.deadline}
                                onChange={handleChange}
                                required
                            />
                        </div>
                    </div>

                    <div className="form-row">
                        <div className="form-group">
                            <label>Prioridade</label>
                            <select
                                name="prioridade"
                                value={formData.prioridade}
                                onChange={handleChange}
                            >
                                <option value="baixa">Baixa</option>
                                <option value="media">Média</option>
                                <option value="alta">Alta</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Status</label>
                            <select
                                name="status"
                                value={formData.status}
                                onChange={handleChange}
                            >
                                <option value="pendente">Pendente</option>
                                <option value="em_andamento">Em Andamento</option>
                                <option value="concluida">Concluída</option>
                            </select>
                        </div>
                    </div>

                    <div className="form-group">
                        <label>Descrição</label>
                        <textarea
                            name="descricao"
                            value={formData.descricao}
                            onChange={handleChange}
                            rows={3}
                        />
                    </div>

                    <div className="form-group">
                        <label>Link de Pesquisa</label>
                        <input
                            type="url"
                            name="research_link"
                            value={formData.research_link}
                            onChange={handleChange}
                            placeholder="https://..."
                        />
                    </div>

                    <div className="form-group">
                        <label>Link Final</label>
                        <input
                            type="url"
                            name="final_link"
                            value={formData.final_link}
                            onChange={handleChange}
                            placeholder="https://..."
                        />
                    </div>

                    <div className="form-actions">
                        <button type="button" onClick={onClose} className="btn-secondary">
                            Cancelar
                        </button>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Salvando...' : 'Salvar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default TaskFormModal;
