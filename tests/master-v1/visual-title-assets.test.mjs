import test from 'node:test'
import assert from 'node:assert/strict'
import { File } from 'node:buffer'
import { slugify, uploadImmutablePng, validatePng } from '../../src/services/masterV1Assets.js'

if (!globalThis.crypto?.subtle) {
  globalThis.crypto = (await import('node:crypto')).webcrypto
}

function pngFile(name = 'selo.png', type = 'image/png', bytes = [137, 80, 78, 71]) {
  return new File([Uint8Array.from(bytes)], name, { type })
}

test('valida somente PNGs de até 5 MB', () => {
  assert.doesNotThrow(() => validatePng(pngFile()))
  assert.throws(() => validatePng(pngFile('selo.jpg', 'image/jpeg')), /somente arquivos PNG/)
  assert.throws(() => validatePng(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })), /máximo 5 MB/)
})

test('gera slug estável sem acentos', () => {
  assert.equal(slugify(' Polícia & Urgente '), 'policia-urgente')
})

test('envia PNG para path imutável com upsert false e retorna apenas metadados', async () => {
  const calls = []
  const supabase = {
    storage: {
      from(bucket) {
        return {
          upload: async (path, file, options) => {
            calls.push({ bucket, path, file, options })
            return { error: null }
          },
        }
      },
    },
  }
  const asset = await uploadImmutablePng({
    supabase,
    file: pngFile('urgente.png'),
    clienteId: 'cliente-1',
    kind: 'visual-titles',
    slug: 'Urgente',
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].bucket, 'ap-images')
  assert.match(calls[0].path, /^visual-titles\/cliente-1\/urgente\/[a-f0-9]{64}\.png$/)
  assert.deepEqual(calls[0].options, { contentType: 'image/png', upsert: false })
  assert.deepEqual(Object.keys(asset).sort(), ['ativo', 'bucket', 'nome', 'path', 'sha256', 'version'])
})