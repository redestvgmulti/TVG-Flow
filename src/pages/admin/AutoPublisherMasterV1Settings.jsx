import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { toast } from 'sonner'
import {
  assetPreviewUrl,
  uploadImmutablePng,
} from '../../services/masterV1Assets'
import VisualTitlesManager from '../../components/editorial/VisualTitlesManager'

const CLIENTE_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'

const DEFAULT_FEED_LAYER_MAP = {
  news_image: 'news-image',
  headline: 'headline_news',
  tag: 'tag_news',
  visual_title: 'tag-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}

const DEFAULT_REELS_LAYER_MAP = {
  news_image: '',
  headline: 'headline_news',
  tag: '',
  visual_title: 'tag-png',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}

const defaultLayerMapFor = format => ({
  ...(format === 'reels'
    ? DEFAULT_REELS_LAYER_MAP
    : DEFAULT_FEED_LAYER_MAP),
})

const LAYER_LABELS = {
  news_image: 'Imagem da notícia',
  headline: 'Manchete',
  tag: 'Tag',
  visual_title: 'Selo',
  sponsor_1: 'Patrocinador 1',
  sponsor_2: 'Patrocinador 2',
}

/**
 * Superfície operacional disponível para o administrador do cliente.
 *
 * Configuração de UUID, layer map, ativação, kill switch e diagnóstico
 * permanece implementada neste componente, mas não fica exposta em
 * /admin/autopublisher.
 */
const SUBTABS = [
  ['titles', 'Selos da matéria'],
  ['profiles', 'Patrocinadores'],
]

function Slot({ label, asset, onChange }) {
  const preview = asset ? assetPreviewUrl(supabase, asset) : null

  return (
    <div className="ap-slot">
      <strong>{label}</strong>

      {preview && (
        <img
          src={preview}
          alt={label}
          className="ap-slot-preview"
        />
      )}

      <input
        type="file"
        accept="image/png"
        className="ap-file-input"
        onChange={event => {
          onChange(event.target.files?.[0] || null)
        }}
      />

      {asset && (
        <button
          type="button"
          className="ap-btn-sm"
          onClick={() => onChange(null)}
        >
          Limpar slot
        </button>
      )}
    </div>
  )
}

export default function AutoPublisherMasterV1Settings() {
  const [tab, setTab] = useState('titles')

  const [titles, setTitles] = useState([])
  const [templates, setTemplates] = useState([])
  const [profiles, setProfiles] = useState([])
  const [configs, setConfigs] = useState([])

  const [control, setControl] = useState({
    kill_switch: false,
  })

  const [selectedTemplate, setSelectedTemplate] = useState('')

  const [profileAssets, setProfileAssets] = useState({
    sponsor_1: undefined,
    sponsor_2: undefined,
  })

  const [format, setFormat] = useState('feed')
  const [masterUuid, setMasterUuid] = useState('')
  const [enabled, setEnabled] = useState(false)

  const [layerMap, setLayerMap] = useState(
    defaultLayerMapFor('feed'),
  )

  async function load() {
    const [
      titlesResult,
      templatesResult,
      profilesResult,
      configsResult,
      controlResult,
    ] = await Promise.all([
      supabase
        .schema('ap')
        .from('visual_titles')
        .select('*')
        .eq('cliente_id', CLIENTE_ID)
        .order('ordem'),

      supabase
        .schema('ap')
        .from('templates')
        .select(
          'id,nome,tipo,template_set,ordem,placid_template_uuid,ativo,uso_total',
        )
        .eq('empresa_id', CLIENTE_ID)
        .order('ordem'),

      supabase
        .schema('ap')
        .from('template_render_profiles')
        .select('*'),

      supabase
        .schema('ap')
        .from('master_render_configs')
        .select('*')
        .eq('cliente_id', CLIENTE_ID),

      supabase
        .schema('ap')
        .from('master_render_controls')
        .select('*')
        .eq('cliente_id', CLIENTE_ID)
        .maybeSingle(),
    ])

    const failedResult = [
      titlesResult,
      templatesResult,
      profilesResult,
      configsResult,
      controlResult,
    ].find(result => result.error)

    if (failedResult?.error) {
      throw failedResult.error
    }

    setTitles(titlesResult.data || [])
    setTemplates(templatesResult.data || [])
    setProfiles(profilesResult.data || [])
    setConfigs(configsResult.data || [])

    setControl(
      controlResult.data || {
        kill_switch: false,
      },
    )
  }

  useEffect(() => {
    load().catch(error => {
      toast.error(error.message)
    })
  }, [])

  /**
   * O master é identificado somente por cliente + formato.
   *
   * Campanha/template_set continua existindo para rotação de templates
   * e patrocinadores, mas não define qual é o master.
   */
  useEffect(() => {
    const current = configs.find(
      config => config.content_type === format,
    )

    setMasterUuid(current?.master_template_uuid || '')
    setEnabled(Boolean(current?.enabled))

    setLayerMap({
      ...defaultLayerMapFor(format),
      ...(current?.layer_map || {}),
    })
  }, [configs, format])

  const activeTitle = titles.find(item => item.ativo)

  async function saveProfile() {
    try {
      if (!selectedTemplate) {
        throw new Error('Selecione uma linha de template.')
      }

      const current = profiles.find(
        profile => profile.template_id === selectedTemplate,
      )

      const slots = {
        ...(current?.other_slots || {}),
      }

      for (const slot of ['sponsor_1', 'sponsor_2']) {
        const input = profileAssets[slot]

        if (input === undefined) {
          continue
        }

        if (input === null) {
          delete slots[slot]
          continue
        }

        slots[slot] = await uploadImmutablePng({
          supabase,
          file: input,
          clienteId: CLIENTE_ID,
          kind: 'sponsors',
          slug: `${selectedTemplate}-${slot}`,
        })
      }

      const profilePayload = {
        template_id: selectedTemplate,
        profile_version: new Date().toISOString(),
        other_slots: slots,
        ativo: true,
      }

      const query = current
        ? supabase
            .schema('ap')
            .from('template_render_profiles')
            .update(profilePayload)
            .eq('id', current.id)
        : supabase
            .schema('ap')
            .from('template_render_profiles')
            .insert(profilePayload)

      const { error } = await query

      if (error) {
        throw error
      }

      setProfileAssets({
        sponsor_1: undefined,
        sponsor_2: undefined,
      })

      toast.success('Perfil salvo.')

      await load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function saveMaster() {
    try {
      const mappedLayerNames = Object.values(layerMap).filter(Boolean)

      if (
        new Set(mappedLayerNames).size !==
        mappedLayerNames.length
      ) {
        throw new Error(
          'O mapeamento de camadas tem nomes duplicados.',
        )
      }

      if (
        enabled &&
        (!masterUuid || !layerMap.visual_title || !activeTitle)
      ) {
        throw new Error(
          'Para ativar é preciso: UUID, mapeamento do selo e um selo de matéria disponível.',
        )
      }

      const current = configs.find(
        config => config.content_type === format,
      )

      const masterPayload = {
        cliente_id: CLIENTE_ID,
        content_type: format,
        template_set: null,
        master_template_uuid: masterUuid || null,
        enabled,
        layer_map: layerMap,
      }

      const { error } = current
        ? await supabase
            .schema('ap')
            .from('master_render_configs')
            .update(masterPayload)
            .eq('id', current.id)
            .eq('cliente_id', CLIENTE_ID)
        : await supabase
            .schema('ap')
            .from('master_render_configs')
            .insert(masterPayload)

      if (error) {
        throw error
      }

      toast.success('Configuração master salva.')

      await load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function saveKill() {
    try {
      const { error } = await supabase
        .schema('ap')
        .from('master_render_controls')
        .upsert(
          {
            cliente_id: CLIENTE_ID,
            kill_switch: Boolean(control.kill_switch),
          },
          {
            onConflict: 'cliente_id',
          },
        )

      if (error) {
        throw error
      }

      toast.success(
        control.kill_switch
          ? 'Kill switch ativado.'
          : 'Kill switch desativado.',
      )

      await load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  const previewProfile = profiles.find(
    profile => profile.template_id === selectedTemplate,
  )

  const previewSlots = useMemo(
    () => previewProfile?.other_slots || {},
    [previewProfile],
  )

  const selectedMasterConfig = configs.find(
    config => config.content_type === format,
  )

  const payload = useMemo(
    () => ({
      template_uuid:
        enabled && masterUuid
          ? masterUuid
          : templates.find(
                template => template.id === selectedTemplate,
              )?.placid_template_uuid || '<UUID legado>',

      contract:
        enabled &&
        masterUuid &&
        !control.kill_switch
          ? 'master_v1'
          : 'legacy',

      selected_config: selectedMasterConfig?.id || null,

      layers: Object.fromEntries(
        [
          activeTitle && layerMap.visual_title
            ? [
                layerMap.visual_title,
                {
                  image: assetPreviewUrl(supabase, {
                    bucket: activeTitle.asset_bucket,
                    path: activeTitle.asset_path,
                  }),
                },
              ]
            : null,

          ...['sponsor_1', 'sponsor_2'].map(slot =>
            previewSlots[slot] && layerMap[slot]
              ? [
                  layerMap[slot],
                  {
                    image: assetPreviewUrl(
                      supabase,
                      previewSlots[slot],
                    ),
                  },
                ]
              : null,
          ),
        ].filter(Boolean),
      ),
    }),
    [
      activeTitle,
      control.kill_switch,
      enabled,
      layerMap,
      masterUuid,
      previewSlots,
      selectedMasterConfig,
      selectedTemplate,
      templates,
    ],
  )

  return (
    <div className="ap-settings">
      <div className="ap-form-section">
        <h2>Configuração das Artes</h2>

        <p className="ap-config-intro">
          Cadastre os elementos que o sistema usará
          automaticamente nas artes das matérias.
        </p>

        <div className="ap-subtabs">
          {SUBTABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`ap-subtab${
                tab === key ? ' active' : ''
              }`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'titles' && (
          <VisualTitlesManager
            clienteId={CLIENTE_ID}
            onChanged={load}
          />
        )}

        {tab === 'profiles' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <select
              className="ap-select"
              value={selectedTemplate}
              onChange={event => {
                setSelectedTemplate(event.target.value)

                setProfileAssets({
                  sponsor_1: undefined,
                  sponsor_2: undefined,
                })
              }}
            >
              <option value="">
                Selecione o template rotacionado
              </option>

              {templates.map(template => (
                <option
                  key={template.id}
                  value={template.id}
                >
                  {template.nome} · {template.tipo} ·{' '}
                  {template.template_set} · #{template.ordem}
                </option>
              ))}
            </select>

            {selectedTemplate && (
              <>
                <div className="ap-field-grid">
                  <Slot
                    label="Patrocinador 1"
                    asset={previewSlots.sponsor_1}
                    onChange={file => {
                      setProfileAssets(previous => ({
                        ...previous,
                        sponsor_1: file,
                      }))
                    }}
                  />

                  <Slot
                    label="Patrocinador 2"
                    asset={previewSlots.sponsor_2}
                    onChange={file => {
                      setProfileAssets(previous => ({
                        ...previous,
                        sponsor_2: file,
                      }))
                    }}
                  />
                </div>

                <div>
                  <button
                    type="button"
                    className="ap-btn-add"
                    onClick={saveProfile}
                  >
                    Salvar perfil
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/*
          Superfície técnica preservada para migração futura à área
          /platform. As abas correspondentes não são exibidas ao admin
          operacional do cliente.
        */}

        {tab === 'masters' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="ap-form-row">
              <select
                className="ap-select"
                value={format}
                onChange={event => {
                  setFormat(event.target.value)
                }}
              >
                <option value="feed">Feed</option>
                <option value="reels">Reels</option>
              </select>

              <input
                className="ap-input"
                placeholder="UUID master"
                value={masterUuid}
                onChange={event => {
                  setMasterUuid(event.target.value.trim())
                }}
              />

              <label className="ap-switch">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={event => {
                    setEnabled(event.target.checked)
                  }}
                />

                <span className="ap-switch-track" />

                <span className="ap-switch-label">
                  Ativado
                </span>
              </label>

              <button
                type="button"
                className="ap-btn-add"
                onClick={saveMaster}
              >
                Salvar
              </button>
            </div>

            <div className="ap-field-grid">
              {Object.keys(DEFAULT_FEED_LAYER_MAP).map(key => (
                <label
                  key={key}
                  className="ap-field-label"
                >
                  {LAYER_LABELS[key] || key}

                  <input
                    className="ap-input"
                    value={layerMap[key] || ''}
                    placeholder="Ausente"
                    onChange={event => {
                      setLayerMap(previous => ({
                        ...previous,
                        [key]: event.target.value.trim(),
                      }))
                    }}
                  />
                </label>
              ))}
            </div>

            <div
              className="ap-config-card"
              style={{ gap: 12 }}
            >
              <label className="ap-switch">
                <input
                  type="checkbox"
                  checked={control.kill_switch}
                  onChange={event => {
                    setControl(previous => ({
                      ...previous,
                      kill_switch: event.target.checked,
                    }))
                  }}
                />

                <span className="ap-switch-track" />

                <span className="ap-switch-body">
                  <span className="ap-switch-label">
                    Kill switch global
                  </span>

                  <span className="ap-switch-hint">
                    Interrompe toda a renderização master deste
                    cliente.
                  </span>
                </span>
              </label>

              <div>
                <button
                  type="button"
                  className="ap-btn-outline"
                  onClick={saveKill}
                >
                  Salvar kill switch
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'diagnostic' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p
              className="ap-config-intro"
              style={{ margin: 0 }}
            >
              Selecione um template na aba Patrocinadores para
              simular os cenários de slots sem chamar o Placid.
            </p>

            <pre className="ap-code-block">
              {JSON.stringify(
                {
                  format,

                  legacy_uuid:
                    templates.find(
                      template =>
                        template.id === selectedTemplate,
                    )?.placid_template_uuid || null,

                  master_uuid: masterUuid || null,

                  contract:
                    enabled &&
                    masterUuid &&
                    !control.kill_switch
                      ? 'master_v1'
                      : 'legacy',

                  payload,
                },
                null,
                2,
              )}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}ss