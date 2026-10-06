// Native Node loader regressions run during packaging, after its production build.
// Workers isolate CLI/host state; all services are fake and no model call is made.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import { test, after } from 'node:test'
import { pathToFileURL } from 'node:url'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'

function ignore() {
  // Fake services have no external side effects.
}

const compare = (left, right) => left.localeCompare(right, 'en')

async function exercise(api, name, table) {
  switch (name) {
    case 'hookRuntime.js': {
      return api.parseElicitationParams({ message: 'Who?', requestedSchema: {} })
    }
    case 'foreignHooks.js': {
      const adapter = api.createForeignHookAdapter({ workspaceRoot: '/fake', platform: 'linux' })
      adapter.dispose()
      return typeof adapter.prepare
    }
    case 'reviewer.js': {
      const rows = []
      const result = await api.reviewPaidCall(
        {
          table,
          locale: 'en',
          userRequest: 'Inspect',
          recentCalls: [],
          resolved: {
            policy: {
              identity: { provider: 'meta', nativeModel: 'muse-spark-1.3' },
              output: {},
            },
          },
          keyed: (body) => body,
          guard: () => ignore,
          isRefused: () => false,
          breaker: { record: () => false },
          record: (row) => {
            rows.push(row)
          },
          emit: ignore,
          deps: {
            newId: () => 'fake-review',
            now: () => 1,
            workspaceRoot: '/fake',
            platform: 'linux',
            log: { warn: ignore },
            client: {
              streamResponse() {
                throw new Error('fake reviewer unavailable')
              },
            },
          },
        },
        'shell',
        'pwd',
        'fake-turn',
        new globalThis.AbortController().signal,
        { modelId: 'muse-spark-1.3' },
        undefined,
        () => true,
      )
      return { result, rows }
    }
    case 'sessionBoard.js': {
      return await api.readSessionBoard(
        {
          ensureHost: async () => ({}),
          backendOf: () => 'modelApi',
          workspaceRoot: undefined,
          platform: 'linux',
          pendingPrompts: { pendingSessionIds: () => new Set() },
          liveSessions: [{ sessionId: 'fake-session', backend: 'modelApi', status: 'idle' }],
        },
        table,
        'en',
      )
    }
    case 'report.js': {
      const errors = []
      const handler = api.createReportProblemHandler(
        {
          onReportWebviewError: (error) => {
            errors.push(error)
          },
        },
        table,
        'en',
      )
      await handler.handle({ type: 'reportWebviewError', message: 'fake failure' })
      return errors
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
    execFileSync('tar', ['-xzf', packageRoot, '-C', scratch])
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
      const baseline = await observe(path.join(root, 'dist', file))
      const packaged = await observe(path.join(packageRoot, 'dist', file))
      assert.deepEqual(packaged, baseline)
      assert.deepEqual(packaged.importCall, packaged.requireCall)
    })
  }
} else {
  // The real CLI entry takes its help path; neither auth nor backend setup runs.
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
  const table = require(path.join(path.dirname(workerData.file), 'uiText.js')).EN
  parentPort.postMessage({
    imported: Object.keys(imported).toSorted(compare),
    required: Object.getOwnPropertyNames(required).toSorted(compare),
    importCall: await exercise(imported, path.basename(workerData.file), table),
    requireCall: await exercise(required, path.basename(workerData.file), table),
  })
}
