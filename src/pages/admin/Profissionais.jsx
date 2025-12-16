import React, { useState, useEffect } from 'react';
import { professionalService } from '../../services/professionalService';
import { departmentService } from '../../services/departmentService';
import { Plus, Search, Edit2, Trash2, UserX, UserCheck } from 'lucide-react';
import ProfessionalModal from '../../components/modals/ProfessionalModal';
import './Profissionais.css';

const Profissionais = () => {
    const [professionals, setProfessionals] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedProfessional, setSelectedProfessional] = useState(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [profsData, deptsData] = await Promise.all([
                professionalService.getAll(),
                departmentService.getAll()
            ]);
            setProfessionals(profsData);
            setDepartments(deptsData);
        } catch (error) {
            console.error('Erro ao carregar dados:', error);
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

    const filteredProfessionals = professionals.filter(p =>
        p.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.departamentos?.nome.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleAdd = () => {
        setSelectedProfessional(null);
        setIsModalOpen(true);
    };

    const handleEdit = (professional) => {
        setSelectedProfessional(professional);
        setIsModalOpen(true);
    };

    const handleDelete = async (id) => {
        if (window.confirm('Tem certeza que deseja excluir este profissional?')) {
            try {
                await professionalService.delete(id);
                fetchData();
            } catch (error) {
                console.error('Erro ao excluir:', error);
                alert('Erro ao excluir profissional.');
            }
        }
    };

    const handleToggleStatus = async (professional) => {
        try {
            await professionalService.toggleStatus(professional.id, professional.ativo);
            fetchData();
        } catch (error) {
            console.error('Erro ao alterar status:', error);
        }
    };

    const handleModalClose = () => {
        setIsModalOpen(false);
        setSelectedProfessional(null);
    };

    const handleModalSave = async () => {
        await fetchData();
        handleModalClose();
    };

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>Profissionais</h1>
                <button className="btn-primary" onClick={handleAdd}>
                    <Plus size={20} />
                    <span>Novo Profissional</span>
                </button>
            </div>

            <div className="search-bar">
                <Search size={20} className="search-icon" />
                <input
                    type="text"
                    placeholder="Buscar por nome, email ou departamento..."
                    value={searchTerm}
                    onChange={handleSearch}
                />
            </div>

            {loading ? (
                <div className="loading">Carregando...</div>
            ) : (
                <div className="professionals-grid">
                    {filteredProfessionals.map(professional => (
                        <div key={professional.id} className={`professional-card ${!professional.ativo ? 'inactive' : ''}`}>
                            <div className="card-header">
                                <div className="avatar-placeholder">
                                    {professional.nome.charAt(0).toUpperCase()}
                                </div>
                                <div className="card-actions">
                                    <button onClick={() => handleEdit(professional)} className="action-btn edit">
                                        <Edit2 size={16} />
                                    </button>
                                    <button onClick={() => handleToggleStatus(professional)} className="action-btn toggle">
                                        {professional.ativo ? <UserCheck size={16} /> : <UserX size={16} />}
                                    </button>
                                </div>
                            </div>
                            <div className="card-body">
                                <h3>{professional.nome}</h3>
                                <p className="email">{professional.email}</p>
                                <span className="department-badge">
                                    {professional.departamentos?.nome}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {isModalOpen && (
                <ProfessionalModal
                    isOpen={isModalOpen}
                    onClose={handleModalClose}
                    onSave={handleModalSave}
                    professional={selectedProfessional}
                    departments={departments}
                />
            )}
        </div>
    );
};

export default Profissionais;
