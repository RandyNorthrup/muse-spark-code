#!/usr/bin/env node
// M110os OS6: the reproducibility comparison.
// node scripts/os-repro-check.mjs --record DIR --out FILE
// node scripts/os-repro-check.mjs --check DIR --against FILE
// node scripts/os-repro-check.mjs --compare DIR-A DIR-B
// Exits 0 on a match, 1 on any divergence (every one is named), 2 on
// a usage or input error.
import { readFileSync, writeFileSync } from 'node:fs'
import { compareMaps, parseRecord, recordTree } from './lib/osReproCheck.mjs'

function usage() {
  console.log(
    [
      'usage: os-repro-check.mjs --record DIR --out FILE',
      '   or: os-repro-check.mjs --check DIR --against FILE',
      '   or: os-repro-check.mjs --compare DIR-A DIR-B',
      'exit 0: identical',
      'exit 1: divergences, every one named',
      'exit 2: usage or input error',
    ].join('\n'),
  )
}

function args() {
  const values = {}
  const positionals = []
  const flags = process.argv.slice(2)
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    if (flag === '--help') return { help: true }
    if (typeof flag === 'string' && ['--record', '--out', '--check', '--against'].includes(flag)) {
      const value = flags[index + 1]
      if (value === undefined || value.startsWith('--')) return { error: `missing value: ${flag}` }
      values[flag.slice(2)] = value
      index += 1
    } else if (flag === '--compare') {
      values.compare = true
    } else if (flag !== undefined && !flag.startsWith('--')) {
      positionals.push(flag)
    } else {
      return { error: `unknown flag: ${flag ?? '(missing)'}` }
    }
  }
  return { values, positionals }
}

function recordCommand(dir, out) {
  if (dir === undefined || out === undefined) {
    console.error('os-repro-check: --record needs DIR and --out FILE')
    process.exit(2)
  }
  const recorded = recordTree(dir)
  if (!recorded.ok) {
    console.error(`os-repro-check: ${recorded.error}`)
    process.exit(2)
  }
  writeFileSync(out, `${JSON.stringify({ files: recorded.files }, null, 2)}\n`)
  const count = Object.keys(recorded.files).length
  console.log(`os-repro-check: recorded ${String(count)} files from ${dir}`)
}

function readRecord(file) {
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    console.error(`os-repro-check: record not readable: ${file}`)
    process.exit(2)
  }
  const parsed = parseRecord(text)
  if (!parsed.ok) {
    console.error(`os-repro-check: ${parsed.error}: ${file}`)
    process.exit(2)
  }
  return parsed.files
}

function report(divergences) {
  if (divergences.length === 0) {
    console.log('os-repro-check: identical')
    return
  }
  for (const divergence of divergences) console.error(`os-repro-check: ${divergence}`)
  process.exit(1)
}

const parsed = args()
if ('help' in parsed) {
  usage()
  process.exit(0)
}
if ('error' in parsed) {
  console.error(`os-repro-check: ${parsed.error}`)
  process.exit(2)
}
const { values, positionals } = parsed
const modes = [values.record !== undefined, values.check !== undefined, values.compare === true]
if (modes.filter(Boolean).length !== 1) {
  console.error('os-repro-check: pass exactly one of --record, --check and --compare')
  process.exit(2)
}
const mode =
  values.record === undefined ? (values.check === undefined ? 'compare' : 'check') : 'record'
if (mode === 'record') {
  if (positionals.length > 0 || values.check !== undefined || values.against !== undefined) {
    console.error('os-repro-check: --record takes only --out')
    process.exit(2)
  }
  recordCommand(values.record, values.out)
} else if (mode === 'check') {
  if (positionals.length > 0 || values.out !== undefined || values.against === undefined) {
    console.error('os-repro-check: --check needs exactly --against')
    process.exit(2)
  }
  const recorded = recordTree(values.check)
  if (!recorded.ok) {
    console.error(`os-repro-check: ${recorded.error}`)
    process.exit(2)
  }
  report(compareMaps(readRecord(values.against), recorded.files))
} else {
  if (
    positionals.length !== 2 ||
    values.out !== undefined ||
    values.against !== undefined ||
    values.record !== undefined ||
    values.check !== undefined
  ) {
    console.error('os-repro-check: --compare needs exactly DIR-A DIR-B')
    process.exit(2)
  }
  const [left = '', right = ''] = positionals
  const recordedLeft = recordTree(left)
  if (!recordedLeft.ok) {
    console.error(`os-repro-check: ${recordedLeft.error}`)
    process.exit(2)
  }
  const recordedRight = recordTree(right)
  if (!recordedRight.ok) {
    console.error(`os-repro-check: ${recordedRight.error}`)
    process.exit(2)
  }
  report(compareMaps(recordedLeft.files, recordedRight.files))
}
