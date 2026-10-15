// `exec --model X --effort Y` checks Y against the levels of X, the model the
// run selected, not against the levels of the model the session started on.
// The real `runExec` runs over the real Model API backend bundle, the real
// ACP agent and the real command-line parser; only the outside world is
// replaced: the provider's model list (a fetch that answers `GET /models`;
// any other request is a failure of this case) and the credential store (a
// map holding a throwaway key). No model call is made or possible.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { runExec, type ExecDeps } from '../../src/runtime/exec/runExec'
import { memorySecretStore } from '../../src/runtime/exec/keyInput'
import { EXEC_EXIT, UI_TEXT } from '../../src/shared/constants'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { removeFolder } from './helpers/temporaryFolders'

const KEY = 'LLM|1|throwaway'
const folders: string[] = []
function folder(): string {
  const created = mkdtempSync(path.join(tmpdir(), 'exec-options-'))
  folders.push(created)
  return created
}
const dist = folder()
beforeAll(async () => {
  await buildModelApiBundle(dist)
  mkdirSync(dist, { recursive: true })
  writeFileSync(
    path.join(dist, 'providerCatalog.json'),
    readFileSync('vendor/models-dev/snapshot.json'),
  )
})
afterAll(async () => {
  await Promise.all(folders.map((created) => removeFolder(created)))
})

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input)
  return input instanceof URL ? input : new URL(input.url)
}

function ignoreSignals(): undefined {
  return undefined
}
function noSignals(): () => undefined {
  return ignoreSignals
}

/** The provider: it lists two Meta models and refuses everything else. */
function providerFetch(requested: string[]): typeof fetch {
  return (input, init) => {
    const url = requestUrl(input)
    requested.push(`${init?.method ?? 'GET'} ${url.pathname}`)
    if (url.pathname.endsWith('/models')) {
      return Promise.resolve(
        Response.json({
          object: 'list',
          data: ['muse-spark-1.3', 'muse-spark-1.2'].map((id) => ({ id, object: 'model' })),
        }),
      )
    }
    return Promise.reject(new Error(`this case sends no request to ${url.pathname}`))
  }
}

function sink() {
  const chunks: string[] = []
  return {
    chunks,
    write: (chunk: string) => {
      chunks.push(chunk)
    },
    queuedBytes: 0,
    isClosed: false,
    flush: () => Promise.resolve(true),
  }
}

async function exec(flags: readonly string[]) {
  const parsed = parseCommandLine([
    'exec',
    '--backend',
    'modelApi',
    '--max-budget-usd',
    '1',
    '--output',
    'jsonl',
    ...flags,
    'task',
  ])
  if (parsed.command !== 'exec') throw new Error('not an exec command line')
  const requested: string[] = []
  const stderr = sink()
  const life = createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: 120_000,
    now: Date.now,
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onSignal: noSignals,
    forceFinish: () => undefined,
    exit: (): never => {
      throw new Error('exit')
    },
  })
  const deps: ExecDeps = {
    options: parsed.options,
    version: 'test',
    distDir: dist,
    platform: process.platform,
    env: {},
    homeDir: folder(),
    processCwd: folder(),
    stdin: new PassThrough(),
    stdout: sink(),
    stderr,
    storeSecrets: memorySecretStore(KEY),
    runGit: () => Promise.resolve(''),
    fetch: providerFetch(requested),
    sleep: () => Promise.resolve(),
    now: Date.now,
    readFile: () => Promise.reject(new Error('no file is read in this case')),
    randomHex: () => '123456789abcdef0',
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  }
  try {
    const code = await runExec(life, deps)
    return { code, stderr: stderr.chunks.join(''), requested }
  } finally {
    life.dispose()
  }
}

describe('exec checks --effort against the selected model (R8)', () => {
  it('refuses max for muse-spark-1.2 as a usage error, before any request but the model list', async () => {
    // The session starts on muse-spark-1.3, which serves `max`; the run
    // selects muse-spark-1.2, which does not. Checked against the first
    // listing, `max` was passed on and the run ended as an incomplete turn.
    const run = await exec(['--model', 'muse-spark-1.2', '--effort', 'max'])
    expect(run.code).toBe(EXEC_EXIT.usage)
    expect(run.stderr).toContain(UI_TEXT.execEffortUnavailable)
    expect(run.requested.every((request) => request.endsWith('/models'))).toBe(true)
  })

  it('accepts xhigh for muse-spark-1.2, which it serves', async () => {
    const run = await exec(['--model', 'muse-spark-1.2', '--effort', 'xhigh'])
    expect(run.stderr).not.toContain(UI_TEXT.execEffortUnavailable)
    expect(run.code).not.toBe(EXEC_EXIT.usage)
  })
})
