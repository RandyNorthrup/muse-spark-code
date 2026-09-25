#!/usr/bin/env node
// The SAST gate (`npm run security:sast`, PLAN.md §7): semgrep with the
// registry's `auto` rules, failing on any finding. semgrep comes from pip
// (`.github/semgrep/requirements.txt`), which on Windows installs it into
// the user's Python Scripts folder. A shell whose editor started before that
// folder joined PATH cannot see it, so when `semgrep` is not on PATH this
// asks each Python on PATH where its user scripts live and runs semgrep from
// there. CI installs semgrep on PATH and runs it directly.
//
//   npm run security:sast

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const SEMGREP = 'semgrep'
const SEMGREP_ARGS = [
  'scan',
  '--config',
  'auto',
  '--error',
  '--exclude=dist',
  '--exclude=coverage',
  '--exclude=node_modules',
  '--exclude=.vscode-test',
  '--exclude=.claude',
]
const PYTHONS = ['python', 'python3', 'py']
// Asks the interpreter for its user scheme's scripts folder (pip install --user).
const USER_SCRIPTS_QUERY =
  'import os, sysconfig; print(sysconfig.get_path("scripts", os.name + "_user"))'
const INSTALL_HINT = 'semgrep is not installed: pip install -r .github/semgrep/requirements.txt'
// semgrep prints Unicode that Windows' default console code page cannot encode.
const ENVIRONMENT = { ...process.env, PYTHONUTF8: '1' }

function run(command, environment = ENVIRONMENT) {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the command is `semgrep` or the semgrep executable found in a Python's user Scripts folder, the arguments are this script's own, and both go as an argument array with no shell (PLAN.md §8)
  return spawnSync(command, SEMGREP_ARGS, { stdio: 'inherit', env: environment })
}

/** semgrep in a Python's user Scripts folder, or undefined. */
function userScriptsSemgrep() {
  const executable = `${SEMGREP}${process.platform === 'win32' ? '.exe' : ''}`
  return PYTHONS.map((python) =>
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the interpreter is one of PYTHONS, a fixed list of names, and the query is this script's own constant, passed as an argument array with no shell (PLAN.md §8)
    spawnSync(python, ['-c', USER_SCRIPTS_QUERY], { encoding: 'utf8' }),
  )
    .filter((query) => query.status === 0 && query.stdout.trim() !== '')
    .map((query) => path.join(query.stdout.trim(), executable))
    .find((file) => existsSync(file))
}

let result = run(SEMGREP)
if (result.error?.code === 'ENOENT') {
  const found = userScriptsSemgrep()
  if (found === undefined) {
    console.error(INSTALL_HINT)
    process.exit(1)
  }
  console.log(`semgrep is not on PATH; running ${found}`)
  // semgrep starts its own helpers (pysemgrep) from the same folder by name.
  const folder = path.dirname(found)
  result = run(found, {
    ...ENVIRONMENT,
    PATH: `${folder}${path.delimiter}${process.env.PATH ?? ''}`,
  })
}
process.exit(result.status ?? 1)
