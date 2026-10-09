import { Buffer } from 'node:buffer'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

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
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, 'version'), `${version}\n`)
  writeFileSync(path.join(stateDir, 'metadata_version'), `${meta}\n`)
  return stateDir
}

function check(meta, stateDir, pub, extraArgs = []) {
  return spawnSync(
    interpreter,
    [channel, 'check', meta, '--state-dir', stateDir, '--key', pub, ...extraArgs],
    {
      encoding: 'utf8',
    },
  )
}

// Drive channel.check in-process with a stubbed subprocess.run: the stub
// records the exact argv and stdin the verifier would receive. Paths travel
// through argv (never embedded in source) so the probe is portable.
function verifyBinding(meta, stateDir, pub, outBin) {
  const driver = [
    'import importlib.util, json, shutil, subprocess, sys',
    'spec = importlib.util.spec_from_file_location("channel", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'captured = {}',
    'def fake_run(cmd, **kw):',
    '    captured["argv"] = cmd',
    '    captured["input"] = kw.get("input")',
    '    class R: returncode = 0',
    '    return R()',
    'subprocess.run = fake_run',
    'shutil.which = lambda name: "/usr/bin/openssl"',
    'm.check(sys.argv[2], sys.argv[3], sys.argv[4])',
    'print("ARGV:" + json.dumps(captured.get("argv") or []))',
    'fed = captured.get("input") or b""',
    'print("INPUTLEN:" + str(len(fed)))',
    'open(sys.argv[5], "wb").write(fed)',
  ].join('\n')
  return spawnSync(interpreter, ['-c', driver, channel, meta, stateDir, pub, outBin], {
    encoding: 'utf8',
  })
}

describe('M110-OS2 signed update channel (single key)', () => {
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

  it.each([
    ['numeric version', { version: 123 }],
    ['null expiry', { expires: null }],
    ['numeric expiry', { expires: 20_300_101 }],
    ['null bundle', { bundle: null }],
  ])('refuses wrongly typed JSON (%s) with a code, never a traceback', (_label, over) => {
    const dir = directory()
    const { pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', over)
    const result = check(meta, state(dir, '1.2.3', 7), pub)
    expect(result.stdout.trim()).toBe('CHANNEL_MALFORMED')
    expect(result.status).not.toBe(0)
    expect(result.stderr).not.toContain('Traceback')
  })

  it.each([
    ['missing version file', 'version', '1.2.3\n', null],
    ['missing counter file', 'metadata_version', null, '7\n'],
    ['malformed version', 'version', 'oops\n', '7\n'],
    ['malformed counter', 'metadata_version', '1.2.3\n', 'oops\n'],
    ['unreadable version', 'version', null, '7\n'],
  ])(
    'refuses damaged installed state (%s) instead of seeding zeros',
    (_label, name, version, meta) => {
      const dir = directory()
      const { key, pub } = keypair(dir)
      const doc = metadata(dir, 'meta.json', { version: '1.2.4', metadata_version: 8 })
      sign(key, doc)
      const stateDir = path.join(dir, 'state')
      mkdirSync(stateDir, { recursive: true })
      if (name === 'unreadable version') {
        mkdirSync(path.join(stateDir, 'version'))
        writeFileSync(path.join(stateDir, 'metadata_version'), meta)
      } else {
        if (version !== null) writeFileSync(path.join(stateDir, 'version'), version)
        if (meta !== null) writeFileSync(path.join(stateDir, 'metadata_version'), meta)
      }
      const result = check(doc, stateDir, pub)
      expect(result.stdout.trim()).toBe('CHANNEL_STATE_INVALID')
      expect(result.status).not.toBe(0)
    },
  )

  it('seeds a missing state only with the explicit first-boot flag', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json')
    sign(key, meta)
    const missing = path.join(dir, 'no-state-dir')
    const refused = check(meta, missing, pub)
    expect(refused.stdout.trim()).toBe('CHANNEL_STATE_INVALID')
    expect(refused.status).not.toBe(0)
    const seeded = check(meta, missing, pub, ['--first-boot'])
    expect(seeded.stdout.trim()).toBe('CHANNEL_OK')
    expect(seeded.status).toBe(0)
  })

  it('verifies the same bytes the policy parsed, never a reopened path', () => {
    const dir = directory()
    const { key, pub } = keypair(dir)
    const meta = metadata(dir, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    sign(key, meta)
    const outBin = path.join(dir, 'fed.bin')
    const result = verifyBinding(meta, state(dir, '1.2.3', 7), pub, outBin)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('CHANNEL_OK')
    // The verifier's stdin is byte-identical to the parsed document.
    expect(readFileSync(outBin).equals(readFileSync(meta))).toBe(true)
    // The metadata pathname itself is never an operand: only the .sig file
    // beside it is named, so a swapped pathname cannot be verified instead.
    const argvLine = result.stdout.split('\n').find((line) => line.startsWith('ARGV:'))
    const argv = JSON.parse(argvLine.slice('ARGV:'.length))
    expect(argv).not.toContain(meta)
    expect(argv).toContain(`${meta}.sig`)
  })
})

describe('M110-OS2 signed update channel: machine-code contract for damaged input', () => {
  let keys
  let dir
  beforeAll(() => {
    dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-channel-keys-'))
    keys = keypair(dir)
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it.each([
    ['negative', '-1'],
    ['signed', '+7'],
    ['non-ASCII digit', '²'],
    ['over-long', '1'.repeat(4400)],
  ])('refuses a %s installed counter, never lowering the replay barrier', (_label, counter) => {
    const work = directory()
    // Same version, older still-signed counter 1: only a corrupt installed
    // counter below 1 would let it through.
    const doc = metadata(work, 'meta.json', { metadata_version: 1 })
    sign(keys.key, doc)
    const result = check(doc, state(work, '1.2.3', counter), keys.pub)
    expect(result.stdout.trim()).toBe('CHANNEL_STATE_INVALID')
    expect(result.status).toBe(5)
    expect(result.stderr).not.toContain('Traceback')
  })

  it('round-trips the maximum counter and refuses one past it on both sides', () => {
    const max = '9223372036854775807' // 2**63 - 1
    const over = '9223372036854775808' // 2**63
    const setCounter = (file, digits) =>
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(
          /"metadata_version":\d+/,
          () => `"metadata_version":${digits}`,
        ),
      )
    // The maximum incoming counter is accepted and persists verbatim: the
    // same text reads back as installed state (stale, never invalid).
    const work = directory()
    const doc = metadata(work, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    setCounter(doc, max)
    sign(keys.key, doc)
    const stateDir = state(work, '1.2.3', 7)
    const accepted = check(doc, stateDir, keys.pub)
    expect(accepted.stdout.trim()).toBe('CHANNEL_OK')
    expect(accepted.status).toBe(0)
    writeFileSync(path.join(stateDir, 'metadata_version'), `${max}\n`)
    const reread = check(doc, stateDir, keys.pub)
    expect(reread.stdout.trim()).toBe('CHANNEL_METADATA_STALE')
    expect(reread.status).toBe(3)
    // One past the maximum is refused on the wire (malformed, never verified).
    const wire = directory()
    const wireDoc = metadata(wire, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    setCounter(wireDoc, over)
    sign(keys.key, wireDoc)
    const wireOver = check(wireDoc, state(wire, '1.2.3', 7), keys.pub)
    expect(wireOver.stdout.trim()).toBe('CHANNEL_MALFORMED')
    expect(wireOver.status).toBe(6)
    // ...and in the installed state file.
    const kept = directory()
    const keptDoc = metadata(kept, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    sign(keys.key, keptDoc)
    const keptOver = check(keptDoc, state(kept, '1.2.4', over), keys.pub)
    expect(keptOver.stdout.trim()).toBe('CHANNEL_STATE_INVALID')
    expect(keptOver.status).toBe(5)
  })

  it('refuses installed state that is not valid UTF-8 with its code', () => {
    const work = directory()
    const doc = metadata(work, 'meta.json', { version: '1.2.4', metadata_version: 8 })
    sign(keys.key, doc)
    const stateDir = state(work, '1.2.3', 7)
    writeFileSync(path.join(stateDir, 'version'), Buffer.from([0x31, 0x2e, 0xff, 0xfe, 0x0a]))
    const result = check(doc, stateDir, keys.pub)
    expect(result.stdout.trim()).toBe('CHANNEL_STATE_INVALID')
    expect(result.status).toBe(5)
    expect(result.stderr).not.toContain('Traceback')
  })

  it.each([
    ['a non-ASCII digit in the version', { version: '1.².3' }],
    ['an over-long version component', { version: `1.${'2'.repeat(4400)}.3` }],
    ['an expiry that overflows in UTC', { expires: '0001-01-01T00:00:00+01:00' }],
    ['a naive expiry', { expires: '2030-01-01T00:00:00' }],
  ])('refuses metadata with %s as CHANNEL_MALFORMED, never a traceback', (_label, over) => {
    const work = directory()
    const doc = metadata(work, 'meta.json', over)
    sign(keys.key, doc)
    const result = check(doc, state(work, '1.2.3', 6), keys.pub)
    expect(result.stdout.trim()).toBe('CHANNEL_MALFORMED')
    expect(result.status).toBe(6)
    expect(result.stderr).not.toContain('Traceback')
  })
})
