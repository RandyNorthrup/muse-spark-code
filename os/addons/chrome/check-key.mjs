#!/usr/bin/env node
// M110os OS7: the package-key check for the Chrome add-on.
// node os/addons/chrome/check-key.mjs --keyring <file> --fingerprints <file> [--gpg <path>]
// node os/addons/chrome/check-key.mjs --transcript <colons-file> --fingerprints <file>
// Exits 0 when the keyring carries every pinned fingerprint, 1 on a
// mismatch, 2 on a usage, input or tool error.
import { readFileSync } from 'node:fs'
import {
  checkFingerprints,
  findGpg,
  fingerprintsFromColons,
  listKeyringFingerprints,
  parseFingerprintsFile,
} from './lib/checkKey.mjs'

function usage() {
  console.log(
    [
      'usage: check-key.mjs --keyring <file> --fingerprints <file> [--gpg <path>]',
      '   or: check-key.mjs --transcript <colons-file> --fingerprints <file>',
      'exit 0: the keyring carries every pinned fingerprint',
      'exit 1: a pinned fingerprint is missing',
      'exit 2: usage, input or tool error',
    ].join('\n'),
  )
}

function args() {
  const values = {}
  const flags = process.argv.slice(2)
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--help') return { help: true }
    if (
      flag !== '--keyring' &&
      flag !== '--transcript' &&
      flag !== '--fingerprints' &&
      flag !== '--gpg'
    ) {
      return { error: `unknown flag: ${flag ?? '(missing)'}` }
    }
    const value = flags[index + 1]
    if (value === undefined || value.startsWith('--')) return { error: `missing value: ${flag}` }
    values[flag.slice(2)] = value
    index += 1
  }
  return { values }
}

const parsed = args()
if ('help' in parsed) {
  usage()
  process.exit(0)
}
if ('error' in parsed) {
  console.error(`check-key: ${parsed.error}`)
  process.exit(2)
}
const { keyring, transcript, fingerprints, gpg } = parsed.values
if ((keyring === undefined) === (transcript === undefined)) {
  console.error('check-key: pass exactly one of --keyring and --transcript')
  process.exit(2)
}
if (fingerprints === undefined) {
  console.error('check-key: pass --fingerprints <file>')
  process.exit(2)
}
let pinned
try {
  pinned = parseFingerprintsFile(readFileSync(fingerprints, 'utf8'))
} catch {
  console.error(`check-key: fingerprints not readable: ${fingerprints}`)
  process.exit(2)
}
if (!pinned.ok) {
  console.error(`check-key: ${pinned.error}`)
  process.exit(2)
}

let found
if (transcript === undefined) {
  const gpgPath = findGpg(gpg)
  if (gpgPath === undefined) {
    console.error('check-key: gpg not found; pass --gpg <path>')
    process.exit(2)
  }
  const listed = listKeyringFingerprints({ keyringPath: keyring, gpgPath })
  if (!listed.ok) {
    console.error(`check-key: ${listed.error}`)
    process.exit(2)
  }
  found = listed.fingerprints
} else {
  let text
  try {
    text = readFileSync(transcript, 'utf8')
  } catch {
    console.error(`check-key: transcript not readable: ${transcript}`)
    process.exit(2)
  }
  found = fingerprintsFromColons(text)
}

const checked = checkFingerprints({ found, pinned: pinned.fingerprints })
if (!checked.ok) {
  console.error(`check-key: missing pinned fingerprint: ${checked.missing.join(', ')}`)
  process.exit(1)
}
console.log(
  `check-key: the keyring carries all ${String(pinned.fingerprints.length)} pinned fingerprints`,
)
