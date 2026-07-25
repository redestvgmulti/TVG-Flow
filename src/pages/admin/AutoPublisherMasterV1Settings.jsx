import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../services/supabase'
import {
  assetPreviewUrl,
  uploadImmutablePng,
} from '../../services/masterV1Assets'
import VisualTitlesManager from '../../components/editorial/VisualTitlesManager'
import { PUBLICATION_VEHICLES } from '../../services/publicationVehicles'

const EMPTY_SPONSOR = {
  id: null,
  nome: '',
  slug: '',
  ativo: true,
}

const EMPTY_MEMBERSHIP = {
  id: null,
  sponsor_id: '',
  // template_set carries the publication vehicle slug (the rotation scope).
  template_set: PUBLICATION_VEHICLES[0].slug,
  content_type: 'feed',
  ordem: 0,
  ativo: true,
}

const TABS = [
  ['titles', 'Selos da matéria'],
  ['sponsors', 'Patrocinadores'],
]

function slugify(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function PngField({
  label,
  file,
  currentAsset,
  onFileChange,
}) {
  const [dragging, setDragging] = useState(false)

  const preview = useMemo(() => {
    if (file) {
      return URL.createObjectURL(file)
    }

    return assetPreviewUrl(supabase, currentAsset)
  }, [file, currentAsset])

  useEffect(() => {
    return () => {
      if (file && preview) {
        URL.revokeObjectURL(preview)
      }
    }
  }, [file, preview])

  function choose(candidate) {
    if (!candidate) {
      return
    }

    const isPng =
      candidate.type === 'image/png' &&
      candidate.name.toLowerCase().endsWith('.png')

    if (!isPng) {
      onFileChange(null, 'Envie somente arquivos PNG.')
      return
    }

    if (candidate.size > 5 * 1024 * 1024) {
      onFileChange(
        null,
        'O arquivo PNG deve ter no máximo 5 MB.',
      )
      return
    }

    onFileChange(candidate, '')
  }

  return (
    <label style={{ display: 'grid', gap: 8 }}>
      <strong style={{ fontSize: 13 }}>
        {label}
      </strong>

      <span
        onDragOver={event => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => {
          setDragging(false)
        }}
        onDrop={event => {
          event.preventDefault()
          setDragging(false)
          choose(event.dataTransfer.files?.[0])
        }}
        style={{
          border: `2px dashed ${
            dragging ? '#2563eb' : '#cbd5e1'
          }`,
          borderRadius: 10,
          padding: 12,
          background: dragging
            ? '#eff6ff'
            : '#f8fafc',
          cursor: 'pointer',
          minHeight: 78,
          display: 'grid',
          alignItems: 'center',
          justifyItems: 'start',
        }}
      >
        <input
          type="file"
          accept="image/png"
          style={{ display: 'none' }}
          onChange={event => {
            choose(event.target.files?.[0])
          }}
        />

        {preview ? (
          <img
            src={preview}
            alt={label}
            style={{
              maxHeight: 58,
              maxWidth: 180,
              objectFit: 'contain',
            }}
          />
        ) : (
          <span>
            Arraste o PNG aqui ou clique para selecionar
          </span>
        )}

        {file && <small>{file.name}</small>}
      </span>
    </label>
  )
}

export default function AutoPublisherMasterV1Settings({
  clienteId,
  clienteError,
}) {
  const [tab, setTab] = useState('titles')
  const [sponsors, setSponsors] = useState([])
  const [memberships, setMemberships] = useState([])

  const [sponsor, setSponsor] = useState(
    EMPTY_SPONSOR,
  )
  const [sponsorFile, setSponsorFile] = useState(null)

  const [membership, setMembership] = useState(
    EMPTY_MEMBERSHIP,
  )

  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const notice = text => {
    setMessage(text)
  }

  const load = useCallback(async () => {
    if (!clienteId) {
      return
    }

    const [
      sponsorsResult,
      membershipsResult,
    ] = await Promise.all([
      supabase
        .schema('ap')
        .from('render_sponsors')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('nome'),

      supabase
        .schema('ap')
        .from('render_sponsor_scope_memberships')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('template_set')
        .order('content_type')
        .order('ordem'),
    ])

    const failure = [
      sponsorsResult,
      membershipsResult,
    ].find(result => result.error)

    if (failure?.error) {
      throw failure.error
    }

    setSponsors(sponsorsResult.data || [])
    setMemberships(membershipsResult.data || [])
  }, [clienteId])

  useEffect(() => {
    if (!clienteId) {
      return
    }

    load().catch(error => {
      notice(error.message)
    })
  }, [clienteId, load])

  const sponsorById = useMemo(() => {
    return new Map(
      sponsors.map(item => [item.id, item]),
    )
  }, [sponsors])

  const selectedSponsor = sponsors.find(
    item => item.id === membership.sponsor_id,
  )

  async function saveSponsor() {
    setSaving(true)

    try {
      const normalizedSlug = slugify(
        sponsor.slug || sponsor.nome,
      )

      if (!sponsor.nome.trim() || !normalizedSlug) {
        throw new Error(
          'O nome do patrocinador é obrigatório.',
        )
      }

      if (!sponsor.id && !sponsorFile) {
        throw new Error(
          'Envie o PNG do patrocinador.',
        )
      }

      let asset = null

      if (sponsorFile) {
        asset = await uploadImmutablePng({
          supabase,
          file: sponsorFile,
          clienteId,
          kind: 'sponsors',
          slug: normalizedSlug,
        })
      }

      const payload = {
        nome: sponsor.nome.trim(),
        slug: normalizedSlug,
        ativo: Boolean(sponsor.ativo),
      }

      if (asset) {
        Object.assign(payload, {
          asset_bucket: asset.bucket,
          asset_path: asset.path,
          asset_version: asset.version,
          sha256: asset.sha256,
        })
      }

      const result = sponsor.id
        ? await supabase
            .schema('ap')
            .from('render_sponsors')
            .update(payload)
            .eq('id', sponsor.id)
            .eq('cliente_id', clienteId)
        : await supabase
            .schema('ap')
            .from('render_sponsors')
            .insert({
              ...payload,
              cliente_id: clienteId,
            })

      if (result.error) {
        throw result.error
      }

      setSponsor(EMPTY_SPONSOR)
      setSponsorFile(null)

      notice('Patrocinador salvo.')

      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleSponsor(item) {
    setSaving(true)

    try {
      const result = await supabase
        .schema('ap')
        .from('render_sponsors')
        .update({
          ativo: !item.ativo,
        })
        .eq('id', item.id)
        .eq('cliente_id', clienteId)

      if (result.error) {
        throw result.error
      }

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
      if (!membership.sponsor_id) {
        throw new Error(
          'Selecione um patrocinador.',
        )
      }

      const templateSet = String(
        membership.template_set || '',
      )
        .trim()
        .toLowerCase()

      if (
        !PUBLICATION_VEHICLES.some(
          vehicle => vehicle.slug === templateSet,
        )
      ) {
        throw new Error(
          'Selecione um veículo de publicação válido.',
        )
      }

      const payload = {
        cliente_id: clienteId,
        sponsor_id: membership.sponsor_id,
        template_set: templateSet,
        content_type: membership.content_type,
        ordem: Number(membership.ordem) || 0,
        ativo: Boolean(membership.ativo),
      }

      let result

      if (membership.id) {
        result = await supabase
          .schema('ap')
          .from(
            'render_sponsor_scope_memberships',
          )
          .update(payload)
          .eq('id', membership.id)
          .eq('cliente_id', clienteId)
      } else {
        result = await supabase
          .schema('ap')
          .from(
            'render_sponsor_scope_memberships',
          )
          .upsert(payload, {
            onConflict:
              'cliente_id,template_set,content_type,sponsor_id',
          })
      }

      if (result.error) {
        throw result.error
      }

      setMembership(EMPTY_MEMBERSHIP)

      notice(
        membership.id
          ? 'Associação atualizada.'
          : 'Patrocinador adicionado ao veículo.',
      )

      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleMembership(item) {
    setSaving(true)

    try {
      const result = await supabase
        .schema('ap')
        .from(
          'render_sponsor_scope_memberships',
        )
        .update({
          ativo: !item.ativo,
        })
        .eq('id', item.id)
        .eq('cliente_id', clienteId)

      if (result.error) {
        throw result.error
      }

      await load()
    } catch (error) {
      notice(error.message)
    } finally {
      setSaving(false)
    }
  }

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

        {message && (
          <p
            role="status"
            style={{ color: '#475569' }}
          >
            {message}
          </p>
        )}

        {tab === 'titles' && (
          <VisualTitlesManager
            clienteId={clienteId}
            onChanged={load}
          />
        )}

        {tab === 'sponsors' && (
          <>
            <h3>Catálogo de patrocinadores</h3>

            <p style={{ color: '#64748b' }}>
              Cadastre cada patrocinador uma única vez
              e associe-o aos veículos e formatos em
              que poderá aparecer.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit,minmax(190px,1fr))',
                gap: 12,
                alignItems: 'end',
              }}
            >
              <label>
                Nome
                <input
                  className="ap-input"
                  value={sponsor.nome}
                  onChange={event => {
                    const nome = event.target.value

                    setSponsor(previous => ({
                      ...previous,
                      nome,
                      slug:
                        previous.slug ||
                        slugify(nome),
                    }))
                  }}
                />
              </label>

              <label>
                Identificador
                <input
                  className="ap-input"
                  value={sponsor.slug}
                  onChange={event => {
                    setSponsor(previous => ({
                      ...previous,
                      slug: slugify(
                        event.target.value,
                      ),
                    }))
                  }}
                />
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={sponsor.ativo}
                  onChange={event => {
                    setSponsor(previous => ({
                      ...previous,
                      ativo: event.target.checked,
                    }))
                  }}
                />{' '}
                Ativo
              </label>

              <PngField
                label="Logo em PNG"
                file={sponsorFile}
                currentAsset={
                  sponsor.id ? sponsor : null
                }
                onFileChange={(file, error) => {
                  setSponsorFile(file)

                  if (error) {
                    notice(error)
                  }
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                gap: 8,
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="ap-btn-add"
                disabled={saving}
                onClick={saveSponsor}
              >
                {sponsor.id
                  ? 'Salvar alterações'
                  : 'Cadastrar patrocinador'}
              </button>

              {sponsor.id && (
                <button
                  type="button"
                  className="ap-btn-outline"
                  disabled={saving}
                  onClick={() => {
                    setSponsor(EMPTY_SPONSOR)
                    setSponsorFile(null)
                  }}
                >
                  Cancelar edição
                </button>
              )}
            </div>

            <table
              className="ap-table"
              style={{ marginTop: 16 }}
            >
              <thead>
                <tr>
                  <th>Logo</th>
                  <th>Nome</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>

              <tbody>
                {sponsors.length === 0 && (
                  <tr>
                    <td colSpan={4}>
                      Nenhum patrocinador cadastrado.
                    </td>
                  </tr>
                )}

                {sponsors.map(item => (
                  <tr key={item.id}>
                    <td>
                      <img
                        src={assetPreviewUrl(
                          supabase,
                          {
                            bucket:
                              item.asset_bucket,
                            path: item.asset_path,
                          },
                        )}
                        alt={item.nome}
                        style={{
                          height: 30,
                          maxWidth: 90,
                          objectFit: 'contain',
                        }}
                      />
                    </td>

                    <td>{item.nome}</td>

                    <td>
                      {item.ativo
                        ? 'Ativo'
                        : 'Arquivado'}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="ap-btn-sm"
                        disabled={saving}
                        onClick={() => {
                          setSponsor({ ...item })
                          setSponsorFile(null)
                        }}
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        className="ap-btn-sm"
                        disabled={saving}
                        onClick={() => {
                          toggleSponsor(item)
                        }}
                      >
                        {item.ativo
                          ? 'Arquivar'
                          : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ marginTop: 22 }}>
              Veículos e formatos
            </h3>

            <p style={{ color: '#64748b' }}>
              Defina quais patrocinadores participam
              de cada veículo, em Feed ou Reels, e em
              qual ordem entram na rotação.
            </p>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns:
                  'repeat(auto-fit,minmax(160px,1fr))',
                gap: 12,
                alignItems: 'end',
              }}
            >
              <label>
                Patrocinador
                <select
                  className="ap-select"
                  value={membership.sponsor_id}
                  onChange={event => {
                    setMembership(previous => ({
                      ...previous,
                      sponsor_id:
                        event.target.value,
                    }))
                  }}
                >
                  <option value="">
                    Selecione
                  </option>

                  {sponsors
                    .filter(item => item.ativo)
                    .map(item => (
                      <option
                        key={item.id}
                        value={item.id}
                      >
                        {item.nome}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Veículo
                <select
                  className="ap-select"
                  value={
                    membership.template_set
                  }
                  onChange={event => {
                    setMembership(previous => ({
                      ...previous,
                      template_set:
                        event.target.value,
                    }))
                  }}
                >
                  {PUBLICATION_VEHICLES.map(
                    vehicle => (
                      <option
                        key={vehicle.slug}
                        value={vehicle.slug}
                      >
                        {vehicle.label}
                      </option>
                    ),
                  )}
                </select>
              </label>

              <label>
                Formato
                <select
                  className="ap-select"
                  value={
                    membership.content_type
                  }
                  onChange={event => {
                    setMembership(previous => ({
                      ...previous,
                      content_type:
                        event.target.value,
                    }))
                  }}
                >
                  <option value="feed">
                    Feed
                  </option>
                  <option value="reels">
                    Reels
                  </option>
                </select>
              </label>

              <label>
                Ordem
                <input
                  className="ap-input"
                  type="number"
                  min="0"
                  value={membership.ordem}
                  onChange={event => {
                    setMembership(previous => ({
                      ...previous,
                      ordem: event.target.value,
                    }))
                  }}
                />
              </label>

              <label>
                <input
                  type="checkbox"
                  checked={membership.ativo}
                  onChange={event => {
                    setMembership(previous => ({
                      ...previous,
                      ativo: event.target.checked,
                    }))
                  }}
                />{' '}
                Ativo
              </label>

              <button
                type="button"
                className="ap-btn-add"
                disabled={
                  saving || !selectedSponsor
                }
                onClick={saveMembership}
              >
                {membership.id
                  ? 'Salvar associação'
                  : 'Adicionar ao veículo'}
              </button>
            </div>

            <table
              className="ap-table"
              style={{ marginTop: 16 }}
            >
              <thead>
                <tr>
                  <th>Patrocinador</th>
                  <th>Veículo</th>
                  <th>Formato</th>
                  <th>Ordem</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>

              <tbody>
                {memberships.length === 0 && (
                  <tr>
                    <td colSpan={6}>
                      Nenhuma associação cadastrada.
                    </td>
                  </tr>
                )}

                {memberships.map(item => (
                  <tr key={item.id}>
                    <td>
                      {sponsorById.get(
                        item.sponsor_id,
                      )?.nome ||
                        'Patrocinador indisponível'}
                    </td>

                    <td>
                      {PUBLICATION_VEHICLES.find(
                        vehicle =>
                          vehicle.slug ===
                          item.template_set,
                      )?.label || item.template_set}
                    </td>
                    <td>{item.content_type}</td>
                    <td>{item.ordem}</td>

                    <td>
                      {item.ativo
                        ? 'Ativo'
                        : 'Pausado'}
                    </td>

                    <td>
                      <button
                        type="button"
                        className="ap-btn-sm"
                        disabled={saving}
                        onClick={() => {
                          setMembership({ ...item })
                        }}
                      >
                        Editar
                      </button>

                      <button
                        type="button"
                        className="ap-btn-sm"
                        disabled={saving}
                        onClick={() => {
                          toggleMembership(item)
                        }}
                      >
                        {item.ativo
                          ? 'Pausar'
                          : 'Ativar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  )
}