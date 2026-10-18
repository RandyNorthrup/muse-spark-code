// Native Node loader regressions run during packaging, after its production build.
// Each dist bundle loads once by import and once by require, then the test only
// enumerates the exports: the packaged bundle must expose exactly the freshly
// built baseline's names. Loading stays hermetic (no network; no host), and no
// bundle API is ever called, so nothing here emulates a service.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { test, after } from 'node:test'
import { pathToFileURL } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

function ignore() {
  // The load guard below has no external side effects.
}

const compare = (left, right) => left.localeCompare(right, 'en')

if (isMainThread) {
  const [kind, artifact] = process.argv.slice(2)
  assert.ok(['vsix', 'acp'].includes(kind) && artifact, 'pass vsix <stage> or acp <tarball>')
  const root = process.cwd()
  mkdirSync(path.join(root, 'temp'), { recursive: true })
  const scratch = mkdtempSync(path.join(root, 'temp', 'package-exports-'))
  after(() => rmSync(scratch, { recursive: true, force: true }))
  let packageRoot = path.resolve(artifact)
  if (kind === 'acp') {
    const archiveTar =
      process.platform === 'win32'
        ? path.join(process.env['SystemRoot'] ?? String.raw`C:\Windows`, 'System32', 'tar.exe')
        : 'tar'
    execFileSync(archiveTar, ['-xzf', packageRoot, '-C', scratch])
    packageRoot = path.join(scratch, 'package')
  }
  const files = readdirSync(path.join(packageRoot, 'dist'))
    .filter((file) => file.endsWith('.js'))
    .toSorted(compare)
  assert.ok(files.length > 0)
  function observe(file) {
    return new Promise((resolve, reject) => {
      let hasResult = false
      const worker = new Worker(new URL(import.meta.url), {
        workerData: { file },
        env: { LC_ALL: 'en_US.UTF-8' },
        stdout: true,
        stderr: true,
      })
      worker.stdout.resume()
      worker.stderr.resume()
      worker.once('error', reject)
      worker.once('message', async (result) => {
        hasResult = true
        try {
          await worker.terminate()
          resolve(result)
        } catch (error) {
          reject(error)
        }
      })
      worker.once('exit', (code) => {
        if (!hasResult) reject(new Error(`Loader worker exited ${code}: ${file}`))
      })
    })
  }
  for (const file of files) {
    test(`${kind} ${file}: native import and require retain baseline exports`, async () => {
      const [baseline, packaged] = await Promise.all([
        observe(path.join(root, 'dist', file)),
        observe(path.join(packageRoot, 'dist', file)),
      ])
      assert.deepEqual(packaged.imported, baseline.imported)
      assert.deepEqual(packaged.required, baseline.required)
    })
  }
} else {
  // The hermetic load guard: extension-host bundles resolve `vscode` to a
  // no-op namespace so they can load in bare Node, worker threads stay
  // detached, and any network use throws. The test only enumerates what the
  // load exposes; nothing here calls a bundle API.
  process.argv = [process.execPath, workerData.file, '--help']
  const noop = new Proxy(ignore, { get: () => noop })
  const load = Module._load
  Module._load = function (name, ...args) {
    if (name === 'vscode') return noop
    return name === 'node:worker_threads'
      ? { parentPort: undefined, workerData: undefined }
      : Reflect.apply(load, Module, [name, ...args])
  }
  Object.defineProperty(globalThis, 'fetch', {
    value() {
      throw new Error('Packaging regression must not use the network')
    },
  })
  const require = createRequire(workerData.file)
  const imported = await import(pathToFileURL(workerData.file).href)
  const required = require(workerData.file)
  parentPort.postMessage({
    imported: Object.keys(imported).toSorted(compare),
    required: Object.getOwnPropertyNames(required).toSorted(compare),
  })
}
