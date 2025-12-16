import React, { useState, useEffect } from 'react';
import { clientService } from '../../services/clientService';
import { X } from 'lucide-react';
import './Modal.css';

const ClientModal = ({ isOpen, onClose, onSave, client }) => {
    const [formData, setFormData] = useState({
        nome: ''
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (client) {
            setFormData({
                nome: client.nome
            });
        } else {
            setFormData({
                nome: ''
            });
        }
    }, [client]);

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
            if (client) {
                await clientService.update(client.id, formData);
            } else {
                await clientService.create(formData);
            }
            onSave();
        } catch (err) {
            console.error(err);
            setError('Erro ao salvar cliente.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <div className="modal-header">
                    <h2>{client ? 'Editar Cliente' : 'Novo Cliente'}</h2>
                    <button onClick={onClose} className="close-btn">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="modal-form">
                    {error && <div className="error-message">{error}</div>}

                    <div className="form-group">
                        <label>Nome do Cliente</label>
                        <input
                            type="text"
                            name="nome"
                            value={formData.nome}
                            onChange={handleChange}
                            required
                            minLength={2}
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

export default ClientModal;
