import { createPortal } from 'react-dom'
import { BellRing } from 'lucide-react'
import '../styles/pushOptIn.css'

export default function PushOptInPrompt({ onAccept, onDecline, loading = false }) {
    return createPortal(
        <div className="push-opt-in-overlay" onClick={onDecline}>
            <div className="push-opt-in-modal" onClick={(e) => e.stopPropagation()}>
                <div className="push-opt-in-icon">
                    <BellRing size={24} />
                </div>

                <h2 className="push-opt-in-title">
                    Receber alertas quando estiver fora do app?
                </h2>

                <p className="push-opt-in-description">
                    Você será notificado quando novas tarefas forem atribuídas, mesmo com o navegador fechado.
                </p>

                <div className="push-opt-in-actions">
                    <button
                        className="push-opt-in-button secondary"
                        onClick={onDecline}
                        disabled={loading}
                    >
                        Agora não
                    </button>

                    <button
                        className="push-opt-in-button primary"
                        onClick={onAccept}
                        disabled={loading}
                    >
                        {loading ? 'Ativando...' : 'Ativar alertas'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    )
}
