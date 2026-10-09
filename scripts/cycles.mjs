#!/usr/bin/env node
// The dependency-cycle gate (`npm run cycles`): dpdm over every root in
// scripts/cycles.json, with the options listed there, exiting with dpdm's own
// status (1 when it finds a cycle).
//
// The roots used to sit on the npm script's command line. On Windows npm runs
// a script through cmd.exe, and node_modules/.bin/dpdm.cmd re-expands every
// argument into one line of its own, which cmd.exe refuses past 8,191
// characters ("The syntax of the command is incorrect.", exit 255;
// CIFIX017W2). Here node starts dpdm's CLI directly, with no shell: the
// patterns reach dpdm unexpanded, as they did quoted on the command line, and
// dpdm expands them itself.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const { options, roots } = JSON.parse(
  readFileSync(path.join(ROOT, 'scripts', 'cycles.json'), 'utf8'),
)
// import.meta.resolve, so the dead-code gate sees dpdm in use.
const manifestPath = fileURLToPath(import.meta.resolve('dpdm/package.json'))
const cli = path.join(
  path.dirname(manifestPath),
  JSON.parse(readFileSync(manifestPath, 'utf8')).bin.dpdm,
)
const result = spawnSync(process.execPath, [cli, ...options, ...roots], {
  cwd: ROOT,
  stdio: 'inherit',
})
if (result.error !== undefined) throw result.error
if (result.status === null) console.error(`dpdm ended by ${String(result.signal)}`)
process.exitCode = result.status ?? 1
