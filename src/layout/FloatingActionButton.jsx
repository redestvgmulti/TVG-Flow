import { PlusSquare } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

/**
 * FLOATING ACTION BUTTON (FAB)
 * 
 * Primary action button for STAFF mobile interface.
 * Follows Material Design guidelines for FAB positioning and touch targets.
 * - Visible ONLY on mobile (max-width: 1024px)
 * - Positioned above bottom navigation
 * - Minimum touch target: 56x56px
 * - Z-index: 110 (above bottom nav)
 */
function FloatingActionButton() {
    const navigate = useNavigate()

    const handleClick = () => {
        navigate('/staff/requests/new')
    }

    return (
        <button
            className="floating-action-btn"
            onClick={handleClick}
            aria-label="Nova Solicitação"
            type="button"
        >
            <PlusSquare size={24} strokeWidth={2} />
        </button>
    )
}

export default FloatingActionButton
