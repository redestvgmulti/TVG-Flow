import React, { useState, useEffect } from 'react';
import { clientService } from '../../services/clientService';
import { Plus, Search, Edit2, Trash2, Briefcase } from 'lucide-react';
import ClientModal from '../../components/modals/ClientModal';
import './Profissionais.css'; // Reusing similar styles

const Clientes = () => {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const data = await clientService.getAll();
            setClients(data);
        } catch (error) {
            console.error('Erro ao carregar clientes:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleSearch = (e) => {
        setSearchTerm(e.target.value);
    };

    const filteredClients = clients.filter(c =>
        c.nome.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleAdd = () => {
        setSelectedClient(null);
        setIsModalOpen(true);
    };

    const handleEdit = (client) => {
        setSelectedClient(client);
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Tem certeza que deseja excluir este cliente?')) {
            try {
                await clientService.delete(id);
                fetchData();
            } catch (error) {
                console.error('Erro ao excluir:', error);
                alert('Erro ao excluir cliente. Ele pode estar vinculado a tarefas.');
            }
        }
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
        setSelectedClient(null);
    };

    const handleModalSave = async () => {
        await fetchData();
        handleModalClose();
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Clientes</h1>
                <button className="btn-primary" onClick={handleAdd}>
                    <Plus size={20} />
                    <span>Novo Cliente</span>
                </button>
            </div>

            <div className="search-bar">
                <Search size={20} className="search-icon" />
                <input
                    type="text"
                    placeholder="Buscar cliente..."
                    value={searchTerm}
                    onChange={handleSearch}
                />
            </div>

            {loading ? (
                <div className="loading">Carregando...</div>
            ) : (
                <div className="professionals-grid">
                    {filteredClients.map(client => (
                        <div key={client.id} className="professional-card">
                            <div className="card-header">
                                <div className="avatar-placeholder">
                                    <Building size={20} />
                                </div>
                                <div className="card-actions">
                                    <button onClick={() => handleEdit(client)} className="action-btn edit">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDelete(client.id)} className="action-btn delete">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                            <div className="card-body">
                                <h3>{client.nome}</h3>
                                {/* Add more client details if available locally, e.g. contact info */}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isModalOpen && (
                <ClientModal
                    isOpen={isModalOpen}
                    onClose={handleModalClose}
                    onSave={handleModalSave}
                    client={selectedClient}
                />
            )}
        </div>
    );
};

export default Clientes;
