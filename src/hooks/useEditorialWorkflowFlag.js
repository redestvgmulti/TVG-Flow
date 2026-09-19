import { useCallback, useEffect, useState } from 'react'
import { getEditorialWorkflowStatus } from '../services/editorialArticlesService'

// One source of truth for "is the editorial workflow flag on for this
// tenant", used by every host that needs to route between the legacy and
// canonical creation UIs (2B.2.3 section 24) -- previously this exact
// try/catch-default-false read was only inline in MyNewsWork.jsx.
export function useEditorialWorkflowFlag(supabase) {
  const [enabled, setEnabled] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const status = await getEditorialWorkflowStatus(supabase)
      setEnabled(status)
    } catch {
      setEnabled(null)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [supabase])

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh() }, 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  return { enabled, loading, error, refresh }
}
