import { AlertTriangle } from 'lucide-react'
import Modal from './ui/Modal'

export default function ConfirmDeleteModal({ taskTitle, onClose, onConfirm, isDeleting }) {
    return (
        <Modal
            isOpen
            onClose={onClose}
            closeOnBackdrop={!isDeleting}
            footer={(
                <>
                    <button type="button" onClick={onClose} className="btn btn-secondary" disabled={isDeleting}>
                        Cancelar
                    </button>
                    <button type="button" onClick={onConfirm} className="btn btn-danger" disabled={isDeleting}>
                        {isDeleting ? 'Excluindo...' : 'Excluir Tarefa'}
                    </button>
                </>
            )}
        >
            <div className="confirm-modal-icon">
                <AlertTriangle size={24} />
            </div>
            <h3 className="confirm-modal-title">Confirmar Exclusão</h3>
            <p className="confirm-modal-message">
                Tem certeza que deseja excluir a tarefa{' '}
                <span className="confirm-modal-highlight">"{taskTitle}"</span>?
            </p>
            <p className="confirm-modal-warning">
                Esta ação não pode ser desfeita. A tarefa será excluída permanentemente.
            </p>
        </Modal>
    )
}
