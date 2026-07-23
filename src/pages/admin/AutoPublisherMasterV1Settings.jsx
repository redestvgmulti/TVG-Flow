import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import { assetPreviewUrl, uploadImmutablePng } from '../../services/masterV1Assets'

const CLIENTE_ID = 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9'
const DEFAULT_MAP = { news_image: '', headline: '', tag: '', visual_title: 'tag-png', sponsor_1: 'patrocinador-1', sponsor_2: 'patrocinador-2' }
const emptyTitle = { id: null, nome: '', slug: '', formatos: ['feed', 'reels'], ordem: 0, ativo: true }
const emptySponsor = { id: null, nome: '', slug: '', ativo: true }
const emptyMembership = { sponsor_id: '', template_set: 'default', content_type: 'feed', ordem: 0, ativo: true }

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function PngField({ label, file, currentAsset, onFileChange }) {
  const [dragging, setDragging] = useState(false)
  const preview = useMemo(() => file ? URL.createObjectURL(file) : assetPreviewUrl(supabase, currentAsset), [file, currentAsset])

  useEffect(() => () => { if (file && preview) URL.revokeObjectURL(preview) }, [file, preview])

  function choose(candidate) {
    if (!candidate) return
    if (candidate.type !== 'image/png' || !candidate.name.toLowerCase().endsWith('.png')) {
      onFileChange(null, 'Envie somente arquivos PNG.')
      return
    }
    if (candidate.size > 5 * 1024 * 1024) {
      onFileChange(null, 'O PNG deve ter no maximo 5 MB.')
      return
    }
    onFileChange(candidate, '')
  }

  return <label style={{ display: 'grid', gap: 8 }}>
    <strong style={{ fontSize: 13 }}>{label}</strong>
    <span
      onDragOver={event => { event.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={event => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files?.[0]) }}
      style={{ border: '2px dashed ' + (dragging ? '#2563eb' : '#cbd5e1'), borderRadius: 10, padding: 12, background: dragging ? '#eff6ff' : '#f8fafc', cursor: 'pointer', minHeight: 78, display: 'grid', alignItems: 'center', justifyItems: 'start' }}
    >
      <input type="file" accept="image/png" onChange={event => choose(event.target.files?.[0])} style={{ display: 'none' }} />
      {preview ? <img src={preview} alt={label} style={{ maxHeight: 58, maxWidth: 180, objectFit: 'contain' }} /> : <span>Arraste o PNG aqui ou clique para selecionar</span>}
      {file && <small>{file.name}</small>}
    </span>
  </label>
}

function toggleFormat(item, format) {
  return item.formatos.includes(format) ? item.formatos.filter(value => value !== format) : [...item.formatos, format]
}

export default function AutoPublisherMasterV1Settings() {
  const [tab, setTab] = useState('titles')
  const [titles, setTitles] = useState([])
  const [sponsors, setSponsors] = useState([])
  const [memberships, setMemberships] = useState([])
  const [configs, setConfigs] = useState([])
  const [control, setControl] = useState({ kill_switch: false })
  const [title, setTitle] = useState(emptyTitle)
  const [titleFile, setTitleFile] = useState(null)
  const [sponsor, setSponsor] = useState(emptySponsor)
  const [sponsorFile, setSponsorFile] = useState(null)
  const [membership, setMembership] = useState(emptyMembership)
  const [format, setFormat] = useState('feed')
  const [masterUuid, setMasterUuid] = useState('')
  const [templateSet, setTemplateSet] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [layerMap, setLayerMap] = useState(DEFAULT_MAP)
  const [previewSponsor1, setPreviewSponsor1] = useState('')
  const [previewSponsor2, setPreviewSponsor2] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const notice = text => setMessage(text)

  async function load() {
    const [titlesResult, sponsorsResult, membershipsResult, configsResult, controlResult] = await Promise.all([
      supabase.schema('ap').from('visual_titles').select('*').eq('cliente_id', CLIENTE_ID).order('ordem'),
      supabase.schema('ap').from('render_sponsors').select('*').eq('cliente_id', CLIENTE_ID).order('nome'),
      supabase.schema('ap').from('render_sponsor_scope_memberships').select('*').eq('cliente_id', CLIENTE_ID).order('template_set').order('content_type').order('ordem'),
      supabase.schema('ap').from('master_render_configs').select('*').eq('cliente_id', CLIENTE_ID),
      supabase.schema('ap').from('master_render_controls').select('*').eq('cliente_id', CLIENTE_ID).maybeSingle(),
    ])
    const failure = [titlesResult, sponsorsResult, membershipsResult, configsResult, controlResult].find(result => result.error)
    if (failure?.error) throw failure.error
    setTitles(titlesResult.data || [])
    setSponsors(sponsorsResult.data || [])
    setMemberships(membershipsResult.data || [])
    setConfigs(configsResult.data || [])
    setControl(controlResult.data || { kill_switch: false })
  }

  useEffect(() => { load().catch(error => notice(error.message)) }, [])

  useEffect(() => {
    const current = configs.find(config => config.content_type === format && (config.template_set || '') === templateSet)
    setMasterUuid(current?.master_template_uuid || '')
    setEnabled(Boolean(current?.enabled))
    setLayerMap({ ...DEFAULT_MAP, ...(current?.layer_map || {}) })
  }, [configs, format, templateSet])

  const activeTitle = titles.find(item => item.ativo)
  const selectedSponsor = sponsors.find(item => item.id === membership.sponsor_id)
  const sponsorById = useMemo(() => new Map(sponsors.map(item => [item.id, item])), [sponsors])

  async function saveTitle() {
    setSaving(true)
    try {
      const normalizedSlug = slugify(title.slug || title.nome)
      if (!title.nome.trim() || !normalizedSlug) throw new Error('Nome do selo e obrigatorio.')
      if (!title.id && !titleFile) throw new Error('Envie o PNG do selo.')
      if (!title.formatos.length) throw new Error('Selecione ao menos um formato.')
      let asset = null
      if (titleFile) asset = await uploadImmutablePng({ supabase, file: titleFile, clienteId: CLIENTE_ID, kind: 'visual-titles', slug: normalizedSlug })
      const payload = { nome: title.nome.trim(), slug: normalizedSlug, formatos: title.formatos, ordem: Number(title.ordem) || 0, ativo: Boolean(title.ativo) }
      if (asset) Object.assign(payload, { asset_bucket: asset.bucket, asset_path: asset.path, asset_version: asset.version, sha256: asset.sha256 })
      const result = title.id
        ? await supabase.schema('ap').from('visual_titles').update(payload).eq('id', title.id).eq('cliente_id', CLIENTE_ID)
        : await supabase.schema('ap').from('visual_titles').insert({ ...payload, cliente_id: CLIENTE_ID })
      if (result.error) throw result.error
      setTitle(emptyTitle)
      setTitleFile(null)
      notice('Selo salvo. Versoes anteriores permanecem preservadas no Storage.')
      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveSponsor() {
    setSaving(true)
    try {
      const normalizedSlug = slugify(sponsor.slug || sponsor.nome)
      if (!sponsor.nome.trim() || !normalizedSlug) throw new Error('Nome do patrocinador e obrigatorio.')
      if (!sponsor.id && !sponsorFile) throw new Error('Envie o PNG do patrocinador.')
      let asset = null
      if (sponsorFile) asset = await uploadImmutablePng({ supabase, file: sponsorFile, clienteId: CLIENTE_ID, kind: 'sponsors', slug: normalizedSlug })
      const payload = { nome: sponsor.nome.trim(), slug: normalizedSlug, ativo: Boolean(sponsor.ativo) }
      if (asset) Object.assign(payload, { asset_bucket: asset.bucket, asset_path: asset.path, asset_version: asset.version, sha256: asset.sha256 })
      const result = sponsor.id
        ? await supabase.schema('ap').from('render_sponsors').update(payload).eq('id', sponsor.id).eq('cliente_id', CLIENTE_ID)
        : await supabase.schema('ap').from('render_sponsors').insert({ ...payload, cliente_id: CLIENTE_ID })
      if (result.error) throw result.error
      setSponsor(emptySponsor)
      setSponsorFile(null)
      notice('Patrocinador salvo. O catalogo nao altera a rotacao de templates legada.')
      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveMembership() {
    setSaving(true)
    try {
      if (!membership.sponsor_id) throw new Error('Selecione um patrocinador.')
      const scope = String(membership.template_set || '').trim().toLowerCase()
      if (!/^[a-z0-9][a-z0-9_-]*$/.test(scope)) throw new Error('Campanha invalida.')
      const result = await supabase.schema('ap').from('render_sponsor_scope_memberships').upsert({ cliente_id: CLIENTE_ID, sponsor_id: membership.sponsor_id, template_set: scope, content_type: membership.content_type, ordem: Number(membership.ordem) || 0, ativo: Boolean(membership.ativo) }, { onConflict: 'cliente_id,template_set,content_type,sponsor_id' })
      if (result.error) throw result.error
      setMembership(emptyMembership)
      notice('Escopo de rotacao salvo.')
      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveMaster() {
    setSaving(true)
    try {
      const duplicateNames = Object.values(layerMap).filter(Boolean)
      if (new Set(duplicateNames).size !== duplicateNames.length) throw new Error('O layer map possui nomes duplicados.')
      if (enabled && (!masterUuid || !layerMap.visual_title || !activeTitle)) throw new Error('Ativacao exige UUID, layer do selo e pelo menos um selo ativo.')
      const current = configs.find(config => config.content_type === format && (config.template_set || '') === templateSet)
      const payload = { cliente_id: CLIENTE_ID, content_type: format, template_set: templateSet || null, master_template_uuid: masterUuid || null, enabled, layer_map: layerMap }
      const result = current ? await supabase.schema('ap').from('master_render_configs').update(payload).eq('id', current.id) : await supabase.schema('ap').from('master_render_configs').insert(payload)
      if (result.error) throw result.error
      notice('Configuracao master salva. Nenhuma ativacao e feita automaticamente.')
      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function saveKillSwitch() {
    setSaving(true)
    try {
      const result = await supabase.schema('ap').from('master_render_controls').upsert({ cliente_id: CLIENTE_ID, kill_switch: Boolean(control.kill_switch) }, { onConflict: 'cliente_id' })
      if (result.error) throw result.error
      notice('Kill switch salvo.')
      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function archiveMembership(item) {
    const { error } = await supabase.schema('ap').from('render_sponsor_scope_memberships').update({ ativo: !item.ativo }).eq('id', item.id).eq('cliente_id', CLIENTE_ID)
    if (error) notice(error.message)
    else await load()
  }

  const logicalPayload = useMemo(() => {
    const config = configs.find(item => item.content_type === format && (item.template_set || '') === templateSet)
    const titleAsset = activeTitle && layerMap.visual_title ? { image: assetPreviewUrl(supabase, { bucket: activeTitle.asset_bucket, path: activeTitle.asset_path }) } : null
    const first = sponsorById.get(previewSponsor1)
    const second = sponsorById.get(previewSponsor2)
    const layers = {}
    if (titleAsset) layers[layerMap.visual_title] = titleAsset
    if (first?.asset_bucket && first?.asset_path && layerMap.sponsor_1) layers[layerMap.sponsor_1] = { image: assetPreviewUrl(supabase, { bucket: first.asset_bucket, path: first.asset_path }) }
    if (second?.asset_bucket && second?.asset_path && layerMap.sponsor_2) layers[layerMap.sponsor_2] = { image: assetPreviewUrl(supabase, { bucket: second.asset_bucket, path: second.asset_path }) }
    return { template_uuid: enabled && masterUuid ? masterUuid : '<UUID legado>', contract: enabled && masterUuid && !control.kill_switch ? 'master_v1' : 'legacy', selected_config: config?.id || null, layers }
  }, [activeTitle, configs, control.kill_switch, enabled, format, layerMap, masterUuid, previewSponsor1, previewSponsor2, sponsorById, templateSet])

  const tabs = [['titles', 'Selos da arte'], ['sponsors', 'Patrocinadores'], ['masters', 'Templates master'], ['diagnostic', 'Diagnostico']]

  return <div className="ap-settings" style={{ marginTop: 24 }}><div className="ap-form-section">
    <h2>Configuracoes das artes</h2>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>{tabs.map(([key, label]) => <button key={key} type="button" className={tab === key ? 'ap-btn-add' : 'ap-btn-outline'} onClick={() => setTab(key)}>{label}</button>)}</div>
    {message && <p role="status" style={{ color: '#475569' }}>{message}</p>}

    {tab === 'titles' && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, alignItems: 'end' }}>
      <label>Nome<input className="ap-input" value={title.nome} onChange={event => setTitle({ ...title, nome: event.target.value, slug: title.slug || slugify(event.target.value) })} /></label>
      <label>Slug<input className="ap-input" value={title.slug} onChange={event => setTitle({ ...title, slug: slugify(event.target.value) })} /></label>
      <label>Ordem<input className="ap-input" type="number" min="0" value={title.ordem} onChange={event => setTitle({ ...title, ordem: event.target.value })} /></label>
      <label><input type="checkbox" checked={title.formatos.includes('feed')} onChange={() => setTitle({ ...title, formatos: toggleFormat(title, 'feed') })} /> Feed</label>
      <label><input type="checkbox" checked={title.formatos.includes('reels')} onChange={() => setTitle({ ...title, formatos: toggleFormat(title, 'reels') })} /> Reels</label>
      <label><input type="checkbox" checked={title.ativo} onChange={event => setTitle({ ...title, ativo: event.target.checked })} /> Ativo</label>
      <PngField label="PNG do selo" file={titleFile} currentAsset={title.id ? title : null} onFileChange={(file, error) => { setTitleFile(file); if (error) notice(error) }} />
    </div><div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button type="button" className="ap-btn-add" disabled={saving} onClick={saveTitle}>{title.id ? 'Salvar alteracoes' : 'Cadastrar selo'}</button>{title.id && <button type="button" className="ap-btn-outline" onClick={() => { setTitle(emptyTitle); setTitleFile(null) }}>Cancelar edicao</button>}</div>
    <table className="ap-table" style={{ marginTop: 16 }}><thead><tr><th>Preview</th><th>Nome</th><th>Formatos</th><th>Ordem</th><th>Status</th><th>Acoes</th></tr></thead><tbody>{titles.map(item => <tr key={item.id}><td><img src={assetPreviewUrl(supabase, { bucket: item.asset_bucket, path: item.asset_path })} alt="" style={{ height: 30, maxWidth: 90, objectFit: 'contain' }} /></td><td>{item.nome}</td><td>{item.formatos.join(', ')}</td><td>{item.ordem}</td><td>{item.ativo ? 'Ativo' : 'Arquivado'}</td><td><button type="button" className="ap-btn-sm" onClick={() => { setTitle({ ...item }); setTitleFile(null) }}>Editar</button><button type="button" className="ap-btn-sm" onClick={async () => { const result = await supabase.schema('ap').from('visual_titles').update({ ativo: !item.ativo }).eq('id', item.id).eq('cliente_id', CLIENTE_ID); if (result.error) notice(result.error.message); else await load() }}>{item.ativo ? 'Arquivar' : 'Ativar'}</button></td></tr>)}</tbody></table></>}

    {tab === 'sponsors' && <><h3>Catalogo de patrocinadores</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12, alignItems: 'end' }}>
      <label>Nome<input className="ap-input" value={sponsor.nome} onChange={event => setSponsor({ ...sponsor, nome: event.target.value, slug: sponsor.slug || slugify(event.target.value) })} /></label>
      <label>Slug<input className="ap-input" value={sponsor.slug} onChange={event => setSponsor({ ...sponsor, slug: slugify(event.target.value) })} /></label>
      <label><input type="checkbox" checked={sponsor.ativo} onChange={event => setSponsor({ ...sponsor, ativo: event.target.checked })} /> Ativo</label>
      <PngField label="Logo PNG" file={sponsorFile} currentAsset={sponsor.id ? sponsor : null} onFileChange={(file, error) => { setSponsorFile(file); if (error) notice(error) }} />
    </div><div style={{ display: 'flex', gap: 8, marginTop: 12 }}><button type="button" className="ap-btn-add" disabled={saving} onClick={saveSponsor}>{sponsor.id ? 'Salvar alteracoes' : 'Cadastrar patrocinador'}</button>{sponsor.id && <button type="button" className="ap-btn-outline" onClick={() => { setSponsor(emptySponsor); setSponsorFile(null) }}>Cancelar edicao</button>}</div>
    <table className="ap-table" style={{ marginTop: 16 }}><thead><tr><th>Preview</th><th>Nome</th><th>Status</th><th>Acoes</th></tr></thead><tbody>{sponsors.map(item => <tr key={item.id}><td><img src={assetPreviewUrl(supabase, { bucket: item.asset_bucket, path: item.asset_path })} alt="" style={{ height: 30, maxWidth: 90, objectFit: 'contain' }} /></td><td>{item.nome}</td><td>{item.ativo ? 'Ativo' : 'Arquivado'}</td><td><button type="button" className="ap-btn-sm" onClick={() => { setSponsor({ ...item }); setSponsorFile(null) }}>Editar</button><button type="button" className="ap-btn-sm" onClick={async () => { const result = await supabase.schema('ap').from('render_sponsors').update({ ativo: !item.ativo }).eq('id', item.id).eq('cliente_id', CLIENTE_ID); if (result.error) notice(result.error.message); else await load() }}>{item.ativo ? 'Arquivar' : 'Ativar'}</button></td></tr>)}</tbody></table>
    <h3 style={{ marginTop: 22 }}>Campanhas e formatos da rotacao</h3><p style={{ color: '#64748b' }}>A ordem pertence a esta associacao. Ela nao altera templates, cursor ou fila legados.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, alignItems: 'end' }}>
      <label>Patrocinador<select className="ap-select" value={membership.sponsor_id} onChange={event => setMembership({ ...membership, sponsor_id: event.target.value })}><option value="">Selecione</option>{sponsors.filter(item => item.ativo).map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
      <label>Campanha<input className="ap-input" value={membership.template_set} onChange={event => setMembership({ ...membership, template_set: event.target.value })} /></label>
      <label>Formato<select className="ap-select" value={membership.content_type} onChange={event => setMembership({ ...membership, content_type: event.target.value })}><option value="feed">Feed</option><option value="reels">Reels</option></select></label>
      <label>Ordem<input className="ap-input" type="number" min="0" value={membership.ordem} onChange={event => setMembership({ ...membership, ordem: event.target.value })} /></label>
      <label><input type="checkbox" checked={membership.ativo} onChange={event => setMembership({ ...membership, ativo: event.target.checked })} /> Ativo</label>
      <button type="button" className="ap-btn-add" disabled={saving || !selectedSponsor} onClick={saveMembership}>Adicionar ao escopo</button>
    </div><table className="ap-table" style={{ marginTop: 16 }}><thead><tr><th>Patrocinador</th><th>Campanha</th><th>Formato</th><th>Ordem</th><th>Status</th><th>Acoes</th></tr></thead><tbody>{memberships.map(item => <tr key={item.id}><td>{sponsorById.get(item.sponsor_id)?.nome || 'Catalogo indisponivel'}</td><td>{item.template_set}</td><td>{item.content_type}</td><td>{item.ordem}</td><td>{item.ativo ? 'Ativo' : 'Pausado'}</td><td><button type="button" className="ap-btn-sm" onClick={() => setMembership({ ...item })}>Editar</button><button type="button" className="ap-btn-sm" onClick={() => archiveMembership(item)}>{item.ativo ? 'Pausar' : 'Ativar'}</button></td></tr>)}</tbody></table></>}

    {tab === 'masters' && <><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, alignItems: 'end' }}>
      <label>Formato<select className="ap-select" value={format} onChange={event => setFormat(event.target.value)}><option value="feed">Feed</option><option value="reels">Reels</option></select></label>
      <label>Campanha (opcional)<input className="ap-input" value={templateSet} onChange={event => setTemplateSet(event.target.value.trim().toLowerCase())} /></label>
      <label>UUID master<input className="ap-input" placeholder="Vazio enquanto nao configurado" value={masterUuid} onChange={event => setMasterUuid(event.target.value.trim())} /></label>
      <label><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> Ativar master para este escopo</label>
    </div><h3 style={{ marginTop: 20 }}>Layer map</h3><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 8 }}>{Object.keys(DEFAULT_MAP).map(key => <label key={key}>{key}<input className="ap-input" value={layerMap[key] || ''} placeholder="Ausente" onChange={event => setLayerMap({ ...layerMap, [key]: event.target.value.trim() })} /></label>)}</div><button type="button" className="ap-btn-add" disabled={saving} style={{ marginTop: 12 }} onClick={saveMaster}>Salvar configuracao master</button>
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' }}><label><input type="checkbox" checked={control.kill_switch} onChange={event => setControl({ ...control, kill_switch: event.target.checked })} /> Kill switch global</label><button type="button" className="ap-btn-outline" disabled={saving} style={{ marginLeft: 8 }} onClick={saveKillSwitch}>Salvar kill switch</button></div></>}

    {tab === 'diagnostic' && <><p style={{ color: '#64748b' }}>Preview logico: nao chama Placid e nao executa rotacao.</p><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>
      <label>Formato<select className="ap-select" value={format} onChange={event => setFormat(event.target.value)}><option value="feed">Feed</option><option value="reels">Reels</option></select></label>
      <label>Patrocinador 1<select className="ap-select" value={previewSponsor1} onChange={event => setPreviewSponsor1(event.target.value)}><option value="">Nenhum</option>{sponsors.filter(item => item.ativo && item.id !== previewSponsor2).map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
      <label>Patrocinador 2<select className="ap-select" value={previewSponsor2} onChange={event => setPreviewSponsor2(event.target.value)}><option value="">Nenhum</option>{sponsors.filter(item => item.ativo && item.id !== previewSponsor1).map(item => <option key={item.id} value={item.id}>{item.nome}</option>)}</select></label>
    </div><pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 16, borderRadius: 10, overflow: 'auto', marginTop: 16 }}>{JSON.stringify(logicalPayload, null, 2)}</pre></>}
  </div></div>
}
