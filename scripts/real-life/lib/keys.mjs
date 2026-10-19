// Where the run's keys come from. A key is held in memory only, handed to the
// product on the standard input of the product's own command, and never
// printed, written to a file or put in a process argument.
//
// Sources (`--keys`):
//   dpapi:<folder>  Windows: <folder>/<name>.dpapi, a PowerShell secure
//                   string of this Windows user, decrypted by PowerShell
//                   itself and read from its standard output. Several
//                   folders are separated by a semicolon.
//   env             Any system: the variable REAL_LIFE_KEY_<NAME>, with the
//                   name in capitals and every other character as `_`. Set
//                   it in the shell that starts the run and nowhere else.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const NAME = /^[a-z0-9-]+$/u

/** The variable `env` reads a key from. */
export const keyVariable = (name) =>
  `REAL_LIFE_KEY_${name.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '_')}`

/**
 * What a source spells, or the reason it cannot be used.
 * @param {string} source `dpapi:<folder>` or `env`
 */
export function keySource(source) {
  if (source === 'env') return { kind: 'env' }
  if (source.startsWith('dpapi:') && source.length > 'dpapi:'.length) {
    const folders = source
      .slice('dpapi:'.length)
      .split(';')
      .filter((folder) => folder !== '')
      .map((folder) => path.resolve(folder))
    return { kind: 'dpapi', folders }
  }
  return { kind: 'invalid', reason: `--keys ${source}: use dpapi:<folder> or env` }
}

function dpapiKey(folders, name) {
  const file = folders
    .map((folder) => path.join(folder, `${name}.dpapi`))
    .find((candidate) => existsSync(candidate))
  if (file === undefined) return { reason: `no stored key named ${name}` }
  // The script names the file, never the key; the key comes back on a pipe.
  const script = [
    '$ErrorActionPreference = "Stop"',
    '$secure = Get-Content -LiteralPath $env:REAL_LIFE_KEY_FILE | ConvertTo-SecureString',
    '[Console]::Out.Write([System.Net.NetworkCredential]::new("", $secure).Password)',
  ].join('; ')
  const run = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: { ...process.env, REAL_LIFE_KEY_FILE: file },
    encoding: 'utf8',
    windowsHide: true,
  })
  const key = run.status === 0 ? run.stdout.trim() : ''
  return key === '' ? { reason: `the stored key ${name} could not be read` } : { key }
}

/**
 * The routes of a plan whose key the source does not hold, each with why.
 * A run with a requested route and no key for it stops before anything is
 * installed or sent, instead of recording the route as not run and
 * exiting 0. A Muse Code route takes no key.
 * @param {readonly { id: string, kind: string, stored?: string }[]} routes the plan's routes
 * @param {{ kind: string }} source what keySource() spelled
 * @returns {{ id: string, reason: string }[]}
 */
export function missingKeys(routes, source) {
  const missing = []
  const asked = new Set()
  for (const route of routes) {
    if (route.kind === 'museCode' || route.stored === undefined || asked.has(route.stored)) {
      continue
    }
    asked.add(route.stored)
    const read = readKey(source, route.stored)
    if (read.key === undefined) missing.push({ id: route.id, reason: read.reason })
  }
  return missing
}

/**
 * The key a source holds under a name.
 * @returns {{ key: string } | { reason: string }}
 */
export function readKey(source, name) {
  if (!NAME.test(name)) return { reason: `not a key name: ${name}` }
  if (source.kind === 'dpapi') return dpapiKey(source.folders, name)
  if (source.kind === 'env') {
    const key = process.env[keyVariable(name)] ?? ''
    return key === '' ? { reason: `${keyVariable(name)} is not set` } : { key }
  }
  return { reason: 'no key source' }
}
