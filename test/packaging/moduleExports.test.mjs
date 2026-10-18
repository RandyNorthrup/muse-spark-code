// Native Node loader regressions run during packaging, after its production build.
// Workers isolate CLI/host state; the remaining calls drive real schemas and
// parsers with data, and no model call is made. Nothing intercepts the loader
// and no module is substituted: a bundle bare Node rejects, or one that boots
// a worker protocol instead of exporting, compares as the identical refusal
// on both sides. The throwing fetch is a network guard: it fails any network
// use instead of answering it.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
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
        undefined,
        true,
        new globalThis.AbortController().signal,
        'Přehled, nikoli právní rada.',
      )
      assert.equal(legal.ok, false)
      assert.equal(legal.isRestricted, false)
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
    test(`${kind} ${file}: packaged bundle matches the baseline bundle`, async () => {
      const [baseline, packaged] = await Promise.all([
        observe(path.join(root, 'dist', file)),
        observe(path.join(packageRoot, 'dist', file)),
      ])
      assert.deepEqual(packaged, baseline)
      if (packaged.kind === 'library') {
        assert.deepEqual(packaged.importCall, packaged.requireCall)
      }
    })
  }
} else {
  // The real CLI entry takes its help path; neither auth nor backend setup runs.
  process.argv = [process.execPath, workerData.file, '--help']
  // Worker entries boot their job protocol on a real thread instead of
  // exporting (their entries are named in scripts/build.mjs); each runs
  // jobless here and answers its own refusal over the thread protocol.
  const workerEntries = new Set(['imageResizeWorker.js', 'pageWorker.js', 'searchWorker.js'])
  const scrubRoot = (value) =>
    String(value ?? '')
      .split(path.dirname(workerData.file))
      .join('<dist>')
      .split(process.cwd())
      .join('<root>')
  const headlineOf = (error) => scrubRoot(error?.message).split('\n', 1)[0]
  async function loadLibrary(file) {
    let imported
    try {
      imported = await import(pathToFileURL(file).href)
    } catch (error) {
      const failure = { code: error?.code, headline: headlineOf(error) }
      try {
        createRequire(file)(file)
        return { kind: 'hostModule', import: failure, require: { loaded: true } }
      } catch (requireError) {
        return {
          kind: 'hostModule',
          import: failure,
          require: { code: requireError?.code, headline: headlineOf(requireError) },
        }
      }
    }
    const require = createRequire(file)
    const required = require(file)
    const table = require(path.join(path.dirname(file), 'uiText.js')).EN
    return {
      kind: 'library',
      imported: Object.keys(imported).toSorted(compare),
      required: Object.getOwnPropertyNames(required).toSorted(compare),
      importCall: await exercise(imported, path.basename(file), table),
      requireCall: await exercise(required, path.basename(file), table),
    }
  }
  function bootWorkerEntry(file) {
    return new Promise((resolve) => {
      const nested = new Worker(file)
      let isSettled = false
      const settle = async (boot) => {
        if (isSettled) return
        isSettled = true
        nested.removeAllListeners()
        try {
          await nested.terminate()
        } catch {
          // The thread is already gone; its refusal was already recorded.
        }
        resolve({ kind: 'workerBoot', boot })
      }
      nested.once('message', (message) => settle({ posted: message }))
      nested.once('error', (error) => settle({ error: headlineOf(error) }))
      nested.once('exit', (code) => settle({ exit: code }))
    })
  }
  Object.defineProperty(globalThis, 'fetch', {
    value() {
      throw new Error('Packaging regression must not use the network')
    },
  })
  parentPort.postMessage(
    workerEntries.has(path.basename(workerData.file))
      ? await bootWorkerEntry(workerData.file)
      : await loadLibrary(workerData.file),
  )
}
