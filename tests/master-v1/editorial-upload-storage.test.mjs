import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { EditorialArticleError, uploadEditorialSourceImage } from '../../src/services/editorialArticlesService.js'

const root = new URL('../../', import.meta.url)
const source = path => readFile(new URL(path, root), 'utf8')

test('editorial image upload uses a backend-resolved tenant and authenticated author path', async () => {
  const uploads = []
  const supabase = {
    rpc: async name => {
      assert.equal(name, 'require_single_operational_cliente_id')
      return { data: 'cd287e6e-f273-4d0f-a72d-2a8c391e40e9', error: null }
    },
    auth: {
      getUser: async () => ({ data: { user: { id: '9da6a905-fe94-4c88-912a-e1bcd7a6f6f7' } }, error: null }),
    },
    storage: {
      from: bucket => {
        assert.equal(bucket, 'ap-images')
        return {
          upload: async (path, file, options) => {
            uploads.push({ path, file, options })
            return { error: null }
          },
          getPublicUrl: path => ({ data: { publicUrl: `https://storage.example/${path}` } }),
        }
      },
    },
  }
  const file = { name: 'qualquer-nome.png', type: 'image/png' }

  const publicUrl = await uploadEditorialSourceImage(supabase, { file, folder: 'editorial_uploads' })

  assert.equal(uploads.length, 1)
  assert.match(uploads[0].path, /^editorial_uploads\/cd287e6e-f273-4d0f-a72d-2a8c391e40e9\/9da6a905-fe94-4c88-912a-e1bcd7a6f6f7\/[0-9a-f-]{36}[.]png$/)
  assert.deepEqual(uploads[0].options, { contentType: 'image/png', upsert: false })
  assert.equal(publicUrl, `https://storage.example/${uploads[0].path}`)
})

test('unsupported image types fail before tenant resolution or upload', async () => {
  let called = false
  const supabase = { rpc: async () => { called = true } }

  await assert.rejects(
    uploadEditorialSourceImage(supabase, {
      file: { name: 'imagem.gif', type: 'image/gif' },
      folder: 'editorial_uploads',
    }),
    error => error instanceof EditorialArticleError && error.code === 'IMAGE_TYPE_UNSUPPORTED',
  )
  assert.equal(called, false)
})

test('editorial upload policy is insert-only, tenant-aware and author-bound', async () => {
  const migration = await source('supabase/migrations/20260921150500_editorial_upload_storage_policy.sql')

  assert.match(migration, /FOR INSERT\s+TO authenticated/)
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = 'editorial_uploads'/)
  assert.match(migration, /SELECT ap\.get_user_cliente_ids\(\)::text/)
  assert.match(migration, /\(storage\.foldername\(name\)\)\[3\] = auth\.uid\(\)::text/)
  assert.match(migration, /editorial_uploads\/\[0-9a-fA-F-\]\{36\}/)
  assert.doesNotMatch(migration, /FOR UPDATE|FOR DELETE|WITH CHECK \(true\)/)
})

test('staff editorial uploads use the operational client scope without opening cross-client or cross-user paths', async () => {
  const migration = await source('supabase/migrations/20260923170500_authorize_operational_editorial_uploads.sql')

  assert.match(migration, /FOR INSERT\s+TO authenticated/)
  assert.match(migration, /bucket_id = 'ap-images'/)
  assert.match(migration, /\(storage\.foldername\(name\)\)\[1\] = 'editorial_uploads'/)
  assert.match(migration, /SELECT ap\.get_operational_cliente_ids\(\)::text/)
  assert.match(migration, /\(storage\.foldername\(name\)\)\[3\] = auth\.uid\(\)::text/)
  assert.match(migration, /editorial_uploads\/\[0-9a-fA-F-\]\{36\}/)
  assert.doesNotMatch(migration, /FOR UPDATE|FOR DELETE|WITH CHECK \(true\)/)
})
