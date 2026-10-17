// Native Node loader regressions run during packaging, after its production build.
// Workers isolate CLI/host state; the remaining calls drive real schemas and
// parsers with data, and no model call is made. The worker's Module._load trap
// for 'vscode' and the throwing fetch are load isolation only: VS Code-bound
// bundles must import in bare Node, and no exercised call reaches them.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { test, after } from 'node:test'
import { pathToFileURL } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

const compare = (left, right) => left.localeCompare(right, 'en')

async function exercise(api, name, table) {
  switch (name) {
    case 'modelApiBoundaries.js': {
      const valid = api.inputTokensSchema.safeParse({ input_tokens: 1 }).success
      const invalid = api.inputTokensSchema.safeParse({ input_tokens: -1 }).success
      assert.equal(valid, true)
      assert.equal(invalid, false)
      const decision = api.decideTeamConversationMode({ teamSwitchOn: false })
      assert.deepEqual(decision, { mode: 'single-model', reason: 'team-off' })
      const legal = await api.runLegalScanCall(
        {},
        async () => ({
          version: 1,
          ruleVersion: 'fixture',
          dataVersion: 'fixture',
          scope: '',
          distribution: 'fixture',
          exclusions: [],
          incompleteChecks: [],
          findings: [],
        }),
        true,
        new globalThis.AbortController().signal,
        'Přehled, nikoli právní rada.',
      )
      assert.equal(legal.ok, true)
      assert.equal(JSON.parse(legal.json).disclaimer, 'Přehled, nikoli právní rada.')
      const detail = `fixture: ${table.teamInPlaceOrchestratorRefused}`
      const refusal = api.teamInPlaceRefusalFor({
        name: 'shell',
        capability: 'shell',
        isExternalWriter: false,
        isUnknownMcp: false,
        detail,
      })
      assert.equal(refusal.visibleOutput, detail)
      return { valid, invalid, decision, refusal }
    }
    case 'hookRuntime.js': {
      return api.parseElicitationParams({ message: 'Who?', requestedSchema: {} })
    }
    case 'pluginHooks.js': {
      return api.pluginAnswer(
        'amp',
        'PreToolUse',
        {
          status: 'completed',
          replacement: { target: 'toolResult', value: { output: 'fake' } },
        },
        { tool_name: 'shell', tool_input: { command: 'pwd' } },
      )
    }
    case 'modelApiTools.js': {
      const passed = api.checkPageUrl('https://Docs.Example.com/a/b?x=1#part')
      assert.equal(passed.ok, true)
      const refused = api.checkPageUrl('http://localhost/')
      assert.equal(refused.ok, false)
      return { ok: passed.ok, refusedOk: refused.ok }
    }
    default: {
      return
    }
  }
}

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
    test(`${kind} ${file}: native import and require retain baseline exports and calls`, async () => {
      const [baseline, packaged] = await Promise.all([
        observe(path.join(root, 'dist', file)),
        observe(path.join(packageRoot, 'dist', file)),
      ])
      assert.deepEqual(packaged, baseline)
      assert.deepEqual(packaged.importCall, packaged.requireCall)
    })
  }
} else {
  // The real CLI entry takes its help path; neither auth nor backend setup runs.
  process.argv = [process.execPath, workerData.file, '--help']
  // Load isolation only (PLAN §8): VS Code-bound bundles must import in bare
  // Node so every dist file's exports can be compared. No exercised call
  // below reaches the trap: the remaining branches drive real schemas and
  // parsers whose sources never import 'vscode'.
  const inert = () => undefined
  // eslint-disable-next-line no-restricted-syntax -- load isolation, PLAN §8.
  const noop = new Proxy(inert, { get: () => noop })
  const load = Module._load
  // eslint-disable-next-line no-restricted-syntax -- load isolation, PLAN §8.
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
  const table = require(path.join(path.dirname(workerData.file), 'uiText.js')).EN
  parentPort.postMessage({
    imported: Object.keys(imported).toSorted(compare),
    required: Object.getOwnPropertyNames(required).toSorted(compare),
    importCall: await exercise(imported, path.basename(workerData.file), table),
    requireCall: await exercise(required, path.basename(workerData.file), table),
  })
}
