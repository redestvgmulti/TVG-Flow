import { X, AlertTriangle } from 'lucide-react'
import '../styles/modal.css'

export default function ConfirmDeleteModal({ taskTitle, onClose, onConfirm, isDeleting }) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-container" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2 className="modal-title">Confirmar Exclusão</h2>
                    <button onClick={onClose} className="modal-close-btn">
                        <X size={20} />
                    </button>
                </div>

                <div className="modal-body">
                    <div className="modal-info-box" style={{ borderColor: '#ef4444', backgroundColor: '#fef2f2' }}>
                        <AlertTriangle size={16} style={{ color: '#ef4444' }} />
                        <p style={{ color: '#991b1b' }}>
                            Esta ação não pode ser desfeita. A tarefa será excluída permanentemente.
                        </p>
                    </div>

                    <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#f9fafb', borderRadius: '8px' }}>
                        <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '4px' }}>Tarefa:</p>
                        <p style={{ fontSize: '15px', fontWeight: '500', color: '#111827' }}>{taskTitle}</p>
                    </div>

                    <div className="modal-actions" style={{ marginTop: '24px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            className="modal-btn-cancel"
                            disabled={isDeleting}
                        >
                            Cancelar
                        </button>
                        <button
                            type="button"
                            onClick={onConfirm}
                            className="modal-btn-submit"
                            disabled={isDeleting}
                            style={{
                                backgroundColor: '#ef4444',
                                borderColor: '#ef4444'
                            }}
                            onMouseEnter={(e) => {
                                if (!isDeleting) e.target.style.backgroundColor = '#dc2626'
                            }}
                            onMouseLeave={(e) => {
                                if (!isDeleting) e.target.style.backgroundColor = '#ef4444'
                            }}
                        >
                            {isDeleting ? 'Excluindo...' : 'Excluir Tarefa'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}
