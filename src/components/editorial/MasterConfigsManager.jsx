import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { loadMasterRuntime } from '../../services/masterRuntime'
import { masterV1ConfigIssues, masterV1Status } from '../../services/masterV1Availability'
import { visualModelLabel } from '../../services/visualModels'

const FORMAT_LABELS = { feed: 'Feed', reels: 'Reels', story: 'Story' }
const STATUS_LABELS = {
  active: 'Disponível',
  disabled: 'Desabilitado',
  incomplete: 'Configuração incompleta',
  sponsor_pool: 'Patrocinadores insuficientes',
  kill_switch: 'Pausado',
  no_config: 'Sem configuração',
}

export default function MasterConfigsManager({ clienteId }) {
  const [runtime, setRuntime] = useState({ configs: [], poolCounts: {}, killSwitch: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setRuntime(await loadMasterRuntime(supabase, clienteId))
    } catch {
      setError('Não foi possível carregar as configurações das artes.')
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => { load() }, [load])

  const configs = useMemo(() => [...runtime.configs].sort((left, right) =>
    left.content_type.localeCompare(right.content_type) ||
    left.visual_model.localeCompare(right.visual_model)), [runtime.configs])

  if (loading) return <p role="status">Carregando configurações das artes...</p>
  if (error) return <p role="alert" className="ap-vt-alert">{error}</p>

  return <section className="ap-form-section">
    <div className="ap-vt-header">
      <div>
        <h2 className="ap-form-card-title">Finalidades das artes</h2>
        <p className="ap-config-intro">Consulta técnica somente leitura. UUID, layers e quantidade de patrocinadores não são editáveis pelo operador.</p>
      </div>
    </div>
    <div className="ap-table-container">
      <table className="ap-table">
        <thead><tr><th>Finalidade</th><th>Formato</th><th>UUID</th><th>Status</th><th>Patrocinadores</th><th>Layers</th><th>Pool</th></tr></thead>
        <tbody>{configs.map(config => {
          const poolSize = runtime.poolCounts?.[config.content_type] ?? 0
          const status = masterV1Status(config, { kill_switch: runtime.killSwitch }, poolSize)
          const layerIssues = masterV1ConfigIssues(config).filter(issue => issue.startsWith('layer'))
          return <tr key={config.id}>
            <td>{visualModelLabel(config.visual_model)}</td>
            <td>{FORMAT_LABELS[config.content_type] || config.content_type}</td>
            <td><code>{config.master_template_uuid || 'Pendente'}</code></td>
            <td>{STATUS_LABELS[status] || status}</td>
            <td>{Number.isInteger(config.sponsor_count) ? config.sponsor_count : 'Pendente'}</td>
            <td>{layerIssues.length ? 'Incompleto' : 'Válido'}</td>
            <td>{poolSize} disponível{poolSize === 1 ? '' : 'is'}</td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </section>
}
