import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { toast } from 'sonner'
import { assetPreviewUrl, uploadImmutablePng } from '../../services/masterV1Assets'
import VisualTitlesManager from '../../components/editorial/VisualTitlesManager'

const CLIENTE_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
const DEFAULT_FEED_LAYER_MAP = { news_image: 'news-image', headline: 'headline_news', tag: 'tag_news', visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const DEFAULT_REELS_LAYER_MAP = { news_image: '', headline: 'headline_news', tag: '', visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const defaultLayerMapFor = format => ({ ...(format === 'reels' ? DEFAULT_REELS_LAYER_MAP : DEFAULT_FEED_LAYER_MAP) })

// Rótulos amigáveis para as camadas do template master
const LAYER_LABELS = {
  news_image: 'Imagem da notícia',
  headline: 'Manchete',
  tag: 'Tag',
  visual_title: 'Selo',
  sponsor_1: 'Patrocinador 1',
  sponsor_2: 'Patrocinador 2',
}

const SUBTABS = [
  ['titles', 'Selos da matéria'],
  ['profiles', 'Patrocinadores'],
  ['masters', 'Templates master'],
  ['diagnostic', 'Diagnóstico'],
]

function Slot({ label, asset, onChange }) {
  const preview = asset ? assetPreviewUrl(supabase, asset) : null
  return (
    <div className="ap-slot">
      <strong>{label}</strong>
      {preview && <img src={preview} alt={label} className="ap-slot-preview" />}
      <input type="file" accept="image/png" className="ap-file-input" onChange={e => onChange(e.target.files?.[0] || null)} />
      {asset && <button className="ap-btn-sm" onClick={() => onChange(null)}>Limpar slot</button>}
    </div>
  )
}

export default function AutoPublisherMasterV1Settings() {
  const [tab, setTab] = useState('titles')
  const [titles, setTitles] = useState([])
  const [templates, setTemplates] = useState([])
  const [profiles, setProfiles] = useState([])
  const [configs, setConfigs] = useState([])
  const [control, setControl] = useState({ kill_switch: false })
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [profileAssets, setProfileAssets] = useState({ sponsor_1: undefined, sponsor_2: undefined })
  const [format, setFormat] = useState('feed')
  const [masterUuid, setMasterUuid] = useState('')
  const [templateSet, setTemplateSet] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [layerMap, setLayerMap] = useState(DEFAULT_FEED_LAYER_MAP)

  async function load() {
    const [a, b, c, d, e] = await Promise.all([
      supabase.schema('ap').from('visual_titles').select('*').eq('cliente_id', CLIENTE_ID).order('ordem'),
      supabase.schema('ap').from('templates').select('id,nome,tipo,template_set,ordem,placid_template_uuid,ativo,uso_total').eq('empresa_id', CLIENTE_ID).order('ordem'),
      supabase.schema('ap').from('template_render_profiles').select('*'),
      supabase.schema('ap').from('master_render_configs').select('*').eq('cliente_id', CLIENTE_ID),
      supabase.schema('ap').from('master_render_controls').select('*').eq('cliente_id', CLIENTE_ID).maybeSingle(),
    ])
    setTitles(a.data || [])
    setTemplates(b.data || [])
    setProfiles(c.data || [])
    setConfigs(d.data || [])
    setControl(e.data || { kill_switch: false })
  }

  useEffect(() => { load().catch(error => toast.error(error.message)) }, [])

  const activeTitle = titles.find(item => item.ativo)

  async function saveProfile() {
    try {
      if (!selectedTemplate) throw new Error('Selecione uma linha de template.')
      const current = profiles.find(p => p.template_id === selectedTemplate)
      const slots = { ...(current?.other_slots || {}) }
      for (const slot of ['sponsor_1', 'sponsor_2']) {
        const input = profileAssets[slot]
        if (input === undefined) continue
        if (input === null) delete slots[slot]
        else slots[slot] = await uploadImmutablePng({ supabase, file: input, clienteId: CLIENTE_ID, kind: 'sponsors', slug: `${selectedTemplate}-${slot}` })
      }
      const payload = { template_id: selectedTemplate, profile_version: new Date().toISOString(), other_slots: slots, ativo: true }
      const query = current
        ? supabase.schema('ap').from('template_render_profiles').update(payload).eq('id', current.id)
        : supabase.schema('ap').from('template_render_profiles').insert(payload)
      const { error } = await query
      if (error) throw error
      setProfileAssets({ sponsor_1: undefined, sponsor_2: undefined })
      toast.success('Perfil salvo.')
      load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function saveMaster() {
    try {
      const duplicates = Object.entries(layerMap).filter(([, value]) => value).map(([, value]) => value)
      if (new Set(duplicates).size !== duplicates.length) throw new Error('O mapeamento de camadas tem nomes duplicados.')
      if (enabled && (!masterUuid || !layerMap.visual_title || !activeTitle)) throw new Error('Para ativar é preciso: UUID, mapeamento do selo e um selo de matéria disponível.')
      const current = configs.find(c => c.content_type === format && (c.template_set || '') === templateSet)
      const payload = { cliente_id: CLIENTE_ID, content_type: format, template_set: templateSet || null, master_template_uuid: masterUuid || null, enabled, layer_map: layerMap }
      const { error } = current
        ? await supabase.schema('ap').from('master_render_configs').update(payload).eq('id', current.id)
        : await supabase.schema('ap').from('master_render_configs').insert(payload)
      if (error) throw error
      toast.success('Configuração master salva.')
      load()
    } catch (error) {
      toast.error(error.message)
    }
  }

  async function saveKill() {
    const { error } = await supabase.schema('ap').from('master_render_controls').upsert({ cliente_id: CLIENTE_ID, kill_switch: control.kill_switch })
    if (error) toast.error(error.message)
    else toast.success(control.kill_switch ? 'Kill switch ativado.' : 'Kill switch desativado.')
  }

  const previewProfile = profiles.find(p => p.template_id === selectedTemplate)
  const previewSlots = useMemo(() => previewProfile?.other_slots || {}, [previewProfile])
  const payload = useMemo(() => ({
    template_uuid: enabled && masterUuid ? masterUuid : (templates.find(t => t.id === selectedTemplate)?.placid_template_uuid || '<UUID legado>'),
    layers: Object.fromEntries([
      ['visual_title', activeTitle && layerMap.visual_title ? [layerMap.visual_title, { image: assetPreviewUrl(supabase, { bucket: activeTitle.asset_bucket, path: activeTitle.asset_path }) }] : null],
      ...['sponsor_1', 'sponsor_2'].map(slot => previewSlots[slot] && layerMap[slot] ? [layerMap[slot], { image: assetPreviewUrl(supabase, previewSlots[slot]) }] : null),
    ].filter(Boolean)),
  }), [enabled, masterUuid, templates, selectedTemplate, activeTitle, layerMap, previewSlots])

  return (
    <div className="ap-settings">
      <div className="ap-form-section">
        <h2>Configuração das Artes</h2>
        <p className="ap-config-intro">Cadastre os elementos que o sistema usará automaticamente nas artes das matérias.</p>

        <div className="ap-subtabs">
          {SUBTABS.map(([key, label]) => (
            <button key={key} className={`ap-subtab${tab === key ? ' active' : ''}`} onClick={() => setTab(key)}>{label}</button>
          ))}
        </div>

        {tab === 'titles' && <VisualTitlesManager clienteId={CLIENTE_ID} onChanged={load} />}

        {tab === 'profiles' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <select className="ap-select" value={selectedTemplate} onChange={e => { setSelectedTemplate(e.target.value); setProfileAssets({ sponsor_1: undefined, sponsor_2: undefined }) }}>
              <option value="">Selecione o template rotacionado</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.nome} · {t.tipo} · {t.template_set} · #{t.ordem}</option>)}
            </select>
            {selectedTemplate && (
              <>
                <div className="ap-field-grid">
                  <Slot label="Patrocinador 1" asset={previewSlots.sponsor_1} onChange={file => setProfileAssets({ ...profileAssets, sponsor_1: file })} />
                  <Slot label="Patrocinador 2" asset={previewSlots.sponsor_2} onChange={file => setProfileAssets({ ...profileAssets, sponsor_2: file })} />
                </div>
                <div><button className="ap-btn-add" onClick={saveProfile}>Salvar perfil</button></div>
              </>
            )}
          </div>
        )}

        {tab === 'masters' && (
          <div style={{ display: 'grid', gap: 16 }}>
            <div className="ap-form-row">
              <select className="ap-select" value={format} onChange={e => { const nextFormat = e.target.value; setFormat(nextFormat); setLayerMap(defaultLayerMapFor(nextFormat)) }}>
                <option value="feed">Feed</option>
                <option value="reels">Reels</option>
              </select>
              <input className="ap-input" placeholder="UUID master (opcional)" value={masterUuid} onChange={e => setMasterUuid(e.target.value.trim())} />
              <input className="ap-input" placeholder="Campanha (template_set, opcional)" value={templateSet} onChange={e => setTemplateSet(e.target.value)} />
              <label className="ap-switch">
                <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
                <span className="ap-switch-track" />
                <span className="ap-switch-label">Ativado</span>
              </label>
              <button className="ap-btn-add" onClick={saveMaster}>Salvar</button>
            </div>

            <div className="ap-field-grid">
              {Object.keys(DEFAULT_FEED_LAYER_MAP).map(key => (
                <label key={key} className="ap-field-label">
                  {LAYER_LABELS[key] || key}
                  <input className="ap-input" value={layerMap[key] || ''} placeholder="Ausente" onChange={e => setLayerMap({ ...layerMap, [key]: e.target.value.trim() })} />
                </label>
              ))}
            </div>

            <div className="ap-config-card" style={{ gap: 12 }}>
              <label className="ap-switch">
                <input type="checkbox" checked={control.kill_switch} onChange={e => setControl({ ...control, kill_switch: e.target.checked })} />
                <span className="ap-switch-track" />
                <span className="ap-switch-body">
                  <span className="ap-switch-label">Kill switch global</span>
                  <span className="ap-switch-hint">Interrompe toda a renderização master deste cliente.</span>
                </span>
              </label>
              <div><button className="ap-btn-outline" onClick={saveKill}>Salvar kill switch</button></div>
            </div>
          </div>
        )}

        {tab === 'diagnostic' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p className="ap-config-intro" style={{ margin: 0 }}>Selecione um template na aba Patrocinadores para simular os quatro cenários de slots sem chamar o Placid.</p>
            <pre className="ap-code-block">{JSON.stringify({ format, legacy_uuid: templates.find(t => t.id === selectedTemplate)?.placid_template_uuid || null, master_uuid: masterUuid || null, contract: enabled && masterUuid ? 'master_v1' : 'legacy', payload }, null, 2)}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
