// The artefact, installed the way a person installs it: `npm install` of the
// packed file into a new, empty folder. The run then starts the file the
// package itself names as its command.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const sha256Of = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const NPM_CLI = 'npm-cli.js'

/**
 * npm's own command script: the one that started this run (`npm run
 * real-life`), or the one that ships beside this Node.
 * @returns {string | undefined}
 */
function npmScript() {
  const started = process.env.npm_execpath ?? ''
  const beside = path.dirname(process.execPath)
  return [
    ...(path.basename(started) === NPM_CLI ? [started] : []),
    path.join(beside, 'node_modules', 'npm', 'bin', NPM_CLI),
    path.join(beside, '..', 'lib', 'node_modules', 'npm', 'bin', NPM_CLI),
  ].find((candidate) => existsSync(candidate))
}

/** Runs npm with no shell: its command script under this Node, or the `npm` program itself. */
function npm(args, cwd) {
  const script = npmScript()
  const options = { encoding: 'utf8', cwd, windowsHide: true }
  if (script !== undefined) return spawnSync(process.execPath, [script, ...args], options)
  // On Windows `npm` is a command script, which only a shell starts: without
  // npm's own script there is nothing this run may start.
  return process.platform === 'win32'
    ? { status: null, stderr: 'npm was not found beside Node' }
    : spawnSync('npm', args, options)
}

/**
 * @param {string} tarball the packed agent (`npm pack`'s output)
 * @param {string} folder a new, empty folder
 * @returns {{ ok: true, name: string, version: string, agent: string } | { ok: false, reason: string }}
 */
export function installArtefact(tarball, folder) {
  const run = npm(
    ['install', '--no-audit', '--no-fund', '--prefix', folder, path.resolve(tarball)],
    folder,
  )
  if (run.status !== 0) {
    return {
      ok: false,
      reason: `npm install failed (exit ${String(run.status)}): ${String(run.stderr ?? run.error?.message ?? '')}`,
    }
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
