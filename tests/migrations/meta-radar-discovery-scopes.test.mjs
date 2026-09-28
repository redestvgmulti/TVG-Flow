import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260928170000_align_meta_radar_discovery_scopes.sql',
  import.meta.url,
)

const radarScopes = "ARRAY['pages_show_list','pages_read_engagement','instagram_basic','business_management','instagram_manage_insights','ads_read']::text[]"
const priorRadarScopes = "ARRAY['pages_show_list','pages_read_engagement','instagram_basic','business_management']::text[]"
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function functionBlock(migration, name) {
  const match = migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION ${escapeRegExp(name)}\\([\\s\\S]*?END; \\$\\$;`),
  )
  assert.ok(match, `expected ${name} definition`)
  return match[0]
}

function reconciliationBlock(migration) {
  const match = migration.match(
    /UPDATE ap\.instagram_connections[\s\S]*?WHERE provider = 'meta'\s+AND status = 'connected';/,
  )
  assert.ok(match, 'expected connected Meta connection reconciliation')
  return match[0]
}

test('persisted Meta Radar discovery capability requires all six read scopes', async () => {
  const migration = (await readFile(migrationUrl, 'utf8')).replace(/\r\n/g, '\n')
  const complete = functionBlock(migration, 'ap.complete_meta_oauth_connection')
  const select = functionBlock(migration, 'ap.select_meta_oauth_candidate')

  assert.match(complete, /p_user_id uuid, p_cliente_id uuid, p_graph_api_version text,[\s\S]*?p_page jsonb\n\)/)
  assert.match(select, /p_candidate_id uuid,[\s\S]*?p_actor_user_id uuid,[\s\S]*?p_cliente_id uuid\n\)/)
  for (const definition of [complete, select]) {
    assert.match(definition, new RegExp(escapeRegExp(radarScopes)))
    assert.doesNotMatch(definition, new RegExp(escapeRegExp(priorRadarScopes)))
    assert.match(definition, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$\$/)
  }

  const reconciliation = reconciliationBlock(migration)
  assert.match(reconciliation, /SET capabilities = jsonb_set\(/)
  assert.match(reconciliation, /'\{radar_read\}'/)
  assert.match(reconciliation, /COALESCE\(granted_scopes, ARRAY\[\]::text\[\]\) @> ARRAY\[[\s\S]*?\]::text\[\]/)
  for (const scope of ['pages_show_list', 'pages_read_engagement', 'instagram_basic', 'business_management', 'instagram_manage_insights', 'ads_read']) {
    assert.match(reconciliation, new RegExp(`'${scope}'`))
  }
  assert.match(reconciliation, /WHERE provider = 'meta'\s+AND status = 'connected';/)
  for (const column of ['granted_scopes', 'token_secret_ref', 'revocation_secret_ref', 'status']) {
    assert.doesNotMatch(reconciliation, new RegExp(`(?:SET|,)\\s*${column}\\s*=`))
  }
})
