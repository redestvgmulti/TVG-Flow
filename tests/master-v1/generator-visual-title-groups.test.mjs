import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveVisualTitleForCreation,
  shouldResolveVisualTitleForCreation,
  VisualTitleResolutionError,
} from '../../supabase/functions/ap-employee-generator/visualTitleResolution.ts'

const CLIENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CLIENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const GROUP_ACTIVE = '11111111-1111-4111-8111-111111111111'
const GROUP_INACTIVE = '22222222-2222-4222-8222-222222222222'

const activeGroup = {
  id: GROUP_ACTIVE,
  cliente_id: CLIENT_A,
  nome: 'Cidades',
  slug: 'cidades',
  ativo: true,
}
const inactiveGroup = {
  id: GROUP_INACTIVE,
  cliente_id: CLIENT_A,
  nome: 'Arquivo',
  slug: 'arquivo',
  ativo: false,
}
const baseTitle = {
  id: '33333333-3333-4333-8333-333333333333',
  cliente_id: CLIENT_A,
  group_id: GROUP_ACTIVE,
  nome: 'Goiatuba',
  slug: 'goiatuba',
  asset_bucket: 'ap-images',
  asset_path: 'visual-titles/a/goiatuba/hash.png',
  asset_version: 'v1',
  sha256: 'a'.repeat(64),
  formatos: ['feed', 'reels'],
  ativo: true,
}

function mockSupabase({ titles = [baseTitle], groups = [activeGroup, inactiveGroup] } = {}) {
  const calls = []
  return {
    calls,
    schema(schemaName) {
      assert.equal(schemaName, 'ap')
      return {
        from(table) {
          const rows = table === 'visual_titles' ? titles : groups
          const filters = []
          calls.push({ table, filters })
          return {
            select() { return this },
            eq(column, value) { filters.push([column, value]); return this },
            async maybeSingle() {
              return {
                data: rows.find(row => filters.every(([column, value]) => row[column] === value)) || null,
                error: null,
              }
            },
          }
        },
      }
    },
  }
}

async function expectCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.ok(error instanceof VisualTitleResolutionError)
    assert.equal(error.code, code)
    return true
  })
}

test('visual_title_id absent produces no catalog lookup and no snapshot', async () => {
  const supabase = mockSupabase()
  assert.equal(await resolveVisualTitleForCreation(supabase, {
    visualTitleId: null,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), null)
  assert.equal(supabase.calls.length, 0)
})

test('active title in an active group freezes immutable asset and group metadata', async () => {
  const supabase = mockSupabase()
  const snapshot = await resolveVisualTitleForCreation(supabase, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  })
  assert.deepEqual(snapshot, {
    id: baseTitle.id,
    name: 'Goiatuba',
    slug: 'goiatuba',
    bucket: 'ap-images',
    path: baseTitle.asset_path,
    version: 'v1',
    sha256: 'a'.repeat(64),
    group_id: GROUP_ACTIVE,
    group_name_at_selection: 'Cidades',
    group_slug_at_selection: 'cidades',
  })
  assert.deepEqual(supabase.calls.map(call => call.table), ['visual_titles', 'visual_title_groups'])
  assert.ok(supabase.calls[0].filters.some(([field, value]) => field === 'cliente_id' && value === CLIENT_A))
  assert.ok(supabase.calls[1].filters.some(([field, value]) => field === 'cliente_id' && value === CLIENT_A))
})

test('inactive title is rejected before its group is queried', async () => {
  const supabase = mockSupabase({ titles: [{ ...baseTitle, ativo: false }] })
  await expectCode(resolveVisualTitleForCreation(supabase, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), 'VISUAL_TITLE_INACTIVE')
  assert.deepEqual(supabase.calls.map(call => call.table), ['visual_titles'])
})

test('inactive and missing groups fail closed for new candidates', async () => {
  const inactive = mockSupabase({ titles: [{ ...baseTitle, group_id: GROUP_INACTIVE }] })
  await expectCode(resolveVisualTitleForCreation(inactive, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), 'VISUAL_TITLE_GROUP_INACTIVE')

  const missing = mockSupabase({ groups: [] })
  await expectCode(resolveVisualTitleForCreation(missing, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), 'VISUAL_TITLE_GROUP_NOT_FOUND')
})

test('a title from another client is indistinguishable from a missing title', async () => {
  const supabase = mockSupabase({ titles: [{ ...baseTitle, cliente_id: CLIENT_B }] })
  await expectCode(resolveVisualTitleForCreation(supabase, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), 'VISUAL_TITLE_NOT_FOUND')
})

test('legacy title without group remains valid with null audit metadata', async () => {
  const supabase = mockSupabase({ titles: [{ ...baseTitle, group_id: null }] })
  const snapshot = await resolveVisualTitleForCreation(supabase, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  })
  assert.equal(snapshot.group_id, null)
  assert.equal(snapshot.group_name_at_selection, null)
  assert.equal(snapshot.group_slug_at_selection, null)
  assert.deepEqual(supabase.calls.map(call => call.table), ['visual_titles'])
})

test('Feed, Reels and dual-format eligibility are enforced by the backend', async () => {
  const feedOnly = mockSupabase({ titles: [{ ...baseTitle, formatos: ['feed'] }] })
  assert.equal((await resolveVisualTitleForCreation(feedOnly, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  })).id, baseTitle.id)
  await expectCode(resolveVisualTitleForCreation(feedOnly, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'reels',
  }), 'VISUAL_TITLE_FORMAT_INVALID')

  const reelsOnly = mockSupabase({ titles: [{ ...baseTitle, formatos: ['reels'] }] })
  assert.equal((await resolveVisualTitleForCreation(reelsOnly, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'reels',
  })).id, baseTitle.id)
  await expectCode(resolveVisualTitleForCreation(reelsOnly, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), 'VISUAL_TITLE_FORMAT_INVALID')
})

test('invalid immutable asset metadata is rejected', async () => {
  const supabase = mockSupabase({ titles: [{ ...baseTitle, asset_path: '' }] })
  await expectCode(resolveVisualTitleForCreation(supabase, {
    visualTitleId: baseTitle.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  }), 'VISUAL_TITLE_ASSET_INVALID')
})

test('renaming or moving catalog rows after selection does not mutate the returned snapshot', async () => {
  const title = { ...baseTitle }
  const group = { ...activeGroup }
  const snapshot = await resolveVisualTitleForCreation(mockSupabase({
    titles: [title],
    groups: [group],
  }), {
    visualTitleId: title.id,
    clienteId: CLIENT_A,
    contentType: 'feed',
  })
  group.nome = 'Novo nome'
  title.group_id = GROUP_INACTIVE
  title.asset_path = 'visual-titles/changed.png'
  assert.equal(snapshot.group_name_at_selection, 'Cidades')
  assert.equal(snapshot.group_id, GROUP_ACTIVE)
  assert.equal(snapshot.path, baseTitle.asset_path)
})

test('idempotent retries skip live title and group resolution', () => {
  assert.equal(shouldResolveVisualTitleForCreation(null), true)
  assert.equal(shouldResolveVisualTitleForCreation({ id: 'existing-candidate' }), false)
})
