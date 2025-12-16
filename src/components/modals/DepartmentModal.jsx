import React, { useState, useEffect } from 'react';
import { departmentService } from '../../services/departmentService';
import { X } from 'lucide-react';
import './Modal.css';

const DepartmentModal = ({ isOpen, onClose, onSave, department }) => {
    const [formData, setFormData] = useState({
        nome: '',
        cor_hex: '#000000'
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (department) {
            setFormData({
                nome: department.nome,
                cor_hex: department.cor_hex || '#000000'
            });
        } else {
            setFormData({
                nome: '',
                cor_hex: '#000000'
            });
        }
    }, [department]);

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
            if (department) {
                await departmentService.update(department.id, formData);
            } else {
                await departmentService.create(formData);
            }
            onSave();
        } catch (err) {
            console.error(err);
            setError('Erro ao salvar departamento.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>{department ? 'Editar Departamento' : 'Novo Departamento'}</h2>
                    <button onClick={onClose} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="modal-form">
                    {error && <div className="error-message">{error}</div>}

                    <div className="form-group">
                        <label>Nome do Departamento</label>
                        <input
                            type="text"
                            name="nome"
                            value={formData.nome}
                            onChange={handleChange}
                            required
                            minLength={2}
                        />
                    </div>

                    <div className="color-input-wrapper">
                        <label>Cor do Departamento</label>
                        <div className="color-picker-container">
                            <input
                                type="color"
                                name="cor_hex"
                                value={formData.cor_hex}
                                onChange={handleChange}
                                className="color-input"
                            />
                            <input
                                type="text"
                                name="cor_hex_text"
                                value={formData.cor_hex}
                                onChange={handleChange}
                                className="color-text-input"
                                placeholder="#000000"
                            />
                        </div>
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

export default DepartmentModal;
