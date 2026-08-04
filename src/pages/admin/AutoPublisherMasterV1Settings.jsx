import { useEffect, useState } from 'react'
import VisualTitlesManager from '../../components/editorial/VisualTitlesManager'
import SponsorsManager from '../../components/editorial/SponsorsManager'
import TerritorialRegionsManager from '../../components/editorial/TerritorialRegionsManager'
import { supabase } from '../../services/supabase'
import { isTerritorialAdminEnabled } from '../../services/territorialCatalog'

// Operator-facing settings only. Everything technical about the render — Placid
// template UUIDs, layer maps, rotation scope, membership ordering — is decided
// by the database and is deliberately absent from this screen.
const TABS = [
  ['titles', 'Selos da matéria'],
  ['sponsors', 'Patrocinadores'],
]

export default function AutoPublisherMasterV1Settings({
  clienteId,
  clienteError,
}) {
  const [tab, setTab] = useState('titles')
  const [titleSection, setTitleSection] = useState('groups')
  const [featureState, setFeatureState] = useState({
    clienteId: null,
    enabled: false,
    error: '',
  })

  useEffect(() => {
    let active = true
    isTerritorialAdminEnabled(supabase, clienteId)
      .then(enabled => {
        if (!active) return
        setFeatureState({
          clienteId,
          enabled,
          error: '',
        })
      })
      .catch(error => {
        if (!active) return
        setFeatureState({
          clienteId,
          enabled: false,
          error: error.message || 'Não foi possível verificar a área de Regiões.',
        })
      })
    return () => {
      active = false
    }
  }, [clienteId])

  const featureLoading = featureState.clienteId !== clienteId
  const territorialEnabled = !featureLoading && featureState.enabled
  const featureError = !featureLoading ? featureState.error : ''
  const activeTitleSection = territorialEnabled ? titleSection : 'groups'

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
          <>
            <h3 className="ap-form-card-title">Selos das Artes</h3>
            <div className="ap-vt-actions" style={{ marginBottom: 16 }}>
              <button
                type="button"
                className={activeTitleSection === 'groups' ? 'ap-btn-add' : 'ap-btn-outline'}
                onClick={() => setTitleSection('groups')}
              >
                Grupos de selos
              </button>
              {territorialEnabled && (
                <button
                  type="button"
                  className={activeTitleSection === 'regions' ? 'ap-btn-add' : 'ap-btn-outline'}
                  onClick={() => setTitleSection('regions')}
                >
                  Regiões
                </button>
              )}
            </div>

            {featureLoading && <p role="status" className="ap-config-intro">Verificando recursos do cliente…</p>}
            {featureError && <p role="alert" className="ap-vt-alert">{featureError}</p>}

            {activeTitleSection === 'groups' && (
              <VisualTitlesManager
                clienteId={clienteId}
                allowTypeReview={territorialEnabled}
              />
            )}

            {territorialEnabled && activeTitleSection === 'regions' && (
              <TerritorialRegionsManager clienteId={clienteId} />
            )}
          </>
        )}

        {tab === 'sponsors' && (
          <SponsorsManager clienteId={clienteId} />
        )}
      </div>
    </div>
  )
}
