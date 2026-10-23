#!/usr/bin/env node
// M110os OS5: the base-firmware check.
// node os/firmware/check-firmware.mjs --firmware <firmware.json>
//   [--snapshot-base <https-url>] [--transcript-dir <dir>] [--json]
// Exits 0 when every package resolves, 1 when a package is unknown,
// 2 on a usage, shape, input or tool error.
import { readFileSync } from 'node:fs'
import { parseFirmwareFile, resolvePackage } from './lib/checkFirmware.mjs'

function usage() {
  console.log(
    [
      'usage: check-firmware.mjs --firmware <firmware.json> [--snapshot-base <https-url>] [--transcript-dir <dir>] [--json]',
      'exit 0: every package resolves',
      'exit 1: a package is unknown',
      'exit 2: usage, shape, input or tool error',
    ].join('\n'),
  )
}

function args() {
  const values = {}
  const flags = process.argv.slice(2)
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--help') return { help: true }
    if (flag === '--json') {
      values.json = true
      continue
    }
    if (flag !== '--firmware' && flag !== '--snapshot-base' && flag !== '--transcript-dir') {
      return { error: `unknown flag: ${flag ?? '(missing)'}` }
    }
    const value = flags[index + 1]
    if (value === undefined || value.startsWith('--')) return { error: `missing value: ${flag}` }
    const name = flag.slice(2).replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    values[name] = value
    index += 1
  }
  return { values }
}

function httpsBase(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.origin : ''
  } catch {
    return ''
  }
}

const parsed = args()
if ('help' in parsed) {
  usage()
  process.exit(0)
}
if ('error' in parsed) {
  console.error(`check-firmware: ${parsed.error}`)
  process.exit(2)
}
const { firmware, snapshotBase, transcriptDir, json } = parsed.values
if (firmware === undefined) {
  console.error('check-firmware: pass --firmware <firmware.json>')
  process.exit(2)
}
let text
try {
  text = readFileSync(firmware, 'utf8')
} catch {
  console.error(`check-firmware: firmware file not readable: ${firmware}`)
  process.exit(2)
}
const firmwareFile = parseFirmwareFile(text)
if (!firmwareFile.ok) {
  console.error(`check-firmware: ${firmwareFile.error}`)
  process.exit(2)
}
const DEFAULT_SNAPSHOT_BASE = 'https://snapshot.debian.org'
const base = transcriptDir === undefined ? httpsBase(snapshotBase ?? DEFAULT_SNAPSHOT_BASE) : ''
if (transcriptDir === undefined && base === '') {
  console.error('check-firmware: --snapshot-base must be an https URL')
  process.exit(2)
}
const resolved = {}
for (const name of firmwareFile.names) {
  const found = await resolvePackage(name, { snapshotBase: base, transcriptDir })
  if (!found.ok && found.kind === 'tool') {
    console.error(`check-firmware: ${found.error}`)
    process.exit(2)
  }
  if (!found.ok) {
    console.error(`check-firmware: ${found.error}`)
    process.exit(1)
  }
  resolved[name] = {
    source: found.source,
    versions: found.versions.length,
    first: found.versions[0],
  }
}
if (json === true) {
  console.log(JSON.stringify(resolved, null, 2))
} else {
  console.log(`check-firmware: all ${String(firmwareFile.names.length)} packages resolve`)
}
