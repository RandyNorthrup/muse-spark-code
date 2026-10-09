import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const channel = fileURLToPath(new URL('../../os/update/channel.py', import.meta.url))
const interpreter = process.platform === 'win32' ? 'python' : 'python3'
const temporary = []
function directory() {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-channel-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})

beforeAll(() => {
  // Throwaway certificates come from openssl, never from fixtures. Absence
  // is a loud failure, never a silent skip.
  const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error('M110-OS2 needs openssl on PATH for channel tests')
})

function sh(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`setup failed: ${cmd} ${args.join(' ')}\n${result.stderr}`)
  return result
}

function keypair(dir) {
  const key = path.join(dir, 'sign.pem')
  const pub = path.join(dir, 'verify.pem')
  sh('openssl', ['genrsa', '-out', key, '2048'])
  sh('openssl', ['rsa', '-in', key, '-pubout', '-out', pub])
  return { key, pub }
}

function metadata(dir, name, over = {}) {
  const doc = {
    channel: 'stable',
    version: '1.2.3',
    metadata_version: 7,
    expires: '2030-01-01T00:00:00Z',
    bundle: {
      url: 'https://example.invalid/bundles/1.2.3.raucb',
      sha256: 'e'.repeat(64),
    },
    ...over,
  }
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify(doc))
  return file
}

function sign(key, file) {
  sh('openssl', ['dgst', '-sha256', '-sign', key, '-out', `${file}.sig`, file])
}

function state(dir, version, meta) {
  const stateDir = path.join(dir, 'state')
  sh('mkdir', ['-p', stateDir])
  writeFileSync(path.join(stateDir, 'version'), `${version}\n`)
  writeFileSync(path.join(stateDir, 'metadata_version'), `${meta}\n`)
  return stateDir
}

function check(meta, stateDir, pub) {
  return spawnSync(interpreter, [channel, 'check', meta, '--state-dir', stateDir, '--key', pub], {
    encoding: 'utf8',
  })
}

describe('M110-OS2 update channel (TUF rules)', () => {
  it('accepts a signed, fresh, unexpired channel', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json')
    sign(key, meta)
    const result = check(meta, state(dir, '1.2.2', 6), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_OK')
    expect(result.status).toBe(0)
  })

  it('refuses a lower version even when signed', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', { version: '1.2.1', metadata_version: 8 })
    sign(key, meta)
    const result = check(meta, state(dir, '1.2.2', 6), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_DOWNGRADE')
    expect(result.status).not.toBe(0)
  })

  it('accepts an equal version with a higher metadata version', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', { metadata_version: 8 })
    sign(key, meta)
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_OK')
    expect(result.status).toBe(0)
  })

  it('refuses expired metadata', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', {
      version: '1.2.4',
      metadata_version: 8,
      expires: '2020-01-01T00:00:00Z',
    })
    sign(key, meta)
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_EXPIRED')
    expect(result.status).not.toBe(0)
  })

  it('refuses a metadata version that does not increase', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', { version: '1.2.4', metadata_version: 7 })
    sign(key, meta)
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_METADATA_STALE')
    expect(result.status).not.toBe(0)
  })

  it('refuses tampered metadata (fail closed)', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    sign(key, meta)
    // A one-field change keeps the document well-formed but breaks the
    // signature: the channel must refuse it, not install it.
    const tampered = JSON.parse(readFileSync(meta, 'utf8'))
    tampered.version = '1.2.5'
    writeFileSync(meta, JSON.stringify(tampered))
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_BAD_SIGNATURE')
    expect(result.status).not.toBe(0)
  })

  it('refuses a valid document with a broken signature', () => {
    const dir = directory()
    const { pub } = keypair(dir)
    const other = keypair(directory())
    const meta = metadata(dir, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    sign(other.key, meta)
    const badKey = check(meta, state(dir, '1.2.3', 7), pub)
    expect(badKey.stdout.trim()).toBe('CHANNEL_BAD_SIGNATURE')
    expect(badKey.status).not.toBe(0)
    writeFileSync(`${meta}.sig`, new Uint8Array([0x30, 0x31, 0x32, 0x33]))
    const corrupt = check(meta, state(dir, '1.2.3', 7), pub)
    expect(corrupt.stdout.trim()).toBe('CHANNEL_BAD_SIGNATURE')
    expect(corrupt.status).not.toBe(0)
  })

  it('refuses an unsigned channel', () => {
    const dir = directory()
    const { pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_BAD_SIGNATURE')
    expect(result.status).not.toBe(0)
  })

  it('refuses malformed metadata without verifying', () => {
    const dir = directory()
    const { pub } = keypair(dir)
    const meta = path.join(dir, 'meta.json')
    writeFileSync(meta, '{"version": "not a version"}\n')
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_MALFORMED')
    expect(result.status).not.toBe(0)
  })
})
