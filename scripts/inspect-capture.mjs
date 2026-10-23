// Per-program B1 capture on a real machine: builds the confine helper the
// way the tests do (or takes a built one with --helper), runs every started
// program of the grammar's table once through it, and prints one row per
// program. Usage:
//   node scripts/inspect-capture.mjs [--helper <path>] [--json <file>]
// `--helper` also accepts a helper built from the pre-round-1 source (see
// docs/certification/m125-f1a.md for the exact build commands), so the
// original failure can be reproduced or shown not to reproduce.
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { capturePrograms, formatCapture, normaliseCaptureText } from './lib/inspectCapture.mjs'

function usage() {
  return 'usage: node scripts/inspect-capture.mjs [--helper <path>] [--json <file>]'
}

function argument(flag, args) {
  const index = args.indexOf(flag)
  if (index === -1) return
  const value = args[index + 1]
  if (value === undefined) throw new Error(`${usage()}: ${flag} needs a value`)
  if (value.startsWith('--')) throw new Error(`${usage()}: ${flag} needs a value`)
  return value
}

const args = process.argv.slice(2)
for (const word of args) {
  if (word !== '--helper' && word !== '--json' && word.startsWith('--'))
    throw new Error(`${usage()}: unknown flag ${word}`)
}
const helperFlag = argument('--helper', args)
const jsonFlag = argument('--json', args)

let helper = helperFlag
if (helper === undefined) {
  const { buildConfine } = await import('./build-confine.mjs')
  const directory = mkdtempSync(path.join(os.tmpdir(), 'inspect-capture-helper-'))
  helper = await buildConfine(directory)
}
// The helper runs with the scratch workspace as its working directory, so a
// relative --helper path must be resolved before the capture starts.
helper = path.resolve(helper)
if (existsSync(helper)) {
  const { root, rows } = capturePrograms(helper, {})
  const replacements = [root]
  const header = normaliseCaptureText(
    `helper: ${helper}\ncaptured: ${new Date().toISOString()}\nplatform: ${process.platform} ${process.arch}\n`,
    replacements,
  )
  process.stdout.write(`${header}${formatCapture(rows, replacements)}\n`)
  if (jsonFlag !== undefined) {
    writeFileSync(
      jsonFlag,
      `${JSON.stringify({ helper: normaliseCaptureText(helper, replacements), rows }, null, 2)}\n`,
    )
  }
} else {
  process.stderr.write(`inspect-capture: helper not found: ${helper}\n`)
  process.exitCode = 2
}
