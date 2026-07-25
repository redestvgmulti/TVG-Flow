import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { masterV1ConfigIssues, masterV1Status } from '../../services/masterV1Availability'

// Editable defaults for the current Placid templates. These are the layer NAMES
// the template expects; they are persisted in ap.master_render_configs.layer_map
// and consumed by the renderer via layer_map — never hardcoded in the renderer.
const DEFAULT_LAYER_MAP = {
  headline: 'headline_news',
  tag: 'tag_news',
  news_image: 'news-image',
  visual_title: 'titulo-materia',
  sponsor_1: 'patrocinador-1',
  sponsor_2: 'patrocinador-2',
}

const CONTENT_TYPES = [
  ['feed', 'Feed'],
  ['reels', 'Story (Reels)'],
]

// Reels forbids news_image and tag in the renderer, so they are only offered for
// feed. Order = [layerKey, label, help].
const LAYER_FIELDS = {
  feed: [
    ['headline', 'Camada do título da matéria', 'Nome da camada de texto do template que recebe o título.'],
    ['tag', 'Camada da tag textual (opcional)', 'Nome da camada de texto da tag (ex.: DESTAQUE).'],
    ['news_image', 'Camada da imagem principal', 'Nome da camada que recebe a imagem da notícia.'],
    ['visual_title', 'Camada do selo da matéria', 'Nome da camada que receberá o selo (PNG) no template Placid.'],
    ['sponsor_1', 'Camada do primeiro patrocinador', 'Nome da camada que recebe o PNG do 1º patrocinador.'],
    ['sponsor_2', 'Camada do segundo patrocinador (opcional)', 'Nome da camada do 2º patrocinador.'],
  ],
  reels: [
    ['headline', 'Camada do título da matéria', 'Nome da camada de texto do template que recebe o título.'],
    ['visual_title', 'Camada do selo da matéria', 'Nome da camada que receberá o selo (PNG) no template Placid.'],
    ['sponsor_1', 'Camada do primeiro patrocinador', 'Nome da camada que recebe o PNG do 1º patrocinador.'],
    ['sponsor_2', 'Camada do segundo patrocinador (opcional)', 'Nome da camada do 2º patrocinador.'],
  ],
}

// Friendly, non-technical messages keyed by the issue codes from the util.
const ISSUE_MESSAGES = {
  master_template_uuid: 'Selecione o modelo visual (template Placid) que será usado para gerar esta arte.',
  'layer:headline': 'Informe o nome da camada que receberá o título da matéria no template Placid.',
  'layer:news_image': 'Informe o nome da camada que receberá a imagem principal da notícia.',
  'layer:visual_title': 'Informe o nome da camada que receberá o selo da matéria no template Placid.',
  'layer:sponsor_1': 'Informe o nome da camada que receberá o primeiro patrocinador.',
}

const STATUS_LABEL = {
  active: ['Fluxo novo ativo', 'tone-success'],
  disabled: ['Configuração desabilitada', 'tone-neutral'],
  incomplete: ['Configuração incompleta', 'tone-brand'],
  kill_switch: ['Kill switch ativo', 'tone-neutral'],
  no_config: ['Sem configuração', 'tone-neutral'],
}

function fieldsFor(contentType) {
  return LAYER_FIELDS[contentType] || LAYER_FIELDS.feed
}

function buildLayerMap(layerValues, contentType) {
  const map = {}
  for (const [key] of fieldsFor(contentType)) {
    const value = String(layerValues?.[key] ?? '').trim()
    if (value) map[key] = value
  }
  return map
}

function prospectiveConfig(form, contentType) {
  return {
    content_type: contentType,
    master_template_uuid: String(form.master_template_uuid || '').trim(),
    layer_map: buildLayerMap(form.layer_map, contentType),
    enabled: true,
  }
}

function emptyForm() {
  return {
    master_template_uuid: '',
    template_set: null,
    enabled: false,
    layer_map: { ...DEFAULT_LAYER_MAP },
  }
}

function formFromConfig(config) {
  if (!config) return emptyForm()
  return {
    master_template_uuid: config.master_template_uuid || '',
    template_set: config.template_set ?? null, // preserved, never edited/exposed
    enabled: Boolean(config.enabled),
    layer_map: { ...DEFAULT_LAYER_MAP, ...(config.layer_map || {}) },
  }
}

// Lists Placid templates through the canonical ap-config proxy (same source used
// by AutoPublisherTemplates), so the selector reuses the registered templates.
async function listTemplates() {
  const { data, error } = await supabase.functions.invoke('ap-config', {
    method: 'POST',
    body: { resource: 'templates', action: 'list' },
  })
  if (error) throw error
  if (data && data.has_error) throw new Error(data.error || 'Falha ao listar templates.')
  return Array.isArray(data) ? data : []
}

export default function MasterRenderConfig({ clienteId }) {
  const [contentType, setContentType] = useState('feed')
  const [configs, setConfigs] = useState({}) // { feed, reels }
  const [control, setControl] = useState({ kill_switch: false })
  const [templates, setTemplates] = useState([])
  const [form, setForm] = useState(emptyForm())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState([])
  const [confirmKill, setConfirmKill] = useState(false)

  const load = useCallback(async () => {
    if (!clienteId) return
    setLoading(true)
    setMessage('')
    try {
      const [configsResult, controlResult, templatesList] = await Promise.all([
        supabase.schema('ap').from('master_render_configs')
          .select('id,content_type,template_set,master_template_uuid,enabled,layer_map')
          .eq('cliente_id', clienteId),
        supabase.schema('ap').from('master_render_controls')
          .select('kill_switch').eq('cliente_id', clienteId).maybeSingle(),
        listTemplates().catch(() => []),
      ])
      if (configsResult.error) throw configsResult.error
      if (controlResult.error) throw controlResult.error
      const byType = {}
      for (const row of configsResult.data || []) byType[row.content_type] = row
      setConfigs(byType)
      setControl({ kill_switch: Boolean(controlResult.data?.kill_switch) })
      setTemplates(templatesList)
    } catch (error) {
      setMessage(error.message || 'Não foi possível carregar a configuração de renderização.')
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => { load() }, [load])

  // Refill the form whenever the selected content type or loaded configs change.
  useEffect(() => {
    setForm(formFromConfig(configs[contentType]))
    setErrors([])
  }, [contentType, configs])

  const templateOptions = useMemo(() => {
    const list = templates.filter(t => t.tipo === contentType)
    const active = list.filter(t => t.ativo !== false)
    const current = form.master_template_uuid
    const currentInList = list.some(t => t.placid_template_uuid === current)
    // Keep the saved template visible even if it is inactive/absent, so editing
    // never silently drops it.
    if (current && !currentInList) {
      return [{ placid_template_uuid: current, nome: current, ativo: false, __missing: true }, ...active]
    }
    return active
  }, [templates, contentType, form.master_template_uuid])

  const status = masterV1Status(configs[contentType], control)
  const [statusText, statusTone] = STATUS_LABEL[status] || STATUS_LABEL.no_config

  const setLayer = (key, value) =>
    setForm(prev => ({ ...prev, layer_map: { ...prev.layer_map, [key]: value } }))

  async function saveConfig(enable) {
    setSaving(true)
    setErrors([])
    setMessage('')
    try {
      const uuid = String(form.master_template_uuid || '').trim()
      if (enable) {
        const issues = masterV1ConfigIssues(prospectiveConfig(form, contentType))
        if (issues.length) {
          setErrors(issues.map(code => ISSUE_MESSAGES[code] || 'Preencha os campos obrigatórios.'))
          setSaving(false)
          return // never persist enabled=true while incomplete
        }
      }
      const existing = configs[contentType]
      const payload = {
        cliente_id: clienteId,
        content_type: contentType,
        template_set: existing ? existing.template_set ?? null : null, // preserved, deprecated field
        master_template_uuid: uuid || null,
        layer_map: buildLayerMap(form.layer_map, contentType),
        enabled: Boolean(enable),
      }
      const { error } = await supabase.schema('ap').from('master_render_configs')
        .upsert(payload, { onConflict: 'cliente_id,content_type' })
      if (error) throw error
      setMessage(enable ? 'Configuração salva e fluxo novo habilitado.' : 'Configuração salva.')
      await load()
    } catch (error) {
      setMessage(error.message || 'Não foi possível salvar a configuração.')
    } finally {
      setSaving(false)
    }
  }

  async function setKillSwitch(next) {
    if (next && !confirmKill) { setConfirmKill(true); return }
    setSaving(true)
    setMessage('')
    try {
      const { error } = await supabase.schema('ap').from('master_render_controls')
        .upsert({ cliente_id: clienteId, kill_switch: next }, { onConflict: 'cliente_id' })
      if (error) throw error
      setConfirmKill(false)
      setMessage(next ? 'Kill switch ATIVADO. O fluxo novo está interrompido.' : 'Kill switch desativado.')
      await load()
    } catch (error) {
      setMessage(error.message || 'Não foi possível atualizar o kill switch.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status">Carregando configuração de renderização...</p>

  return (
    <section className="ap-form-section">
      <h3 className="ap-form-card-title">Modelo da arte (integração Placid)</h3>
      <p className="ap-config-intro">
        Defina qual template Placid e quais camadas serão usados para gerar as artes.
        Selo e patrocinadores só entram na arte quando esta configuração estiver válida e ativa.
      </p>

      <div className="ap-vt-toolbar">
        <label className="ap-field-label" style={{ minWidth: 200 }}>
          Tipo de conteúdo
          <select className="ap-select" value={contentType} onChange={e => setContentType(e.target.value)}>
            {CONTENT_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span className={`ap-chip ${statusTone}`} role="status" style={{ alignSelf: 'flex-end' }}>{statusText}</span>
      </div>

      {control.kill_switch && (
        <p role="alert" className="ap-vt-alert">
          Kill switch ativo: o fluxo novo está interrompido para todos os formatos, mesmo com a configuração habilitada.
        </p>
      )}
      {status === 'disabled' && !control.kill_switch && (
        <p role="status" className="ap-vt-alert">
          Configuração salva, porém desabilitada. As matérias continuam usando o fluxo antigo (sem selo e sem patrocinadores) até você habilitar.
        </p>
      )}

      <div className="ap-form-card" style={{ marginTop: 12 }}>
        <label className="ap-field-label">
          Template Placid principal
          <select className="ap-select" value={form.master_template_uuid}
            onChange={e => setForm(prev => ({ ...prev, master_template_uuid: e.target.value }))}>
            <option value="">Selecione o modelo visual...</option>
            {templateOptions.map(t => (
              <option key={t.placid_template_uuid} value={t.placid_template_uuid}>
                {t.nome} — {t.placid_template_uuid}{t.__missing ? ' (inativo)' : ''}
              </option>
            ))}
          </select>
          <small className="ap-dropzone-sub">Escolhido entre os templates cadastrados. Não há rotação entre templates: este é o modelo usado para gerar a arte.</small>
        </label>

        <div className="ap-field-grid">
          {fieldsFor(contentType).map(([key, label, help]) => (
            <label className="ap-field-label" key={key}>
              {label}
              <input className="ap-input" value={form.layer_map[key] ?? ''} placeholder="Nome da camada no template"
                onChange={e => setLayer(key, e.target.value)} />
              <small className="ap-dropzone-sub">{help}</small>
            </label>
          ))}
        </div>

        {errors.length > 0 && (
          <div role="alert" className="ap-vt-alert">
            <strong>Não foi possível habilitar:</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {errors.map((msg, i) => <li key={i}>{msg}</li>)}
            </ul>
          </div>
        )}

        <div className="ap-vt-actions">
          <button type="button" className="ap-btn-outline" disabled={saving} onClick={() => saveConfig(false)}>
            Salvar sem habilitar
          </button>
          <button type="button" className="ap-btn-add" disabled={saving} onClick={() => saveConfig(true)}>
            Salvar e habilitar fluxo novo
          </button>
          {form.enabled && (
            <button type="button" className="ap-btn-outline" disabled={saving} onClick={() => saveConfig(false)}>
              Desabilitar
            </button>
          )}
        </div>
      </div>

      <div className="ap-form-card" style={{ marginTop: 16 }}>
        <h4 className="ap-form-card-title">Kill switch (interrupção emergencial)</h4>
        <p className="ap-config-intro">
          Diferente de desabilitar: o kill switch interrompe o fluxo novo de <strong>todos</strong> os formatos
          imediatamente, mesmo com a configuração habilitada. Use apenas em emergência.
        </p>
        {confirmKill ? (
          <div className="ap-vt-alert">
            Confirmar ativação do kill switch? O fluxo novo será interrompido para este cliente.
            <div className="ap-vt-actions" style={{ marginTop: 8 }}>
              <button type="button" className="ap-btn-add" disabled={saving} onClick={() => setKillSwitch(true)}>Confirmar</button>
              <button type="button" className="ap-btn-outline" disabled={saving} onClick={() => setConfirmKill(false)}>Cancelar</button>
            </div>
          </div>
        ) : (
          <div className="ap-vt-actions">
            {control.kill_switch
              ? <button type="button" className="ap-btn-add" disabled={saving} onClick={() => setKillSwitch(false)}>Desativar kill switch</button>
              : <button type="button" className="ap-btn-outline" disabled={saving} onClick={() => setKillSwitch(true)}>Ativar kill switch</button>}
          </div>
        )}
      </div>

      {message && <p role="status" className="ap-config-intro" style={{ marginTop: 12 }}>{message}</p>}
    </section>
  )
}
