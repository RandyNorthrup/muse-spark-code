// M110os OS5: the fingerprint checks every add-on shares. A pinned
// fingerprints file names the vendor keys an install keyring must carry;
// anything else refuses. Node builtins only, so the device and CI run it
// bare.
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

/** Whether the keyring carries every pinned fingerprint. */
export function checkFingerprints({ found, pinned }) {
  const missing = pinned.filter((fingerprint) => !found.includes(fingerprint))
  return missing.length === 0 ? { ok: true } : { ok: false, missing }
}
