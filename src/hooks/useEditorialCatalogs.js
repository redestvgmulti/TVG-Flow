import { useCallback, useEffect, useState } from 'react'
import { loadMasterRuntime, MASTER_RUNTIME_STATUS } from '../services/masterRuntime.js'
import { loadTerritorialComposer, TERRITORIAL_COMPOSER_STATUS } from '../services/territorialComposer.js'
import { loadVisualTitleCatalog } from '../services/visualTitleCatalog.js'
import { deriveEditorialCatalogView } from '../services/editorialCatalogsView.js'

// Thin wiring hook: loads the three catalogs the canonical editor's
// "Formato e visual"/"Território"/"Composição" sections need, and hands the
// decision-making (what's available right now) to the pure
// deriveEditorialCatalogView function so that logic stays testable without a
// DOM/React renderer.
export function useEditorialCatalogs(supabase, clienteId, contentType) {
  const [masterRuntimeStatus, setMasterRuntimeStatus] = useState(MASTER_RUNTIME_STATUS.IDLE)
  const [masterRuntime, setMasterRuntime] = useState(null)
  const [territorialComposer, setTerritorialComposer] = useState({
    enabled: false,
    status: TERRITORIAL_COMPOSER_STATUS.IDLE,
    catalog: null,
    error: '',
  })
  const [visualTitleGroups, setVisualTitleGroups] = useState([])
  const [visualTitlesError, setVisualTitlesError] = useState('')

  const retryMasterRuntime = useCallback(async () => {
    if (!clienteId) return
    setMasterRuntimeStatus(MASTER_RUNTIME_STATUS.LOADING)
    try {
      const runtime = await loadMasterRuntime(supabase, clienteId)
      setMasterRuntime(runtime)
      setMasterRuntimeStatus(MASTER_RUNTIME_STATUS.READY)
    } catch {
      setMasterRuntimeStatus(MASTER_RUNTIME_STATUS.ERROR)
    }
  }, [supabase, clienteId])

  const retryTerritorialComposer = useCallback(async () => {
    if (!clienteId) return
    setTerritorialComposer(previous => ({ ...previous, status: TERRITORIAL_COMPOSER_STATUS.LOADING }))
    try {
      const result = await loadTerritorialComposer(supabase, clienteId)
      setTerritorialComposer({ ...result, error: '' })
    } catch (error) {
      setTerritorialComposer({
        enabled: true,
        status: TERRITORIAL_COMPOSER_STATUS.ERROR,
        catalog: null,
        error: error.message || 'Não foi possível carregar o compositor territorial.',
      })
    }
  }, [supabase, clienteId])

  const retryVisualTitles = useCallback(async () => {
    if (!clienteId) return
    try {
      const groups = await loadVisualTitleCatalog(supabase, clienteId)
      setVisualTitleGroups(groups)
      setVisualTitlesError('')
    } catch (error) {
      setVisualTitlesError(error.message || 'Não foi possível carregar os selos.')
    }
  }, [supabase, clienteId])

  useEffect(() => {
    const timer = window.setTimeout(() => { void retryMasterRuntime() }, 0)
    return () => window.clearTimeout(timer)
  }, [retryMasterRuntime])
  useEffect(() => {
    const timer = window.setTimeout(() => { void retryTerritorialComposer() }, 0)
    return () => window.clearTimeout(timer)
  }, [retryTerritorialComposer])
  useEffect(() => {
    const timer = window.setTimeout(() => { void retryVisualTitles() }, 0)
    return () => window.clearTimeout(timer)
  }, [retryVisualTitles])

  const view = deriveEditorialCatalogView({
    territorialComposerEnabled: territorialComposer.enabled,
    masterRuntimeStatus,
    masterRuntime,
    territorialComposerStatus: territorialComposer.status,
    territorialCatalog: territorialComposer.catalog,
    contentType,
  })

  return {
    ...view,
    territorialComposerEnabled: territorialComposer.enabled,
    territorialComposerState: territorialComposer.status,
    territorialCatalog: territorialComposer.catalog,
    territorialComposerError: territorialComposer.error,
    visualTitleGroups,
    visualTitlesError,
    masterRuntime,
    retryMasterRuntime,
    retryTerritorialComposer,
    retryVisualTitles,
  }
}
