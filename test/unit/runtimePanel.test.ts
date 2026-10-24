// `muse-spark-code-acp panel --stdio` (M104 lane B): the packed agent's
// dist/acp.js from the shared production build, driven over real stdio by
// this suite as an editor's MHP host would drive it, every frame built and
// parsed with the frozen contract (src/shared/hostApi). Every per-user folder
// the runtime reads points into the suite's own folder; no provider, key or
// network is touched. What the host writes through the runtime lands in the
// files the runtime itself reads (runtimeDailyBudgetUsd).
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest'
import { runtimeDailyBudgetUsd } from '../../src/runtime/dailyBudgetSetting'
import { agentDataFolder } from '../../src/runtime/dataFolder'
import {
  MHP,
  MHP_ERROR_CODES,
  MHP_PANEL,
  RUNTIME_PANEL_STATE,
  SETTING_DEFAULTS,
} from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import type { MhpParams } from '../../src/shared/hostApi/methods'
import { panelInitializeResultSchema } from '../../src/shared/hostApi/panel'
import { failureFrameSchema, parseMhpResult } from '../../src/shared/hostApi/protocol'
import { assertCurrentProductionBuild } from './productionBuild'
import { removeFolder } from './helpers/temporaryFolders'
import { isolatedRuntimeEnvironment } from './helpers/isolatedRuntimeEnvironment'

const ROOT = process.cwd()
const AGENT = path.join(ROOT, 'dist', 'acp.js')
const FOLDER = realpathSync(mkdtempSync(path.join(tmpdir(), 'muse-panel-')))
const HOME = path.join(FOLDER, 'home')
const WORKSPACE = path.join(FOLDER, 'workspace')
const OTHER_FOLDER = path.join(FOLDER, 'other')
const MISSING_FOLDER = path.join(FOLDER, 'missing')
const STARTED = new Set<ChildProcessWithoutNullStreams>()

/** The runtime's per-user folders, all inside this suite's own folder. */
function environment(): NodeJS.ProcessEnv {
  return isolatedRuntimeEnvironment(HOME, FOLDER)
}

const DATA_FOLDER = agentDataFolder({
  platform: process.platform,
  env: environment(),
  homeDir: HOME,
})

/** The editor's side of one connection: frames out, frames in by id. */
interface Host {
  readonly child: ChildProcessWithoutNullStreams
  readonly exited: Promise<number | null>
  send(frame: unknown): void
  /** Sends a request and resolves with the frame answering its id. */
  request(method: string, params: unknown): Promise<unknown>
  /** The next frame without an id the host is waiting on (a panel error, an id-less failure). */
  nextUnsolicited(): Promise<unknown>
  stderr(): string
}

function serve(args: readonly string[]): Host {
  const child = spawn(process.execPath, [AGENT, ...args], {
    cwd: WORKSPACE,
    env: environment(),
    stdio: 'pipe',
  })
  STARTED.add(child)
  const exited = new Promise<number | null>((resolve) => {
    child.once('close', (code) => {
      STARTED.delete(child)
      resolve(code)
    })
  })
  let errors = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    errors += chunk
  })
  const waiting = new Map<string, (frame: unknown) => void>()
  const unsolicited: unknown[] = []
  const unsolicitedWaiters: ((frame: unknown) => void)[] = []
  let buffered = ''
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    buffered += chunk
    for (let end = buffered.indexOf('\n'); end !== -1; end = buffered.indexOf('\n')) {
      const frame: unknown = JSON.parse(buffered.slice(0, end))
      buffered = buffered.slice(end + 1)
      const id =
        typeof frame === 'object' &&
        frame !== null &&
        'id' in frame &&
        (typeof frame.id === 'string' || typeof frame.id === 'number')
          ? String(frame.id)
          : undefined
      const resolve = id === undefined ? undefined : waiting.get(id)
      if (id !== undefined && resolve !== undefined) {
        waiting.delete(id)
        resolve(frame)
      } else {
        const next = unsolicitedWaiters.shift()
        if (next === undefined) unsolicited.push(frame)
        else next(frame)
      }
    }
  })
  let nextId = 1
  const send = (frame: unknown) => {
    child.stdin.write(`${JSON.stringify(frame)}\n`)
  }
  return {
    child,
    exited,
    send,
    request: (method, params) => {
      const id = `host-${String(nextId++)}`
      const answered = new Promise<unknown>((resolve) => {
        waiting.set(id, resolve)
      })
      send({ jsonrpc: MHP.jsonRpcVersion, id, method, params })
      return answered
    },
    nextUnsolicited: () => {
      const head = unsolicited.shift()
      if (head !== undefined) return Promise.resolve(head)
      return new Promise((resolve) => {
        unsolicitedWaiters.push(resolve)
      })
    },
    stderr: () => errors,
  }
}

function initializeParams(
  overrides: Partial<MhpParams<'initialize'>> = {},
): MhpParams<'initialize'> {
  return {
    host: { id: 'runtime-panel-suite', version: '1.0.0' },
    protocolRange: { minimum: MHP.minimumVersion, maximumExclusive: MHP.maximumVersionExclusive },
    capabilities: ['lifecycle', 'ui'],
    locale: 'en',
    theme: { kind: 'dark', tokens: {} },
    folders: [{ uri: pathToFileURL(WORKSPACE).href, name: 'workspace' }],
    trusted: true,
    ...overrides,
  }
}

/** The failure a frame carries: its code and message. */
function failureOf(frame: unknown): { code: number; message: string } {
  return failureFrameSchema.parse(frame).error
}

async function initialized(): Promise<Host> {
  const host = serve(['panel', '--stdio'])
  panelInitializeResultSchema.parse(await host.request('initialize', initializeParams()))
  return host
}

/** Shutdown, then the exit code: the host keeps its end of the pipe open, as a running editor does. */
async function shutDown(host: Host): Promise<number | null> {
  parseMhpResult('shutdown', await host.request('shutdown', {}))
  return await host.exited
}

beforeAll(() => {
  assertCurrentProductionBuild(inject('productionBuildGeneration'), ROOT)
  mkdirSync(WORKSPACE, { recursive: true })
  mkdirSync(OTHER_FOLDER, { recursive: true })
})

afterAll(async () => {
  for (const child of STARTED) child.kill()
  await removeFolder(FOLDER)
})

describe('panel --stdio', () => {
  it('negotiates MHP 1.5, refuses a second handshake, and exits 0 after shutdown', async () => {
    const host = serve(['panel', '--stdio'])
    // Nothing before the handshake.
    expect(
      failureOf(await host.request('settings/get', { key: 'museSpark.autosave' })),
    ).toMatchObject({ code: MHP_ERROR_CODES.invalidRequest, message: 'MHP_NOT_INITIALIZED' })
    const result = panelInitializeResultSchema.parse(
      await host.request('initialize', initializeParams()),
    )
    expect(result.result).toEqual({
      protocolVersion: MHP.version,
      capabilities: ['lifecycle', 'settings', 'storage'],
    })
    expect(failureOf(await host.request('initialize', initializeParams()))).toMatchObject({
      code: MHP_ERROR_CODES.invalidRequest,
      message: 'MHP_ALREADY_INITIALIZED',
    })
    expect(await shutDown(host)).toBe(0)
  })

  it('refuses a version range without MHP 1.5, and a folder that is not its workspace', async () => {
    const host = serve(['panel', '--stdio'])
    expect(
      failureOf(
        await host.request(
          'initialize',
          initializeParams({
            protocolRange: { minimum: 'mhp/1.6.0', maximumExclusive: 'mhp/1.7.0' },
          }),
        ),
      ),
    ).toMatchObject({
      code: MHP_ERROR_CODES.incompatibleVersion,
      message: 'MHP_INCOMPATIBLE_VERSION',
    })
    for (const folder of [OTHER_FOLDER, MISSING_FOLDER])
      expect(
        failureOf(
          await host.request(
            'initialize',
            initializeParams({ folders: [{ uri: pathToFileURL(folder).href, name: 'other' }] }),
          ),
        ),
        folder,
      ).toMatchObject({
        code: MHP_ERROR_CODES.invalidParams,
        message: 'MHP_WORKSPACE_BINDING_MISMATCH',
      })
    host.child.stdin.end()
    expect(await host.exited).toBe(1)
  })

  it('writes a setting where the runtime reads it, and keeps the person’s settings their own', async () => {
    const host = await initialized()
    expect(
      parseMhpResult(
        'settings/update',
        await host.request('settings/update', {
          key: 'museSpark.paidDailyBudgetUsd',
          value: 4.5,
          scope: 'user',
        }),
      ).result,
    ).toBeNull()
    expect(runtimeDailyBudgetUsd(DATA_FOLDER)).toBe(4.5)
    expect(
      parseMhpResult(
        'settings/get',
        await host.request('settings/get', { key: 'museSpark.paidDailyBudgetUsd' }),
      ).result,
    ).toEqual({ value: 4.5 })
    // What runs and what is billed is never a workspace's to set (D15).
    expect(
      failureOf(
        await host.request('settings/update', {
          key: 'museSpark.paidDailyBudgetUsd',
          value: 9,
          scope: 'workspace',
        }),
      ),
    ).toMatchObject({
      code: MHP_ERROR_CODES.permissionDenied,
      message: 'MHP_STATE_MACHINE_SETTING',
    })
    expect(
      failureOf(
        await host.request('settings/update', {
          key: 'museSpark.autosave',
          value: 'sometimes',
          scope: 'user',
        }),
      ),
    ).toMatchObject({ code: MHP_ERROR_CODES.invalidParams, message: 'MHP_STATE_INVALID_VALUE' })
    expect(
      parseMhpResult(
        'settings/get',
        await host.request('settings/get', { key: 'museSpark.autosave' }),
      ).result,
    ).toEqual({ value: SETTING_DEFAULTS.autosave })
    expect(await shutDown(host)).toBe(0)
  })

  it('keeps the two storage scopes apart across connections', async () => {
    const first = await initialized()
    await first.request('storage/workspace.set', { key: 'layout', value: { pane: 'right' } })
    await first.request('storage/global.set', { key: 'layout', value: 'wide' })
    expect(await shutDown(first)).toBe(0)
    const second = await initialized()
    expect(
      parseMhpResult(
        'storage/workspace.get',
        await second.request('storage/workspace.get', { key: 'layout' }),
      ).result,
    ).toEqual({ value: { pane: 'right' } })
    expect(
      parseMhpResult(
        'storage/global.get',
        await second.request('storage/global.get', { key: 'layout' }),
      ).result,
    ).toEqual({ value: 'wide' })
    expect(await shutDown(second)).toBe(0)
  })

  it('loses no setting when two runtimes write the same file at once', async () => {
    const left = await initialized()
    const right = await initialized()
    const writes = Array.from({ length: 12 }, (_, index) => ({
      host: index % 2 === 0 ? left : right,
      key: `entry-${String(index)}`,
    }))
    await Promise.all(
      writes.map(({ host, key }, index) =>
        host.request('storage/global.set', { key, value: { index } }),
      ),
    )
    const stored: unknown = JSON.parse(
      await readFile(path.join(DATA_FOLDER, RUNTIME_PANEL_STATE.storageFile), 'utf8'),
    )
    for (const [index, { key }] of writes.entries())
      expect(stored, key).toHaveProperty([key], { index })
    expect(await shutDown(left)).toBe(0)
    expect(await shutDown(right)).toBe(0)
  })

  it('answers a malformed line and an unknown method, and survives them', async () => {
    const host = await initialized()
    host.child.stdin.write('{not json\n')
    expect(failureOf(await host.nextUnsolicited())).toMatchObject({
      code: MHP_ERROR_CODES.parseError,
    })
    expect(failureOf(await host.request('no/suchMethod', {}))).toMatchObject({
      code: MHP_ERROR_CODES.methodNotFound,
    })
    expect(failureOf(await host.request('workspace/folders', {}))).toMatchObject({
      code: MHP_ERROR_CODES.invalidRequest,
      message: 'MHP_WRONG_DIRECTION',
    })
    expect(await shutDown(host)).toBe(0)
  })

  it('ends the connection, saying why, on a line longer than MHP allows', async () => {
    const host = await initialized()
    host.child.stdin.write(`${'x'.repeat(MHP_PANEL.maximumEnvelopeBytes + 1)}\n`)
    expect(await host.exited).toBe(1)
    expect(host.stderr()).toContain('MHP_PANEL_TOO_LARGE')
  })

  it('ends with exit 1 when the host goes away without shutdown', async () => {
    const host = await initialized()
    host.child.stdin.end()
    expect(await host.exited).toBe(1)
    expect(host.stderr()).not.toContain('MHP_REQUEST_FAILED')
  })

  it('refuses to start without a transport', async () => {
    const host = serve(['panel'])
    expect(await host.exited).toBe(2)
    expect(host.stderr()).toContain(EN.hostService.needsStdio)
  })
})
