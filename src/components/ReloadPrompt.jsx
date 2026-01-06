import { useRegisterSW } from 'virtual:pwa-register/react'

export function ReloadPrompt() {
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegistered(r) {
            console.log('SW Registered: ' + r)
        },
        onRegisterError(error) {
            console.log('SW registration error', error)
        },
    })

    const close = () => {
        setOfflineReady(false)
        setNeedRefresh(false)
    }

    return (
        <div className="reload-prompt-container">
            {(offlineReady || needRefresh) && (
                <div className="reload-prompt">
                    <div className="reload-prompt-message">
                        {offlineReady ? (
                            <span>App pronta para funcionar offline</span>
                        ) : (
                            <span>Nova versão disponível</span>
                        )}
                    </div>
                    <div className="reload-prompt-actions">
                        {needRefresh && (
                            <button
                                className="btn btn-primary btn-sm"
                                onClick={() => updateServiceWorker(true)}
                            >
                                Atualizar agora
                            </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => close()}>
                            Fechar
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
