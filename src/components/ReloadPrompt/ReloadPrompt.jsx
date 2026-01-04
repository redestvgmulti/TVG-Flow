import { useRegisterSW } from 'virtual:pwa-register/react'
import { toast } from 'sonner'
import { useEffect } from 'react'

function ReloadPrompt() {
    const {
        offlineReady: [offlineReady, setOfflineReady],
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(swUrl, r) {
            console.log('SW Registered: ' + swUrl)
        },
        onRegisterError(error) {
            console.log('SW registration error', error)
        },
    })

    useEffect(() => {
        if (offlineReady) {
            toast.success('App pronto para uso offline.')
            setOfflineReady(false)
        }
    }, [offlineReady, setOfflineReady])

    useEffect(() => {
        if (needRefresh) {
            toast('Nova versão disponível', {
                description: 'Uma nova versão está disponível. Atualize para continuar.',
                action: {
                    label: 'Atualizar agora',
                    onClick: () => {
                        updateServiceWorker(true)
                    },
                },
                duration: Infinity, // Manter visível até o usuário interagir
                cancel: {
                    label: 'Fechar',
                    onClick: () => setNeedRefresh(false)
                }
            })
        }
    }, [needRefresh, updateServiceWorker, setNeedRefresh])

    return null
}

export default ReloadPrompt
