import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

const channel = fileURLToPath(new URL('../../os/update/channel.py', import.meta.url))
const interpreter = process.platform === 'win32' ? 'python' : 'python3'
const temporary = []
const shared = []
function directory() {
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-tuf-'))
  temporary.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})
afterAll(() => {
  for (const dir of shared.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** OLPC Canonical JSON: sorted keys, no whitespace, only quote and
backslash escaped. The independence matters: the test signer and the
Python verifier agree byte for byte, or nothing verifies. */
const CANONICAL_QUOTE = String.fromCodePoint(34)
const CANONICAL_BACKSLASH = String.fromCodePoint(92)
function canonical(value) {
  if (value === null) return 'null'
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TypeError('canonical JSON has no floats')
    return String(value)
  }
  // Channel keys are ASCII throughout, where UTF-16 and codepoint order agree.
  if (typeof value === 'string')
    return `${CANONICAL_QUOTE}${value
      .replaceAll(CANONICAL_BACKSLASH, () => CANONICAL_BACKSLASH + CANONICAL_BACKSLASH)
      .replaceAll(CANONICAL_QUOTE, () => CANONICAL_BACKSLASH + CANONICAL_QUOTE)}${CANONICAL_QUOTE}`
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`
  const keys = Object.keys(value).toSorted((a, b) => a.localeCompare(b, 'en'))
  return `{${keys.map((key) => `${canonical(key)}:${canonical(value[key])}`).join(',')}}`
}

function sh(args) {
  const result = spawnSync('openssl', args, { encoding: 'utf8' })
  if (result.status !== 0)
    throw new Error(`setup failed: openssl ${args.join(' ')}\n${result.stderr}`)
  return result
}

const keys = {}
beforeAll(() => {
  // Throwaway keys come from openssl, never from fixtures. Absence, and
  // an openssl that cannot do PSS (LibreSSL silently ignores -sigopt),
  // is a loud failure, never a silent skip.
  const probe = spawnSync('openssl', ['version'], { encoding: 'utf8' })
  if (probe.status !== 0) throw new Error('M110-OS2 needs openssl on PATH for TUF tests')
  // The key pool lives for the whole file: per-test cleanup must not eat it.
  const dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-tuf-keys-'))
  shared.push(dir)
  for (const name of ['rootA', 'rootB', 'rootC', 'timestamp', 'snapshot', 'targets', 'attacker']) {
    const key = path.join(dir, `${name}.pem`)
    sh(['genrsa', '-out', key, '2048'])
    const pub = path.join(dir, `${name}-pub.pem`)
    sh(['rsa', '-in', key, '-pubout', '-out', pub])
    keys[name] = { key, pub: readFileSync(pub, 'utf8') }
  }
  const weak = path.join(dir, 'weak.pem')
  sh(['genrsa', '-out', weak, '1024'])
  const weakPub = path.join(dir, 'weak-pub.pem')
  sh(['rsa', '-in', weak, '-pubout', '-out', weakPub])
  keys.weak = { key: weak, pub: readFileSync(weakPub, 'utf8') }
  // PSS round trip now, so a silent -sigopt never reads as a channel bug.
  const data = path.join(dir, 'pss-probe.bin')
  const sig = path.join(dir, 'pss-probe.sig')
  writeFileSync(data, 'pss capability probe')
  sh([
    'dgst',
    '-sha256',
    '-sigopt',
    'rsa_padding_mode:pss',
    '-sigopt',
    'rsa_pss_saltlen:32',
    '-sign',
    keys.attacker.key,
    '-out',
    sig,
    data,
  ])
  const verify = spawnSync(
    'openssl',
    [
      'dgst',
      '-sha256',
      '-sigopt',
      'rsa_padding_mode:pss',
      '-sigopt',
      'rsa_pss_saltlen:auto',
      '-verify',
      path.join(dir, 'attacker-pub.pem'),
      '-signature',
      sig,
      data,
    ],
    { encoding: 'utf8' },
  )
  if (verify.status !== 0)
    throw new Error('M110-OS2 needs an openssl with RSA-PSS (-sigopt) for TUF tests')
  sharedBase.dir = mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'm110-os2-tuf-base-'))
  shared.push(sharedBase.dir)
  sharedBase.built = buildChannel(sharedBase.dir)
}, 60_000)

const sharedBase = {}

function keyObject(name) {
  return { keytype: 'rsa', scheme: 'rsassa-pss-sha256', keyval: { public: keys[name].pub } }
}

function keyidOf(key) {
  return createHash('sha256').update(canonical(key), 'utf8').digest('hex')
}

function sign(dir, name, signed, signers) {
  const bytes = Buffer.from(canonical(signed), 'utf8')
  const signatures = []
  for (const signer of signers) {
    const payload = path.join(dir, `${name}-${signer}.bin`)
    const sig = path.join(dir, `${name}-${signer}.sig`)
    writeFileSync(payload, bytes)
    sh([
      'dgst',
      '-sha256',
      '-sigopt',
      'rsa_padding_mode:pss',
      '-sigopt',
      'rsa_pss_saltlen:32',
      '-sign',
      keys[signer].key,
      '-out',
      sig,
      payload,
    ])
    signatures.push({ keyid: keyidOf(keyObject(signer)), sig: readFileSync(sig).toString('hex') })
  }
  return { signatures, signed }
}

function writeMeta(dir, name, envelope) {
  const file = path.join(dir, name)
  writeFileSync(file, JSON.stringify(envelope))
  return file
}

const EXPIRES = '2030-01-01T00:00:00Z'
const EXPIRED = '2020-01-01T00:00:00Z'

function rootSigned(version, keyNames, thresholds = {}) {
  const keyObjs = {}
  for (const name of keyNames) keyObjs[keyidOf(keyObject(name))] = keyObject(name)
  const role = (name, names, fallback) => ({
    keyids: names.map((key) => keyidOf(keyObject(key))),
    threshold: thresholds[name] ?? fallback,
  })
  return {
    _type: 'root',
    spec_version: '1.0.0',
    version,
    expires: EXPIRES,
    keys: keyObjs,
    roles: {
      root: role(
        'root',
        keyNames.filter((key) => key.startsWith('root')),
        2,
      ),
      timestamp: role('timestamp', ['timestamp'], 1),
      snapshot: role('snapshot', ['snapshot'], 1),
      targets: role('targets', ['targets'], 1),
    },
  }
}

function buildChannel(dir = directory(), options = {}) {
  const version = options.version ?? '1.2.3'
  const bundleBytes = Buffer.from(`fake RAUC bundle ${version}`, 'utf8')
  const bundle = path.join(dir, `${version}.raucb`)
  writeFileSync(bundle, bundleBytes)
  const metaDir = path.join(dir, 'meta')
  mkdirSync(metaDir, { recursive: true })
  const rootKeys = options.rootKeys ?? ['rootA', 'rootB']
  const rootSigners = options.rootSigners ?? rootKeys
  const root = rootSigned(1, [...new Set([...rootKeys, 'timestamp', 'snapshot', 'targets'])], {
    root: options.rootThreshold ?? 2,
  })
  // The root role lists only root keys; role keys ride in the key table.
  root.roles.root.keyids = rootKeys.map((key) => keyidOf(keyObject(key)))
  if (options.rootRoles !== undefined) root.roles = options.rootRoles(root)
  const rootFile = writeMeta(metaDir, '1.root.json', sign(dir, 'root1', root, rootSigners))
  const targetsSigned = {
    _type: 'targets',
    spec_version: '1.0.0',
    version: options.targetsVersion ?? 1,
    expires: options.targetsExpires ?? EXPIRES,
    targets: {
      [`bundles/${version}.raucb`]: {
        length: bundleBytes.length,
        hashes: { sha256: createHash('sha256').update(bundleBytes).digest('hex') },
      },
    },
    ...options.targetsExtra,
  }
  const targetsFile = writeMeta(
    metaDir,
    'targets.json',
    sign(dir, 'targets', targetsSigned, options.targetsSigners ?? ['targets']),
  )
  const snapshotSigned = {
    _type: 'snapshot',
    spec_version: '1.0.0',
    version: options.snapshotVersion ?? 1,
    expires: EXPIRES,
    meta: {
      'targets.json': {
        version: targetsSigned.version,
        length: readFileSync(targetsFile).length,
        hashes: { sha256: shaFile(targetsFile) },
      },
      ...options.snapshotExtraMeta,
    },
  }
  const snapshotFile = writeMeta(
    metaDir,
    'snapshot.json',
    sign(dir, 'snapshot', snapshotSigned, ['snapshot']),
  )
  const timestampSigned = {
    _type: 'timestamp',
    spec_version: '1.0.0',
    version: options.timestampVersion ?? 1,
    expires: options.timestampExpires ?? EXPIRES,
    meta: {
      'snapshot.json': {
        version: snapshotSigned.version,
        length: readFileSync(snapshotFile).length,
        hashes: { sha256: shaFile(snapshotFile) },
      },
    },
  }
  writeMeta(metaDir, 'timestamp.json', sign(dir, 'timestamp', timestampSigned, ['timestamp']))
  if (options.rotation !== undefined) {
    const { version: rootVersion, keys: newKeys, signers } = options.rotation
    const rotated = rootSigned(rootVersion, [
      ...new Set([...newKeys, 'timestamp', 'snapshot', 'targets']),
    ])
    rotated.roles.root.keyids = newKeys.map((key) => keyidOf(keyObject(key)))
    writeMeta(
      metaDir,
      `${rootVersion}.root.json`,
      sign(dir, `root${rootVersion}`, rotated, signers),
    )
  }
  const stateDir = path.join(dir, 'state')
  return { metaDir, bundle, stateDir, trustRoot: rootFile, version }
}

function shaFile(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** Recompute the snapshot binding over the current targets.json bytes
and the timestamp binding over the snapshot, re-signing both: after a
test rewrites targets.json, only its own mutation must refuse. */
// Re-signs a mutated root with the two root keys and writes it out.
function resignRoot(dir, tag, outFile, root) {
  const bytes = Buffer.from(canonical(root.signed), 'utf8')
  root.signatures = []
  for (const signer of ['rootA', 'rootB']) {
    const payload = path.join(dir, `${tag}-${signer}.bin`)
    const sig = path.join(dir, `${tag}-${signer}.sig`)
    writeFileSync(payload, bytes)
    sh([
      'dgst',
      '-sha256',
      '-sigopt',
      'rsa_padding_mode:pss',
      '-sigopt',
      'rsa_pss_saltlen:32',
      '-sign',
      keys[signer].key,
      '-out',
      sig,
      payload,
    ])
    root.signatures.push({
      keyid: keyidOf(keyObject(signer)),
      sig: readFileSync(sig).toString('hex'),
    })
  }
  writeFileSync(outFile, JSON.stringify(root))
}

function rebind(dir, metaDir) {
  const resign = (file, role) => {
    const envelope = JSON.parse(readFileSync(file, 'utf8'))
    const payload = path.join(dir, `rebind-${role}.bin`)
    const sig = path.join(dir, `rebind-${role}.sig`)
    writeFileSync(payload, Buffer.from(canonical(envelope.signed), 'utf8'))
    sh([
      'dgst',
      '-sha256',
      '-sigopt',
      'rsa_padding_mode:pss',
      '-sigopt',
      'rsa_pss_saltlen:32',
      '-sign',
      keys[role].key,
      '-out',
      sig,
      payload,
    ])
    envelope.signatures = [
      { keyid: keyidOf(keyObject(role)), sig: readFileSync(sig).toString('hex') },
    ]
    writeFileSync(file, JSON.stringify(envelope))
  }
  const targetsFile = path.join(metaDir, 'targets.json')
  const snapshotFile = path.join(metaDir, 'snapshot.json')
  const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'))
  snapshot.signed.meta['targets.json'].length = readFileSync(targetsFile).length
  snapshot.signed.meta['targets.json'].hashes.sha256 = shaFile(targetsFile)
  writeFileSync(snapshotFile, JSON.stringify(snapshot))
  resign(snapshotFile, 'snapshot')
  const timestampFile = path.join(metaDir, 'timestamp.json')
  const timestamp = JSON.parse(readFileSync(timestampFile, 'utf8'))
  timestamp.signed.meta['snapshot.json'].length = readFileSync(snapshotFile).length
  timestamp.signed.meta['snapshot.json'].hashes.sha256 = shaFile(snapshotFile)
  writeFileSync(timestampFile, JSON.stringify(timestamp))
  resign(timestampFile, 'timestamp')
}

function check(metaDir, bundle, stateDir, trustRoot, extraArgs = []) {
  return spawnSync(
    interpreter,
    [
      channel,
      'check',
      '--metadata-dir',
      metaDir,
      '--bundle',
      bundle,
      '--state-dir',
      stateDir,
      '--trust-root',
      trustRoot,
      ...extraArgs,
    ],
    { encoding: 'utf8' },
  )
}

function seedInstalled(stateDir, version) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, 'version'), `${version}\n`)
}

describe('M110-OS2 TUF update channel', () => {
  it('accepts a fresh channel on first boot and persists trust', () => {
    const dir = directory()
    const { metaDir, bundle, stateDir, trustRoot, version } = buildChannel(dir)
    const first = check(metaDir, bundle, stateDir, trustRoot, ['--first-boot'])
    expect(first.status).toBe(0)
    expect(first.stdout.trim()).toBe('TUF_OK')
    for (const name of ['root.json', 'timestamp.json', 'snapshot.json', 'targets.json']) {
      expect(readFileSync(path.join(stateDir, name)).length).toBeGreaterThan(0)
    }
    // The install hook records the installed bundle; the second run
    // answers from persisted trust, without the flag.
    seedInstalled(stateDir, version)
    const second = check(metaDir, bundle, stateDir, trustRoot)
    expect(second.status).toBe(0)
    expect(second.stdout.trim()).toBe('TUF_OK')
  })

  it('counts the root threshold over unique keys only', () => {
    // An anchor meeting one of two refuses at seeding: corrupt trust
    // never becomes trusted state.
    const dir = directory()
    const once = buildChannel(dir, { rootSigners: ['rootA'] })
    const refused = check(once.metaDir, once.bundle, once.stateDir, once.trustRoot, [
      '--first-boot',
    ])
    expect(refused.status).not.toBe(0)
    expect(refused.stdout.trim()).toBe('TUF_STATE_INVALID')
    // The same key twice still counts once, even though PSS randomizes
    // each signature: duplicate keyids never stack towards a threshold.
    const dir2 = directory()
    const duped = buildChannel(dir2, {
      rotation: { version: 2, keys: ['rootA', 'rootB'], signers: ['rootA', 'rootA'] },
    })
    const result = check(duped.metaDir, duped.bundle, duped.stateDir, duped.trustRoot, [
      '--first-boot',
    ])
    expect(result.stdout.trim()).toBe('TUF_BAD_SIGNATURE')
  })

  it('rotates the root across versions with both thresholds', () => {
    const dir = directory()
    const { metaDir, bundle, stateDir, trustRoot } = buildChannel(dir, {
      rotation: { version: 2, keys: ['rootB', 'rootC'], signers: ['rootA', 'rootB', 'rootC'] },
    })
    const result = check(metaDir, bundle, stateDir, trustRoot, ['--first-boot'])
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('TUF_OK')
    const trusted = JSON.parse(readFileSync(path.join(stateDir, 'root.json'), 'utf8'))
    expect(trusted.signed.version).toBe(2)
  })

  it('refuses a rotation the new keys did not countersign', () => {
    const dir = directory()
    // Signed by the old threshold only: the new keys never countersigned,
    // so anyone holding the old keys could rotate to their own.
    const { metaDir, bundle, stateDir, trustRoot } = buildChannel(dir, {
      rotation: { version: 2, keys: ['rootB', 'rootC'], signers: ['rootA', 'rootB'] },
    })
    const result = check(metaDir, bundle, stateDir, trustRoot, ['--first-boot'])
    expect(result.status).not.toBe(0)
    expect(result.stdout.trim()).toBe('TUF_BAD_SIGNATURE')
  })

  it('refuses a root version that skips ahead', () => {
    const dir = directory()
    const built = buildChannel(dir)
    const envelope = JSON.parse(readFileSync(path.join(built.metaDir, '1.root.json'), 'utf8'))
    envelope.signed.version = 3
    // Re-sign over the tampered version with both thresholds, so the
    // refusal names the rollback, not the signature.
    const signed = envelope.signed
    const bytes = Buffer.from(canonical(signed), 'utf8')
    envelope.signatures = []
    for (const signer of ['rootA', 'rootB']) {
      const payload = path.join(dir, `gap-${signer}.bin`)
      const sig = path.join(dir, `gap-${signer}.sig`)
      writeFileSync(payload, bytes)
      sh([
        'dgst',
        '-sha256',
        '-sigopt',
        'rsa_padding_mode:pss',
        '-sigopt',
        'rsa_pss_saltlen:32',
        '-sign',
        keys[signer].key,
        '-out',
        sig,
        payload,
      ])
      envelope.signatures.push({
        keyid: keyidOf(keyObject(signer)),
        sig: readFileSync(sig).toString('hex'),
      })
    }
    writeFileSync(path.join(built.metaDir, '2.root.json'), JSON.stringify(envelope))
    const result = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(result.stdout.trim()).toBe('TUF_ROLLBACK')
  })

  it('refuses a timestamp that steps back, and answers an unchanged one from trust', () => {
    const dir = directory()
    const first = buildChannel(dir, { timestampVersion: 2 })
    seedInstalled(first.stateDir, '0.0.0')
    const ok = check(first.metaDir, first.bundle, first.stateDir, first.trustRoot, ['--first-boot'])
    expect(ok.stdout.trim()).toBe('TUF_OK')
    // Rewind the channel to timestamp 1 with fresh signatures: the
    // rollback check compares against trusted state, not the signature.
    const rewound = buildChannel(dir, { timestampVersion: 1 })
    const back = check(rewound.metaDir, rewound.bundle, first.stateDir, rewound.trustRoot)
    expect(back.stdout.trim()).toBe('TUF_ROLLBACK')
    // Same version as trusted ends the metadata update normally, and the
    // bundle is answered from trusted metadata: rebuild the version-2
    // channel, trash its snapshot file, and the trusted bundle answers.
    const again = buildChannel(dir, { timestampVersion: 2 })
    writeFileSync(path.join(again.metaDir, 'snapshot.json'), 'not json anymore')
    const current = check(again.metaDir, first.bundle, first.stateDir, again.trustRoot)
    expect(current.status).toBe(0)
    expect(current.stdout.trim()).toBe('TUF_OK')
  })

  it('refuses an expired timestamp and an expired final root', () => {
    const dir = directory()
    const stale = buildChannel(dir, { timestampExpires: EXPIRED })
    const frozen = check(stale.metaDir, stale.bundle, stale.stateDir, stale.trustRoot, [
      '--first-boot',
    ])
    expect(frozen.stdout.trim()).toBe('TUF_EXPIRED')
    const dir2 = directory()
    const built = buildChannel(dir2)
    const envelope = JSON.parse(readFileSync(path.join(built.metaDir, '1.root.json'), 'utf8'))
    envelope.signed.expires = EXPIRED
    const bytes = Buffer.from(canonical(envelope.signed), 'utf8')
    envelope.signatures = []
    for (const signer of ['rootA', 'rootB']) {
      const payload = path.join(dir2, `exp-${signer}.bin`)
      const sig = path.join(dir2, `exp-${signer}.sig`)
      writeFileSync(payload, bytes)
      sh([
        'dgst',
        '-sha256',
        '-sigopt',
        'rsa_padding_mode:pss',
        '-sigopt',
        'rsa_pss_saltlen:32',
        '-sign',
        keys[signer].key,
        '-out',
        sig,
        payload,
      ])
      envelope.signatures.push({
        keyid: keyidOf(keyObject(signer)),
        sig: readFileSync(sig).toString('hex'),
      })
    }
    const expiredRoot = path.join(dir2, 'expired-root.json')
    writeFileSync(expiredRoot, JSON.stringify(envelope))
    const result = check(built.metaDir, built.bundle, built.stateDir, expiredRoot, ['--first-boot'])
    expect(result.stdout.trim()).toBe('TUF_EXPIRED')
  })

  it('refuses snapshot and targets that break their parent binding', () => {
    const dir = directory()
    const built = buildChannel(dir)
    // Snapshot bytes swapped after the timestamp bound them: the hash
    // no longer matches what timestamp pinned.
    const snapshotFile = path.join(built.metaDir, 'snapshot.json')
    const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'))
    snapshot.signed.expires = '2031-06-01T00:00:00Z'
    writeFileSync(snapshotFile, JSON.stringify(snapshot))
    const hashed = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(hashed.stdout.trim()).toBe('TUF_MALFORMED')
    // Snapshot version that disagrees with timestamp's pin: rewrite
    // the pin to 1 and re-sign, leaving the snapshot file (version 5)
    // and its hash binding intact, so only the version fires.
    const dir2 = directory()
    const mismatch = buildChannel(dir2, { snapshotVersion: 5 })
    const timestampFile = path.join(mismatch.metaDir, 'timestamp.json')
    const timestamp = JSON.parse(readFileSync(timestampFile, 'utf8'))
    timestamp.signed.meta['snapshot.json'].version = 1
    const repinPayload = path.join(dir2, 'repin.bin')
    const repinSig = path.join(dir2, 'repin.sig')
    writeFileSync(repinPayload, Buffer.from(canonical(timestamp.signed), 'utf8'))
    sh([
      'dgst',
      '-sha256',
      '-sigopt',
      'rsa_padding_mode:pss',
      '-sigopt',
      'rsa_pss_saltlen:32',
      '-sign',
      keys.timestamp.key,
      '-out',
      repinSig,
      repinPayload,
    ])
    timestamp.signatures = [
      { keyid: keyidOf(keyObject('timestamp')), sig: readFileSync(repinSig).toString('hex') },
    ]
    writeFileSync(timestampFile, JSON.stringify(timestamp))
    const result = check(mismatch.metaDir, mismatch.bundle, mismatch.stateDir, mismatch.trustRoot, [
      '--first-boot',
    ])
    expect(result.stdout.trim()).toBe('TUF_MALFORMED')
  })

  it('refuses a snapshot that rolls targets back or drops a file', () => {
    const dir = directory()
    const first = buildChannel(dir, {
      targetsVersion: 5,
      snapshotVersion: 3,
      snapshotExtraMeta: { 'other.json': { version: 2 } },
    })
    const ok = check(first.metaDir, first.bundle, first.stateDir, first.trustRoot, ['--first-boot'])
    expect(ok.stdout.trim()).toBe('TUF_OK')
    const lower = buildChannel(dir, {
      targetsVersion: 3,
      snapshotVersion: 4,
      timestampVersion: 2,
    })
    const back = check(lower.metaDir, lower.bundle, lower.stateDir, lower.trustRoot)
    expect(back.stdout.trim()).toBe('TUF_ROLLBACK')
  })

  it('refuses targets signed by the wrong key or tampered after signing', () => {
    const dir = directory()
    const forged = buildChannel(dir, { targetsSigners: ['attacker'] })
    const result = check(forged.metaDir, forged.bundle, forged.stateDir, forged.trustRoot, [
      '--first-boot',
    ])
    expect(result.stdout.trim()).toBe('TUF_BAD_SIGNATURE')
    const dir2 = directory()
    const built = buildChannel(dir2)
    // Flip version bytes in place: the length stays close enough that a
    // sloppy checker could miss it, but the signature cannot.
    const targetsFile = path.join(built.metaDir, 'targets.json')
    const raw = readFileSync(targetsFile, 'utf8').replace('"version":1', '"version":2')
    writeFileSync(targetsFile, raw)
    const tampered = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    // The parent's hash binds first here too: tampering breaks the file
    // binding before any signature is checked.
    expect(tampered.stdout.trim()).toBe('TUF_MALFORMED')
  })

  it('refuses a bundle whose bytes break the targets hash', () => {
    const dir = directory()
    const built = buildChannel(dir)
    // Same length, different bytes: only the hash can catch it.
    writeFileSync(built.bundle, 'tampered bundle bytes!?')
    const hashed = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(hashed.stdout.trim()).toBe('TUF_BAD_TARGET')
  })

  it('refuses a bundle whose length breaks the targets entry', () => {
    const dir = directory()
    const sized = buildChannel(dir)
    writeFileSync(sized.bundle, 'x')
    const length = check(sized.metaDir, sized.bundle, sized.stateDir, sized.trustRoot, [
      '--first-boot',
    ])
    expect(length.stdout.trim()).toBe('TUF_BAD_TARGET')
  })

  it('refuses a bundle the channel never listed', () => {
    const dir = directory()
    const unknown = buildChannel(dir)
    const stranger = path.join(dir, '9.9.9.raucb')
    writeFileSync(stranger, 'a bundle the channel never listed')
    const missing = check(unknown.metaDir, stranger, unknown.stateDir, unknown.trustRoot, [
      '--first-boot',
    ])
    expect(missing.stdout.trim()).toBe('TUF_UNKNOWN_TARGET')
  })

  it('refuses a bundle older than the installed one, and accepts an equal one', () => {
    const dir = directory()
    const built = buildChannel(dir, { version: '1.2.3' })
    seedInstalled(built.stateDir, '1.2.4')
    const down = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(down.stdout.trim()).toBe('TUF_DOWNGRADE')
    seedInstalled(built.stateDir, '1.2.3')
    const same = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(same.status).toBe(0)
    expect(same.stdout.trim()).toBe('TUF_OK')
  })

  it('refuses a role key under 2048 bits', () => {
    // A 1024-bit targets key is unusable: the threshold cannot be met,
    // even signed by the weak key itself.
    const dir = directory()
    const weak = buildChannel(dir, { targetsSigners: ['weak'] })
    const rootFile = path.join(weak.metaDir, '1.root.json')
    const root = JSON.parse(readFileSync(rootFile, 'utf8'))
    const weakKey = keyObject('weak')
    const weakKeyid = keyidOf(weakKey)
    root.signed.keys[weakKeyid] = weakKey
    root.signed.roles.targets.keyids = [weakKeyid]
    resignRoot(dir, 'weak', rootFile, root)
    // The trust anchor must match: re-seed from the weakened root.
    const refused = check(weak.metaDir, weak.bundle, weak.stateDir, rootFile, ['--first-boot'])
    expect(refused.stdout.trim()).toBe('TUF_BAD_SIGNATURE')
  })

  it('refuses a key of an unknown scheme', () => {
    // A key of an unknown scheme never counts, even with a signature
    // under its keyid: the threshold cannot be met.
    const dir = directory()
    const strange = buildChannel(dir, { targetsSigners: ['attacker'] })
    const strangeFile = path.join(strange.metaDir, '1.root.json')
    const strangeRoot = JSON.parse(readFileSync(strangeFile, 'utf8'))
    const edKey = { keytype: 'ed25519', scheme: 'ed25519', keyval: { public: 'not a key' } }
    const edKeyid = keyidOf(edKey)
    strangeRoot.signed.keys[edKeyid] = edKey
    strangeRoot.signed.roles.targets.keyids = [edKeyid]
    resignRoot(dir, 'strange', strangeFile, strangeRoot)
    const strangeTargets = JSON.parse(
      readFileSync(path.join(strange.metaDir, 'targets.json'), 'utf8'),
    )
    strangeTargets.signatures[0].keyid = edKeyid
    writeFileSync(path.join(strange.metaDir, 'targets.json'), JSON.stringify(strangeTargets))
    rebind(dir, strange.metaDir)
    const unknown = check(strange.metaDir, strange.bundle, strange.stateDir, strangeFile, [
      '--first-boot',
    ])
    expect(unknown.stdout.trim()).toBe('TUF_BAD_SIGNATURE')
  })

  it('refuses a key filed under the wrong keyid', () => {
    // A key filed under a keyid that is not its own is refused at the
    // rotation candidate: clients recompute every keyid.
    const dir = directory()
    const lied = buildChannel(dir)
    const liedRoot = JSON.parse(readFileSync(path.join(lied.metaDir, '1.root.json'), 'utf8'))
    liedRoot.signed.version = 2
    const targetsKeyid = liedRoot.signed.roles.targets.keyids[0]
    const targetsKey = liedRoot.signed.keys[targetsKeyid]
    // The correct entry stays filed too, inert: the lied one refuses.
    const wrongKeyid = `00${targetsKeyid.slice(2)}`
    liedRoot.signed.keys[wrongKeyid] = targetsKey
    liedRoot.signed.roles.targets.keyids = [wrongKeyid]
    resignRoot(dir, 'lied', path.join(lied.metaDir, '2.root.json'), liedRoot)
    const liedResult = check(lied.metaDir, lied.bundle, lied.stateDir, lied.trustRoot, [
      '--first-boot',
    ])
    expect(liedResult.stdout.trim()).toBe('TUF_MALFORMED')
  })

  it('refuses a root that names delegations', () => {
    // A targets file carrying delegations is refused outright.
    const dir = directory()
    const delegated = buildChannel(dir, { targetsExtra: { delegations: { keys: {}, roles: [] } } })
    const result = check(
      delegated.metaDir,
      delegated.bundle,
      delegated.stateDir,
      delegated.trustRoot,
      ['--first-boot'],
    )
    expect(result.stdout.trim()).toBe('TUF_MALFORMED')
  })

  it('keeps an untouched channel verifiable across a rebind', () => {
    // The mutation tests below rebind after rewriting targets.json; if
    // the rebind itself broke the parent hashes, every one of them would
    // pass for the wrong reason. This pins the rebind clean.
    const dir = directory()
    const built = buildChannel(dir)
    const targetsFile = path.join(built.metaDir, 'targets.json')
    writeFileSync(targetsFile, JSON.stringify(JSON.parse(readFileSync(targetsFile, 'utf8'))))
    rebind(dir, built.metaDir)
    const result = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(result.stdout.trim()).toBe('TUF_OK')
  })

  // One test per malformed shape, each with its own timeout budget; the
  // copies are cheap and the one shared channel was built in beforeAll.
  const malformedCases = [
    ['bad spec major', (signed) => ({ ...signed, spec_version: '2.0.0' })],
    ['zero version', (signed) => ({ ...signed, version: 0 })],
    ['boolean version', (signed) => ({ ...signed, version: true })],
    ['float field', (signed) => ({ ...signed, custom: 1.5 })],
    ['missing expiry', (signed) => ({ ...signed, expires: undefined })],
    ['wrong type', (signed) => ({ ...signed, _type: 'snapshot' })],
  ]
  for (const [name, mutate] of malformedCases) {
    it(`refuses a malformed role (${name}) without verifying`, () => {
      const base = sharedBase.built
      const dir = directory()
      const metaDir = path.join(dir, 'meta')
      cpSync(base.metaDir, metaDir, { recursive: true })
      const bundle = path.join(dir, path.basename(base.bundle))
      cpSync(base.bundle, bundle)
      const stateDir = path.join(dir, 'state')
      const trustRoot = path.join(metaDir, '1.root.json')
      const targetsFile = path.join(metaDir, 'targets.json')
      const envelope = JSON.parse(readFileSync(targetsFile, 'utf8'))
      // Re-sign over the mutation so only the shape refuses, and rebind
      // the parent's hash and length to the mutated bytes for the same
      // reason: the shape check must fire, not the binding.
      const signed = mutate(envelope.signed)
      const payload = path.join(dir, 'mutated.bin')
      const sig = path.join(dir, 'mutated.sig')
      try {
        writeFileSync(payload, Buffer.from(canonical(signed), 'utf8'))
      } catch {
        writeFileSync(payload, Buffer.from(JSON.stringify(signed), 'utf8'))
      }
      sh([
        'dgst',
        '-sha256',
        '-sigopt',
        'rsa_padding_mode:pss',
        '-sigopt',
        'rsa_pss_saltlen:32',
        '-sign',
        keys.targets.key,
        '-out',
        sig,
        payload,
      ])
      envelope.signed = signed
      envelope.signatures = [
        { keyid: keyidOf(keyObject('targets')), sig: readFileSync(sig).toString('hex') },
      ]
      writeFileSync(targetsFile, JSON.stringify(envelope))
      rebind(dir, metaDir)
      const result = check(metaDir, bundle, stateDir, trustRoot, ['--first-boot'])
      expect(result.stdout.trim()).toBe('TUF_MALFORMED')
    })
  }

  it('refuses without the first-boot flag on missing state, and corrupt trusted state', () => {
    const dir = directory()
    const built = buildChannel(dir)
    const strict = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot)
    expect(strict.stdout.trim()).toBe('TUF_STATE_INVALID')
    const seeded = check(built.metaDir, built.bundle, built.stateDir, built.trustRoot, [
      '--first-boot',
    ])
    expect(seeded.stdout.trim()).toBe('TUF_OK')
    writeFileSync(path.join(built.stateDir, 'timestamp.json'), 'damaged trust')
    const bumped = buildChannel(dir, { timestampVersion: 2 })
    const damaged = check(bumped.metaDir, bumped.bundle, built.stateDir, bumped.trustRoot)
    expect(damaged.stdout.trim()).toBe('TUF_STATE_INVALID')
  })

  it('refuses without openssl on PATH', () => {
    const dir = directory()
    const built = buildChannel(dir)
    const empty = path.join(dir, 'empty-path')
    mkdirSync(empty, { recursive: true })
    // The interpreter itself is resolved before PATH is emptied; only
    // the child's openssl lookup sees the empty directory.
    const locator = process.platform === 'win32' ? 'where' : 'which'
    const found = spawnSync(locator, [interpreter], { encoding: 'utf8' })
    const python = found.stdout.trim().split(/\r?\n/, 1)[0]
    const probe = spawnSync(
      python,
      [
        channel,
        'check',
        '--metadata-dir',
        built.metaDir,
        '--bundle',
        built.bundle,
        '--state-dir',
        built.stateDir,
        '--trust-root',
        built.trustRoot,
        '--first-boot',
      ],
      { encoding: 'utf8', env: { ...process.env, PATH: empty, Path: empty } },
    )
    expect(probe.stdout.trim()).toBe('TUF_NO_VERIFY_TOOL')
    expect(probe.status).not.toBe(0)
  })
})
