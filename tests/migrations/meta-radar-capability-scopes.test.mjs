import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../supabase/migrations/20260927231500_align_meta_radar_capability_scopes.sql',
  import.meta.url,
)

const radarScopes = "ARRAY['pages_show_list','pages_read_engagement','instagram_basic','business_management']::text[]"
const oldRadarScopes = "ARRAY['pages_show_list','pages_read_engagement','instagram_basic']::text[]"
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function functionBlock(migration, name) {
  const match = migration.match(
    new RegExp(`CREATE OR REPLACE FUNCTION ${escapeRegExp(name)}\\([\\s\\S]*?END; \\$\\$;`),
  )
  assert.ok(match, `expected ${name} definition`)
  return match[0]
}

test('persisted Meta Radar capability requires all four read scopes', async () => {
  const migration = await readFile(migrationUrl, 'utf8')
  const complete = functionBlock(migration, 'ap.complete_meta_oauth_connection')
  const select = functionBlock(migration, 'ap.select_meta_oauth_candidate')

  assert.match(complete, /p_user_id uuid, p_cliente_id uuid, p_graph_api_version text,[\s\S]*?p_page jsonb\n\)/)
  assert.match(select, /p_candidate_id uuid,[\s\S]*?p_actor_user_id uuid,[\s\S]*?p_cliente_id uuid\n\)/)
  for (const definition of [complete, select]) {
    assert.match(definition, new RegExp(escapeRegExp(radarScopes)))
    assert.doesNotMatch(definition, new RegExp(escapeRegExp(oldRadarScopes)))
    assert.match(definition, /LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS \$\$/)
  }
})
