import { useState, useEffect } from 'react'
import { supabase } from '../services/supabase'

/**
 * Hook useOSPermissions - ETAPA 4 FASE 3
 * Busca permissões calculadas para uma OS via RPC
 * Retorna objeto com todas as flags booleanas de permissão
 */
export function useOSPermissions(osId) {
    const [permissions, setPermissions] = useState(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        if (!osId) {
            setPermissions(null)
            setLoading(false)
            return
        }

        async function fetchPermissions() {
            try {
                setLoading(true)
                setError(null)

                const { data, error: rpcError } = await supabase
                    .rpc('get_os_permissions', { p_os_id: osId })

                if (rpcError) throw rpcError

                // Parsear JSON se necessário
                const parsedData = typeof data === 'string' ? JSON.parse(data) : data

                setPermissions(parsedData)
            } catch (err) {
                console.error('Erro ao buscar permissões:', err)
                setError(err.message)
                setPermissions(null)
            } finally {
                setLoading(false)
            }
        }

        fetchPermissions()
    }, [osId])

    return { permissions, loading, error }
}

/**
 * Hook helper para verificar uma permissão específica
 */
export function usePermission(osId, permissionKey) {
    const { permissions, loading, error } = useOSPermissions(osId)

    const hasPermission = permissions ? !!permissions[permissionKey] : false

    return { hasPermission, loading, error }
}
