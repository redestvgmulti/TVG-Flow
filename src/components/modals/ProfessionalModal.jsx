import React, { useState, useEffect } from 'react';
import { professionalService } from '../../services/professionalService';
import { X } from 'lucide-react';
import './Modal.css'; // Reusing generic modal styles if available, or creating new

const ProfessionalModal = ({ isOpen, onClose, onSave, professional, departments }) => {
    const [formData, setFormData] = useState({
        nome: '',
        email: '',
        departamento_id: '',
        ativo: true
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (professional) {
            setFormData({
                nome: professional.nome,
                email: professional.email,
                departamento_id: professional.departamento_id || '',
                ativo: professional.ativo
            });
        } else {
            setFormData({
                nome: '',
                email: '',
                departamento_id: '',
                ativo: true
            });
        }
    }, [professional]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            if (professional) {
                await professionalService.update(professional.id, formData);
            } else {
                await professionalService.create(formData);
            }
            onSave();
        } catch (err) {
            console.error(err);
            setError('Erro ao salvar profissional. Verifique os dados.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>{professional ? 'Editar Profissional' : 'Novo Profissional'}</h2>
                    <button onClick={onClose} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="modal-form">
                    {error && <div className="error-message">{error}</div>}

                    <div className="form-group">
                        <label>Nome</label>
                        <input
                            type="text"
                            name="nome"
                            value={formData.nome}
                            onChange={handleChange}
                            required
                            minLength={3}
                        />
                    </div>

                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                        />
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
                            {departments.map(dept => (
                                <option key={dept.id} value={dept.id}>
                                    {dept.nome}
                                </option>
                            ))}
                        </select>
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

export default ProfessionalModal;
