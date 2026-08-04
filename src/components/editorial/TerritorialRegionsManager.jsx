import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building2, Edit3, MapPin, Plus } from 'lucide-react'
import { supabase } from '../../services/supabase'
import { assetPreviewUrl } from '../../services/masterV1Assets'
import { listRenderSponsors } from '../../services/renderSponsors'
import {
  assetFromTerritorialRecord,
  createTerritorialCity,
  createTerritorialRegion,
  listTerritorialCities,
  listTerritorialRegions,
  listTerritorialRegionSponsors,
  setTerritorialCityActive,
  setTerritorialRegionActive,
  setTerritorialRegionSponsor,
  slugifyTerritorial,
  updateTerritorialCity,
  updateTerritorialRegion,
  uploadTerritorialPng,
} from '../../services/territorialCatalog'
import TerritorialPngField from './TerritorialPngField'

function StatusChip({ ativo, activeLabel = 'Ativo', inactiveLabel = 'Inativo' }) {
  return (
    <span className={`ap-chip ${ativo ? 'tone-success' : 'tone-neutral'}`}>
      {ativo ? activeLabel : inactiveLabel}
    </span>
  )
}

function RegionForm({
  value,
  upload,
  processing,
  saving,
  onChange,
  onUpload,
  onProcessingChange,
  onSave,
  onCancel,
}) {
  return (
    <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label={value.id ? 'Editar região' : 'Nova região'}>
      <form
        className="ap-form-card"
        onSubmit={event => {
          event.preventDefault()
          onSave()
        }}
      >
        <h3 className="ap-form-card-title">{value.id ? 'Editar região' : 'Nova região'}</h3>
        <label className="ap-field-label">
          Nome da região
          <input
            className="ap-input"
            required
            placeholder="Ex.: Vale do Paraíba"
            value={value.nome}
            onChange={event => onChange({ ...value, nome: event.target.value })}
          />
        </label>
        <TerritorialPngField
          label="Imagem da região"
          required={!value.id}
          asset={value.id ? { bucket: value.asset_bucket, path: value.asset_path } : null}
          disabled={saving}
          onChange={onUpload}
          onProcessingChange={onProcessingChange}
        />
        {value.id && !upload && (
          <small className="ap-dropzone-sub">
            A imagem atual será mantida. Um novo envio cria outro asset imutável.
          </small>
        )}
        <div className="ap-vt-actions">
          <button className="ap-btn-add" disabled={saving || processing}>
            {saving ? 'Salvando…' : (value.id ? 'Salvar alterações' : 'Cadastrar região')}
          </button>
          <button type="button" className="ap-btn-outline" disabled={saving} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

function CityForm({
  value,
  regions,
  upload,
  processing,
  saving,
  onChange,
  onUpload,
  onProcessingChange,
  onSave,
  onCancel,
}) {
  return (
    <div className="ap-vt-dialog" role="dialog" aria-modal="true" aria-label={value.id ? 'Editar cidade' : 'Nova cidade'}>
      <form
        className="ap-form-card"
        onSubmit={event => {
          event.preventDefault()
          onSave()
        }}
      >
        <h3 className="ap-form-card-title">{value.id ? 'Editar cidade' : 'Nova cidade'}</h3>
        <label className="ap-field-label">
          Nome da cidade
          <input
            className="ap-input"
            required
            placeholder="Ex.: Aparecida"
            value={value.nome}
            onChange={event => onChange({ ...value, nome: event.target.value })}
          />
        </label>
        <label className="ap-field-label">
          Região
          <select
            className="ap-select"
            required
            value={value.region_id}
            onChange={event => onChange({ ...value, region_id: event.target.value })}
          >
            <option value="">Selecione a região</option>
            {regions.map(region => (
              <option key={region.id} value={region.id}>
                {region.nome}{region.ativo ? '' : ' (inativa)'}
              </option>
            ))}
          </select>
          <small className="ap-dropzone-sub">
            Mover a cidade preserva o mesmo selo e altera somente a região.
          </small>
        </label>
        <TerritorialPngField
          label="Imagem da cidade e do selo"
          required={!value.id}
          asset={value.id ? { bucket: value.asset_bucket, path: value.asset_path } : null}
          disabled={saving}
          onChange={onUpload}
          onProcessingChange={onProcessingChange}
        />
        {value.id && !upload && (
          <small className="ap-dropzone-sub">
            A imagem atual será mantida no cadastro e no mesmo selo vinculado.
          </small>
        )}
        <div className="ap-vt-actions">
          <button className="ap-btn-add" disabled={saving || processing}>
            {saving ? 'Salvando…' : (value.id ? 'Salvar alterações' : 'Cadastrar cidade e selo')}
          </button>
          <button type="button" className="ap-btn-outline" disabled={saving} onClick={onCancel}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

export default function TerritorialRegionsManager({ clienteId, onCatalogChanged }) {
  const [regions, setRegions] = useState([])
  const [cities, setCities] = useState([])
  const [links, setLinks] = useState([])
  const [sponsors, setSponsors] = useState([])
  const [selectedRegionId, setSelectedRegionId] = useState(null)
  const [regionForm, setRegionForm] = useState(null)
  const [regionUpload, setRegionUpload] = useState(null)
  const [cityForm, setCityForm] = useState(null)
  const [cityUpload, setCityUpload] = useState(null)
  const [processingImage, setProcessingImage] = useState(false)
  const [sponsorSelection, setSponsorSelection] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    if (!clienteId) {
      setLoading(false)
      setError('Nenhum cliente operacional autorizado foi encontrado.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const [nextRegions, nextCities, nextLinks, nextSponsors] = await Promise.all([
        listTerritorialRegions(supabase, clienteId),
        listTerritorialCities(supabase, clienteId),
        listTerritorialRegionSponsors(supabase, clienteId),
        listRenderSponsors(supabase, clienteId),
      ])
      setRegions(nextRegions)
      setCities(nextCities)
      setLinks(nextLinks)
      setSponsors(nextSponsors)
      setSelectedRegionId(current => (
        current && nextRegions.some(region => region.id === current) ? current : null
      ))
    } catch (loadError) {
      setError(loadError.message || 'Não foi possível carregar o cadastro territorial.')
    } finally {
      setLoading(false)
    }
  }, [clienteId])

  useEffect(() => {
    load()
  }, [load])

  const selectedRegion = regions.find(region => region.id === selectedRegionId) || null
  const selectedCities = useMemo(
    () => cities.filter(city => city.region_id === selectedRegionId),
    [cities, selectedRegionId],
  )
  const sponsorById = useMemo(
    () => new Map(sponsors.map(sponsor => [sponsor.id, sponsor])),
    [sponsors],
  )
  const activeRegionLinks = useMemo(
    () => links.filter(link => link.region_id === selectedRegionId && link.ativo),
    [links, selectedRegionId],
  )
  const associatedSponsorIds = useMemo(
    () => new Set(activeRegionLinks.map(link => link.sponsor_id)),
    [activeRegionLinks],
  )
  const availableSponsors = useMemo(
    () => sponsors.filter(sponsor => !associatedSponsorIds.has(sponsor.id)),
    [sponsors, associatedSponsorIds],
  )

  function clearMessages() {
    setError('')
    setNotice('')
  }

  async function saveRegion() {
    if (saving) return
    clearMessages()
    setSaving(true)
    try {
      const nome = regionForm?.nome?.trim()
      if (!nome) throw new Error('Informe o nome da região.')
      if (!regionForm.id && !regionUpload?.file) throw new Error('Envie a imagem obrigatória da região.')

      let asset = assetFromTerritorialRecord(regionForm)
      let assetMetadata = regionForm.asset_metadata || {}
      if (regionUpload?.file) {
        asset = await uploadTerritorialPng({
          supabase,
          file: regionUpload.file,
          clienteId,
          kind: 'regions',
          slug: slugifyTerritorial(nome),
        })
        assetMetadata = regionUpload.metadata
      }

      if (regionForm.id) {
        await updateTerritorialRegion(supabase, regionForm.id, { nome, asset, assetMetadata })
        setNotice('Região atualizada.')
      } else {
        await createTerritorialRegion(supabase, clienteId, { nome, asset, assetMetadata })
        setNotice('Região cadastrada. A nova área permanece isolada do fluxo de geração.')
      }
      setRegionForm(null)
      setRegionUpload(null)
      setProcessingImage(false)
      await load()
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível salvar a região.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleRegion(region) {
    if (saving) return
    clearMessages()
    setSaving(true)
    try {
      await setTerritorialRegionActive(supabase, region.id, !region.ativo)
      setNotice(region.ativo
        ? 'Região desativada. Os status das cidades e dos selos não foram alterados.'
        : 'Região reativada. Os status próprios das cidades e dos selos foram preservados.')
      await load()
    } catch (toggleError) {
      setError(toggleError.message || 'Não foi possível atualizar a região.')
    } finally {
      setSaving(false)
    }
  }

  async function saveCity() {
    if (saving) return
    clearMessages()
    setSaving(true)
    try {
      const nome = cityForm?.nome?.trim()
      if (!nome) throw new Error('Informe o nome da cidade.')
      if (!cityForm.region_id) throw new Error('Escolha a região da cidade.')
      if (!cityForm.id && !cityUpload?.file) throw new Error('Envie a imagem obrigatória da cidade.')

      let asset = assetFromTerritorialRecord(cityForm)
      let assetMetadata = cityForm.asset_metadata || {}
      if (cityUpload?.file) {
        asset = await uploadTerritorialPng({
          supabase,
          file: cityUpload.file,
          clienteId,
          kind: 'cities',
          slug: slugifyTerritorial(nome),
        })
        assetMetadata = cityUpload.metadata
      }

      if (cityForm.id) {
        await updateTerritorialCity(supabase, cityForm.id, cityForm.region_id, {
          nome,
          asset,
          assetMetadata,
        })
        setNotice('Cidade e o mesmo selo vinculado foram atualizados atomicamente.')
      } else {
        await createTerritorialCity(supabase, cityForm.region_id, {
          nome,
          asset,
          assetMetadata,
        })
        setNotice('Cidade e selo cadastrados atomicamente.')
      }
      setCityForm(null)
      setCityUpload(null)
      setProcessingImage(false)
      await load()
      onCatalogChanged?.()
    } catch (saveError) {
      setError(saveError.message || 'Não foi possível salvar a cidade.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCity(city) {
    if (saving) return
    clearMessages()
    setSaving(true)
    try {
      await setTerritorialCityActive(supabase, city.id, !city.ativo)
      setNotice(city.ativo
        ? 'Cidade e selo vinculado foram desativados atomicamente.'
        : 'Cidade e selo vinculado foram reativados atomicamente.')
      await load()
      onCatalogChanged?.()
    } catch (toggleError) {
      setError(toggleError.message || 'Não foi possível atualizar a cidade.')
    } finally {
      setSaving(false)
    }
  }

  async function addSponsor() {
    if (saving || !sponsorSelection || !selectedRegion) return
    clearMessages()
    setSaving(true)
    try {
      await setTerritorialRegionSponsor(
        supabase,
        selectedRegion.id,
        sponsorSelection,
        true,
      )
      setSponsorSelection('')
      setNotice('Patrocinador associado somente a esta região. A rotação atual não foi alterada.')
      await load()
    } catch (associationError) {
      setError(associationError.message || 'Não foi possível associar o patrocinador.')
    } finally {
      setSaving(false)
    }
  }

  async function removeSponsor(sponsorId) {
    if (saving || !selectedRegion) return
    clearMessages()
    setSaving(true)
    try {
      await setTerritorialRegionSponsor(supabase, selectedRegion.id, sponsorId, false)
      setNotice('Associação removida somente desta região.')
      await load()
    } catch (associationError) {
      setError(associationError.message || 'Não foi possível remover a associação.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p role="status">Carregando regiões e cidades…</p>

  if (selectedRegion) {
    return (
      <section className="ap-form-section">
        <div className="ap-vt-header">
          <div>
            <button type="button" className="ap-btn-sm" onClick={() => setSelectedRegionId(null)}>
              <ArrowLeft size={15} /> Voltar às regiões
            </button>
            <h2 className="ap-form-card-title" style={{ marginTop: 12 }}>{selectedRegion.nome}</h2>
            <p className="ap-config-intro">
              Cidades e patrocinadores administrativos desta região. Nenhuma associação participa da rotação atual.
            </p>
          </div>
          <div className="ap-vt-actions">
            <StatusChip ativo={selectedRegion.ativo} />
            <button
              type="button"
              className="ap-btn-sm"
              onClick={() => {
                setRegionForm({ ...selectedRegion })
                setRegionUpload(null)
                setProcessingImage(false)
              }}
            >
              <Edit3 size={15} /> Editar região
            </button>
          </div>
        </div>

        <div className="ap-vt-header" style={{ marginTop: 24 }}>
          <div>
            <h3 className="ap-form-card-title">Cidades</h3>
            <p className="ap-config-intro">Cada cidade mantém exatamente um selo vinculado.</p>
          </div>
          <button
            type="button"
            className="ap-btn-add"
            onClick={() => {
              setCityForm({ nome: '', region_id: selectedRegion.id })
              setCityUpload(null)
              setProcessingImage(false)
            }}
          >
            <Plus size={16} /> Nova cidade
          </button>
        </div>

        {!selectedCities.length ? (
          <div className="ap-vt-empty">
            <p>Nenhuma cidade cadastrada nesta região.</p>
            <small>O primeiro cadastro criará a cidade e o selo na mesma transação.</small>
          </div>
        ) : (
          <div className="ap-table-container">
            <table className="ap-table">
              <thead>
                <tr>
                  <th>Imagem</th>
                  <th>Cidade</th>
                  <th>Selo vinculado</th>
                  <th>Status</th>
                  <th>Opções</th>
                </tr>
              </thead>
              <tbody>
                {selectedCities.map(city => (
                  <tr key={city.id}>
                    <td>
                      <img
                        className="ap-vt-thumb"
                        src={assetPreviewUrl(supabase, {
                          bucket: city.asset_bucket,
                          path: city.asset_path,
                        })}
                        alt={`Imagem de ${city.nome}`}
                      />
                    </td>
                    <td>{city.nome}</td>
                    <td><code>{city.visual_title_id.slice(0, 8)}…</code></td>
                    <td><StatusChip ativo={city.ativo} /></td>
                    <td>
                      <div className="ap-vt-actions">
                        <button
                          type="button"
                          className="ap-btn-sm"
                          onClick={() => {
                            setCityForm({ ...city })
                            setCityUpload(null)
                            setProcessingImage(false)
                          }}
                        >
                          Editar / mover
                        </button>
                        <button type="button" className="ap-btn-sm" disabled={saving} onClick={() => toggleCity(city)}>
                          {city.ativo ? 'Desativar' : 'Reativar'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="ap-vt-header" style={{ marginTop: 28 }}>
          <div>
            <h3 className="ap-form-card-title">Patrocinadores da região</h3>
            <p className="ap-config-intro">
              Associe somente patrocinadores já existentes. Esta lista ainda não muda Feed, Reels ou Story.
            </p>
          </div>
        </div>

        <div className="ap-vt-actions" style={{ marginBottom: 16 }}>
          <select
            className="ap-select"
            aria-label="Patrocinador existente"
            value={sponsorSelection}
            onChange={event => setSponsorSelection(event.target.value)}
          >
            <option value="">Selecione um patrocinador existente</option>
            {availableSponsors.map(sponsor => (
              <option key={sponsor.id} value={sponsor.id}>
                {sponsor.nome}{sponsor.ativo ? '' : ' (inativo)'}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="ap-btn-add"
            disabled={saving || !sponsorSelection}
            onClick={addSponsor}
          >
            Associar
          </button>
        </div>

        {!activeRegionLinks.length ? (
          <div className="ap-vt-empty">
            <p>Nenhum patrocinador associado.</p>
          </div>
        ) : (
          <div className="ap-table-container">
            <table className="ap-table">
              <thead><tr><th>Patrocinador</th><th>Cadastro geral</th><th>Opções</th></tr></thead>
              <tbody>
                {activeRegionLinks.map(link => {
                  const sponsor = sponsorById.get(link.sponsor_id)
                  return (
                    <tr key={link.id}>
                      <td>{sponsor?.nome || 'Patrocinador indisponível'}</td>
                      <td>
                        <StatusChip
                          ativo={sponsor?.ativo === true}
                          activeLabel="Ativo"
                          inactiveLabel="Inativo no cadastro geral"
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="ap-btn-sm"
                          disabled={saving}
                          onClick={() => removeSponsor(link.sponsor_id)}
                        >
                          Remover desta região
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {regionForm && (
          <RegionForm
            value={regionForm}
            upload={regionUpload}
            processing={processingImage}
            saving={saving}
            onChange={setRegionForm}
            onUpload={setRegionUpload}
            onProcessingChange={setProcessingImage}
            onSave={saveRegion}
            onCancel={() => {
              setRegionForm(null)
              setRegionUpload(null)
              setProcessingImage(false)
            }}
          />
        )}
        {cityForm && (
          <CityForm
            value={cityForm}
            regions={regions}
            upload={cityUpload}
            processing={processingImage}
            saving={saving}
            onChange={setCityForm}
            onUpload={setCityUpload}
            onProcessingChange={setProcessingImage}
            onSave={saveCity}
            onCancel={() => {
              setCityForm(null)
              setCityUpload(null)
              setProcessingImage(false)
            }}
          />
        )}
        {error && <p role="alert" className="ap-vt-alert">{error}</p>}
        {notice && <p role="status" className="ap-config-intro">{notice}</p>}
      </section>
    )
  }

  return (
    <section className="ap-form-section">
      <div className="ap-vt-header">
        <div>
          <h2 className="ap-form-card-title">Regiões</h2>
          <p className="ap-config-intro">
            Estrutura administrativa tenantizada. A área não altera o modal de Nova Matéria nem a geração.
          </p>
        </div>
        <button
          type="button"
          className="ap-btn-add"
          onClick={() => {
            setRegionForm({ nome: '' })
            setRegionUpload(null)
            setProcessingImage(false)
          }}
        >
          <Plus size={16} /> Nova região
        </button>
      </div>

      {!regions.length ? (
        <div className="ap-vt-empty">
          <MapPin size={24} aria-hidden="true" />
          <p>Nenhuma região cadastrada.</p>
          <small>O AutoPublisher continua operando como hoje enquanto não houver regiões.</small>
        </div>
      ) : (
        <div className="ap-vt-grid">
          {regions.map(region => {
            const regionCities = cities.filter(city => city.region_id === region.id)
            const regionSponsors = links.filter(link => link.region_id === region.id && link.ativo)
            return (
              <article key={region.id} className="ap-vt-card">
                <div className="ap-vt-card-head">
                  <div>
                    <img
                      className="ap-vt-thumb"
                      src={assetPreviewUrl(supabase, {
                        bucket: region.asset_bucket,
                        path: region.asset_path,
                      })}
                      alt={`Imagem da região ${region.nome}`}
                    />
                    <h3 className="ap-vt-card-title">{region.nome}</h3>
                  </div>
                  <StatusChip ativo={region.ativo} />
                </div>
                <small className="ap-vt-card-meta">
                  <Building2 size={14} aria-hidden="true" /> {regionCities.length} cidade{regionCities.length === 1 ? '' : 's'}
                  {' · '}{regionSponsors.length} patrocinador{regionSponsors.length === 1 ? '' : 'es'}
                </small>
                <div className="ap-vt-actions">
                  <button type="button" className="ap-btn-add" onClick={() => setSelectedRegionId(region.id)}>
                    Abrir região
                  </button>
                  <button
                    type="button"
                    className="ap-btn-sm"
                    onClick={() => {
                      setRegionForm({ ...region })
                      setRegionUpload(null)
                      setProcessingImage(false)
                    }}
                  >
                    Editar
                  </button>
                  <button type="button" className="ap-btn-sm" disabled={saving} onClick={() => toggleRegion(region)}>
                    {region.ativo ? 'Desativar' : 'Reativar'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {regionForm && (
        <RegionForm
          value={regionForm}
          upload={regionUpload}
          processing={processingImage}
          saving={saving}
          onChange={setRegionForm}
          onUpload={setRegionUpload}
          onProcessingChange={setProcessingImage}
          onSave={saveRegion}
          onCancel={() => {
            setRegionForm(null)
            setRegionUpload(null)
            setProcessingImage(false)
          }}
        />
      )}
      {error && <p role="alert" className="ap-vt-alert">{error}</p>}
      {notice && <p role="status" className="ap-config-intro">{notice}</p>}
    </section>
  )
}
