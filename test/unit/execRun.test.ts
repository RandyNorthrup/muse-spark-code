import {
  constants as fileFlags,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  writeFileSync,
  symlinkSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { open, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'
import { handleIdentity, lstatIdentity as lstat } from '../../src/core/fs/fileIdentity'
import * as runtimeBackends from '../../src/runtime/backends'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildSync } from 'esbuild'
import * as acp from '@agentclientprotocol/sdk'
import { runExec, type ExecDeps, type ExecOutputSchemaPort } from '../../src/runtime/exec/runExec'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import {
  validateResult,
  type ExecEvent,
  type ExecResult,
} from '../../src/runtime/exec/execProtocol'
import { EXEC_PROMPT_MAX_BYTES, SECRET_KEYS, UI_TEXT } from '../../src/shared/constants'
import { paidGrantsFile, workspaceSessionsFolder } from '../../src/runtime/dataFolder'
import { memorySecrets } from './helpers/fakes'
import {
  fakeModelApi,
  FAKE_MODEL_API_KEY,
  streamFor,
  type ScriptedReply,
} from './helpers/fakeModelApi'
import { buildModelApiBundle } from './helpers/modelApiBundle'
import { outputWriter } from './helpers/execContract'
import { removeFolder } from './helpers/temporaryFolders'
import { acpMspHost } from './helpers/acpMsp'
import { createExecClient } from '../../src/runtime/exec/execClient'
import {
  createExecSink,
  validateSchemaEvent,
  validateSchemaResult,
} from '../../src/runtime/exec/execOutput'
import { compileOutputSchema } from '../../src/runtime/exec/outputSchema'
import * as keyInput from '../../src/runtime/exec/keyInput'

const actualMemoryStore = keyInput.memorySecretStore

function notification(method: string, params: Record<string, unknown>) {
  return { jsonrpc: '2.0', method, params }
}

function configureBlockedPhase(deps: ExecDeps, phase: string): void {
  switch (phase) {
    case 'prompt': {
      deps.options = { ...deps.options, prompt: { kind: 'stdin' } }
      break
    }
    case 'file': {
      deps.options = { ...deps.options, prompt: { kind: 'file', path: 'hung' } }
      deps.readFile = () => new Promise(() => undefined)
      break
    }
    case 'readiness': {
      deps.storeSecrets = {
        get: () => new Promise(() => undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      }
      break
    }
    default: {
      /* Key mode already has --key-stdin and a pipe held open. */ break
    }
  }
}

function useMuseOptions(deps: ExecDeps): void {
  deps.options = {
    ...deps.options,
    backend: 'museCode',
    model: undefined,
    budgetUsd: undefined,
    budgetMicroUsd: undefined,
    maxRequests: undefined,
  }
}
async function imageHarness(file = 'image.png', reply = 'done') {
  return await harness(
    ['--permission-mode', 'acceptEdits', '--image-generation'],
    [{ calls: [image(file)] }, { text: reply }],
  )
}

const actualRuntime = runtimeBackends.createRuntimeBackend

function ignoreSignals() {
  return undefined
}
function noSignals() {
  return ignoreSignals
}
const folders: string[] = []
function folder() {
  const f = mkdtempSync(path.join(tmpdir(), 'm80b-'))
  folders.push(f)
  return f
}
const dist = folder()
const builtMain = path.join(folder(), 'dist', 'acp.js')
beforeAll(async () => {
  await buildModelApiBundle(dist)
  mkdirSync(path.dirname(builtMain), { recursive: true })
  buildSync({
    entryPoints: ['src/runtime/main.ts'],
    outfile: builtMain,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['@napi-rs/keyring'],
    logLevel: 'silent',
  })
  writeFileSync(
    path.join(path.dirname(path.dirname(builtMain)), 'package.json'),
    '{"version":"test"}',
  )
})
afterAll(async () => {
  await Promise.all(folders.map((created) => removeFolder(created)))
})
async function harness(
  flags: string[] = [],
  replies: ScriptedReply[] = [{ text: 'done' }],
  changes: Partial<ExecDeps> = {},
  deadline = 1_800_000,
) {
  const cwd = folder()
  const homeDir = folder()
  const out = outputWriter()
  const err = outputWriter()
  const parsed = parseCommandLine([
    'exec',
    '--backend',
    'modelApi',
    '--max-budget-usd',
    '1',
    '--allow-contributor-models',
    '--model',
    'muse-spark-1.3-contributor',
    '--output',
    'jsonl',
    ...flags,
    'task',
  ])
  if (parsed.command !== 'exec') throw new Error(JSON.stringify(parsed))
  const api = fakeModelApi()
  api.script(...replies)
  const store = memorySecrets()
  await store.store(SECRET_KEYS.modelApiKey, FAKE_MODEL_API_KEY)
  const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const clock = { offset: 0 }
  const now = () => Date.now() + clock.offset
  const life = createLifecycle({
    processStartMs: Date.now(),
    timeoutMs: deadline,
    now,
    setTimer: (ms, run) => {
      const t = setTimeout(run, ms)
      return () => {
        clearTimeout(t)
      }
    },
    onSignal: noSignals,
    forceFinish: vi.fn(),
    exit: (_code): never => {
      throw new Error('exit')
    },
  })
  const deps: ExecDeps = {
    options: parsed.options,
    version: 'test',
    distDir: dist,
    platform: process.platform,
    env: {},
    homeDir,
    processCwd: cwd,
    stdin: new PassThrough(),
    stdout: out,
    stderr: err,
    storeSecrets: store,
    runGit: vi.fn(() => Promise.resolve('')),
    museCodeCredentials: [],
    fetch: api.fetch,
    sleep: () => Promise.resolve(),
    now,
    readFile: async (file, max) => {
      const b = await readFile(file)
      if (b.length > max) throw new Error('too large')
      return b
    },
    randomHex: () => '123456789abcdef0',
    log,
    ...changes,
  }
  const run = async () => {
    try {
      const code = await runExec(life, deps)
      const events: ExecEvent[] = out.chunks.flatMap((chunk) =>
        chunk
          .trim()
          .split('\n')
          .map((line): ExecEvent => validateSchemaEvent(JSON.parse(line))),
      )
      const records = events.filter((event) => event.type === 'result')
      const result =
        records.length === 0
          ? undefined
          : validateSchemaResult(records[0]?.type === 'result' ? records[0].result : undefined)
      return { code, events, result }
    } finally {
      life.dispose()
    }
  }
  return { api, deps, cwd, homeDir, out, err, life, store, run, clock }
}

function recordBodies(deps: ExecDeps): string[] {
  const bodies: string[] = []
  const fetch = deps.fetch
  deps.fetch = async (url, init) => {
    if (typeof init?.body === 'string') bodies.push(init.body)
    return await fetch(url, init)
  }
  return bodies
}

const outputSchemaBytes = new TextEncoder().encode(
  JSON.stringify({
    type: 'object',
    properties: { ok: { type: 'boolean' } },
    required: ['ok'],
    additionalProperties: false,
  }),
)

function strictSchemaBinding(): ExecOutputSchemaPort {
  return {
    formatsFor: () => Promise.resolve(['strict_schema']),
    configure: () => Promise.resolve(),
  }
}
async function outsideSchemaHarness(
  kind: 'symlink' | 'traversal' | 'absolute',
  isAllowed: boolean,
) {
  const h = await harness([], [{ text: '{"ok":true}' }])
  const outside = path.join(h.homeDir, 'answer.json')
  writeFileSync(outside, outputSchemaBytes)
  symlinkSync(h.homeDir, path.join(h.cwd, 'linked'), 'junction')
  const given = {
    symlink: path.join('linked', 'answer.json'),
    traversal: path.relative(h.cwd, outside),
    absolute: outside,
  }[kind]
  h.deps.options = {
    ...h.deps.options,
    outputSchema: given,
    ...(isAllowed && { outputSchemaOutside: true }),
  }
  h.deps.readFile = vi.fn(h.deps.readFile)
  h.deps.outputSchema = strictSchemaBinding()
  return { h, outside }
}

async function expectPreflightRefusal(h: Awaited<ReturnType<typeof harness>>): Promise<void> {
  h.deps.fetch = vi.fn(h.deps.fetch)
  const create = vi.spyOn(runtimeBackends, 'createRuntimeBackend')
  try {
    const run = await h.run()
    expect(run.code).toBe(2)
    expect(run.result).toBeUndefined()
    expect(h.deps.fetch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  } finally {
    create.mockRestore()
  }
}

async function schemaSwapHarness(
  swap: (h: Awaited<ReturnType<typeof harness>>, file: string) => void,
  phase: 'before' | 'after',
) {
  const h = await harness([], [{ text: '{"ok":true}' }])
  const inside = path.join(h.cwd, 'parent', 'answer.json')
  mkdirSync(path.dirname(inside))
  writeFileSync(inside, outputSchemaBytes)
  h.deps.options = { ...h.deps.options, outputSchema: inside }
  h.deps.outputSchema = strictSchemaBinding()
  const reads = vi.fn()
  const opener = vi.fn(async (file: string, flags: number) => {
    if (phase === 'before') swap(h, file)
    const handle = await open(file, flags)
    if (phase === 'after') swap(h, file)
    vi.spyOn(handle, 'read').mockImplementation(reads)
    return handle
  })
  h.deps.schemaFileIo = { open: opener, realpath, lstat }
  return { h, opener, reads }
}

describe('M106 output schema runtime binding', () => {
  it('refuses a final symlink swapped immediately before open without reading the outside file', async () => {
    const { h, opener, reads } = await schemaSwapHarness((fixture, file) => {
      const outside = path.join(fixture.homeDir, 'answer.json')
      writeFileSync(outside, outputSchemaBytes)
      unlinkSync(file)
      symlinkSync(outside, file)
    }, 'before')
    await expectPreflightRefusal(h)
    expect(opener).toHaveBeenCalledOnce()
    if (process.platform !== 'win32')
      expect((opener.mock.calls[0]?.[1] ?? 0) & fileFlags.O_NOFOLLOW).toBe(fileFlags.O_NOFOLLOW)
    expect(reads).not.toHaveBeenCalled()
  })
  it('refuses a symlink parent swapped before open without reading outside the workspace', async () => {
    const { h, opener, reads } = await schemaSwapHarness((fixture, file) => {
      writeFileSync(path.join(fixture.homeDir, 'answer.json'), outputSchemaBytes)
      const parent = path.dirname(file)
      renameSync(parent, path.join(fixture.cwd, 'saved'))
      symlinkSync(fixture.homeDir, parent, 'junction')
    }, 'before')
    await expectPreflightRefusal(h)
    expect(opener).toHaveBeenCalledOnce()
    expect(reads).not.toHaveBeenCalled()
    expect(h.err.chunks.join('')).toContain('--output-schema-outside')
  })
  it('refuses a replaced inside pathname when its inode differs from the open handle', async () => {
    const { h, opener, reads } = await schemaSwapHarness((fixture, file) => {
      renameSync(file, path.join(fixture.cwd, 'saved.json'))
      writeFileSync(file, outputSchemaBytes)
    }, 'after')
    await expectPreflightRefusal(h)
    expect(opener).toHaveBeenCalledOnce()
    expect(reads).not.toHaveBeenCalled()
  })
  it.each([false, true])(
    'verifies Windows junction containment through the open-handle seam (inside=%s)',
    async (isInside) => {
      const h = await harness([], [{ text: '{"ok":true}' }])
      const inside = path.join(h.cwd, 'answer.json')
      writeFileSync(inside, outputSchemaBytes)
      h.deps.platform = 'win32'
      h.deps.options = { ...h.deps.options, outputSchema: inside }
      h.deps.outputSchema = strictSchemaBinding()
      const handles: Awaited<ReturnType<typeof open>>[] = []
      const opener = vi.fn(async (file: string, flags: number) => {
        const handle = await open(file, flags)
        handles.push(handle)
        vi.spyOn(handle, 'read')
        return handle
      })
      const target = isInside
        ? String.raw`C:\workspace\linked\answer.json`
        : String.raw`C:\outside\answer.json`
      h.deps.schemaFileIo = {
        open: opener,
        realpath: (file) => Promise.resolve(file === h.cwd ? String.raw`C:\workspace` : target),
        lstat: async () => {
          const handle = handles[0]
          if (handle === undefined) throw new Error('open must precede verification')
          // The filesystem seam is Windows; the backend still runs on this rig.
          h.deps.platform = process.platform
          return await handleIdentity(handle)
        },
      }
      // Record reads through the held handle without replacing its implementation.
      if (isInside) {
        const run = await h.run()
        expect(run.code).toBe(0)
        expect(handles[0]?.read).toHaveBeenCalled()
      } else {
        await expectPreflightRefusal(h)
        expect(handles[0]?.read).not.toHaveBeenCalled()
      }
      expect(opener).toHaveBeenCalledOnce()
      expect(opener.mock.calls[0]?.[1]).toBe(0)
    },
  )

  it.each(['device', 'nonregular', 'stat-size', 'growth'] as const)(
    'refuses a schema handle with invalid %s and closes it before backend creation',
    async (kind) => {
      const h = await harness()
      const inside = path.join(h.cwd, 'answer.json')
      writeFileSync(inside, outputSchemaBytes)
      h.deps.options = { ...h.deps.options, outputSchema: inside }
      h.deps.outputSchema = strictSchemaBinding()
      const handles: Awaited<ReturnType<typeof open>>[] = []
      h.deps.schemaFileIo = {
        open: async (file, flags) => {
          const handle = await open(file, flags)
          handles.push(handle)
          const info = await handleIdentity(handle)
          switch (kind) {
            case 'device': {
              info.dev += 1n
              break
            }
            case 'nonregular': {
              vi.spyOn(info, 'isFile').mockReturnValue(false)
              break
            }
            case 'stat-size': {
              info.size = BigInt(EXEC_PROMPT_MAX_BYTES + 1)
              break
            }
            case 'growth': {
              writeFileSync(inside, ' '.repeat(EXEC_PROMPT_MAX_BYTES + 1))
              break
            }
          }
          vi.spyOn(handle, 'stat').mockResolvedValue(info)
          vi.spyOn(handle, 'read')
          vi.spyOn(handle, 'close')
          return handle
        },
        realpath,
        lstat,
      }
      await expectPreflightRefusal(h)
      expect(handles[0]?.close).toHaveBeenCalledOnce()
      expect(h.err.chunks.join('')).toContain(
        UI_TEXT.outputSchemaReadFailed.replace('{detail}', 'file'),
      )
      if (kind === 'growth') expect(handles[0]?.read).toHaveBeenCalled()
      else expect(handles[0]?.read).not.toHaveBeenCalled()
    },
  )

  it('refuses invalid/unreadable schemas and an absent binding before backend creation or HTTP', async () => {
    for (const phase of ['invalid', 'unreadable', 'unbound']) {
      const h = await harness()
      h.deps.options = { ...h.deps.options, outputSchema: 'answer.json' }
      if (phase !== 'unreadable')
        writeFileSync(
          path.join(h.cwd, 'answer.json'),
          phase === 'invalid' ? '{}' : outputSchemaBytes,
        )
      if (phase !== 'unbound') h.deps.outputSchema = strictSchemaBinding()
      await expectPreflightRefusal(h)
    }
  })
  it.each([
    [['forced_tool', 'json_schema', 'strict_schema'], 'strict_schema'],
    [['forced_tool', 'json_schema'], 'json_schema'],
    [['forced_tool'], 'forced_tool'],
  ] as const)(
    'selects the strongest captured format %j before the prompt',
    async (formats, mode) => {
      const h = await harness([], [{ text: '{"ok":true}' }])
      h.deps.options = { ...h.deps.options, outputSchema: 'answer.json' }
      writeFileSync(path.join(h.cwd, 'answer.json'), outputSchemaBytes)
      h.deps.readFile = vi.fn(h.deps.readFile)
      const configure = vi.fn(() => {
        expect(h.api.responseBodies()).toHaveLength(0)
        return Promise.resolve()
      })
      h.deps.outputSchema = { formatsFor: vi.fn(() => Promise.resolve(formats)), configure }
      const run = await h.run()
      expect(configure).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'muse-spark-1.3-contributor',
          mode,
          schema: compileOutputSchema(outputSchemaBytes).schema,
          signal: h.life.signal,
        }),
      )
      expect(run.code).toBe(0)
      expect(run.result).toMatchObject({
        output: { value: { ok: true }, validation: 'provider' },
        ledger: {
          outputSchemaSha256: compileOutputSchema(outputSchemaBytes).sha256,
        },
      })
    },
  )
  it('uses prompt-text schema fallback and discloses local validation when no wire format is supported', async () => {
    const h = await harness([], [{ text: '{"ok":true}' }])
    writeFileSync(path.join(h.cwd, 'answer.json'), outputSchemaBytes)
    h.deps.options = { ...h.deps.options, outputSchema: 'answer.json' }
    const configure = vi.fn(() => Promise.resolve())
    h.deps.outputSchema = { formatsFor: () => Promise.resolve([]), configure }
    const run = await h.run()
    expect(run.code).toBe(0)
    expect(configure).not.toHaveBeenCalled()
    expect(h.api.responseBodies()).toHaveLength(1)
    expect(JSON.stringify(h.api.responseBodies()[0]?.['input'])).toContain(
      JSON.stringify(new TextDecoder().decode(outputSchemaBytes)).slice(1, -1),
    )
    expect(run.result).toMatchObject({
      output: { value: { ok: true }, validation: 'local' },
      usage: { requests: 1 },
      ledger: { outputSchemaSha256: compileOutputSchema(outputSchemaBytes).sha256 },
    })
    expect(h.err.chunks.join('')).toContain(UI_TEXT.outputSchemaLocalValidation)
  })
  it('fails a text-fallback schema mismatch locally without a repair or extra billable request', async () => {
    const h = await harness([], [{ text: '{"ok":"wrong"}' }])
    writeFileSync(path.join(h.cwd, 'answer.json'), outputSchemaBytes)
    h.deps.options = { ...h.deps.options, outputSchema: 'answer.json' }
    h.deps.outputSchema = {
      formatsFor: () => Promise.resolve([]),
      configure: vi.fn(() => Promise.resolve()),
    }
    const run = await h.run()
    expect(run.code).toBe(4)
    expect(run.result).toMatchObject({
      status: 'failed',
      error: { kind: 'output_schema_mismatch' },
      usage: { requests: 1 },
    })
    expect(Object.hasOwn(run.result ?? {}, 'output')).toBe(false)
    expect(h.api.responseBodies()).toHaveLength(1)
    expect(h.err.chunks.join('')).toContain(UI_TEXT.outputSchemaLocalValidation)
  })
  it('normalises Windows separators before the schema containment comparison', async () => {
    const h = await harness()
    writeFileSync(path.join(h.cwd, 'answer.json'), outputSchemaBytes)
    h.deps.options = { ...h.deps.options, outputSchema: 'answer.json' }
    h.deps.readFile = vi.fn(h.deps.readFile)
    const relative = vi.spyOn(path, 'relative').mockReturnValue(String.raw`..\outside\answer.json`)
    try {
      const run = await h.run()
      expect(run.code).toBe(2)
      expect(h.deps.readFile).not.toHaveBeenCalled()
      expect(h.err.chunks.join('')).toContain('--output-schema-outside')
    } finally {
      relative.mockRestore()
    }
  })
  it.each(['symlink', 'traversal', 'absolute'] as const)(
    'refuses an outside schema target through %s before reading or creating a backend',
    async (kind) => {
      const { h } = await outsideSchemaHarness(kind, false)
      await expectPreflightRefusal(h)
      expect(h.deps.readFile).not.toHaveBeenCalled()
      expect(h.err.chunks.join('')).toContain('--output-schema-outside')
    },
  )
  it.each(['symlink', 'traversal', 'absolute'] as const)(
    'reads and reports an explicitly authorised outside schema through %s',
    async (kind) => {
      const { h, outside } = await outsideSchemaHarness(kind, true)
      const run = await h.run()
      expect(run.code).toBe(0)
      expect(h.deps.readFile).not.toHaveBeenCalled()
      expect(run.result?.output).toMatchObject({ value: { ok: true }, validation: 'provider' })
      expect(h.err.chunks.join('')).toContain(UI_TEXT.outputSchemaOutsideAllowed)
      expect(JSON.stringify(run.result?.ledger)).not.toContain(outside)
    },
  )
  it('accepts an absolute inside schema and a symlinked workspace by their real paths', async () => {
    const h = await harness([], [{ text: '{"ok":true}' }])
    const inside = path.join(h.cwd, 'answer.json')
    writeFileSync(inside, outputSchemaBytes)
    const alias = path.join(h.homeDir, 'workspace')
    symlinkSync(h.cwd, alias, 'junction')
    h.deps.options = { ...h.deps.options, cwd: alias, outputSchema: inside }
    h.deps.outputSchema = strictSchemaBinding()
    const run = await h.run()
    expect(run.code).toBe(0)
    expect(h.err.chunks.join('')).not.toContain('--output-schema-outside')
  })
  it('propagates a final schema mismatch to the process code while retaining spend and digest', async () => {
    const h = await harness([], [{ text: '{"ok":"wrong"}' }])
    h.deps.options = { ...h.deps.options, outputSchema: 'answer.json' }
    writeFileSync(path.join(h.cwd, 'answer.json'), outputSchemaBytes)
    h.deps.outputSchema = strictSchemaBinding()
    const run = await h.run()
    expect(run.code).toBe(4)
    expect(run.result).toMatchObject({
      status: 'failed',
      exitCode: 4,
      error: { kind: 'output_schema_mismatch' },
      ledger: { outputSchemaSha256: compileOutputSchema(outputSchemaBytes).sha256 },
      usage: { requests: 1 },
    })
    expect(Object.hasOwn(run.result ?? {}, 'output')).toBe(false)
  })
  it('does not read capabilities or change request bytes without a schema', async () => {
    const baseline = await harness()
    const baselineBodies = recordBodies(baseline.deps)
    await baseline.run()
    const enhanced = await harness([], [{ text: 'done' }], { processCwd: baseline.cwd })
    const enhancedBodies = recordBodies(enhanced.deps)
    const formatsFor = vi.fn(() => Promise.resolve(['strict_schema'] as const))
    const configure = vi.fn(() => Promise.resolve())
    enhanced.deps.outputSchema = { formatsFor, configure }
    await enhanced.run()
    expect(formatsFor).not.toHaveBeenCalled()
    expect(configure).not.toHaveBeenCalled()
    expect(enhancedBodies).toHaveLength(1)
    expect(enhancedBodies).toEqual(baselineBodies)
  })
})
function result(r: { result: ExecResult | undefined }) {
  if (r.result === undefined) throw new Error('no result')
  return r.result
}
const write = (file: string) => ({
  name: 'write_file',
  arguments: JSON.stringify({ path: file, content: 'new' }),
})
const ask = {
  name: 'ask_user',
  arguments: JSON.stringify({
    questions: [
      {
        id: 'q',
        header: 'Choose',
        question: 'Which?',
        selection: { mode: 'single' },
        options: [{ label: 'Red' }],
      },
    ],
  }),
}
const image = (file = 'image.png') => ({
  name: 'generate_image',
  arguments: JSON.stringify({ path: file, prompt: 'tiny dot' }),
})

function builtCommand(
  args: readonly string[],
  input: string | undefined,
  elapsed: number,
  shouldHangTable = false,
  shouldBlockStderr = false,
  shouldDrainStderr = false,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const bootstrap = path.join(folder(), 'bootstrap.cjs')
  const trace = `${bootstrap}.trace`
  // Test-owned Node bootstrap, never shipped or selected by a production flag.
  // It models elapsed setup time and fails immediately if native keyring loads.
  writeFileSync(
    bootstrap,
    `const started = Date.now(); const elapsed = ${String(elapsed)};
const trace = ${JSON.stringify(trace)}; const mark = (word) => require('node:fs').appendFileSync(trace, word+':'+String(Date.now()-started)+String.fromCharCode(10)); mark('bootstrap');
const originalExit = process.exit; process.exit = (code) => { mark('exit='+String(code)); return originalExit(code); };
Object.defineProperty(globalThis, 'performance', {value: {timeOrigin: started-elapsed, now: () => Date.now()-started+elapsed}});
const Module = require('node:module'); const load = Module._load;
Module._load = function(name, ...rest) { if(name === '@napi-rs/keyring') throw new Error('native keyring must stay unloaded'); return load.call(this, name, ...rest); };
${shouldHangTable ? "require('node:fs/promises').readFile = () => new Promise(() => {});" : ''}
${shouldBlockStderr ? "require('node:fs/promises').readFile = () => Promise.reject(new Error('x'.repeat(4 * 1024 * 1024))); setTimeout(() => { mark('SIGINT'); process.emit('SIGINT'); setTimeout(() => { mark('SIGTERM'); process.emit('SIGTERM'); }, 10); }, 100);" : ''}`,
  )
  const child = childProcess.spawn(process.execPath, ['--require', bootstrap, builtMain, ...args], {
    cwd: path.dirname(bootstrap),
    env: {
      PATH: process.env['PATH'],
      SystemRoot: process.env['SystemRoot'],
      LANG: shouldHangTable || shouldBlockStderr ? 'de_DE.UTF-8' : 'en_US.UTF-8',
      NODE_OPTIONS: '',
      NODE_PATH: '',
    },
    stdio: 'pipe',
  })
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(
        new Error(
          `standalone command exceeded its bounded test deadline: ${existsSync(trace) ? readFileSync(trace, 'utf8') : 'no bootstrap'}`,
        ),
      )
    }, 2000)
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    if (shouldBlockStderr && !shouldDrainStderr)
      child.once('exit', () => {
        child.stderr.destroy()
      })
    else
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
    child.stdin.on('error', () => {
      /* A bounded child exit may close its private input pipe first. */
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    if (input !== undefined) child.stdin.write(input)
  })
}

describe('M80 real runtime → ACP → manager → client → tools', () => {
  it.each([false, true])('D29 4MiB stderr keeps bounded exit; drained=%s', async (isDrained) => {
    const r = await builtCommand(
      [
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '2',
        '--key-stdin',
        '--output',
        'json',
        'task',
      ],
      undefined,
      0,
      false,
      true,
      isDrained,
    )
    expect(r.code).toBe(!isDrained && process.platform === 'win32' ? 1 : 130)
    expect(validateResult(JSON.parse(r.stdout))).toMatchObject({
      status: 'cancelled',
      signal: 'SIGINT',
      sessionId: null,
    })
  })
  it('A17/A20 client preserves future non-tool updates and suppresses every tool/chunk before sink', async () => {
    const h = await harness()
    const out = outputWriter()
    const sink = createExecSink({
      format: 'jsonl',
      out,
      now: () => Date.now(),
      literals: () => [FAKE_MODEL_API_KEY],
      summary: vi.fn(),
      onStalled: vi.fn(),
    })
    const client = createExecClient({
      sink,
      lifecycle: h.life,
      onDenial: vi.fn(),
      onQuestion: vi.fn(),
      onFilesChanged: vi.fn(),
    })
    const incoming = new TransformStream<Uint8Array, Uint8Array>()
    const output = new WritableStream<Uint8Array>({
      write() {
        /* No requests are sent in this notification-only fixture. */
      },
    })
    const connection = client.connect(acp.ndJsonStream(output, incoming.readable))
    const writer = incoming.writable.getWriter()
    for (const update of [
      { sessionUpdate: 'future_non_tool', extra: { text: `done ${FAKE_MODEL_API_KEY}` } },
      { sessionUpdate: 'agent_message_chunk.v2', content: { text: 'LLM|1|s' } },
      { sessionUpdate: 'agent_thought_chunk', content: { text: 'LLM|1|s' } },
      { sessionUpdate: 'tool_future_update', rawOutput: 'LLM|1|s', toolCallId: 'x' },
    ]) {
      await writer.write(
        new TextEncoder().encode(
          `${JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update } })}\n`,
        ),
      )
    }
    await writer.close()
    await connection.closed
    expect(h.life.cause).toBeNull()
    h.life.dispose()
    expect(out.chunks).toHaveLength(1)
    expect(out.chunks.join('')).toContain('future_non_tool')
    expect(out.chunks.join('')).not.toContain(FAKE_MODEL_API_KEY)
    expect(out.chunks.join('')).not.toContain('LLM|1|s')
  })
  it('A10 built headless usage errors are bounded stderr-only exit 2', async () => {
    for (const args of [['exec', '--trust-workspace', 'task'], ['scan-secrets']]) {
      const r = await builtCommand(args, '', 0, true)
      expect(r.code).toBe(2)
      expect(r.stdout).toBe('')
      expect(r.stderr.length).toBeGreaterThan(0)
    }
  })
  it('D29 main creates lifecycle before hung localization and queues timeout result', async () => {
    const r = await builtCommand(
      [
        'exec',
        '--backend',
        'modelApi',
        '--max-budget-usd',
        '2',
        '--timeout',
        '10',
        '--key-stdin',
        '--output',
        'json',
        'task',
      ],
      undefined,
      9900,
      true,
    )
    expect(r.code).toBe(6)
    expect(validateResult(JSON.parse(r.stdout))).toMatchObject({
      status: 'timeout',
      sessionId: null,
    })
    expect(r.stderr).not.toContain('native keyring must stay unloaded')
  })
  it('scanner lifecycle includes hung key reading, native keyring stays unloaded', async () => {
    const r = await builtCommand(['scan-secrets', 'unused.txt', '--key-stdin'], undefined, 29_900)
    expect(r.code).toBe(2)
    expect(r.stdout).toBe('')
    expect(r.stderr).not.toContain('native keyring must stay unloaded')
  })
  it('scanner CLI reads exact stdin literal and emits counts only, including clean and unreadable', async () => {
    const file = path.join(folder(), 'patch.txt')
    writeFileSync(file, 'ordinary text')
    const clean = await builtCommand(['scan-secrets', file], '', 0)
    expect(clean.code).toBe(0)
    writeFileSync(file, `ordinary ${FAKE_MODEL_API_KEY}`)
    const found = await builtCommand(
      ['scan-secrets', file, '--key-stdin'],
      `${FAKE_MODEL_API_KEY}\n`,
      0,
    )
    expect(found.code).toBe(10)
    expect(found.stdout).not.toContain(FAKE_MODEL_API_KEY)
    expect(found.stderr).not.toContain('native keyring must stay unloaded')
    const missing = await builtCommand(['scan-secrets', `${file}-missing`], '', 0)
    expect(missing.code).toBe(2)
  })
  it('D17 real read/write tools start no child, git, hook or shell process', async () => {
    const spies = [
      vi.spyOn(childProcess, 'spawn'),
      vi.spyOn(childProcess, 'spawnSync'),
      vi.spyOn(childProcess, 'exec'),
      vi.spyOn(childProcess, 'execSync'),
      vi.spyOn(childProcess, 'execFile'),
      vi.spyOn(childProcess, 'execFileSync'),
      vi.spyOn(childProcess, 'fork'),
    ]
    syncBuiltinESMExports()
    try {
      const h = await harness(
        ['--permission-mode', 'acceptEdits'],
        [
          { calls: [write('x.txt')] },
          { calls: [{ name: 'read_file', arguments: '{"path":"x.txt"}' }] },
          { text: 'done' },
        ],
      )
      const r = await h.run()
      expect(r.code).toBe(0)
      expect(h.deps.runGit).not.toHaveBeenCalled()
      for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    } finally {
      for (const spy of spies) spy.mockRestore()
      syncBuiltinESMExports()
    }
  })
  it.each(['completed', 'interrupted'])(
    'D22/D24/D28 real MSP terminal %s and repeated cumulative usage',
    async (terminal) => {
      const msp = acpMspHost()
      const sessionId = 'm80-muse'
      const turnId = 'm80-turn'
      msp.server.handle('session/start', (params) => ({
        session: { sessionId, modelId: params['modelId'], status: 'idle' },
        viewCursor: '',
      }))
      msp.server.handle('turn/start', (params) => ({
        commandId: params['commandId'],
        turnId,
        status: 'accepted',
        disposition: 'started',
        startedNewTurn: true,
      }))
      const item = {
        itemId: 'message',
        kind: 'agentMessage',
        status: 'completed',
        turnId,
        text: 'whole Muse reply',
      }
      const usage = {
        sessionId,
        modelId: 'muse-spark-1.3',
        usage: { inputTokens: 120, outputTokens: 24, cachedTokens: 0, reasoningTokens: 0 },
        promptTokens: 120,
        totalTokens: 144,
        cumulative: { promptTokens: 120, outputTokens: 24, totalTokens: 144 },
      }
      msp.server.followWith('turn/start', () => [
        notification('item/started', {
          sessionId,
          item: { ...item, status: 'inProgress', text: '' },
        }),
        notification('item/completed', { sessionId, item }),
        notification('session/tokenUsage', usage),
        notification('session/tokenUsage', usage),
        notification('turn/completed', { sessionId, turnId, terminal }),
      ])
      const spy = vi
        .spyOn(runtimeBackends, 'createRuntimeBackend')
        .mockImplementationOnce((input) => ({
          ...actualRuntime(input),
          backend: {
            kind: 'museCode',
            readiness: () => Promise.resolve({ state: 'ready' }),
            hostFor: () => Promise.resolve(msp.host),
          },
        }))
      try {
        const h = await harness()
        useMuseOptions(h.deps)
        const r = await h.run()
        expect(r.code).toBe(terminal === 'completed' ? 0 : 8)
        expect(result(r).terminal).toBe(terminal)
        expect(result(r).usage).toMatchObject({
          requests: null,
          costUsd: null,
          inputTokens: 120,
          outputTokens: 24,
          cachedTokens: null,
          reasoningTokens: null,
        })
        expect(msp.server.requestsFor('session/start')[0]?.params).toMatchObject({
          approvalMode: 'denyUnmatched',
        })
        expect(msp.server.requestsFor('turn/start')).toHaveLength(1)
      } finally {
        spy.mockRestore()
        await msp.host.close()
      }
    },
  )
  it('D23 signed-out Muse never initiates login', async () => {
    const readiness = vi.fn(() =>
      Promise.resolve({ state: 'signedOut' as const, message: 'signed out' }),
    )
    const spy = vi
      .spyOn(runtimeBackends, 'createRuntimeBackend')
      .mockImplementationOnce((input) => ({
        ...actualRuntime(input),
        backend: {
          kind: 'museCode',
          readiness,
          hostFor: () => Promise.reject(new Error('must not start')),
        },
      }))
    try {
      const h = await harness()
      useMuseOptions(h.deps)
      const r = await h.run()
      expect(r.code).toBe(3)
      expect(result(r).status).toBe('auth_required')
      expect(readiness).toHaveBeenCalledExactlyOnceWith(false)
      expect(h.api.requests).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
  it('D29 hung key, prompt, input and readiness are all cancelled by process deadline', async () => {
    for (const phase of ['key', 'prompt', 'file', 'readiness']) {
      const h = await harness(phase === 'key' ? ['--key-stdin'] : [], [], {}, 50)
      configureBlockedPhase(h.deps, phase)
      const r = await h.run()
      expect(r.code).toBe(6)
      expect(result(r).sessionId).toBeNull()
      expect(h.api.requests).toHaveLength(0)
    }
  })
  it('D29 hung session/new is cancelled before any session id or billable call exists', async () => {
    const spy = vi
      .spyOn(runtimeBackends, 'createRuntimeBackend')
      .mockImplementationOnce((input) => {
        const runtime = actualRuntime(input)
        return {
          ...runtime,
          backend: { ...runtime.backend, hostFor: () => new Promise(() => undefined) },
        }
      })
    try {
      const h = await harness([], [{ text: 'must not dispatch' }], {}, 50)
      const r = await h.run()
      expect(r.code).toBe(6)
      expect(result(r).sessionId).toBeNull()
      expect(h.api.requests).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
  it('D29 cancellation queues result before hung runtime cleanup and suppresses late logs', async () => {
    let lateLog: ExecDeps['log'] | undefined
    const h = await harness(
      [],
      [{ holdEof: new Promise(() => undefined), text: 'partial' }],
      {},
      50,
    )
    const spy = vi
      .spyOn(runtimeBackends, 'createRuntimeBackend')
      .mockImplementationOnce((input) => {
        lateLog = input.log
        return {
          ...actualRuntime(input),
          close: () => {
            h.clock.offset += 5000
            return new Promise(() => undefined)
          },
        }
      })
    try {
      const running = h.run()
      await vi.waitFor(() => {
        expect(h.out.chunks.join('')).toContain('"status":"timeout"')
      })
      await running
      const before = h.err.chunks.join('')
      lateLog?.warn(FAKE_MODEL_API_KEY)
      expect(h.err.chunks.join('')).toBe(before)
    } finally {
      spy.mockRestore()
    }
  })
  it('D30 signal before setup is preserved with null session id', async () => {
    const h = await harness()
    h.life.latch({ kind: 'signal', signal: 'SIGTERM' })
    const r = await h.run()
    expect(r.code).toBe(143)
    expect(result(r)).toMatchObject({ signal: 'SIGTERM', sessionId: null })
    expect(h.api.requests).toHaveLength(0)
  })
  it('D1 reply only uses real stream and priced ledger; JSONL is only selected output', async () => {
    const h = await harness()
    const r = await h.run()
    const record = result(r)
    expect(r.code).toBe(0)
    expect(record).toMatchObject({
      status: 'completed',
      finalMessage: 'done',
      model: 'muse-spark-1.3-contributor',
      usage: {
        requests: 1,
        inputTokens: 10,
        outputTokens: 5,
        costUsd: { settled: 0.000002, total: 0.000002 },
      },
    })
    expect(h.api.responseBodies()).toHaveLength(1)
    expect(JSON.stringify(r.events)).not.toContain(h.cwd)
    expect(r.events.filter((e) => e.type === 'result')).toHaveLength(1)
  })
  it('stdin exec never reads native store, returns after LF without EOF and clears memory entry', async () => {
    const h = await harness(['--key-stdin', '--ephemeral'])
    h.deps.stdin.push(`${FAKE_MODEL_API_KEY}\n`)
    const native = vi.spyOn(h.deps.storeSecrets, 'get')
    const held: { store?: keyInput.MemorySecretStore } = {}
    const create = vi.spyOn(keyInput, 'memorySecretStore').mockImplementationOnce((key) => {
      held.store = actualMemoryStore(key)
      return held.store
    })
    try {
      const r = await h.run()
      expect(r.code).toBe(0)
      expect(native).not.toHaveBeenCalled()
      expect(h.deps.stdin.destroyed).toBe(true)
      expect(held.store).toBeDefined()
      expect(await held.store?.get(SECRET_KEYS.modelApiKey)).toBeUndefined()
    } finally {
      native.mockRestore()
      create.mockRestore()
    }
  })
  it('D2 plan refuses edits without an approval popup', async () => {
    const h = await harness([], [{ calls: [write('x.txt')] }, { text: 'done' }])
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(existsSync(path.join(h.cwd, 'x.txt'))).toBe(false)
    expect(result(r).denials).toEqual([])
    expect(result(r).filesChanged).toEqual([])
  })
  it('D3 acceptEdits writes a confined file, reports relative edit metadata only', async () => {
    const h = await harness(
      ['--permission-mode', 'acceptEdits'],
      [{ calls: [write('x.txt')] }, { text: 'done' }],
    )
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(readFileSync(path.join(h.cwd, 'x.txt'), 'utf8')).toBe('new')
    expect(result(r).filesChanged).toEqual(['x.txt'])
    expect(JSON.stringify(r.events)).not.toContain('rawInput')
    expect(r.events.filter((e) => e.type === 'tool')).not.toHaveLength(0)
  })
  it.each([false, true])('D4/D5 protected edit denied; fail-on-denial=%s', async (fail) => {
    const h = await harness(
      ['--permission-mode', 'acceptEdits', ...(fail ? ['--fail-on-denial'] : [])],
      [{ calls: [write('AGENTS.md')] }, { text: 'done' }],
    )
    const r = await h.run()
    expect(r.code).toBe(fail ? 7 : 0)
    expect(existsSync(path.join(h.cwd, 'AGENTS.md'))).toBe(false)
    expect(result(r).denials).toHaveLength(1)
    expect(h.api.responseBodies()).toHaveLength(fail ? 1 : 2)
  })
  it('D6 no elicitation capability declines questions while turn continues', async () => {
    const h = await harness([], [{ calls: [ask] }, { text: 'done' }])
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(result(r).questionsDeclined).toBe(1)
    expect(r.events.filter((e) => e.type === 'question_declined')).toHaveLength(1)
  })
  it('D7 two admitted calls then request cap; no retry after refusal', async () => {
    const h = await harness(
      ['--max-requests', '2'],
      [{ calls: [{ name: 'read_file', arguments: '{"path":"missing"}' }] }],
    )
    const r = await h.run()
    expect(r.code).toBe(5)
    expect(result(r).status).toBe('request_cap')
    expect(h.api.responseBodies()).toHaveLength(2)
  })
  it('D8/L9 too-small start budget names rounded minimum before billable dispatch', async () => {
    const h = await harness(['--max-budget-usd', '0.108134'])
    const r = await h.run()
    expect(r.code).toBe(5)
    expect(h.api.responseBodies()).toHaveLength(0)
    expect(result(r).error?.message).toContain('0.108135')
  })
  it('D9 held response hits process deadline and retains full R', async () => {
    // The deadline lands on the held response, not on a wall clock that a slow
    // setup outlasts before the request is sent. Its timer's own latch is
    // covered in execLimits.test.ts.
    const eofHeld = Promise.withResolvers<undefined>()
    const h = await harness(
      [],
      [
        {
          text: 'partial',
          holdEof: new Promise(() => undefined),
          onEofHeld: () => {
            eofHeld.resolve(undefined)
          },
        },
      ],
    )
    const running = h.run()
    // A run that ends without sending the request fails the asserts below.
    await Promise.race([eofHeld.promise, running])
    h.life.latch({ kind: 'timeout' })
    const r = await running
    expect(r.code).toBe(6)
    expect(result(r).usage.costUsd).toMatchObject({ uncertain: 0.108135, isUpperBound: true })
    expect(result(r).finalMessage).toBe(UI_TEXT.execMessageWithheld)
  })
  it.each([false, true])(
    'D11/D12 missing key vs unavailable store=%s starts no network',
    async (broken) => {
      const h = await harness()
      h.deps.storeSecrets = {
        get: () =>
          broken ? Promise.reject(new Error('store unavailable')) : Promise.resolve(undefined),
        store: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      }
      const r = await h.run()
      expect(r.code).toBe(3)
      expect(result(r).status).toBe(broken ? 'backend_unavailable' : 'auth_required')
      expect(h.api.requests).toHaveLength(0)
    },
  )
  it.each([401, 403])('D13 HTTP %s is auth, liability retained', async (status) => {
    const h = await harness([], [{ httpError: { status } }])
    const r = await h.run()
    expect(r.code).toBe(3)
    expect(result(r).usage.costUsd?.uncertain).toBe(0.108135)
  })
  it('D13 catalogue authentication failure is auth/3 before any billable request', async () => {
    const h = await harness()
    h.deps.fetch = () =>
      Promise.resolve(
        Response.json(
          { error: { message: 'bad key', type: 'authentication_error', code: 'invalid_api_key' } },
          { status: 401 },
        ),
      )
    const r = await h.run()
    expect(r.code).toBe(3)
    expect(result(r)).toMatchObject({
      status: 'auth_required',
      sessionId: null,
      usage: { requests: 0 },
    })
  })
  it('D12 absent backend bundle is unavailable/3 rather than a fabricated incomplete response', async () => {
    const h = await harness()
    h.deps.distDir = folder()
    const r = await h.run()
    expect(r.code).toBe(3)
    expect(result(r)).toMatchObject({
      status: 'backend_unavailable',
      sessionId: null,
      usage: { requests: 0 },
    })
  })
  it('D14 five 500 attempts retain all reservations after real client retry policy', async () => {
    const h = await harness([], [{ httpError: { status: 500 } }])
    const r = await h.run()
    expect(r.code).toBe(4)
    expect(result(r).usage.requests).toBe(5)
    expect(result(r).usage.costUsd?.uncertain).toBe(0.540675)
  })
  it('D15 reply/key-shaped stderr are redacted; missing terminal prefix withheld whole', async () => {
    const h = await harness([], [{ text: `reply ${FAKE_MODEL_API_KEY}` }])
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(h.out.chunks.join('')).not.toContain(FAKE_MODEL_API_KEY)
    // RVM80A P3-6: the key really crossed stream deltas on its way in.
    const deltas = streamFor({ text: `reply ${FAKE_MODEL_API_KEY}` }, 'resp_split')
      .split('\n\n')
      .filter((frame) => frame.includes('response.output_text.delta'))
    expect(deltas.length).toBeGreaterThan(1)
    expect(deltas.some((frame) => frame.includes(FAKE_MODEL_API_KEY))).toBe(false)
    const cut = await harness([], [{ text: 'LLM|1|se', omitTerminal: true }])
    const ended = await cut.run()
    expect(ended.code).toBe(8)
    expect(result(ended).finalMessage).toBe(UI_TEXT.execMessageWithheld)
    expect(cut.out.chunks.join('')).not.toContain('LLM|1|se')
  })
  it.each(['json', 'text'] as const)(
    'D15 engine %s output and diagnostics scrub full percent legacy key',
    async (output) => {
      const key = 'LLM|123456|synthetic%2Fwith.punctuation'
      const h = await harness(['--output', output], [{ text: `done ${key}` }])
      await h.store.store(SECRET_KEYS.modelApiKey, key)
      h.deps.fetch = (url, init) =>
        h.api.fetch(url, {
          ...init,
          headers: {
            ...Object.fromEntries(new Headers(init?.headers)),
            Authorization: `Bearer ${FAKE_MODEL_API_KEY}`,
          },
        })
      try {
        expect(await runExec(h.life, h.deps)).toBe(0)
        const text = h.out.chunks.join('')
        expect(text).not.toContain(key)
        expect(text).not.toContain('with.punctuation')
        expect(h.err.chunks.join('')).not.toContain(key)
        if (output === 'json')
          expect(validateResult(JSON.parse(text)).finalMessage).toContain('done')
        else expect(text).toContain('done')
      } finally {
        h.life.dispose()
      }
    },
  )
  it('D16 200KB untrusted file reaches actual serialized request with all sentinels', async () => {
    const h = await harness(['--untrusted-file', 'diff.txt'])
    const text = `${'x'.repeat(10_000)}FIRST${'x'.repeat(60_000)}SECOND${'x'.repeat(120_000)}THIRD`
    writeFileSync(path.join(h.cwd, 'diff.txt'), text)
    const r = await h.run()
    expect(r.code).toBe(0)
    const body = JSON.stringify(h.api.responseBodies()[0])
    for (const sentinel of ['FIRST', 'SECOND', 'THIRD']) expect(body).toContain(sentinel)
    expect(result(r).inputs[0]).toMatchObject({
      name: 'diff.txt',
      complete: true,
      bytes: text.length,
      chunks: 3,
    })
    expect(h.api.requests.some((req) => req.path.includes('input_tokens'))).toBe(false)
  })
  it.each([false, true])(
    'D20 ephemeral=%s controls session persistence, stored text has no credential',
    async (ephemeral) => {
      const h = await harness(ephemeral ? ['--ephemeral'] : [], [
        { text: `answer ${FAKE_MODEL_API_KEY}` },
      ])
      const r = await h.run()
      expect(r.code).toBe(0)
      const dir = workspaceSessionsFolder(
        { platform: process.platform, env: {}, homeDir: h.homeDir },
        h.cwd,
      )
      if (ephemeral) expect(existsSync(dir)).toBe(false)
      else {
        const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
        expect(files).toHaveLength(1)
        const saved = readFileSync(path.join(dir, files[0]!), 'utf8')
        expect(saved).not.toContain(FAKE_MODEL_API_KEY)
        expect(saved).not.toMatch(/LLM\|/)
      }
      expect(
        existsSync(paidGrantsFile({ platform: process.platform, env: {}, homeDir: h.homeDir })),
      ).toBe(false)
    },
  )
  it.each(['unknown', 'muse-spark-9.9', 'effort'])(
    'D21 model/effort validation %s refuses after session creation, before billing',
    async (value) => {
      const h = await harness(
        value === 'effort'
          ? ['--model', 'muse-spark-1.2-contributor', '--effort', 'max']
          : ['--model', value],
      )
      if (value === 'muse-spark-9.9') h.api.models.push('muse-spark-9.9')
      else if (value === 'effort') h.api.models.push('muse-spark-1.2-contributor')
      const r = await h.run()
      expect(r.code).toBe(2)
      expect(r.result).toBeUndefined()
      expect(h.api.responseBodies()).toHaveLength(0)
    },
  )
  it('D25 incomplete response after edit withholds latest prose and retains changed file', async () => {
    const h = await harness(
      ['--permission-mode', 'acceptEdits'],
      [
        { calls: [write('x.txt')] },
        { text: 'LLM|1|s', incomplete: { reason: 'max_output_tokens' } },
      ],
    )
    const r = await h.run()
    expect(r.code).toBe(8)
    expect(result(r)).toMatchObject({
      terminal: 'incomplete',
      incompleteReason: 'max_output_tokens',
      filesChanged: ['x.txt'],
      finalMessage: UI_TEXT.execMessageWithheld,
    })
  })
  it('D27 valid earlier tool response cannot authorize latest HTTP failure', async () => {
    const h = await harness(
      [],
      [
        {
          text: 'earlier commentary',
          calls: [{ name: 'read_file', arguments: '{"path":"missing"}' }],
        },
        { httpError: { status: 500 } },
      ],
    )
    const r = await h.run()
    expect(r.code).toBe(4)
    expect(result(r).terminal).toBeNull()
    expect(result(r).finalMessage).toBe(UI_TEXT.execMessageWithheld)
    expect(result(r).usage.costUsd).toMatchObject({ settled: 0.000002, uncertain: 0.540675 })
  })
  it.each([
    [false, false, 0],
    [false, true, 9],
    [true, false, 0],
    [true, true, 9],
  ] as const)(
    'L6 earlier/latest missing usage %s/%s → %s',
    async (earlyMissing, lateMissing, code) => {
      const h = await harness(
        [],
        [
          {
            calls: [{ name: 'read_file', arguments: '{"path":"missing"}' }],
            omitUsage: earlyMissing,
          },
          { text: 'final', omitUsage: lateMissing },
        ],
      )
      const r = await h.run()
      expect(r.code).toBe(code)
      expect(result(r).finalMessage).toBe('final')
      expect(result(r).usage.costUsd?.uncertain).toBe(
        (Number(earlyMissing) + Number(lateMissing)) * 0.108135,
      )
    },
  )
  it('L6 missing only response releases complete prose but exits accounting/9', async () => {
    const h = await harness([], [{ text: 'whole', omitUsage: true }])
    const r = await h.run()
    expect(r.code).toBe(9)
    expect(result(r).finalMessage).toBe('whole')
  })
  it('P1 no image flag offers no image tool and sends no image request', async () => {
    const h = await harness(
      ['--permission-mode', 'acceptEdits'],
      [{ calls: [image()] }, { text: 'done' }],
    )
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(h.api.imageBodies()).toHaveLength(0)
  })
  it('P2 flagged image has admission and returned tally through real engine', async () => {
    const h = await imageHarness()
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(result(r).usage.paid).toMatchObject({
      imageAttempts: 1,
      imagesReturned: 1,
      settledUsd: 0.01,
    })
    expect(existsSync(path.join(h.cwd, 'image.png'))).toBe(true)
    expect(r.events.filter((e) => e.type === 'paid_use').map((e) => e.phase)).toEqual([
      'admitted',
      'returned',
    ])
  })
  it('P4 protected image destination denied without paid HTTP', async () => {
    const h = await imageHarness('.github/workflows/x.png')
    const r = await h.run()
    expect(r.code).toBe(0)
    expect(h.api.imageBodies()).toHaveLength(0)
  })
  it('P3 remaining image liability is denied before HTTP and next request stops at budget', async () => {
    const h = await harness(
      ['--permission-mode', 'acceptEdits', '--image-generation', '--max-budget-usd', '0.118135'],
      [
        { calls: [{ name: 'read_file', arguments: '{"path":"missing"}' }] },
        { calls: [image()], usage: { input: 1_015_808, output: 32_768 } },
      ],
    )
    const r = await h.run()
    expect(r.code).toBe(5)
    expect(h.api.imageBodies()).toHaveLength(0)
    expect(result(r).usage.paid.imageAttempts).toBe(0)
  })
  it('P9 invalid usage/image overrun stops admission without credit or stale completion', async () => {
    const invalid = await harness(
      [],
      [{ text: 'unsafe', usageOverride: { input_tokens: -1, output_tokens: 5 } }],
    )
    const bad = await invalid.run()
    expect(bad.code).toBe(9)
    expect(result(bad).usage.costUsd?.uncertain).toBe(0.108135)
    expect(result(bad).finalMessage).toBe(UI_TEXT.execMessageWithheld)
    const imageRun = await imageHarness('image.png', 'must not run')
    imageRun.api.images.push({ count: 2 })
    const over = await imageRun.run()
    expect(over.code).toBe(5)
    expect(result(over).ledger?.breach).toBe(true)
    expect(imageRun.api.responseBodies()).toHaveLength(1)
  })
  it.each([429, 500])(
    'P5/P6 image HTTP %s retains uncertainty with rate-limit-only retries',
    async (status) => {
      const h = await imageHarness()
      h.api.images.push({ httpError: { status, message: 'failed' } })
      if (status === 429) h.api.images.push({})
      const r = await h.run()
      expect(r.code).toBe(0)
      expect(result(r).usage.paid).toMatchObject({
        imageAttempts: status === 429 ? 2 : 1,
        imagesReturned: status === 429 ? 1 : 0,
        imagesUncertain: 1,
        uncertainUsd: 0.01,
      })
    },
  )
})
