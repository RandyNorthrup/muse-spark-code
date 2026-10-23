// M110os OS7: the package-key check for the Chrome add-on. The install
// keyring must carry every pinned fingerprint; anything else refuses.
// Node builtins only, so the device and CI run it bare.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const FINGERPRINT_LENGTH = 40
const FINGERPRINT_PATTERN = /^[0-9A-F]{40}$/
/** The fingerprint field of a `gpg --with-colons` `fpr:` line. */
const COLONS_FINGERPRINT_FIELD = 9

/**
Parse a fingerprints file: one 40-digit hex fingerprint per line, an
optional label after it, `#` comments and blanks skipped.
*/
export function parseFingerprintsFile(text) {
  const fingerprints = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const [uncommented = ''] = line.split('#', 1)
    const stripped = uncommented.trim()
    if (stripped === '') continue
    const [fingerprint = ''] = stripped.split(/\s+/, 1)
    const upper = fingerprint.toUpperCase()
    if (upper.length !== FINGERPRINT_LENGTH || !FINGERPRINT_PATTERN.test(upper)) {
      return { ok: false, error: `fingerprints line ${String(index + 1)} is not a fingerprint` }
    }
    fingerprints.push(upper)
  }
  return fingerprints.length === 0
    ? { ok: false, error: 'no pinned fingerprints' }
    : { ok: true, fingerprints }
}

/** Fingerprints from `gpg --list-keys --with-colons` output. */
export function fingerprintsFromColons(text) {
  const found = []
  for (const line of text.split('\n')) {
    const fields = line.split(':')
    if (fields[0] !== 'fpr') continue
    const fingerprint = (fields[COLONS_FINGERPRINT_FIELD] ?? '').toUpperCase()
    if (FINGERPRINT_PATTERN.test(fingerprint)) found.push(fingerprint)
  }
  return found
}

function isExecutableFile(candidate) {
  try {
    return statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** Resolve the gpg binary: the explicit path, else the first on PATH. */
export function findGpg(explicit) {
  if (explicit !== undefined && isExecutableFile(explicit)) return explicit
  if (explicit !== undefined) return
  const pathValue = process.env.PATH ?? ''
  const extensions =
    process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE').split(';') : ['']
  for (const dir of pathValue.split(path.delimiter)) {
    if (dir === '') continue
    for (const extension of extensions) {
      const candidate = path.join(dir, `gpg${extension.toLowerCase()}`)
      if (isExecutableFile(candidate)) return candidate
    }
  }
}

/**
Import a keyring into a throwaway home and list its fingerprints. The
import's own exit status is ignored on purpose: gpg reports failure
when its agent cannot start even though the keys imported (seen in a
sandbox without socket support). The listing afterwards is the verdict:
no fingerprints means nothing usable imported.
*/
export function listKeyringFingerprints({ keyringPath, gpgPath }) {
  if (!existsSync(keyringPath)) return { ok: false, error: `keyring not found: ${keyringPath}` }
  const home = mkdtempSync(path.join(tmpdir(), 'node-os-keyring-'))
  try {
    spawnSync(gpgPath, ['--batch', '--homedir', home, '--import', keyringPath], {
      encoding: 'utf8',
    })
    const listed = spawnSync(
      gpgPath,
      ['--batch', '--homedir', home, '--list-keys', '--with-colons'],
      { encoding: 'utf8' },
    )
    if (listed.status !== 0) {
      return { ok: false, error: `keyring listing failed: ${(listed.stderr ?? '').trim()}` }
    }
    const fingerprints = fingerprintsFromColons(listed.stdout ?? '')
    return fingerprints.length === 0
      ? { ok: false, error: 'keyring import failed: no keys imported' }
      : { ok: true, fingerprints }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

/** Whether the keyring carries every pinned fingerprint. */
export function checkFingerprints({ found, pinned }) {
  const missing = pinned.filter((fingerprint) => !found.includes(fingerprint))
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
