import { useState } from 'react'
import VisualTitlesManager from '../../components/editorial/VisualTitlesManager'
import SponsorsManager from '../../components/editorial/SponsorsManager'
import MasterConfigsManager from '../../components/editorial/MasterConfigsManager'

// Operator-facing settings only. Everything technical about the render — Placid
// template UUIDs, layer maps, rotation scope, membership ordering — is decided
// by the database and is deliberately absent from this screen.
const TABS = [
  ['purposes', 'Finalidades das artes'],
  ['titles', 'Selos da matéria'],
  ['sponsors', 'Patrocinadores'],
]

export default function AutoPublisherMasterV1Settings({
  clienteId,
  clienteError,
}) {
  const [tab, setTab] = useState('purposes')

  if (!clienteId) {
    return (
      <div
        className="ap-form-section"
        role={clienteError ? 'alert' : 'status'}
      >
        {clienteError ||
          'Carregando cliente operacional...'}
      </div>
    )
  }

  return (
    <div
      className="ap-settings"
      style={{ marginTop: 24 }}
    >
      <div className="ap-form-section">
        <h2>Configurações das artes</h2>

        <p style={{ color: '#64748b' }}>
          Gerencie os selos e patrocinadores usados
          automaticamente nas artes das matérias.
        </p>

        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={
                tab === key
                  ? 'ap-btn-add'
                  : 'ap-btn-outline'
              }
              onClick={() => {
                setTab(key)
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'titles' && (
          <VisualTitlesManager clienteId={clienteId} />
        )}

        {tab === 'purposes' && (
          <MasterConfigsManager clienteId={clienteId} />
        )}

        {tab === 'sponsors' && (
          <SponsorsManager clienteId={clienteId} />
        )}
      </div>
    </div>
  )
}
