import { readFileSync } from 'node:fs'
import * as z from 'zod/mini'
import { Usd } from '../../src/shared/usd'
import type { UsageRecording } from '../../src/core/usage/recording'
import { watchSessionTurns } from './helpers/sessionTurns'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import type { SessionStore } from '../../src/core/backends/modelapi/sessionStore'
import {
  ModelApiBackendManager,
  type ModelApiBackendManagerDeps,
} from '../../src/host/backend/modelApiBackendManager'
import * as modelApiEntry from '../../src/host/backend/modelApiEntry'
import { fakeMcpSource } from './helpers/fakeMcpSource'
import { FakeLogOutputChannel } from './helpers/fakes'
import {
  FAKE_MODEL_API_ACCOUNT_ID,
  fakeModelApi,
  fakeModelApiClient,
  streamFor,
  type FakeModelApi,
} from './helpers/fakeModelApi'
import { createProviderRegistry } from '../../src/core/providers/providerRegistry'
import { memoryContextIo } from './helpers/fakeContextIo'
import { noopToolIo } from './helpers/fakeToolIo'
import { fakeManagerDeps } from './helpers/modelApiManager'
import type { ToolIo } from '../../src/core/backends/modelapi/tools'
import { ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import * as hostModule from '../../src/core/backends/modelapi/ModelApiHost'
import { M106_CAPTURED_META_MODEL } from '../../src/shared/constants'
import { VerifyLedger } from '../../src/core/backends/modelapi/verifyLedger'
import { EditReview } from '../../src/host/editor/editReview'

interface HookFixture {
  readonly enabled: boolean
  readonly files: Map<string, string>
  readonly runHook: NonNullable<ToolIo['runHook']>
}

it('loads the provider factory only on first BYO resolution and reuses it', async () => {
  const meta = fakeModelApi()
  const provider = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const ref = 'team/small'
  const registry = byoRegistry(ref, provider, log, { capabilities: { toolCalling: true } })
  const createProviders = vi.fn(() => Promise.resolve(registry))
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(meta, log, {
      workspaceRoot: '/ws',
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
      createProviders,
    }),
  )
  try {
    const host = await manager.ensureHost()
    const session = await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(createProviders).not.toHaveBeenCalled()
    await session.setModel(ref)
    await session.setModel(ref)
    expect(createProviders).toHaveBeenCalledTimes(1)
    expect(await host.listModels(session.sessionId)).toContainEqual(
      expect.objectContaining({
        modelId: ref,
        providerId: 'team',
        isActive: true,
        pricing: 'local',
      }),
    )
  } finally {
    await manager.dispose()
  }
})

/** A BYO registry with one local model, for production-path binding tests. */
function byoRegistry(
  ref: string,
  provider: FakeModelApi,
  log: FakeLogOutputChannel,
  evidence: {
    readonly capabilities: { readonly toolCalling: true }
    readonly maxOutputTokens?: number
  },
) {
  return createProviderRegistry({
    models: () =>
      Promise.resolve([
        {
          ref,
          origin: 'https://example.test',
          pricing: { kind: 'local' },
          evidence,
        },
      ]),
    createClient: () => Promise.resolve(fakeModelApiClient(provider, log)),
    isCurrent: () => true,
  })
}

/** One read_file call ending in done text, scripted on the serving fake. */
function scriptReadDone(target: FakeModelApi) {
  target.script(
    { calls: [{ name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'c1' }] },
    { text: 'done' },
  )
}

/** A started session on the fake API, for production-path binding tests. */
async function boundSession(
  log: FakeLogOutputChannel,
  extra: Partial<ModelApiBackendManagerDeps> = {},
) {
  const { manager } = managerOn('/ws', undefined, log, undefined, extra)
  const host = await manager.ensureHost()
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'allowAll',
  })
  return { manager, host, session }
}

/** One read_file turn's request bodies through the serving fake. */
async function readTurnBodies(
  session: Parameters<typeof watchSessionTurns>[0],
  provider: FakeModelApi,
) {
  const watched = watchSessionTurns(session)
  scriptReadDone(provider)
  await session.sendTurn([{ type: 'text', text: 'read it' }])
  await watched.turnDone()
  return provider.responseBodies()
}

/** One qualified BYO record with a session client resolving through it. */
function resolvingClient(
  provider: FakeModelApi,
  log: FakeLogOutputChannel,
  ref: string,
  options: { readonly maxOutputTokens?: number; readonly withList: boolean },
) {
  const registry = byoRegistry(ref, provider, log, {
    capabilities: { toolCalling: true },
    ...(options.maxOutputTokens !== undefined && { maxOutputTokens: options.maxOutputTokens }),
  })
  const resolve = vi.fn((name: string) => registry.resolve(name))
  const client = Object.assign(fakeModelApiClient(provider, log), {
    models: {
      resolve,
      ...(options.withList && { list: registry.list }),
    },
  })
  return { registry, resolve, client }
}

/** Every request body carries the selected record's cap, never preview bytes. */
function expectSelectedCap(bodies: readonly Record<string, unknown>[], cap: number) {
  expect(bodies.length).toBeGreaterThan(0)
  for (const body of bodies) {
    expect(body['max_output_tokens']).toBe(cap)
  }
  expect(JSON.stringify(bodies)).not.toContain('argumentPreview')
}

/** A manager on the fake API with no waits, over the given root and store. */
function managerOn(
  workspaceRoot: string | undefined,
  store: ModelApiBackendManagerDeps['store'],
  log = new FakeLogOutputChannel(),
  hooks?: HookFixture,
  extra: Partial<ModelApiBackendManagerDeps> = {},
) {
  const api = fakeModelApi()
  return {
    api,
    log,
    manager: new ModelApiBackendManager(
      fakeManagerDeps(api, log, {
        workspaceRoot,
        store,
        ...(hooks !== undefined && {
          io: { ...noopToolIo, runHook: hooks.runHook },
          contextIo: memoryContextIo(hooks.files),
          isHooksEnabled: () => hooks.enabled,
        }),
        // The bundle's source module, imported rather than built (M57): the
        // built dist/modelApi.js is modelApiBundle.test.ts's.
        bundlePath: 'src/host/backend/modelApiEntry.ts',
        loadBundle: () => modelApiEntry,
        ...extra,
      }),
    ),
  }
}

function manager(workspaceRoot: string | undefined) {
  return managerOn(workspaceRoot, undefined)
}

describe('ModelApiBackendManager', () => {
  it('offers the window browser check only to the window host, never a best-of-N attempt (M81)', async () => {
    const check = vi.fn<NonNullable<ModelApiBackendManagerDeps['browserCheck']>['check']>(() =>
      Promise.resolve({ ok: false, failure: { kind: 'runtimeMissing' } }),
    )
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      browserCheck: { check, extraHosts: () => [], isOffered: () => true },
    })
    const windowHost = await m.manager.ensureHost()
    const parent = await windowHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    m.api.script({ text: 'parent' })
    await parent.sendTurn([{ type: 'text', text: 'hello' }])
    await vi.waitFor(() => {
      expect(m.api.responseBodies()).toHaveLength(1)
    })
    expect(JSON.stringify(m.api.responseBodies()[0])).toContain('browser_check')
    const attemptHost = await m.manager.buildAttemptHost('/trial', () => undefined)
    const attempt = await attemptHost.startSession({
      workspaceRoot: '/trial',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const events: AgentEvent[] = []
    attempt.onEvent((event) => {
      events.push(event)
    })
    m.api.script(
      { calls: [{ name: 'browser_check', arguments: '{"url":"http://localhost:3000/"}' }] },
      { text: 'done' },
    )
    await attempt.sendTurn([{ type: 'text', text: 'check' }])
    await vi.waitFor(() => {
      expect(events.some((event) => event.type === 'turnCompleted')).toBe(true)
    })
    expect(JSON.stringify(m.api.responseBodies()[1])).not.toContain('browser_check')
    expect(check).not.toHaveBeenCalled()
    await attemptHost.close()
    await m.manager.dispose()
  })

  it('forwards the legal scanner to production host construction, never to a best-of-N worktree', async () => {
    const create = vi.spyOn(modelApiEntry, 'createModelApiHost')
    const api = fakeModelApi()
    const legalScan = vi.fn(() => Promise.reject(new Error('scan not requested')))
    const manager = new ModelApiBackendManager(
      fakeManagerDeps(api, new FakeLogOutputChannel(), {
        workspaceRoot: '/ws',
        store: undefined,
        legalScan,
        bundlePath: 'src/host/backend/modelApiEntry.ts',
        loadBundle: () => modelApiEntry,
      }),
    )
    try {
      await manager.ensureHost()
      expect(create.mock.calls.at(-1)?.[0].host.legalScan).toBe(legalScan)
      const attempt = await manager.buildAttemptHost('/ws-trial', () => undefined)
      expect(create.mock.calls.at(-1)?.[0].host.legalScan).toBeUndefined()
      await attempt.close()
      expect(api.responseBodies()).toEqual([])
      expect(legalScan).not.toHaveBeenCalled()
    } finally {
      await manager.dispose()
      create.mockRestore()
    }
  })

  it('binds the selected record through the unmanaged production path', async () => {
    // No caller supplies preview or cap deps: the bundle entry installs the
    // Meta defaults, so this turn runs the same path VS Code, ACP and exec use.
    const { api, manager } = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      confirmContributorModel: () => Promise.resolve(true),
    })
    try {
      const host = await manager.ensureHost()
      for (const [modelId, wantPreview, wantCap] of [
        [M106_CAPTURED_META_MODEL, true, 131_072],
        ['muse-spark-1.2', false, 131_072],
        ['unobserved-model', false, 32_768],
      ] as const) {
        const session = await host.startSession({
          workspaceRoot: '/ws',
          modelId,
          approvalMode: 'allowAll',
        })
        const watched = watchSessionTurns(session)
        const before = api.responseBodies().length
        scriptReadDone(api)
        await session.sendTurn([{ type: 'text', text: 'read it' }])
        await watched.turnDone()
        const previews = watched.events.filter((event) => event.type === 'toolArgumentPreview')
        expect(previews.length > 0).toBe(wantPreview)
        if (wantPreview) {
          expect(previews.at(-1)).toMatchObject({
            item: { argumentPreview: { text: expect.stringContaining('a.txt') } },
          })
        }
        const bodies = api.responseBodies().slice(before)
        expect(bodies.length).toBeGreaterThan(0)
        for (const body of bodies) {
          expect(body['max_output_tokens']).toBe(wantCap)
        }
        expect(JSON.stringify(bodies)).not.toContain('argumentPreview')
      }
    } finally {
      await manager.dispose()
    }
  })

  it('binds a qualified selected record through the unmanaged production path', async () => {
    // RVCM1062 P2: a BYO record with authoritative output.maxTokens = 65536
    // must request 65536 through the production path (manager → entry), not
    // the legacy 32768. No caller supplies preview or cap deps: the entry
    // binds the registry record the host resolves for the selected model.
    // Without a streaming-argument capture the turn stays preview-free.
    const provider = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const ref = 'team/small'
    const registry = byoRegistry(ref, provider, log, {
      capabilities: { toolCalling: true },
      maxOutputTokens: 65_536,
    })
    const { manager } = managerOn('/ws', undefined, log, undefined, {
      createProviders: () => Promise.resolve(registry),
    })
    try {
      const host = await manager.ensureHost()
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'allowAll',
      })
      await session.setModel(ref)
      const watched = watchSessionTurns(session)
      scriptReadDone(provider)
      await session.sendTurn([{ type: 'text', text: 'read it' }])
      await watched.turnDone()
      expect(watched.events.filter((event) => event.type === 'toolArgumentPreview')).toEqual([])
      const bodies = provider.responseBodies()
      expect(bodies.length).toBeGreaterThan(0)
      for (const body of bodies) {
        expect(body['max_output_tokens']).toBe(65_536)
      }
      expect(JSON.stringify(bodies)).not.toContain('argumentPreview')
    } finally {
      await manager.dispose()
    }
  })

  it('resolves qualified records through the session client, never a standalone registry', async () => {
    // RVCM1062B P1 (headless accounting) and P2 (plan usage): the session
    // client already resolves qualified refs — accounting-wrapped on a
    // provider run, usage-owning where subscriptions live — so the entry
    // must bind its record without consulting a standalone registry. A
    // standalone resolve would bypass the daily reservation/run-ledger
    // admission and record plan usage where no reader looks.
    const provider = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const ref = 'team/small'
    const { registry, resolve, client } = resolvingClient(provider, log, ref, {
      maxOutputTokens: 65_536,
      withList: true,
    })
    const createProviders = vi.fn(() => Promise.resolve(registry))
    const { manager, session } = await boundSession(log, {
      createProviderClient: () => Promise.resolve(client),
      createProviders,
    })
    try {
      await session.setModel(ref)
      expect(resolve).toHaveBeenCalledWith(ref)
      expect(createProviders).not.toHaveBeenCalled()
      expectSelectedCap(await readTurnBodies(session, provider), 65_536)
    } finally {
      await manager.dispose()
    }
  })

  it('keeps subscription models selectable beside a subscription-blind registry', async () => {
    // RVCM1062B P1 (extension): a standalone registry names no
    // auth:'subscription' entry, so a plan ref it rejects must still
    // resolve against the session client, as before any registry existed.
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const client = Object.assign(fakeModelApiClient(api, log), {
      isPlanModel: (name: string) => name.startsWith('chatgpt/'),
    })
    const blind = byoRegistry('team/small', fakeModelApi(), log, {
      capabilities: { toolCalling: true },
    })
    const { manager, session } = await boundSession(log, {
      createProviderClient: () => Promise.resolve(client),
      createProviders: () => Promise.resolve(blind),
    })
    try {
      await session.setModel('chatgpt/gpt-6-astra')
      const watched = watchSessionTurns(session)
      await session.sendTurn([{ type: 'text', text: 'hi' }])
      await watched.turnDone()
      expect(api.responseBodies().length).toBeGreaterThan(0)
    } finally {
      await manager.dispose()
    }
  })

  it('binds the selected record cap through the session client resolver alone', async () => {
    // RVCM1062B P2 (interactive ACP): no createProviders is supplied there;
    // the configured resolver arrives on client.models, and the selected
    // record's output maximum must reach the request through the entry
    // stash, not the legacy cap.
    const provider = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const ref = 'team/small'
    const { resolve, client } = resolvingClient(provider, log, ref, {
      maxOutputTokens: 65_536,
      withList: true,
    })
    const { manager, session } = await boundSession(log, {
      createProviderClient: () => Promise.resolve(client),
    })
    try {
      await session.setModel(ref)
      expect(resolve).toHaveBeenCalledWith(ref)
      expectSelectedCap(await readTurnBodies(session, provider), 65_536)
    } finally {
      await manager.dispose()
    }
  })

  it('keeps the client-only catalogue when the session resolver lists nothing', async () => {
    // The accounting-wrapped runtime client resolves but does not list; the
    // entry must not turn that absence into a failure (the ACP agent lists
    // models on every session/new).
    const provider = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const ref = 'team/small'
    const { client } = resolvingClient(provider, log, ref, {
      maxOutputTokens: 65_536,
      withList: false,
    })
    const { manager, host, session } = await boundSession(log, {
      createProviderClient: () => Promise.resolve(client),
    })
    try {
      await session.setModel(ref)
      const listed = await host.listModels(session.sessionId)
      expect(listed.map((row) => row.modelId)).toContain('muse-spark-1.3')
      expectSelectedCap(await readTurnBodies(session, provider), 65_536)
    } finally {
      await manager.dispose()
    }
  })

  it('replays the captured U9 argument wire through the production path', async () => {
    // RVCM1062 P3: the production preview proof replays CAPTURED bytes, not
    // invented deltas. The U9 fixture keeps no raw per-delta payloads
    // (rawArgumentFramesAvailable: false), only the done arguments and the
    // counted delta sequence (two deltas then done). This turn serves the
    // byte-exact captured arguments as exactly two deltas through real SSE
    // framing, the production transport, parser and host (manager → entry
    // with no caller suppliers), and proves the preview renders the captured
    // text. Only the split point between the two deltas is the test's.
    const capture = z
      .object({
        streamSummary: z.object({
          function_call_arguments_delta_events: z.number(),
          function_call_arguments_done: z.array(
            z.object({ name: z.string(), arguments: z.string() }),
          ),
        }),
      })
      .parse(
        JSON.parse(
          readFileSync(new URL('../fixtures/m106/u9-strict-stream.json', import.meta.url), 'utf8'),
        ),
      )
    expect(capture.streamSummary.function_call_arguments_delta_events).toBe(2)
    const done = capture.streamSummary.function_call_arguments_done[0]
    if (done === undefined) throw new Error('the U9 capture names no completed call')
    const capturedArguments = done.arguments
    const halves: readonly [string, string] = [
      capturedArguments.slice(0, Math.floor(capturedArguments.length / 2)),
      capturedArguments.slice(Math.floor(capturedArguments.length / 2)),
    ]
    expect(halves.join('')).toBe(capturedArguments)
    const wire = streamFor(
      {
        calls: [{ name: done.name, arguments: capturedArguments, argumentDeltas: halves }],
      },
      'resp_u9',
      M106_CAPTURED_META_MODEL,
    )
    expect(wire.match(/^event: response\.function_call_arguments\.delta$/gm)).toHaveLength(2)
    expect(wire).toContain(JSON.stringify(capturedArguments).slice(1, -1))
    const { api, manager } = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      confirmContributorModel: () => Promise.resolve(true),
    })
    try {
      const host = await manager.ensureHost()
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: M106_CAPTURED_META_MODEL,
        approvalMode: 'allowAll',
      })
      const watched = watchSessionTurns(session)
      api.script({
        calls: [{ name: done.name, arguments: capturedArguments, argumentDeltas: halves }],
      })
      await session.sendTurn([{ type: 'text', text: 'check the weather' }])
      await watched.turnDone()
      const previews = watched.events.filter((event) => event.type === 'toolArgumentPreview')
      expect(previews.length).toBeGreaterThan(0)
      // The captured tool is undeclared to the host, so the grammar renders
      // no text (declared fields only) while the captured bytes still drive
      // every snapshot to the full captured length. Rendering undeclared
      // model bytes would fail this pin.
      expect(previews.every((event) => event.item.argumentPreview.text === '')).toBe(true)
      expect(
        previews.some((event) => event.item.argumentPreview.bytes === capturedArguments.length),
      ).toBe(true)
      const bodies = api.responseBodies()
      expect(bodies.length).toBeGreaterThan(0)
      for (const body of bodies) {
        expect(body['max_output_tokens']).toBe(131_072)
      }
      expect(JSON.stringify(bodies)).not.toContain('argumentPreview')
    } finally {
      await manager.dispose()
    }
  })

  it('keeps a caller-supplied selected record ahead of the Meta default', async () => {
    const create = vi.spyOn(modelApiEntry, 'createModelApiHost')
    const previews = vi.fn(() => undefined)
    const cap = vi.fn(() => 4096)
    const { manager } = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      argumentPreviewCapabilities: previews,
      modelOutputMaxTokens: cap,
    })
    try {
      await manager.ensureHost()
      const host = create.mock.calls.at(-1)?.[0]?.host
      expect(host?.argumentPreviewCapabilities).toBe(previews)
      expect(host?.modelOutputMaxTokens).toBe(cap)
    } finally {
      await manager.dispose()
      create.mockRestore()
    }
  })

  it('holds a manual revert across lazy startup and a same-id replacement without creating an own round', async () => {
    const m = manager('/ws')
    const entered = Promise.withResolvers<undefined>()
    const writing = Promise.withResolvers<undefined>()
    const added = vi.spyOn(m.manager.workspaceEdits, 'add')
    const review = new EditReview({
      workspaceRoot: '/ws',
      platform: 'linux',
      realPath: (file) => Promise.resolve(file),
      readFile: () => Promise.resolve('after\n'),
      hasUnsavedChanges: () => false,
      beginEdit: (file) => m.manager.beginExternalEdit(undefined, [file]),
      withAdmission: async (work) => await work(() => undefined),
      io: {
        writeFileIfUnchanged: async () => {
          entered.resolve(undefined)
          await writing.promise
          return 'written'
        },
        trashFileIfUnchanged: vi.fn(),
        createFileIfAbsent: vi.fn(),
      },
      openDiff: vi.fn(),
      log: m.log,
    })
    const patch =
      '{"files":[{"path":"notes.md","hunks":[{"oldStart":1,"newStart":1,"lines":["-before","+after"]}]}]}'
    const reverting = review.revert('i', patch)
    await entered.promise
    expect(m.manager.isRunning).toBe(false)
    expect(m.api.responseBodies()).toEqual([])
    const host = await m.manager.ensureHost()
    const options = { workspaceRoot: '/ws', modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
    const original = await host.startSession(options)
    original.dispose()
    const replacement = await host.startSession(options)
    expect(replacement.sessionId).toBe(original.sessionId)
    const ledger = added.mock.calls.at(-1)?.[0]
    if (!(ledger instanceof VerifyLedger) || !(replacement instanceof ModelApiSession)) {
      throw new TypeError('expected replacement source-module session and ledger')
    }
    const note = vi.spyOn(replacement, 'noteExternalEdit')
    ledger.resetForMessage()
    ledger.record('passed', ledger.snapshot('lint', 'project'))
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    writing.resolve(undefined)
    await reverting
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    expect(note).not.toHaveBeenCalled()
    expect(ledger.takeRoundEdits()).toEqual([])
    ledger.resetForMessage()
    ledger.record('passed', ledger.snapshot('lint', 'project'))
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(true)
    expect(m.api.responseBodies()).toEqual([])
    await m.manager.dispose()
  })

  it('M80 forwards only an explicitly provided stream idle interval to real client construction', async () => {
    const create = vi.spyOn(modelApiEntry, 'createModelApiHost')
    try {
      const api = fakeModelApi()
      const log = new FakeLogOutputChannel()
      const manager = new ModelApiBackendManager(
        fakeManagerDeps(api, log, {
          workspaceRoot: '/ws',
          store: undefined,
          streamIdleMs: 37,
          bundlePath: 'src/host/backend/modelApiEntry.ts',
          loadBundle: () => modelApiEntry,
        }),
      )
      await manager.ensureHost()
      expect(create.mock.calls.at(-1)?.[0].client.streamIdleMs).toBe(37)
      await manager.dispose()
    } finally {
      create.mockRestore()
    }
  })
  it('keeps host-origin writes pending before the lazy host and newly live ledger exist', async () => {
    const m = manager('/ws')
    const file = { relative: '.agents/plans/held.md', absolute: '/ws/.agents/plans/held.md' }
    const complete = m.manager.beginExternalEdit(undefined, [file])
    expect(m.manager.isRunning).toBe(false)
    const added = vi.spyOn(m.manager.workspaceEdits, 'add')
    const host = await m.manager.ensureHost()
    await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    const ledger = added.mock.calls[0]?.[0]
    if (!(ledger instanceof VerifyLedger)) {
      throw new TypeError('new session did not join the shared ledger registry')
    }
    ledger.resetForMessage()
    expect(ledger.changesWhatRuns('cat .agents/plans/held.md')).toBe(true)
    const started = ledger.snapshot('lint', 'project')
    ledger.record('passed', started)
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    complete(false)
    ledger.resetForMessage()
    expect(ledger.changesWhatRuns('cat .agents/plans/held.md')).toBe(false)
    expect(ledger.hasCurrentRun('lint', 'project')).toBe(false)
    await m.manager.dispose()
  })

  it.each([false, true])(
    'records a host-origin edit only for a true new-file result: %s',
    async (written) => {
      const m = manager('/ws')
      const host = await m.manager.ensureHost()
      const owner = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      if (!(owner instanceof ModelApiSession)) {
        throw new TypeError('expected source-module Model API owner')
      }
      const note = vi.spyOn(owner, 'noteExternalEdit')
      const file = { relative: '.agents/plans/held.md', absolute: '/ws/.agents/plans/held.md' }
      m.manager.beginExternalEdit(m.manager.captureExternalEditOwner(owner), [file])(written)
      expect(note).toHaveBeenCalledTimes(written ? 1 : 0)
      if (written) {
        expect(note).toHaveBeenCalledWith(file)
      }
      await m.manager.dispose()
    },
  )

  it.each([true, false])(
    'keeps the captured owner when the same id is revived (before begin: %s)',
    async (isBeforeBegin) => {
      const m = manager('/ws')
      const host = await m.manager.ensureHost()
      const options = { workspaceRoot: '/ws', modelId: 'muse-spark-1.3', approvalMode: 'onRequest' }
      const owner = await host.startSession(options)
      const captured = m.manager.captureExternalEditOwner(owner)
      expect(captured).toBeDefined()
      const file = { relative: '.agents/plans/held.md', absolute: '/ws/.agents/plans/held.md' }
      let complete = isBeforeBegin ? undefined : m.manager.beginExternalEdit(captured, [file])
      owner.dispose()
      const replacement = await host.startSession(options)
      if (!(replacement instanceof ModelApiSession)) {
        throw new TypeError('expected replacement Model API owner')
      }
      // The fixture reuses its id: object ownership must still distinguish the new session.
      expect(replacement.sessionId).toBe(owner.sessionId)
      const note = vi.spyOn(replacement, 'noteExternalEdit')
      complete ??= m.manager.beginExternalEdit(captured, [file])
      complete(true)
      expect(note).not.toHaveBeenCalled()
      await m.manager.dispose()
    },
  )

  it('reads hash-only account identity without a folder, bundle load or model request', async () => {
    const api = fakeModelApi()
    const loadBundle = vi.fn(() => modelApiEntry)
    const m = new ModelApiBackendManager(
      fakeManagerDeps(api, new FakeLogOutputChannel(), {
        workspaceRoot: undefined,
        bundlePath: 'src/host/backend/modelApiEntry.ts',
        loadBundle,
      }),
    )
    expect(await m.accountId()).toBe(FAKE_MODEL_API_ACCOUNT_ID)
    expect(m.isRunning).toBe(false)
    expect(loadBundle).not.toHaveBeenCalled()
    expect(api.requests).toEqual([])
    await m.dispose()
  })

  it('loads no hook command until the machine opt-in is on', async () => {
    const files = new Map([
      [
        '/cfg/muse/settings.json',
        JSON.stringify({
          schema_version: 1,
          hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'say' }] }] },
        }),
      ],
    ])
    const runHook = vi.fn(() =>
      Promise.resolve({
        stdout: '',
        stderr: '',
        exitCode: 0,
        isTimedOut: false,
        isCancelled: false,
      }),
    )
    const disabled = managerOn('/ws', undefined, new FakeLogOutputChannel(), {
      enabled: false,
      files,
      runHook,
    })
    const disabledHost = await disabled.manager.ensureHost()
    await disabledHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(runHook).not.toHaveBeenCalled()

    const enabled = managerOn('/ws', undefined, new FakeLogOutputChannel(), {
      enabled: true,
      files,
      runHook,
    })
    const enabledHost = await enabled.manager.ensureHost()
    await enabledHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(runHook).toHaveBeenCalledOnce()
  })

  it('logs a hook file the loader refuses, under Hooks (M51)', async () => {
    const log = new FakeLogOutputChannel()
    const m = managerOn('/ws', undefined, log, {
      enabled: true,
      files: new Map([['/cfg/muse/settings.json', '{ not json']]),
      runHook: vi.fn(),
    })
    const host = await m.manager.ensureHost()
    await host.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(log.warn).toHaveBeenCalledWith(
      'Hooks: settings.json: invalid JSON; user and managed hooks are off',
    )
  })

  it('hands the host the packing setting, read when each conversation starts (M73)', async () => {
    let isPacking = false
    let ids = 0
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      isObservationPackingOn: () => isPacking,
      newId: () => {
        ids += 1
        return `id-${String(ids)}`
      },
    })
    const host = await m.manager.ensureHost()
    const start = async () => {
      const session = await host.startSession({
        workspaceRoot: '/ws',
        modelId: 'muse-spark-1.3',
        approvalMode: 'onRequest',
      })
      if (!(session instanceof ModelApiSession)) {
        throw new TypeError('expected the Model API session')
      }
      return session
    }
    // A packing conversation keeps a ledger with its session; one that
    // does not pack has none.
    const before = await start()
    isPacking = true
    const after = await start()
    expect(before.snapshot().packedTokensAvoided).toBeUndefined()
    expect(after.snapshot().packedTokensAvoided).toBe(0)
    await m.manager.dispose()
    // The default, with no setting handed over, packs nothing.
    const plain = manager('/ws')
    const plainHost = await plain.manager.ensureHost()
    const session = await plainHost.startSession({
      workspaceRoot: '/ws',
      modelId: 'muse-spark-1.3',
      approvalMode: 'onRequest',
    })
    expect(session instanceof ModelApiSession ? session.snapshot().packedTokensAvoided : 0).toBe(
      undefined,
    )
    await plain.manager.dispose()
  })

  it('creates one host per window, lists its models, and forgets it on dispose', async () => {
    const m = manager('/ws')
    expect(m.manager.isRunning).toBe(false)
    const host = await m.manager.ensureHost()
    expect(await m.manager.ensureHost()).toBe(host)
    expect(m.manager.isRunning).toBe(true)
    expect(host.info).toMatchObject({ kind: 'modelApi', serverName: 'meta-model-api' })
    const models = await host.listModels()
    expect(models.map((model) => model.modelId)).toEqual([
      'muse-spark-1.3',
      'muse-spark-1.3-contributor',
      'muse-spark-1.2',
    ])
    expect(m.api.requests[0]?.headers['Authorization']).toBe('Bearer LLM|1|secret')
    await m.manager.dispose()
    expect(m.manager.isRunning).toBe(false)
    expect(m.log.info).toHaveBeenCalledWith(expect.stringContaining('Model API backend ready'))
  })

  it('gives the host its MCP servers for the workspace, shows their state, stops them (M50)', async () => {
    const servers = fakeMcpSource([])
    const roots: string[] = []
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      createMcpServers: (root) => {
        roots.push(root)
        return servers
      },
      ideTools: [],
    })
    expect(m.manager.mcpSnapshot()).toBeUndefined()
    await m.manager.ensureHost()
    expect(roots).toEqual(['/ws'])
    expect(m.manager.mcpSnapshot()).toBe(servers.snapshotValue)
    await m.manager.dispose()
    expect(servers.isClosed).toBe(true)
  })

  it("makes the host's MCP servers with the bundle's own pool (M50, M57)", async () => {
    const m = managerOn('/ws', undefined, new FakeLogOutputChannel(), undefined, {
      createMcpServers: (root, newPool) =>
        newPool({
          readSettings: () => ({ status: 'missing' }),
          lookupEnv: () => undefined,
          isWorkspaceTrusted: () => true,
          workspaceRoot: root,
          platform: 'linux',
          spawn: () => {
            throw new Error('no server is configured')
          },
          fetch: () => Promise.reject(new Error('no server is configured')),
          clientVersion: '0.0.0',
          log: new FakeLogOutputChannel(),
        }),
    })
    await m.manager.ensureHost()
    expect(m.manager.mcpSnapshot()).toEqual({ isStarted: false, fault: undefined, servers: [] })
    await m.manager.dispose()
  })

  it('refuses to start without a workspace', async () => {
    await expect(manager(undefined).manager.ensureHost()).rejects.toThrow('Open a folder first')
  })

  it('builds one host for concurrent callers, after the stored sessions are read (D25)', async () => {
    let lists = 0
    const store = {
      list: async () => {
        lists += 1
        await Promise.resolve()
        return []
      },
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const m = managerWith({ store })
    const [first, second] = await Promise.all([m.ensureHost(), m.ensureHost()])
    expect(second).toBe(first)
    expect(lists).toBe(1)
  })

  it('forgets a failed build so the next call tries again (D25)', async () => {
    let isBroken = true
    const store = {
      list: () => (isBroken ? Promise.reject(new Error('disk gone')) : Promise.resolve([])),
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    const m = managerWith({ store })
    await expect(m.ensureHost()).rejects.toThrow('disk gone')
    expect(m.isRunning).toBe(false)
    isBroken = false
    await expect(m.ensureHost()).resolves.toBeDefined()
  })

  it('makes a lazy store when the host is built, and a store that cannot load fails only that build', async () => {
    const store = {
      list: () => Promise.resolve([]),
      load: () => Promise.resolve(undefined),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    }
    let isMissing = true
    const makeStore = vi.fn(() => {
      if (isMissing) throw new Error('store bundle missing')
      return store
    })
    const m = managerOn('/ws', makeStore)
    expect(makeStore).not.toHaveBeenCalled()
    await expect(m.manager.ensureHost()).rejects.toThrow('store bundle missing')
    expect(m.manager.isRunning).toBe(false)
    isMissing = false
    await expect(m.manager.ensureHost()).resolves.toBeDefined()
    expect(makeStore).toHaveBeenCalledTimes(2)
    await m.manager.dispose()
  })

  it('closes a host whose build a dispose overtook, and builds anew after (D25)', async () => {
    const listed = Promise.withResolvers<[]>()
    const servers = fakeMcpSource([])
    const m = managerOn(
      '/ws',
      {
        list: () => listed.promise,
        load: () => Promise.resolve(undefined),
        save: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      new FakeLogOutputChannel(),
      undefined,
      { createMcpServers: () => servers },
    )
    const overtaken = m.manager.ensureHost()
    await m.manager.dispose()
    expect(m.manager.isRunning).toBe(false)
    listed.resolve([])
    await expect(overtaken).rejects.toThrow('stopped while it was starting')
    expect(servers.isClosed).toBe(true)
    expect(m.manager.isRunning).toBe(false)
    await m.manager.refreshSkills()
    const host = await m.manager.ensureHost()
    await expect(m.manager.ensureHost()).resolves.toBe(host)
    await m.manager.refreshSkills()
  })
})

/** A manager over a given session store, for the build-once cases. */
function managerWith(overrides: { store: SessionStore }) {
  return managerOn('/ws', overrides.store).manager
}

it('records best-of-N requests once with the attempt kind and its own session', async () => {
  const api = fakeModelApi()
  const recording: UsageRecording = {
    note: vi.fn(),
    limit: vi.fn(),
    today: () => Promise.resolve([]),
    flush: () => Promise.resolve(),
  }
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, new FakeLogOutputChannel(), {
      workspaceRoot: '/ws',
      sessionBudgetUsd: () => Usd.from(0).toAmount(),
      usageRecording: recording,
      bundlePath: 'source',
      loadBundle: () => modelApiEntry,
    }),
  )
  const host = await manager.buildAttemptHost('/attempt', () => undefined)
  try {
    const session = await host.startSession({
      workspaceRoot: '/attempt',
      modelId: 'muse-spark-1.3',
      approvalMode: 'allowAll',
    })
    const turns = watchSessionTurns(session)
    api.script({ text: 'attempt result' })
    await session.sendTurn([{ type: 'text', text: 'try' }])
    await turns.turnDone()
    expect(recording.note).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.objectContaining({ kind: 'bestOfN', session: session.sessionId }),
    )
  } finally {
    await host.close()
    await manager.dispose()
  }
})

async function windowHostDeps(
  api: FakeModelApi,
  log: FakeLogOutputChannel,
  reserveAutoCompaction?: () => Promise<undefined>,
) {
  const create = vi.spyOn(hostModule, 'ModelApiHost')
  const manager = new ModelApiBackendManager(
    fakeManagerDeps(api, log, {
      workspaceRoot: '/ws',
      store: undefined,
      ...(reserveAutoCompaction !== undefined && { reserveAutoCompaction }),
      bundlePath: 'src/host/backend/modelApiEntry.ts',
      loadBundle: () => modelApiEntry,
    }),
  )
  await manager.ensureHost()
  return { manager, host: create.mock.calls.at(-1)?.[0], create }
}

it('binds the shared automatic-compaction admission and model reader to production host construction', async () => {
  const api = fakeModelApi()
  const { manager, host, create } = await windowHostDeps(api, new FakeLogOutputChannel(), () =>
    Promise.resolve(undefined),
  )
  try {
    expect(typeof host?.autoCompactModel).toBe('function')
    expect(host?.autoCompactModel?.('muse-spark-1.3')?.pricing.kind).toBe('priced')
    expect(host?.autoCompactModel?.('openai/gpt-5')).toBe(undefined)
    expect(typeof host?.admitAutoCompaction).toBe('function')
    // No ledger means no admission: the host then sends no extra request.
    await expect(
      host?.admitAutoCompaction?.({
        sessionId: 'session',
        turnId: 'turn',
        modelId: 'muse-spark-1.3',
        model: { pricing: { kind: 'unpriced' } },
        decision: {
          reason: 'cost',
          newDebt: 1,
          saving: 2,
          breakEvenRequests: 3,
          writeReadRatio: 1,
        },
        signal: new AbortController().signal,
      }),
    ).resolves.toBe(undefined)
    await manager.dispose()
  } finally {
    create.mockRestore()
  }
})

it('leaves automatic compaction without production admission when the ledger is absent', async () => {
  const api = fakeModelApi()
  const { manager, host, create } = await windowHostDeps(api, new FakeLogOutputChannel())
  try {
    expect(typeof host?.autoCompactModel).toBe('function')
    expect(host?.admitAutoCompaction).toBe(undefined)
    await manager.dispose()
  } finally {
    create.mockRestore()
  }
})
