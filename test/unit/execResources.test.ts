import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as runtimeBackends from '../../src/runtime/backends'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { agentDataFolder } from '../../src/runtime/dataFolder'
import { createLifecycle } from '../../src/runtime/exec/execLimits'
import { execEventV2Schema, execEventSchema } from '../../src/runtime/exec/execProtocol'
import { runExec } from '../../src/runtime/exec/runExec'
import { createResourceExecSink } from '../../src/runtime/resources/execSink'
import {
  RESOURCE_EXEC_EVENT_VERSION,
  EXEC_SINK_HIGH_WATER_BYTES,
  UI_TEXT,
} from '../../src/shared/constants'
import type { RuntimeResources } from '../../src/runtime/resources/port'
import { resourceStatusSchema } from '../../src/shared/resources'
import { resourceHistorySchema } from '../../src/shared/resourceHistory'
import { FakeAgentHost } from './helpers/fakeAgent'
import { memorySecrets } from './helpers/fakes'
import { outputWriter, resultRecord } from './helpers/execContract'
import { runtimeResources } from './helpers/resources/runtime'
import { removeFolder } from './helpers/temporaryFolders'

const hosts: RuntimeResources[] = []
const folders: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const host of hosts.splice(0)) host.dispose()
  await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
})

function sinkScene(format: 'text' | 'json' | 'jsonl' = 'jsonl') {
  const out = outputWriter()
  const summary = vi.fn()
  const stalled = vi.fn()
  const sink = createResourceExecSink({
    format,
    out,
    now: () => 0,
    literals: () => ['private-canary'],
    summary,
    onStalled: stalled,
  })
  return { sink, out, summary, stalled }
}

function ignoreSignals() {
  return undefined
}
function noSignals() {
  return ignoreSignals
}

describe('M107 H headless flags and v2 egress', () => {
  it('parses terminal resources and validates headless flags without replacing omitted machine values', () => {
    expect(parseCommandLine(['resources', '--json'])).toEqual({
      command: 'resources',
      action: 'status',
      json: true,
    })
    expect(parseCommandLine(['usage', 'resources', '--json'])).toEqual({
      command: 'resources',
      action: 'history',
      json: true,
    })
    for (const action of ['status', 'history', 'resume'])
      expect(parseCommandLine(['resources', action])).toMatchObject({
        command: 'resources',
        action,
      })
    expect(parseCommandLine(['exec', 'task'])).toMatchObject({
      command: 'exec',
      resourceOverrides: {},
    })
    expect(
      parseCommandLine([
        'exec',
        '--resource-governor',
        'off',
        '--cpu-max',
        '75',
        '--memory-max',
        '80',
        'task',
      ]),
    ).toMatchObject({
      command: 'exec',
      resourceOverrides: { enabled: false, cpuMaxPercent: 75, memoryMaxPercent: 80 },
    })
    for (const args of [
      ['resources', 'wrong'],
      ['resources', 'status', 'extra'],
      ['resources', '--cpu-max', '80'],
      ['exec', '--resource-governor', 'false', 'task'],
      ['exec', '--cpu-max', '29', 'task'],
      ['exec', '--cpu-max', '101', 'task'],
      ['exec', '--cpu-max', 'NaN', 'task'],
      ['exec', '--memory-max', '39', 'task'],
      ['exec', '--memory-max', '99', 'task'],
      ['exec', '--memory-max', 'Infinity', 'task'],
      ['exec', '--resource-relocate', 'paired', 'task'],
      ['scan-secrets', '--cpu-max', '80', 'patch'],
    ])
      expect(parseCommandLine(args)).toMatchObject({ command: 'invalid', exitCode: 2 })
    expect(
      parseCommandLine([
        'exec',
        '--resource-governor',
        'on',
        '--cpu-max',
        '30',
        '--memory-max',
        '98',
        'task',
      ]),
    ).toMatchObject({
      command: 'exec',
      resourceOverrides: { enabled: true, cpuMaxPercent: 30, memoryMaxPercent: 98 },
    })
  })

  it('sequences ordinary and resource events together with the structured v2 result', async () => {
    const { sink, out } = sinkScene()
    sink.emit({ type: 'tool', name: 'shell', status: 'completed', durationMs: 1 })
    sink.resource({ type: 'deferred', atMs: 0, kind: 'check', class: 'background' })
    sink.message({
      itemId: 'message',
      kind: 'agentMessage',
      text: 'private-canary',
      complete: true,
    })
    await sink.finish(resultRecord())
    const events = out.chunks.map((chunk) => execEventV2Schema.parse(JSON.parse(chunk)))
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4])
    expect(events.map((event) => event.v)).toEqual(
      Array.from({ length: 4 }, () => RESOURCE_EXEC_EVENT_VERSION),
    )
    expect(events.map((event) => event.type)).toEqual(['tool', 'resource', 'message', 'result'])
    expect(events.at(-1)).toMatchObject({ result: { v: 2 } })
    expect(out.chunks.join('')).not.toContain('private-canary')
    expect(execEventSchema.safeParse(events[0]).success).toBe(true)
    expect(execEventSchema.safeParse(events[1]).success).toBe(false)
    const count = out.chunks.length
    sink.resource({ type: 'override', atMs: 0, untilMs: 1 })
    expect(out.chunks).toHaveLength(count)
  })

  it('retains recursive update privacy and refuses tree identity in resource events before output', () => {
    const { sink, out } = sinkScene()
    const textSink = sinkScene('text').sink
    const event = { type: 'override' as const, atMs: 0, untilMs: 1 }
    for (const key of ['pid', 'commandLine', 'path', 'environment']) {
      Reflect.set(event, key, 'canary')
      expect(() => sink.resource(event)).toThrow()
      expect(() => textSink.resource(event)).toThrow()
      Reflect.deleteProperty(event, key)
    }
    expect(() => {
      sink.emit({
        type: 'update',
        update: { sessionUpdate: 'future', nested: { rawOutput: 'canary' } },
      })
    }).toThrow()
    expect(out.chunks).toHaveLength(0)
  })

  it('preserves text/JSON results and checks resource backpressure and closed output', async () => {
    for (const format of ['text', 'json'] as const) {
      const s = sinkScene(format)
      expect(s.sink.resource({ type: 'paused', atMs: 0, kind: 'check' })).toBe(true)
      expect(s.out.chunks).toHaveLength(0)
      await s.sink.finish(resultRecord())
      expect(s.out.chunks).toHaveLength(1)
      expect(s.summary).toHaveBeenCalledTimes(1)
    }
    const s = sinkScene()
    Object.defineProperty(s.out, 'queuedBytes', {
      get: () => (s.out.chunks.length > 0 ? EXEC_SINK_HIGH_WATER_BYTES + 1 : 0),
    })
    expect(s.sink.resource({ type: 'paused', atMs: 0, kind: 'check' })).toBe(false)
    expect(s.stalled).toHaveBeenCalledTimes(1)
    s.sink.resource({ type: 'paused', atMs: 0, kind: 'check' })
    expect(s.out.chunks).toHaveLength(1)
  })

  it('routes actual runExec resource changes to v2 output and stderr, forces relocation off, and cleans up', async () => {
    const options = parseCommandLine(['exec', '--output', 'jsonl', 'fake task'])
    if (options.command !== 'exec') throw new Error('bad options')
    const backend = new FakeAgentHost()
    const start = backend.startSession.getMockImplementation()
    if (start === undefined) throw new Error('missing fake start')
    const fixture = await runtimeResources({ relocate: 'off' })
    hosts.push(fixture.host)
    let lateNotice: Parameters<RuntimeResources['subscribeEvents']>[0] | undefined
    let lateStatus: ReturnType<typeof resourceStatusSchema.parse> | undefined
    const subscribe = fixture.host.subscribeEvents.bind(fixture.host)
    const unsubscribe = vi.fn()
    vi.spyOn(fixture.host, 'subscribeEvents').mockImplementation((listener) => {
      lateNotice = listener
      const stop = subscribe(listener)
      return () => {
        stop()
        unsubscribe()
      }
    })
    const factory = vi.fn(() => fixture.host)
    backend.startSession.mockImplementation(async (options) => {
      const session = await start(options)
      const fake = backend.sessions.at(-1)
      if (fake === undefined) throw new Error('missing fake session')
      fake.sendTurn.mockImplementation(async () => {
        const admission = await fixture.host.admit(
          { kind: 'check', class: 'background', priority: 0 },
          { sessionId: session.sessionId },
        )
        const permit = await admission.ready
        fixture.reading.memoryAvailableBytes = 1
        lateStatus = await fixture.host.status()
        permit.release()
        fake.emit({ type: 'turnCompleted', turnId: 'fake-turn', terminal: 'completed' })
        return { turnId: 'fake-turn', disposition: 'started' }
      })
      return session
    })
    const realRuntime = runtimeBackends.createRuntimeBackend
    vi.spyOn(runtimeBackends, 'createRuntimeBackend').mockImplementation((options) => ({
      ...realRuntime(options),
      backend: {
        kind: 'museCode',
        readiness: () => Promise.resolve({ state: 'ready' }),
        hostFor: () => Promise.resolve(backend),
      },
      close() {
        if (lateStatus !== undefined)
          lateNotice?.(
            { type: 'override', atMs: 0, untilMs: 1 },
            lateStatus,
            'late-resource-canary',
          )
        return Promise.resolve()
      },
    }))
    const out = outputWriter()
    const err = outputWriter()
    const lifecycle = createLifecycle({
      processStartMs: 0,
      timeoutMs: options.options.timeoutMs,
      now: () => fixture.clock.now(),
      setTimer: (ms, callback) => fixture.clock.setTimeout(callback, ms),
      onSignal: noSignals,
      forceFinish: vi.fn(),
      exit: () => {
        throw new Error('unexpected force exit')
      },
    })
    const dispose = vi.spyOn(fixture.host, 'dispose')
    try {
      const code = await runExec(lifecycle, {
        options: options.options,
        version: 'test',
        distDir: '/unused',
        platform: process.platform,
        env: {},
        homeDir: '/unused',
        processCwd: process.cwd(),
        stdin: new PassThrough(),
        stdout: out,
        stderr: err,
        storeSecrets: memorySecrets(),
        runGit: () => Promise.resolve(''),
        fetch: vi.fn(() => Promise.reject(new Error('network forbidden'))),
        sleep: () => Promise.resolve(),
        now: () => fixture.clock.now(),
        readFile: () => Promise.reject(new Error('unused')),
        randomHex: () => 'fixed',
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        createResources: factory,
        resourceOverrides: { relocate: 'paired' },
      })
      expect(code).toBe(0)
      expect(factory).toHaveBeenCalledWith({ relocate: 'off' })
      const events = out.chunks.map((chunk) => execEventV2Schema.parse(JSON.parse(chunk)))
      expect(events.find((event) => event.type === 'resource')).toMatchObject({
        event: { type: 'levelChanged', to: 'pause' },
      })
      expect(events.filter((event) => event.type === 'resource')).toHaveLength(1)
      expect(events.at(-1)?.type).toBe('result')
      expect(err.chunks.join('')).toContain(UI_TEXT.resourcePauseNotice.split(':', 1)[0])
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(err.chunks.join('')).not.toContain('late-resource-canary')
    } finally {
      lifecycle.dispose()
    }
  })

  it('runs terminal resources against the real lazy entry without any key-store or model access', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm107h-cli-'))
    folders.push(folder)
    const dist = path.join(folder, 'dist')
    await mkdir(dist)
    await build({
      entryPoints: ['src/runtime/main.ts', 'src/runtime/resources/entry.ts'],
      outdir: dist,
      entryNames: '[name]',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['@napi-rs/keyring'],
      logLevel: 'silent',
    })
    // The release names are W's binding; test the exact loader filename here.
    const { rename } = await import('node:fs/promises')
    await rename(path.join(dist, 'entry.js'), path.join(dist, 'resourceGovernor.js'))
    await writeFile(path.join(folder, 'package.json'), '{"version":"test"}')
    const machine = path.join(folder, 'machine')
    const home = path.join(folder, 'home')
    const invoke = (args: string[]) =>
      promisify(execFile)(process.execPath, [path.join(dist, 'main.js'), ...args], {
        env: {
          LOCALAPPDATA: machine,
          USERPROFILE: home,
          HOME: home,
          XDG_DATA_HOME: machine,
          LANG: 'en_US.UTF-8',
        },
        timeout: 30_000,
      })
    const status = await invoke(['resources', '--json'])
    const raw: unknown = JSON.parse(status.stdout)
    expect(resourceStatusSchema.parse(raw)).toMatchObject({
      settings: { enabled: true, cpuMaxPercent: 85 },
      sample: { cpuPercent: null },
    })
    const resumed = await invoke(['resources', 'resume', '--json'])
    const resumeRaw: unknown = JSON.parse(resumed.stdout)
    expect(resourceStatusSchema.parse(resumeRaw).overrideUntilMs).toBeGreaterThan(Date.now())
    const storage = agentDataFolder({
      platform: process.platform,
      env: { LOCALAPPDATA: machine, XDG_DATA_HOME: machine },
      homeDir: home,
    })
    expect(await readFile(path.join(storage, 'resource-resume.json'), 'utf8')).toContain('untilMs')
    const help = await invoke(['--help'])
    expect(help.stdout).toContain('--resource-governor on|off')
    // Terminal history reads the machine journal: empty on a fresh machine, never invented.
    for (const args of [
      ['resources', 'history', '--json'],
      ['usage', 'resources', '--json'],
    ]) {
      const history = await invoke(args)
      expect(resourceHistorySchema.parse(JSON.parse(history.stdout))).toEqual({
        minutes: [],
        events: [],
        counts: [],
        work: [],
      })
    }
    // An unreadable journal exits non-zero and names it, with nothing on stdout.
    const day = path.join(
      storage,
      'usage',
      'v1',
      'resources',
      new Date().toISOString().slice(0, 10),
    )
    await mkdir(day, { recursive: true })
    await writeFile(path.join(day, 'other.0.jsonl'), 'garbage\n')
    await expect(invoke(['resources', 'history'])).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: expect.stringContaining(UI_TEXT.resourceHistoryInvalid),
    })
  })
})
