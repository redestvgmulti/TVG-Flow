import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createTerritorialCity,
  createTerritorialRegion,
  isTerritorialAdminEnabled,
  listTerritorialCities,
  listTerritorialRegions,
  listTerritorialRegionSponsors,
  setTerritorialCityActive,
  setTerritorialRegionActive,
  setTerritorialRegionSponsor,
  setVisualTitleType,
  slugifyTerritorial,
  updateTerritorialCity,
  updateTerritorialRegion,
} from '../../src/services/territorialCatalog.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8')

function rpcClient() {
  const calls = []
  return {
    calls,
    schema(schema) {
      assert.equal(schema, 'ap')
      return {
        async rpc(name, params) {
          calls.push({ name, params })
          return { data: { ok: true }, error: null }
        },
      }
    },
  }
}

function listClient(rowsByTable) {
  const calls = []
  const makeQuery = table => {
    const query = {
      select(columns) {
        calls.push({ table, op: 'select', columns })
        return query
      },
      eq(column, value) {
        calls.push({ table, op: 'eq', column, value })
        return query
      },
      order(column) {
        calls.push({ table, op: 'order', column })
        return Promise.resolve({ data: rowsByTable[table] || [], error: null })
      },
      maybeSingle() {
        return Promise.resolve({
          data: rowsByTable[table]?.[0] || null,
          error: null,
        })
      },
    }
    return query
  }
  return {
    calls,
    schema(schema) {
      assert.equal(schema, 'ap')
      return {
        from(table) {
          return makeQuery(table)
        },
      }
    },
  }
}

const asset = {
  bucket: 'ap-images',
  path: 'regions/a/slug/hash.png',
  version: '123456789012',
  sha256: '1'.repeat(64),
}

test('territorial service scopes every list by cliente_id', async () => {
  const supabase = listClient({
    territorial_regions: [{ id: 'region' }],
    territorial_cities: [{ id: 'city' }],
    territorial_region_sponsors: [{ id: 'link' }],
  })

  assert.equal((await listTerritorialRegions(supabase, 'tenant-a')).length, 1)
  assert.equal((await listTerritorialCities(supabase, 'tenant-a')).length, 1)
  assert.equal((await listTerritorialRegionSponsors(supabase, 'tenant-a')).length, 1)

  const tenantFilters = supabase.calls.filter(call => call.op === 'eq')
  assert.equal(tenantFilters.length, 3)
  assert.ok(tenantFilters.every(call => (
    call.column === 'cliente_id' && call.value === 'tenant-a'
  )))
})

test('missing feature-flag column safely keeps the additive UI disabled', async () => {
  const supabase = {
    schema() {
      return {
        from() {
          const query = {
            select() { return query },
            eq() { return query },
            async maybeSingle() {
              return {
                data: null,
                error: {
                  code: '42703',
                  message: 'column territorial_admin_enabled does not exist',
                },
              }
            },
          }
          return query
        },
      }
    },
  }
  assert.equal(await isTerritorialAdminEnabled(supabase, 'tenant-a'), false)
})

test('frontend uses only transactional RPCs for territorial mutations', async () => {
  const supabase = rpcClient()

  await createTerritorialRegion(supabase, 'tenant-a', {
    nome: 'Vale',
    asset,
    assetMetadata: {},
  })
  await updateTerritorialRegion(supabase, 'region-a', {
    nome: 'Vale Norte',
    asset,
    assetMetadata: {},
  })
  await setTerritorialRegionActive(supabase, 'region-a', false)
  await createTerritorialCity(supabase, 'region-a', {
    nome: 'Cidade A',
    asset,
    assetMetadata: {},
  })
  await updateTerritorialCity(supabase, 'city-a', 'region-b', {
    nome: 'Cidade B',
    asset,
    assetMetadata: {},
  })
  await setTerritorialCityActive(supabase, 'city-a', false)
  await setTerritorialRegionSponsor(supabase, 'region-a', 'sponsor-a', true)
  await setVisualTitleType(supabase, 'title-a', 'cidade')

  assert.deepEqual(supabase.calls.map(call => call.name), [
    'create_territorial_region',
    'update_territorial_region',
    'set_territorial_region_active',
    'create_territorial_city',
    'update_territorial_city',
    'set_territorial_city_active',
    'set_territorial_region_sponsor',
    'set_visual_title_type',
  ])
  assert.equal(supabase.calls[0].params.p_cliente_id, 'tenant-a')
  assert.equal(supabase.calls[3].params.p_region_id, 'region-a')
  assert.equal(supabase.calls[4].params.p_region_id, 'region-b')
  assert.equal(supabase.calls[6].params.p_sponsor_id, 'sponsor-a')
})

test('territorial UI covers CRUD, mandatory images, movement and inactive sponsors', () => {
  const manager = read('src/components/editorial/TerritorialRegionsManager.jsx')
  const settings = read('src/pages/admin/AutoPublisherMasterV1Settings.jsx')
  const titles = read('src/components/editorial/VisualTitlesManager.jsx')

  assert.match(settings, /territorialEnabled &&/)
  assert.match(settings, /Grupos de selos/)
  assert.match(settings, /Regiões/)
  assert.match(manager, /Nova região/)
  assert.match(manager, /Envie a imagem obrigatória da região/)
  assert.match(manager, /Nova cidade/)
  assert.match(manager, /Envie a imagem obrigatória da cidade/)
  assert.match(manager, /Editar \/ mover/)
  assert.match(manager, /setTerritorialRegionActive/)
  assert.match(manager, /setTerritorialCityActive/)
  assert.match(manager, /setTerritorialRegionSponsor/)
  assert.match(manager, /Inativo no cadastro geral/)
  assert.match(manager, /Remover desta região/)
  assert.match(manager, /if \(saving\) return/)
  assert.match(manager, /disabled=\{saving \|\| processing\}/)
  assert.match(titles, /allowTypeReview/)
  assert.match(titles, /setVisualTitleType/)
  assert.match(titles, /visualTitleTypeWithFallback/)

  // Region details may select existing sponsors, never register a new one.
  assert.doesNotMatch(manager, /createRenderSponsor|Novo patrocinador/)
})

test('territorial upload path is immutable, tenant-scoped and normalized', () => {
  const service = read('src/services/territorialCatalog.js')
  const storageMigration = read(
    'supabase/migrations/20260804113000_autopublisher_territorial_rls_storage.sql',
  )

  assert.equal(slugifyTerritorial('  São José  '), 'sao-jose')
  assert.match(service, /`\$\{kind\}\/\$\{clienteId\}\/\$\{safeSlug\}\/\$\{hash\}\.png`/)
  assert.match(service, /upsert: false|uploadImmutablePng/)
  assert.match(storageMigration, /ap_images_authenticated_insert_regions/)
  assert.match(storageMigration, /ap_images_authenticated_insert_cities/)
  assert.match(storageMigration, /get_user_cliente_ids/)
  assert.doesNotMatch(storageMigration, /FOR UPDATE[\s\S]*regions|FOR DELETE[\s\S]*cities/)
})

test('migrations remain additive and outside render/publication contracts', () => {
  const files = [
    'supabase/migrations/20260804110000_autopublisher_territorial_schema.sql',
    'supabase/migrations/20260804111000_autopublisher_visual_title_type.sql',
    'supabase/migrations/20260804112000_autopublisher_region_sponsors.sql',
    'supabase/migrations/20260804113000_autopublisher_territorial_rls_storage.sql',
    'supabase/migrations/20260804114000_autopublisher_territorial_rpcs.sql',
  ]
  const sql = files.map(read).join('\n')

  assert.match(sql, /territorial_admin_enabled boolean\s+NOT NULL DEFAULT false/i)
  assert.match(sql, /tipo text/)
  assert.match(sql, /VISUAL_TITLE_TYPE_BACKFILL_INCOMPLETE/)
  assert.match(sql, /CHECK \(tipo IN \('editorial', 'cidade'\)\)/)
  assert.match(sql, /SECURITY DEFINER/g)
  assert.match(sql, /SET search_path = pg_catalog/g)
  assert.doesNotMatch(sql, /USING\s*\(\s*true\s*\)/i)
  assert.doesNotMatch(sql, /TO\s+anon/i)
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|ON DELETE CASCADE/i)
  assert.doesNotMatch(sql, /UPDATE\s+ap\.candidate_news|INSERT INTO\s+ap\.candidate_news/i)
  assert.doesNotMatch(sql, /UPDATE\s+ap\.render_sponsor_rotation_state/i)
  assert.doesNotMatch(sql, /UPDATE\s+ap\.master_render_configs/i)
  assert.doesNotMatch(sql, /placid_template_uuid|instagram|queued_for_posting|pending_review/i)
})

test('new UI does not import or mutate the current article/render path', () => {
  const manager = read('src/components/editorial/TerritorialRegionsManager.jsx')
  const service = read('src/services/territorialCatalog.js')
  const combined = `${manager}\n${service}`

  assert.doesNotMatch(combined, /ArticleForm|ap-employee-generator|ap-render-engine/)
  assert.doesNotMatch(combined, /candidate_news|render_snapshot|placid/)
  assert.doesNotMatch(combined, /render_sponsor_scope_memberships|rotation_state/)
  assert.doesNotMatch(combined, /content_type|visual_model|master_template_uuid/)
})

function featureFlagClient(valuesByTenant) {
  let selectedTenant = null
  return {
    schema(schema) {
      assert.equal(schema, 'ap')
      return {
        from(table) {
          assert.equal(table, 'system_config')
          const query = {
            select(columns) {
              assert.equal(columns, 'territorial_admin_enabled')
              return query
            },
            eq(column, value) {
              assert.equal(column, 'cliente_id')
              selectedTenant = value
              return query
            },
            async maybeSingle() {
              if (!Object.prototype.hasOwnProperty.call(valuesByTenant, selectedTenant)) {
                return { data: null, error: null }
              }
              return {
                data: {
                  territorial_admin_enabled: valuesByTenant[selectedTenant],
                },
                error: null,
              }
            },
          }
          return query
        },
      }
    },
  }
}

test('flag disabled keeps the legacy group surface and hides Regions', async () => {
  const supabase = featureFlagClient({ 'tenant-off': false })
  const settings = read('src/pages/admin/AutoPublisherMasterV1Settings.jsx')

  assert.equal(await isTerritorialAdminEnabled(supabase, 'tenant-off'), false)
  assert.match(settings, /activeTitleSection = territorialEnabled \? titleSection : 'groups'/)
  assert.match(settings, /\{territorialEnabled && \(\s*<button/)
  assert.match(settings, /<VisualTitlesManager/)
  assert.match(settings, /Grupos de selos/)
})

test('flag enabled exposes Regions for only the selected tenant', async () => {
  const supabase = featureFlagClient({
    'tenant-a': true,
    'tenant-b': false,
  })

  assert.equal(await isTerritorialAdminEnabled(supabase, 'tenant-a'), true)
  assert.equal(await isTerritorialAdminEnabled(supabase, 'tenant-b'), false)
})

test('switching sections preserves the legacy group manager and performs no write', () => {
  const settings = read('src/pages/admin/AutoPublisherMasterV1Settings.jsx')

  assert.match(settings, /onClick=\{\(\) => setTitleSection\('groups'\)\}/)
  assert.match(settings, /onClick=\{\(\) => setTitleSection\('regions'\)\}/)
  assert.match(
    settings,
    /\{activeTitleSection === 'groups' && \(\s*<VisualTitlesManager/,
  )
  assert.match(
    settings,
    /\{territorialEnabled && activeTitleSection === 'regions' && \(\s*<TerritorialRegionsManager/,
  )
  assert.doesNotMatch(
    settings,
    /createTerritorial|updateTerritorial|setTerritorialRegionActive/,
  )
})
