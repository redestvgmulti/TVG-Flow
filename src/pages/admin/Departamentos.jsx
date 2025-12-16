import React, { useState, useEffect } from 'react';
import { departmentService } from '../../services/departmentService';
import { Plus, Search, Edit2, Trash2, Building } from 'lucide-react';
import DepartmentModal from '../../components/modals/DepartmentModal'; // To be created
import './Profissionais.css'; // Reusing similar styles

const Departamentos = () => {
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedDepartment, setSelectedDepartment] = useState(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const data = await departmentService.getAll();
            setDepartments(data);
        } catch (error) {
            console.error('Erro ao carregar departamentos:', error);
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

    const filteredDepartments = departments.filter(d =>
        d.nome.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleAdd = () => {
        setSelectedDepartment(null);
        setIsModalOpen(true);
    };

    const handleEdit = (department) => {
        setSelectedDepartment(department);
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Tem certeza que deseja excluir este departamento?')) {
            try {
                await departmentService.delete(id);
                fetchData();
            } catch (error) {
                console.error('Erro ao excluir:', error);
                alert('Erro ao excluir departamento. Ele pode estar vinculado a profissionais ou tarefas.');
            }
        }
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
        setSelectedDepartment(null);
    };

    const handleModalSave = async () => {
        await fetchData();
        handleModalClose();
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Departamentos</h1>
                <button className="btn-primary" onClick={handleAdd}>
                    <Plus size={20} />
                    <span>Novo Departamento</span>
                </button>
            </div>

            <div className="search-bar">
                <Search size={20} className="search-icon" />
                <input
                    type="text"
                    placeholder="Buscar departamento..."
                    value={searchTerm}
                    onChange={handleSearch}
                />
            </div>

            {loading ? (
                <div className="loading">Carregando...</div>
            ) : (
                <div className="professionals-grid">
                    {filteredDepartments.map(dept => (
                        <div key={dept.id} className="professional-card">
                            <div className="card-header">
                                <div className="avatar-placeholder">
                                    <Building size={24} />
                                </div>
                                <div className="card-actions">
                                    <button onClick={() => handleEdit(dept)} className="action-btn edit">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleDelete(dept.id)} className="action-btn delete">
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                            <div className="card-body">
                                <h3>{dept.nome}</h3>
                                {dept.cor_hex && (
                                    <div className="meta">
                                        <span className="color-dot"></span>
                                        Cor: {dept.cor_hex}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isModalOpen && (
                <DepartmentModal
                    isOpen={isModalOpen}
                    onClose={handleModalClose}
                    onSave={handleModalSave}
                    department={selectedDepartment}
                />
            )}
        </div>
    );
};

export default Departamentos;
