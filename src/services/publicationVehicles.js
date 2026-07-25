// Publication vehicle ("Veículo de publicação"): the only daily selector that,
// together with the format (Feed/Reels), addresses one of the six fixed Placid
// templates. The vehicle ALSO fixes how many sponsors the rotation applies —
// the operator never chooses the sponsor count separately.
//
//   TVG + Itumbiara → 1 patrocinador
//   TVG             → 2 patrocinadores
//   Itumbiara       → 2 patrocinadores
//
// The vehicle slug is stored as ap.master_render_configs.template_set, which is
// the same scope already used by the sponsor/template rotation. It is NOT a
// "campanha visual" and never selects layers or UUIDs in the UI.
import { isMasterV1Available } from './masterV1Availability.js'

export const PUBLICATION_VEHICLES = [
  { slug: 'tvg_itumbiara', label: 'TVG + Itumbiara', sponsorCount: 1 },
  { slug: 'tvg', label: 'TVG', sponsorCount: 2 },
  { slug: 'itumbiara', label: 'Itumbiara', sponsorCount: 2 },
]

const BY_SLUG = new Map(PUBLICATION_VEHICLES.map(vehicle => [vehicle.slug, vehicle]))

export function isPublicationVehicle(slug) {
  return BY_SLUG.has(slug)
}

export function sponsorCountForVehicle(slug) {
  return BY_SLUG.get(slug)?.sponsorCount ?? null
}

export function vehicleLabel(slug) {
  return BY_SLUG.get(slug)?.label ?? slug
}

// Vehicles the operator can actually pick for a given format: those whose fixed
// master config exists, is enabled and complete, with the kill switch off.
// `configs` are ap.master_render_configs rows (template_set = vehicle slug).
export function availableVehiclesForFormat(configs, control, contentType) {
  const byVehicle = new Map(
    (configs || [])
      .filter(config => config.content_type === contentType)
      .map(config => [config.template_set, config]),
  )
  return PUBLICATION_VEHICLES.filter(vehicle =>
    isMasterV1Available(byVehicle.get(vehicle.slug), control),
  )
}
