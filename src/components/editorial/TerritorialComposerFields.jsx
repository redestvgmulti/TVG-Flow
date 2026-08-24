import { useMemo, useState } from 'react'
import { Building2, Check, MapPin } from 'lucide-react'
import { supabase } from '../../services/supabase'
import VisualTitleCombobox from './VisualTitleCombobox'
import {
  territorialAssetPublicUrl,
} from '../../services/territorialComposer'

const MODES = [
  { value: 'editorial', label: 'Editorial', description: 'Selo editorial e região' },
  { value: 'cities', label: 'Cidades', description: 'Cidade resolve região e selo' },
  { value: 'individual', label: 'Individual', description: 'Composição manual dos slots' },
]

function FieldError({ children }) {
  return children ? <small role="alert" style={{ color: '#dc2626', fontWeight: 600 }}>{children}</small> : null
}

function AssetThumbnail({ asset, alt }) {
  const src = territorialAssetPublicUrl(supabase, asset)
  if (!src) return <div aria-hidden="true" style={{ width: 40, height: 40, borderRadius: 10, background: '#e2e8f0' }} />
  return <img src={src} alt={alt} style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'contain', background: '#fff', border: '1px solid #e2e8f0' }} />
}

function groupTerritorialTitles(titles, fallbackGroupName) {
  const groups = new Map()
  for (const title of titles) {
    const id = title.group_id || `territorial-${fallbackGroupName}`
    if (!groups.has(id)) {
      groups.set(id, {
        id,
        nome: title.group_name || fallbackGroupName,
        ordem: groups.size,
        titles: [],
      })
    }
    groups.get(id).titles.push({
      ...title,
      preview_url: territorialAssetPublicUrl(supabase, title),
    })
  }
  return [...groups.values()]
}

export default function TerritorialComposerFields({
  formData,
  setFormData,
  catalog,
  errors = {},
}) {
  const [cityQuery, setCityQuery] = useState('')
  const isStory = formData.content_type === 'story'
  const mode = formData.composer_mode
  const editorialTitles = useMemo(
    () => (catalog.visual_titles || []).filter(title =>
      title.tipo === 'editorial' &&
      (isStory || (title.formatos || []).includes(formData.content_type))),
    [catalog.visual_titles, formData.content_type, isStory],
  )
  const editorialTitleGroups = useMemo(
    () => groupTerritorialTitles(editorialTitles, 'Selos editoriais'),
    [editorialTitles],
  )
  const individualTitles = useMemo(
    () => (catalog.visual_titles || []).filter(title =>
      (title.formatos || []).includes(formData.content_type)),
    [catalog.visual_titles, formData.content_type],
  )
  // Individual mode intentionally allows any active selo (editorial or cidade),
  // but a flat list makes the two indistinguishable — group them so it's clear
  // which bucket (and, for editorial, which group — Regiões, Eventos...) each is.
  const individualTitleGroups = useMemo(
    () => groupTerritorialTitles(individualTitles, 'Selos'),
    [individualTitles],
  )
  const visibleCities = useMemo(() => {
    const query = cityQuery.trim().toLocaleLowerCase('pt-BR')
    return (catalog.cities || []).filter(city =>
      !query ||
      city.nome.toLocaleLowerCase('pt-BR').includes(query) ||
      city.region_name.toLocaleLowerCase('pt-BR').includes(query))
  }, [catalog.cities, cityQuery])
  const selectedCity = (catalog.cities || []).find(city => city.id === formData.city_id)
  // Footer slots are sponsor placements only — catalog.manual_assets also carries
  // 'region' entries (used elsewhere for region artwork), which don't belong here.
  const sponsorAssets = useMemo(
    () => (catalog.manual_assets || []).filter(asset => asset.source_type === 'sponsor'),
    [catalog.manual_assets],
  )

  function selectMode(nextMode) {
    setFormData(previous => ({
      ...previous,
      composer_mode: nextMode,
      region_id: null,
      city_id: null,
      visual_title_id: null,
      manual_slots: [],
      idempotency_key: null,
    }))
  }

  function setManualSlot(index, value) {
    const slots = [0, 1, 2].map(slotIndex => {
      const existing = (formData.manual_slots || []).find(item =>
        item.slot === `footer_slot_${slotIndex + 1}`)
      return existing || {
        slot: `footer_slot_${slotIndex + 1}`,
        source_type: '',
        source_id: '',
      }
    })
    const asset = sponsorAssets.find(item =>
      `${item.source_type}:${item.source_id}` === value)
    slots[index] = asset
      ? {
        slot: `footer_slot_${index + 1}`,
        source_type: asset.source_type,
        source_id: asset.source_id,
      }
      : {
        slot: `footer_slot_${index + 1}`,
        source_type: '',
        source_id: '',
      }
    setFormData(previous => ({
      ...previous,
      manual_slots: slots.filter(slot => slot.source_id),
      idempotency_key: null,
    }))
  }

  return (
    <section aria-label="Composição territorial" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Modo da composição <span style={{ color: '#ef4444' }}>*</span></label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
          {MODES.map(item => (
            <button
              key={item.value}
              type="button"
              aria-pressed={mode === item.value}
              onClick={() => selectMode(item.value)}
              style={{
                padding: 12,
                borderRadius: 12,
                border: mode === item.value ? '1px solid #0f172a' : '1px solid #cbd5e1',
                background: mode === item.value ? '#0f172a' : '#fff',
                color: mode === item.value ? '#fff' : '#334155',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <strong style={{ display: 'block', fontSize: 14 }}>{item.label}</strong>
              <span style={{ display: 'block', marginTop: 3, fontSize: 11, opacity: 0.78 }}>{item.description}</span>
            </button>
          ))}
        </div>
        <FieldError>{errors.composer_mode}</FieldError>
      </div>

      {mode === 'editorial' && (
        <>
          <VisualTitleCombobox
            groups={editorialTitleGroups}
            value={formData.visual_title_id || null}
            onChange={visualTitleId => setFormData(previous => ({ ...previous, visual_title_id: visualTitleId, idempotency_key: null }))}
            contentType={isStory ? null : formData.content_type}
            label="Selo editorial"
            emptyLabel="Selecione o selo editorial"
            searchPlaceholder="Buscar por selo ou grupo"
            fieldError={errors.visual_title_id}
          />
          <label style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 13, fontWeight: 700, color: '#334155' }}>
            Região <span style={{ color: '#ef4444' }}>*</span>
            <select
              value={formData.region_id || ''}
              onChange={event => setFormData(previous => ({ ...previous, region_id: event.target.value || null, idempotency_key: null }))}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: errors.region_id ? '1px solid #ef4444' : '1px solid #cbd5e1', background: '#fff' }}
            >
              <option value="">Selecione a região</option>
              {(catalog.regions || []).map(region => <option key={region.id} value={region.id}>{region.nome}</option>)}
            </select>
            <FieldError>{errors.region_id}</FieldError>
          </label>
          <div role="note" style={{ padding: 12, borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontSize: 13 }}>
            Patrocinadores serão definidos automaticamente pela região.
          </div>
        </>
      )}

      {mode === 'cities' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <label style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>Buscar cidade <span style={{ color: '#ef4444' }}>*</span></label>
          <input
            type="search"
            value={cityQuery}
            onChange={event => setCityQuery(event.target.value)}
            placeholder="Digite parte do nome da cidade ou região"
            style={{ width: '100%', padding: 12, borderRadius: 10, border: errors.city_id ? '1px solid #ef4444' : '1px solid #cbd5e1', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'grid', gap: 7, maxHeight: 230, overflowY: 'auto', overflowX: 'hidden' }}>
            {visibleCities.map(city => (
              <button
                key={city.id}
                type="button"
                onClick={() => setFormData(previous => ({ ...previous, city_id: city.id, idempotency_key: null }))}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: 9,
                  borderRadius: 11,
                  border: selectedCity?.id === city.id ? '1px solid #2563eb' : '1px solid #e2e8f0',
                  background: selectedCity?.id === city.id ? '#eff6ff' : '#fff',
                  color: '#0f172a',
                  cursor: 'pointer',
                  textAlign: 'left',
                  boxSizing: 'border-box',
                }}
              >
                <AssetThumbnail asset={city} alt={`Miniatura de ${city.nome}`} />
                <span style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block' }}>{city.nome}</strong>
                  <small style={{ color: '#64748b' }}>{city.region_name}</small>
                </span>
                {selectedCity?.id === city.id && <Check size={18} aria-label="Selecionada" />}
              </button>
            ))}
            {!visibleCities.length && <div role="status" style={{ padding: 14, color: '#64748b', textAlign: 'center' }}>Nenhuma cidade ativa encontrada.</div>}
          </div>
          <FieldError>{errors.city_id}</FieldError>
          <div role="note" style={{ padding: 12, borderRadius: 10, background: '#eff6ff', color: '#1d4ed8', fontSize: 13 }}>
            A região, o selo da cidade e os patrocinadores serão resolvidos no servidor.
          </div>
        </div>
      )}

      {mode === 'individual' && (
        <>
          {!isStory && (
            <>
              <VisualTitleCombobox
                groups={individualTitleGroups}
                value={formData.visual_title_id || null}
                onChange={visualTitleId => setFormData(previous => ({ ...previous, visual_title_id: visualTitleId, idempotency_key: null }))}
                contentType={formData.content_type}
                label="Selo"
                emptyLabel="Selecione qualquer selo ativo"
                searchPlaceholder="Buscar por selo ou grupo"
                fieldError={errors.visual_title_id}
              />
            </>
          )}
          {isStory && (
            <div role="note" style={{ padding: 12, borderRadius: 10, background: '#f8fafc', color: '#475569', fontSize: 13 }}>
              Stories não possui selo visual; apenas os três slots inferiores são enviados ao template.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#334155' }}>
              <Building2 size={17} />
              <strong style={{ fontSize: 13 }}>Slots inferiores</strong>
            </div>
            <small style={{ color: '#64748b' }}>Preencha de 1 a 3 posições. Posições vazias serão omitidas sem reordenação.</small>
            {[0, 1, 2].map(index => {
              const current = (formData.manual_slots || []).find(slot => slot.slot === `footer_slot_${index + 1}`)
              return (
                <label key={index} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span style={{ flex: '0 0 54px', fontSize: 12, fontWeight: 700, color: '#475569' }}>Slot {index + 1}</span>
                  <select
                    aria-label={`Conteúdo do slot inferior ${index + 1}`}
                    value={current ? `${current.source_type}:${current.source_id}` : ''}
                    onChange={event => setManualSlot(index, event.target.value)}
                    style={{ flex: 1, minWidth: 0, padding: 11, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff' }}
                  >
                    <option value="">Deixar vazio</option>
                    {sponsorAssets.map(asset => (
                      <option key={`${asset.source_type}:${asset.source_id}`} value={`${asset.source_type}:${asset.source_id}`}>
                        {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
            <FieldError>{errors.manual_slots}</FieldError>
          </div>
        </>
      )}

      {!mode && (
        <div role="status" style={{ padding: 18, borderRadius: 12, border: '1px dashed #cbd5e1', color: '#64748b', textAlign: 'center' }}>
          <MapPin size={22} style={{ marginBottom: 6 }} />
          <div>Selecione o modo para continuar.</div>
        </div>
      )}
    </section>
  )
}
