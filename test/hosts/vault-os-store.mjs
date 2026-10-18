// Generated-only native slot receipt. Linux: run inside an isolated unlocked
// Secret Service. macOS: run with the login Keychain unlocked. No model calls.
import { Buffer } from 'node:buffer'
import { build } from 'esbuild'
import { randomBytes } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'

const output = path.resolve('temp/cm109-os-store.cjs')
mkdirSync(path.dirname(output), { recursive: true })
await build({
  entryPoints: ['src/runtime/vault/slots/osStoreVaultSlot.ts'],
  outfile: output,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['@napi-rs/keyring'],
})
const { OsStoreVaultSlot } = createRequire(import.meta.url)(output)
const key = randomBytes(32)
const slot = new OsStoreVaultSlot({
  id: randomBytes(16).toString('hex'),
  vaultId: randomBytes(16).toString('hex'),
  lastGeneration: 0,
  auditGeneration: 0,
  auditHead: '0'.repeat(64),
  createdAt: Date.now(),
})
let hasWritten = false
try {
  if (process.argv.includes('--unavailable')) {
    await assert.rejects(slot.wrap(key), { name: 'VaultStoreUnavailableError' })
    process.stdout.write(
      'PASS: absent Secret Service refuses with VaultStoreUnavailableError (no native text)\n',
    )
  } else {
    const record = await slot.wrap(key)
    hasWritten = true
    assert.ok(!JSON.stringify(record).includes(key.toString('base64')))
    const restored = await slot.unwrap(record, '')
    try {
      assert.deepEqual(Buffer.from(restored), key)
    } finally {
      restored.fill(0)
    }
    await slot.remove()
    hasWritten = false
    await assert.rejects(slot.unwrap(record, ''), { code: 'locked' })
    process.stdout.write(
      `PASS: ${process.platform} native slot create/read/delete; no secret in record\n`,
    )
  }
} finally {
  key.fill(0)
  if (hasWritten) await slot.remove()
  rmSync(output, { force: true })
}
