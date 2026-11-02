// M88 lane C (PLAN.md D67, item 15): Muse Code timed sends' account
// binding. While META_API_KEY is present in the window's environment
// Muse Code offers no timed send (creation and admission refuse in
// words), and a sign-out or sign-in the host sees clears the
// workspace's Muse Code once-schedules (at start, at every Muse Code
// admission, before the surface lists; the transcript says why). The
// sweep below runs against a real engine over a real store; the
// verdicts come from the CLI's recorded credential shapes.
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { credentialFileVerdict } from '../../src/core/backends/musecode/credentialFile'
import { createScheduleEngine } from '../../src/runtime/schedules/engine'
import { ScheduleSurface } from '../../src/runtime/schedules/surface'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import type { ScheduleCallerContext } from '../../src/runtime/schedules/args'
import {
  createNodeScheduleFs,
  createNodeScheduleQueue,
} from '../../src/runtime/schedules/nodeScheduleFs'
import { workspaceKey } from '../../src/runtime/dataFolder'
import {
  admitMuseCodeOnce,
  bindingTransition,
  checkMuseCodeBinding,
  type MuseCodeBindingCheckDeps,
  type MuseCodeOnceAdmitDeps,
  type MuseCodeScheduleSignIn,
  type MuseCodeSeen,
  isMuseCodeOnceTarget,
  museCodeSignInOf,
  staleMuseCodeOnceIds,
} from '../../src/host/schedules/museCodeBinding'
import { createSchedulesBridge } from '../../src/host/schedules/schedulesBridge'
import {
  isScheduleDispatchRefusal,
  scheduleDispatchRefusal,
} from '../../src/core/schedules/dispatchRefusal'
import { SCHEDULE_PROTOCOL_VERSION, UI_TEXT } from '../../src/shared/constants'
import {
  scheduleDraftSchema,
  scheduleV2Schema,
  type ScheduleDraft,
  type ScheduleRequest,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import {
  scheduleResponseMessageSchema,
  scheduleWebviewMessageSchema,
} from '../../src/shared/scheduleProtocol'
import { AUTH_SET_FILE, LOGOUT_SHELL } from './helpers/credentialShapes'
import { scheduleFixture } from './helpers/scheduleFixtures'
import { closeSharedScheduleEngine } from './helpers/schedules/scheduleTestRig'
import { temporaryDir } from './helpers/temporaryFolders'

const silentLog = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function neverReached(name: string): () => never {
  return () => {
    throw new Error(`must stay unreached: ${name}`)
  }
}

function responseOf(answer: unknown) {
  return scheduleResponseMessageSchema.parse(answer).response
}

function errorMessage(value: unknown): string {
  if (!(value instanceof Error)) throw new TypeError('expected an Error')
  return value.message
}

async function caughtError(work: () => Promise<unknown>): Promise<unknown> {
  try {
    await work()
    return undefined
  } catch (error: unknown) {
    return error
  }
}

function memorySeen(seen: Map<string, MuseCodeSeen>): MuseCodeBindingCheckDeps['seen'] {
  return {
    load: (workspace: string) => Promise.resolve(seen.get(workspace)),
    save: (workspace: string, value: MuseCodeSeen) => {
      seen.set(workspace, value)
      return Promise.resolve()
    },
  }
}

function admitRig() {
  const seen = new Map<string, MuseCodeSeen>()
  const signIn: MuseCodeScheduleSignIn = 'signedIn'
  const rig: {
    readonly seen: Map<string, MuseCodeSeen>
    signIn: MuseCodeScheduleSignIn
    hasEnvironmentKey: boolean
    readonly deps: MuseCodeOnceAdmitDeps
  } = {
    seen,
    signIn,
    hasEnvironmentKey: false,
    deps: {
      hasEnvironmentKey: () => rig.hasEnvironmentKey,
      currentSignIn: () => rig.signIn,
      seen: memorySeen(seen),
      nowMs: 1_700_000_100_000,
    },
  }
  return rig
}

function admissionJob(overrides: Partial<ScheduleV2> = {}) {
  return scheduleFixture({
    workspaceKey: 'workspace-1',
    target: { kind: 'conversation', sessionId: 'session-1', backend: 'museCode' },
    trigger: { kind: 'once', atMs: 1_800_000_000_000 },
    createdAtMs: 1_700_000_000_000,
    ...overrides,
  })
}

describe('museCodeSignInOf', () => {
  it('reads the recorded sign-in shapes as signed in', () => {
    // `muse auth set` (Windows and Linux) and the sign-out shell: the
    // real verdict over the CLI's recorded shapes, never a value.
    expect(museCodeSignInOf(credentialFileVerdict(AUTH_SET_FILE, 'linux'))).toBe('signedIn')
    expect(museCodeSignInOf(credentialFileVerdict(LOGOUT_SHELL, 'linux'))).toBe('signedOut')
  })

  it('maps every verdict without asking the CLI', () => {
    expect(museCodeSignInOf('inline')).toBe('signedIn')
    expect(museCodeSignInOf('keychain')).toBe('signedIn')
    expect(museCodeSignInOf('empty')).toBe('signedOut')
    expect(museCodeSignInOf('absent')).toBe('signedOut')
    expect(museCodeSignInOf('unsupportedHere')).toBe('unknown')
    expect(museCodeSignInOf('unrecognized')).toBe('unknown')
  })
})

describe('bindingTransition', () => {
  it('records the first sight silently and changes loudly', () => {
    expect(bindingTransition('signedIn', undefined, 100)).toEqual({
      seen: { signIn: 'signedIn' },
      transitioned: false,
    })
    expect(bindingTransition('signedIn', { signIn: 'signedIn' }, 100)).toBeUndefined()
    expect(bindingTransition('signedOut', { signIn: 'signedIn' }, 200)).toEqual({
      seen: { signIn: 'signedOut', transitionMs: 200 },
      transitioned: true,
    })
  })

  it('leaves unknown reads unanswered, keeping what was seen', () => {
    expect(bindingTransition('unknown', { signIn: 'signedIn' }, 100)).toBeUndefined()
    expect(bindingTransition('unknown', undefined, 100)).toBeUndefined()
  })
})

describe('isMuseCodeOnceTarget', () => {
  it('names timed sends only', () => {
    const once = { kind: 'once', atMs: 1_700_000_000_000 } as const
    const interval = { kind: 'interval', everyMs: 3_600_000, anchorMs: 0 } as const
    expect(
      isMuseCodeOnceTarget({ kind: 'conversation', sessionId: 's', backend: 'museCode' }, once),
    ).toBe(true)
    expect(isMuseCodeOnceTarget({ kind: 'newConversation', backend: 'museCode' }, once)).toBe(true)
    expect(
      isMuseCodeOnceTarget({ kind: 'conversation', sessionId: 's', backend: 'modelApi' }, once),
    ).toBe(false)
    expect(
      isMuseCodeOnceTarget({ kind: 'conversation', sessionId: 's', backend: 'museCode' }, interval),
    ).toBe(false)
  })
})

describe('staleMuseCodeOnceIds', () => {
  it('retires Muse Code onces from before the transition, nothing else', () => {
    const line = 1_700_000_050_000
    const rows = [
      scheduleFixture({
        id: 'stale-once',
        target: { kind: 'conversation', sessionId: 's', backend: 'museCode' },
        trigger: { kind: 'once', atMs: line + 60_000 },
        createdAtMs: line - 1,
      }),
      scheduleFixture({
        id: 'fresh-once',
        target: { kind: 'conversation', sessionId: 's', backend: 'museCode' },
        trigger: { kind: 'once', atMs: line + 60_000 },
        createdAtMs: line + 1,
      }),
      scheduleFixture({
        id: 'modelapi-once',
        target: { kind: 'conversation', sessionId: 's', backend: 'modelApi' },
        trigger: { kind: 'once', atMs: line + 60_000 },
        createdAtMs: line - 1,
      }),
      scheduleFixture({
        id: 'musecode-interval',
        target: { kind: 'conversation', sessionId: 's', backend: 'museCode' },
        trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 0 },
        createdAtMs: line - 1,
      }),
    ]
    expect(staleMuseCodeOnceIds(rows, line)).toEqual(['stale-once'])
  })
})

describe('scheduleDispatchRefusal', () => {
  it('brands structurally, so a duplicate copy still reads', () => {
    const refusal = scheduleDispatchRefusal(UI_TEXT.museCodeOnceAccountChanged)
    expect(refusal).toBeInstanceOf(Error)
    expect(isScheduleDispatchRefusal(refusal)).toBe(true)
    expect(isScheduleDispatchRefusal(new Error(UI_TEXT.museCodeOnceAccountChanged))).toBe(false)
    // A second copy of the module builds the same shape (the activation
    // bundle throws, the lazy schedules bundle catches): the shape, not
    // the class identity, carries the refusal.
    const duplicate = Object.assign(new Error('x'), {
      refusalCode: 'scheduleDispatchRefusal',
      sentence: 'y',
    })
    expect(isScheduleDispatchRefusal(duplicate)).toBe(true)
    expect(isScheduleDispatchRefusal({ refusalCode: 'scheduleDispatchRefusal' })).toBe(false)
  })
})

interface BindingShared {
  readonly engine: Awaited<ReturnType<typeof createScheduleEngine>>
  readonly root: string
  /** One workspace for every test: a single control warmup, reset between tests. */
  readonly workspace: string
  readonly reported: unknown[]
  readonly notices: string[]
  readonly seen: Map<string, MuseCodeSeen>
  signIn: MuseCodeScheduleSignIn
  hasEnvironmentKey: boolean
  failSeenLoad: boolean
}

const sharedBox: { current?: BindingShared | undefined } = {}

function useShared(): BindingShared {
  if (sharedBox.current === undefined) throw new Error('expected the binding engine')
  return sharedBox.current
}

function onceDraft(target: ScheduleDraft['target']): ScheduleDraft {
  return scheduleDraftSchema.parse({
    name: 'Timed send',
    action: { kind: 'prompt', prompt: 'Water the plants.' },
    trigger: { kind: 'once', atMs: 1_800_000_000_000 },
    target,
    delivery: 'newConversation',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: [], paidCapUsd: '0' },
    paidCapUsd: '0',
    parallel: false,
    zone: 'UTC',
    pinned: false,
  })
}

function envelopeOf(request: unknown, requestId: string): unknown {
  return scheduleWebviewMessageSchema.parse({
    type: 'schedulesRequest',
    version: SCHEDULE_PROTOCOL_VERSION,
    requestId,
    request,
  })
}

async function seedJob(
  context: BindingShared,
  workspace: string,
  overrides: Partial<ScheduleV2> = {},
): Promise<ScheduleV2> {
  const job = scheduleV2Schema.parse(
    scheduleFixture({
      workspaceKey: workspaceKey(workspace),
      target: { kind: 'conversation', sessionId: 'session-1', backend: 'museCode' },
      trigger: { kind: 'once', atMs: 1_800_000_000_000 },
      createdAtMs: 1_700_000_000_000,
      ...overrides,
    }),
  )
  await context.engine.store.create(job)
  return job
}

async function listedIds(context: BindingShared, workspace: string): Promise<readonly string[]> {
  const jobs = await context.engine.store.list(workspaceKey(workspace))
  return jobs.map((job) => job.id)
}

// Each case lists and sweeps through the real engine over the fsync'd
// journal store: a loaded rig needs more than the five-second default.
const DURABLE_COMMITS_TIMEOUT_MS = 30_000

describe('museCode binding against a real engine', { timeout: DURABLE_COMMITS_TIMEOUT_MS }, () => {
  beforeAll(async () => {
    const root = await temporaryDir('schedules-muse-binding-')
    const reported: unknown[] = []
    const notices: string[] = []
    const seen = new Map<string, MuseCodeSeen>()
    const live = (): BindingShared => {
      if (sharedBox.current === undefined) throw new Error('expected the binding engine')
      return sharedBox.current
    }
    const engine = await createScheduleEngine({
      log: silentLog,
      fs: createNodeScheduleFs(root),
      queue: createNodeScheduleQueue(root),
      onError: (error: unknown) => {
        reported.push(error)
      },
      museCodeBinding: {
        hasEnvironmentKey: () => live().hasEnvironmentKey,
        currentSignIn: () => live().signIn,
        seen: {
          load: (workspace: string) => {
            return live().failSeenLoad
              ? Promise.reject(new Error('seen unavailable'))
              : Promise.resolve(seen.get(workspace))
          },
          save: (workspace: string, value: MuseCodeSeen) => {
            seen.set(workspace, value)
            return Promise.resolve()
          },
        },
        notice: (text: string) => {
          notices.push(text)
        },
      },
    })
    sharedBox.current = {
      engine,
      root,
      workspace: path.join(root, 'binding'),
      reported,
      notices,
      seen,
      signIn: 'signedIn',
      hasEnvironmentKey: false,
      failSeenLoad: false,
    }
  })

  beforeEach(() => {
    const context = useShared()
    context.signIn = 'signedIn'
    context.hasEnvironmentKey = false
    context.failSeenLoad = false
    context.seen.clear()
  })

  afterEach(async () => {
    const context = useShared()
    const key = workspaceKey(context.workspace)
    const jobs = await context.engine.store.list(key)
    for (const job of jobs) {
      await context.engine.store.remove(key, job.id)
    }
  })

  afterAll(async () => {
    await closeSharedScheduleEngine(sharedBox)
  })

  it('sweeps a seen sign-out before the surface lists, and says why', async () => {
    const context = useShared()
    const workspace = context.workspace
    const stale = await seedJob(context, workspace, { id: 'sweep-stale' })
    await seedJob(context, workspace, {
      id: 'sweep-modelapi',
      target: { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
    })
    // Seen signed in before; the host now reads a sign-out.
    context.seen.set(workspaceKey(workspace), { signIn: 'signedIn' })
    context.signIn = 'signedOut'
    const noticesBefore = context.notices.length
    const answer = responseOf(
      await context.engine.runtime.message(
        envelopeOf({ method: 'schedules/list', workspaceKey: workspaceKey(workspace) }, 'list-1'),
        workspace,
      ),
    )
    if (answer.kind !== 'list') throw new TypeError('expected the schedule list')
    expect(answer.schedules.map((row) => row.id)).toEqual(['sweep-modelapi'])
    expect(await listedIds(context, workspace)).toEqual(['sweep-modelapi'])
    expect(context.notices.length - noticesBefore).toBe(1)
    expect(context.notices.at(-1)).toContain('removed')
    const saved = context.seen.get(workspaceKey(workspace))
    expect(saved?.signIn).toBe('signedOut')
    expect(saved?.transitionMs).toBeGreaterThan(stale.createdAtMs)
  })

  it('leaves the list alone without a transition', async () => {
    const context = useShared()
    const workspace = context.workspace
    await seedJob(context, workspace, { id: 'steady-once' })
    context.seen.set(workspaceKey(workspace), { signIn: 'signedOut' })
    context.signIn = 'signedOut'
    const noticesBefore = context.notices.length
    const answer = responseOf(
      await context.engine.runtime.message(
        envelopeOf({ method: 'schedules/list', workspaceKey: workspaceKey(workspace) }, 'list-2'),
        workspace,
      ),
    )
    if (answer.kind !== 'list') throw new TypeError('expected the schedule list')
    expect(answer.schedules.map((row) => row.id)).toEqual(['steady-once'])
    expect(context.notices.length - noticesBefore).toBe(0)
  })

  it('sweeps on an admission-consumed line, keeping newer sends', async () => {
    const context = useShared()
    const workspace = context.workspace
    const line = 1_700_000_050_000
    await seedJob(context, workspace, { id: 'consumed-old', createdAtMs: line - 1 })
    await seedJob(context, workspace, { id: 'consumed-new', createdAtMs: line + 1 })
    // An admission already consumed the transition; the list was never asked.
    context.seen.set(workspaceKey(workspace), { signIn: 'signedOut', transitionMs: line })
    context.signIn = 'signedOut'
    await context.engine.runtime.message(
      envelopeOf({ method: 'schedules/list', workspaceKey: workspaceKey(workspace) }, 'list-3'),
      workspace,
    )
    expect(await listedIds(context, workspace)).toEqual(['consumed-new'])
  })

  it('keeps what was seen while the structure cannot settle', async () => {
    const context = useShared()
    const workspace = context.workspace
    await seedJob(context, workspace, { id: 'unknown-once' })
    context.seen.set(workspaceKey(workspace), { signIn: 'signedIn' })
    context.signIn = 'unknown'
    await context.engine.runtime.message(
      envelopeOf({ method: 'schedules/list', workspaceKey: workspaceKey(workspace) }, 'list-4'),
      workspace,
    )
    expect(await listedIds(context, workspace)).toEqual(['unknown-once'])
    expect(context.seen.get(workspaceKey(workspace))).toEqual({ signIn: 'signedIn' })
  })

  it('still answers the list when the sweep fails, and reports why', async () => {
    const context = useShared()
    const workspace = context.workspace
    await seedJob(context, workspace, { id: 'sweep-fails-once' })
    context.failSeenLoad = true
    const reportedBefore = context.reported.length
    const answer = responseOf(
      await context.engine.runtime.message(
        envelopeOf({ method: 'schedules/list', workspaceKey: workspaceKey(workspace) }, 'list-5'),
        workspace,
      ),
    )
    if (answer.kind !== 'list') throw new TypeError('expected the schedule list')
    expect(answer.schedules.map((row) => row.id)).toEqual(['sweep-fails-once'])
    expect(context.reported.length - reportedBefore).toBe(1)
    const failure = context.reported.at(-1)
    expect(errorMessage(failure)).toBe('seen unavailable')
  })

  it('sweeps a seen sign-in when the workspace is held', async () => {
    const context = useShared()
    const workspace = context.workspace
    await seedJob(context, workspace, { id: 'held-stale' })
    context.seen.set(workspaceKey(workspace), { signIn: 'signedOut' })
    context.signIn = 'signedIn'
    const noticesBefore = context.notices.length
    const release = await context.engine.runtime.holdWorkspace(workspace)
    try {
      expect(await listedIds(context, workspace)).toEqual([])
      expect(context.notices.length - noticesBefore).toBe(1)
    } finally {
      await release()
    }
  })

  it('refuses a Muse Code timed send while the environment key is present', async () => {
    const context = useShared()
    const workspace = context.workspace
    context.hasEnvironmentKey = true
    const draft = onceDraft({ kind: 'conversation', sessionId: 'session-1', backend: 'museCode' })
    const answer = responseOf(
      await context.engine.runtime.message(
        envelopeOf(
          { method: 'schedules/create', workspaceKey: workspaceKey(workspace), draft },
          'create-1',
        ),
        workspace,
      ),
    )
    expect(answer).toEqual({
      kind: 'refused',
      reason: UI_TEXT.museCodeOnceEnvKeyRefused,
    })
    expect(await listedIds(context, workspace)).toEqual([])
  })
})

function createSurface(forward: (request: ScheduleRequest) => Promise<unknown>) {
  const signIn: MuseCodeScheduleSignIn = 'signedIn'
  return new ScheduleSurface({
    request: forward,
    background: new ScheduleBackgroundCoordinator({
      entry: {
        status: neverReached('background status'),
        register: neverReached('background register'),
        remove: neverReached('background remove'),
      },
      consent: {
        exclusive: (work) => work(undefined, () => Promise.resolve()),
      },
      now: () => 1_700_000_000_000,
      nextWakeAtMs: () => Promise.resolve(undefined),
    }),
    askBackground: neverReached('askBackground'),
    notice: neverReached('notice'),
    reportError: neverReached('reportError'),
    museCode: {
      hasEnvironmentKey: () => true,
      currentSignIn: () => signIn,
      seen: {
        load: neverReached('seen load'),
        save: neverReached('seen save'),
      },
      notice: neverReached('notice'),
    },
  })
}

const detachedCaller: ScheduleCallerContext = {
  source: 'acp',
  isInteractive: false,
  scheduledPrompts: false,
}

describe('surface creation under the environment key', () => {
  it('refuses before the store is reached', async () => {
    const surface = createSurface(neverReached('forward'))
    const draft = onceDraft({ kind: 'conversation', sessionId: 'session-1', backend: 'museCode' })
    const answer = await surface.request(
      { method: 'schedules/create', workspaceKey: 'workspace-1', draft },
      'workspace-1',
    )
    expect(answer).toEqual({
      kind: 'refused',
      reason: UI_TEXT.museCodeOnceEnvKeyRefused,
    })
  })

  it('forwards anything but a Muse Code timed send', async () => {
    const forwarded: ScheduleRequest[] = []
    const surface = createSurface((request: ScheduleRequest) => {
      forwarded.push(request)
      return Promise.resolve({ kind: 'accepted', id: 'new-schedule' })
    })
    const drafts = [
      onceDraft({ kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' }),
      {
        ...onceDraft({ kind: 'conversation', sessionId: 'session-1', backend: 'museCode' }),
        trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 0 },
      },
    ]
    for (const draft of drafts) {
      const answer = await surface.request(
        { method: 'schedules/create', workspaceKey: 'workspace-1', draft },
        'workspace-1',
        undefined,
        detachedCaller,
      )
      expect(answer.kind).toBe('accepted')
    }
    expect(forwarded).toHaveLength(2)
  })
})

describe('admitMuseCodeOnce', () => {
  it('refuses every Muse Code once while the environment key is present', async () => {
    const rig = admitRig()
    rig.hasEnvironmentKey = true
    const refusal = await caughtError(() => admitMuseCodeOnce(admissionJob(), rig.deps))
    expect(isScheduleDispatchRefusal(refusal)).toBe(true)
    expect(errorMessage(refusal)).toBe(UI_TEXT.museCodeOnceEnvKeyRefused)
  })

  it('admits other targets and triggers untouched', async () => {
    const rig = admitRig()
    rig.hasEnvironmentKey = true
    await admitMuseCodeOnce(
      admissionJob({
        target: { kind: 'conversation', sessionId: 'session-1', backend: 'modelApi' },
      }),
      rig.deps,
    )
    await admitMuseCodeOnce(
      admissionJob({
        trigger: { kind: 'interval', everyMs: 3_600_000, anchorMs: 0 },
      }),
      { ...rig.deps, hasEnvironmentKey: () => false },
    )
  })

  it('refuses a stale send and consumes the transition it saw', async () => {
    const rig = admitRig()
    rig.seen.set('workspace-1', { signIn: 'signedIn' })
    rig.signIn = 'signedOut'
    const refusal = await caughtError(() => admitMuseCodeOnce(admissionJob(), rig.deps))
    expect(isScheduleDispatchRefusal(refusal)).toBe(true)
    expect(errorMessage(refusal)).toBe(UI_TEXT.museCodeOnceAccountChanged)
    expect(rig.seen.get('workspace-1')).toEqual({
      signIn: 'signedOut',
      transitionMs: 1_700_000_100_000,
    })
  })

  it('admits a send from under the current sign-in', async () => {
    const rig = admitRig()
    rig.seen.set('workspace-1', { signIn: 'signedOut', transitionMs: 1_700_000_050_000 })
    rig.signIn = 'signedOut'
    await admitMuseCodeOnce(admissionJob({ createdAtMs: 1_700_000_050_001 }), rig.deps)
    const refusal = await caughtError(() =>
      admitMuseCodeOnce(admissionJob({ createdAtMs: 1_700_000_049_999 }), rig.deps),
    )
    expect(isScheduleDispatchRefusal(refusal)).toBe(true)
  })

  it('admits while the structure cannot settle, keeping what was seen', async () => {
    const rig = admitRig()
    rig.seen.set('workspace-1', { signIn: 'signedIn' })
    rig.signIn = 'unknown'
    await admitMuseCodeOnce(admissionJob(), rig.deps)
    expect(rig.seen.get('workspace-1')).toEqual({ signIn: 'signedIn' })
  })
})

describe('checkMuseCodeBinding', () => {
  it('notices once however many checks race', async () => {
    const notices: string[] = []
    const seen = new Map<string, MuseCodeSeen>([['workspace-1', { signIn: 'signedIn' }]])
    const signedOut: MuseCodeScheduleSignIn = 'signedOut'
    let removals = 0
    const deps = {
      workspaceKey: 'workspace-1',
      currentSignIn: () => signedOut,
      seen: memorySeen(seen),
      list: () =>
        Promise.resolve([
          scheduleFixture({
            id: 'race-stale',
            target: { kind: 'conversation', sessionId: 's', backend: 'museCode' },
            trigger: { kind: 'once', atMs: 1_800_000_000_000 },
            createdAtMs: 1_700_000_000_000,
          }),
        ]),
      remove: () => {
        removals += 1
        return Promise.resolve(true)
      },
      notice: (text: string) => {
        notices.push(text)
      },
      nowMs: 1_700_000_100_000,
    }
    const [first, second] = await Promise.all([
      checkMuseCodeBinding(deps),
      checkMuseCodeBinding(deps),
    ])
    expect(first).toBe(1)
    expect(second).toBe(1)
    expect(removals).toBe(1)
    expect(notices).toHaveLength(1)
  })
})

function boundBridge(hasEnvironmentKey: boolean) {
  const lines: string[] = []
  const record = (message: string) => {
    lines.push(message)
  }
  const signIn: MuseCodeScheduleSignIn = 'signedIn'
  return createSchedulesBridge({
    distDir: '/dist',
    log: { trace: record, info: record, warn: record, error: record },
    isEnabled: () => true,
    defaultDelivery: () => 'whenIdle',
    pauseAfterFailures: () => 0,
    museCodeBinding: {
      hasEnvironmentKey: () => hasEnvironmentKey,
      currentSignIn: () => signIn,
      seen: {
        load: neverReached('seen load'),
        save: neverReached('seen save'),
      },
      notice: neverReached('notice'),
    },
  })
}

describe('schedules bridge museCode target', () => {
  it('says why upfront while the environment key is present', () => {
    const bridge = boundBridge(true)
    const [choice] = bridge.targets({ sessionId: 's', backend: 'museCode', label: 'C' })
    expect(choice?.capability).toEqual({
      available: false,
      reason: UI_TEXT.museCodeOnceEnvKeyRefused,
    })
    const [modelApi] = bridge.targets({ sessionId: 's', backend: 'modelApi', label: 'C' })
    expect(modelApi?.capability).toEqual({ available: true })
  })

  it('offers the target once the key is gone', () => {
    const bridge = boundBridge(false)
    const [choice] = bridge.targets({ sessionId: 's', backend: 'museCode', label: 'C' })
    expect(choice?.capability).toEqual({ available: true })
  })
})
