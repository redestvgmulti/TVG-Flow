import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyInstagramSourceRemovalResult,
  createInstagramSource,
  InstagramRadarError,
  listInstagramSources,
  normalizeInstagramProfile,
  removeInstagramSource,
  setInstagramSourceActive,
} from './instagramRadarService.js'

const accepted = [
  '@prefeituradegoiatuba',
  'prefeituradegoiatuba',
  'instagram.com/prefeituradegoiatuba',
  'https://instagram.com/prefeituradegoiatuba',
  ' https://www.instagram.com/PrefeituraDeGoiatuba/?utm=fixture#bio ',
]

test('normalizes every supported Instagram profile form to one canonical profile URL', () => {
  for (const input of accepted) {
    assert.deepEqual(normalizeInstagramProfile(input), {
      username: 'prefeituradegoiatuba',
      url: 'https://www.instagram.com/prefeituradegoiatuba/',
    })
  }
})

test('rejects posts, reels, stories, non-Instagram hosts and extra profile paths', () => {
  for (const input of [
    'https://www.instagram.com/p/example/',
    'https://www.instagram.com/reel/example/',
    'https://www.instagram.com/reels/example/',
    'https://www.instagram.com/stories/example/',
    'https://www.instagram.com/explore/',
    'https://not-instagram.example/prefeitura',
    'https://www.instagram.com/prefeitura/extra',
  ]) {
    assert.throws(() => normalizeInstagramProfile(input), /INSTAGRAM_SOURCE_INVALID/)
  }
})

function client(resolver) {
  const calls = []
  return {
    calls,
    auth: { async getSession() { return { data: { session: { access_token: 'fixture-session' } }, error: null } } },
    functions: {
      async invoke(name, options) {
        calls.push({ name, options })
        return resolver(name, options)
      },
    },
  }
}

test('CRUD uses the dedicated tenant-scoped resource and never places cliente_id in its payload', async () => {
  const supabase = client((_name, options) => ({ data: options.body.action === 'list' ? [] : { id: 'source-1', ativo: true }, error: null }))
  await listInstagramSources(supabase, 'tenant-a')
  await createInstagramSource(supabase, 'tenant-a', '@PrefeituraDeGoiatuba')
  await setInstagramSourceActive(supabase, 'tenant-a', 'source-1', false)
  await removeInstagramSource(supabase, 'tenant-a', 'source-1')

  assert.deepEqual(supabase.calls.map(call => call.options.body.action), ['list', 'insert', 'update', 'delete'])
  for (const call of supabase.calls) {
    assert.equal(call.name, 'ap-config')
    assert.equal(call.options.body.resource, 'instagram_sources')
    assert.equal(call.options.body.cliente_id, 'tenant-a')
    assert.equal(call.options.headers.Authorization, 'Bearer fixture-session')
    assert.equal(Object.hasOwn(call.options.body.payload ?? {}, 'cliente_id'), false)
  }
  assert.deepEqual(supabase.calls[1].options.body.payload, { input: 'https://www.instagram.com/prefeituradegoiatuba/' })
})

test('duplicate response remains deterministic for the UI', async () => {
  const supabase = client(() => ({ data: { error: 'INSTAGRAM_SOURCE_ALREADY_EXISTS' }, error: null }))
  await assert.rejects(
    createInstagramSource(supabase, 'tenant-a', '@prefeituradegoiatuba'),
    error => error instanceof InstagramRadarError && error.code === 'INSTAGRAM_SOURCE_ALREADY_EXISTS',
  )
})

test('a successful removal keeps a historically collected source paused and otherwise removes it', () => {
  const sources = [{ id: 'one', ativo: true }, { id: 'two', ativo: true }]
  assert.deepEqual(
    applyInstagramSourceRemovalResult(sources, 'one', {
      deactivated: true,
      source: { id: 'one', ativo: false },
    }),
    [{ id: 'one', ativo: false }, { id: 'two', ativo: true }],
  )
  assert.deepEqual(
    applyInstagramSourceRemovalResult(sources, 'one', { deactivated: false }),
    [{ id: 'two', ativo: true }],
  )
})
