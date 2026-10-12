// The artefact, installed the way a person installs it: `npm install` of the
// packed file into a new, empty folder. The run then starts the file the
// package itself names as its command.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

export const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const quoted = (text) => `"${text.replaceAll('"', String.raw`\"`)}"`

/**
 * @param {string} tarball the packed agent (`npm pack`'s output)
 * @param {string} folder a new, empty folder
 * @returns {{ ok: true, name: string, version: string, agent: string } | { ok: false, reason: string }}
 */
export function installArtefact(tarball, folder) {
  // One shell line: on Windows npm is a command script, which only a shell starts.
  const run = spawnSync(
    `npm install --no-audit --no-fund --prefix ${quoted(folder)} ${quoted(path.resolve(tarball))}`,
    { shell: true, encoding: 'utf8', cwd: folder, windowsHide: true },
  )
  if (run.status !== 0) {
    return { ok: false, reason: `npm install failed (exit ${String(run.status)}): ${run.stderr}` }
  }
  const installed = JSON.parse(readFileSync(path.join(folder, 'package.json'), 'utf8'))
  const [name] = Object.keys(installed.dependencies ?? {})
  if (name === undefined) return { ok: false, reason: 'npm installed no package' }
  const root = path.join(folder, 'node_modules', name)
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : Object.values(manifest.bin ?? {})[0]
  return typeof bin === 'string'
    ? { ok: true, name, version: String(manifest.version), agent: path.join(root, bin) }
    : { ok: false, reason: `${name} names no command` }
}
