// A window's playbook and its worker (M116, C-M116-6). The real worker code
// runs behind a thread boundary that copies every message, over a real
// journal and a real git repository (and, on Windows, the real job helper),
// so each request is validated on both sides exactly as in the extension.
// Stand-in workers that crash, stall or lie prove that nothing is allowed
// when the worker cannot be believed.
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { PLAYBOOK_PANEL_TEAM, PLAYBOOK_RECORD_FOLDER, UI_TEXT } from '../../src/shared/constants'
import { defaultPlaybookSettings } from '../../src/shared/playbook'
import type { PanelChild } from '../../src/core/orchestration/panelLanes'
import {
  createPlaybookWindow,
  PlaybookRefusal,
  type PlaybookConversationEvents,
  type PlaybookWindow,
  type PlaybookWindowDeps,
  type PlaybookWorkerHandle,
} from '../../src/host/playbook/playbookWindow'
import { servePlaybook, type PlaybookWorkerPort } from '../../src/host/playbook/playbookWorker'
import type { FromPlaybookWorker, ToPlaybookWorker } from '../../src/host/playbook/workerProtocol'
import { playbookSnapshotSchema } from '../../src/runtime/playbook/command'
import type { PanelModuleSummary } from '../../src/runtime/playbook/governor'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import {
  coveredReview,
  GOVERNED_ROUND_TIMEOUT_MS,
  PANEL_FILES,
  panelRepository,
  panelRepositoryTemplate,
  reviewReply,
  turnEnd,
  type PanelRepository,
} from './helpers/playbook/panelRepository'
import { removeFolder } from './helpers/temporaryFolders'

// The job type compiles under the bootstrap runner; only its admission is a fixture.
vi.mock('../../src/core/resources/admission', async (original) => {
  const { withFixtureBootstrap } = await import('./helpers/resources/fixtureLaunch')
  return withFixtureBootstrap(await original())
})

const IS_WINDOWS = process.platform === 'win32'
const SESSION = 'conversation-1'
const CHILD: PanelChild = {
  agentId: 'subagent-1',
  sessionId: `${SESSION}:subagent-1`,
  files: [PANEL_FILES.store],
}
const RACE = {
  file: PANEL_FILES.store,
  line: 3,
  severity: 'high',
  title: 'The claim is read and written in two steps',
  class: 'concurrency',
}

const shared: {
  template?: ReturnType<typeof panelRepositoryTemplate>
  storage?: string
  assembly?: string
} = {}
const open: { remove(): void }[] = []
const windows: { dispose(): void }[] = []

beforeAll(async () => {
  shared.template = panelRepositoryTemplate()
  if (!IS_WINDOWS) return
  shared.storage = await mkdtemp(path.join(tmpdir(), 'muse-playbook-window-'))
  shared.assembly = await compiledJobAssembly(shared.storage)
})
afterEach(() => {
  for (const window of windows.splice(0)) window.dispose()
  for (const repository of open.splice(0)) repository.remove()
})
afterAll(async () => {
  shared.template?.remove()
  if (shared.storage !== undefined) await removeFolder(shared.storage)
})

function recordedLog() {
  const lines: string[] = []
  const keep = (level: string) => (message: string) => {
    lines.push(`${level}: ${message}`)
  }
  return {
    lines,
    log: { trace: keep('trace'), info: keep('info'), warn: keep('warn'), error: keep('error') },
  }
}

function deliver(listeners: readonly ((raw: unknown) => void)[], message: unknown): void {
  const copy: unknown = structuredClone(message)
  setImmediate(() => {
    for (const listener of listeners) listener(copy)
  })
}

/**
 * Waits out real decisions: each is real git processes, and on Windows a
 * job helper's start as well, which is seconds when PowerShell starts cold.
 */
async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(assertion, { timeout: GOVERNED_ROUND_TIMEOUT_MS / 2 })
}

/** What a request was refused with; undefined when it was not refused. */
async function refusalOf(request: Promise<unknown>): Promise<unknown> {
  try {
    await request
  } catch (error) {
    return error
  }
  return undefined
}

/** Both sides of a thread: every message is copied, and delivered on a later turn. */
function thread() {
  const toWorker: ((raw: unknown) => void)[] = []
  const toWindow: Record<'message' | 'error' | 'exit', ((value: unknown) => void)[]> = {
    message: [],
    error: [],
    exit: [],
  }
  const sent: ToPlaybookWorker[] = []
  const terminate = vi.fn(() => Promise.resolve(0))
  const handle: PlaybookWorkerHandle = {
    postMessage: (message) => {
      sent.push(message)
      deliver(toWorker, message)
    },
    on: (event, listener) => {
      toWindow[event].push(listener)
    },
    terminate,
  }
  const port: PlaybookWorkerPort = {
    postMessage: (message) => {
      deliver(toWindow.message, message)
    },
    on: (_event, listener) => {
      toWorker.push(listener)
    },
  }
  return {
    handle,
    port,
    sent,
    terminate,
    /** What a stand-in worker says to its window. */
    say: (message: FromPlaybookWorker | Record<string, unknown>) => {
      deliver(toWindow.message, message)
    },
    crash: () => {
      for (const listener of toWindow.error) listener(new Error('the thread died'))
    },
    /** Anything at all, as a request: the worker must not take it on trust. */
    raw: (message: unknown) => {
      deliver(toWorker, message)
    },
  }
}

function subscriber() {
  const events = {
    note: vi.fn<PlaybookConversationEvents['note']>(),
    offer: vi.fn<PlaybookConversationEvents['offer']>(),
    rounds: vi.fn<PlaybookConversationEvents['rounds']>(),
    hookOutput: vi.fn<PlaybookConversationEvents['hookOutput']>(),
    failure: vi.fn<PlaybookConversationEvents['failure']>(),
  }
  return events
}

/** A window over the real worker code, a real journal and a real repository. */
function live(overrides: Partial<PlaybookWindowDeps> = {}) {
  if (shared.template === undefined) throw new Error('The repository template was not made')
  const repository: PanelRepository = panelRepository(shared.template.directory)
  open.push(repository)
  const recorded = recordedLog()
  const threads: ReturnType<typeof thread>[] = []
  const startWorker = vi.fn<PlaybookWindowDeps['startWorker']>((_file, data) => {
    const boundary = thread()
    threads.push(boundary)
    servePlaybook(boundary.port, structuredClone(data))
    return boundary.handle
  })
  const window = createPlaybookWindow({
    bundlePath: 'dist/playbook.js',
    startWorker,
    agentDataFolder: repository.dataFolder,
    workspaceRoot: repository.workspace,
    isWorkspaceTrusted: () => true,
    platform: process.platform,
    systemRoot: IS_WINDOWS ? SYSTEM_ROOT : undefined,
    shellJobAssembly: IS_WINDOWS ? () => Promise.resolve(shared.assembly) : undefined,
    reviewCharter: (targets) =>
      `charter for ${targets.map((target) => target.moduleKey).join(', ')}`,
    log: recorded.log,
    ...overrides,
  })
  windows.push(window)
  const events = subscriber()
  window.subscribe(SESSION, events)
  return { repository, window, startWorker, threads, events, ...recorded }
}

type Live = ReturnType<typeof live>

/** One whole counted review through the window, as the controller drives it. */
async function reviewed(setup: Live, turnId: string): Promise<readonly PanelModuleSummary[]> {
  const before = setup.events.rounds.mock.calls.length
  const ticket = await setup.window.openReview(SESSION, [PANEL_FILES.store], [CHILD])
  if (ticket === undefined) throw new Error('A playbook review was expected')
  ticket.observe(reviewReply(turnId, coveredReview([RACE])))
  ticket.observe(turnEnd(turnId))
  ticket.bind(turnId)
  await eventually(() => {
    expect(setup.events.rounds.mock.calls.length).toBeGreaterThan(before)
  })
  expect(ticket.isClosed).toBe(true)
  return setup.events.rounds.mock.calls.at(-1)?.[0] ?? []
}

async function answered(setup: Live, rounds: readonly PanelModuleSummary[]): Promise<void> {
  for (const round of rounds)
    await expect(
      setup.window.answer(
        SESSION,
        round.moduleId,
        round.findings.map((finding) => ({ findingId: finding.id, status: 'fixed' as const })),
      ),
    ).resolves.toBe(true)
}

/** A data folder that already holds journals, so a dispatch is asked about. */
function journalFolder(): string {
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-playbook-journals-'))
  mkdirSync(path.join(folder, PLAYBOOK_RECORD_FOLDER), { recursive: true })
  open.push({
    remove: () => {
      rmSync(folder, { recursive: true, force: true })
    },
  })
  return folder
}

/** A follow-up dispatch that must be refused as unavailable: the work it would have started. */
async function refusedWork(window: PlaybookWindow) {
  const effect = vi.fn(() => Promise.resolve('never'))
  await expect(
    window.dispatch({ kind: 'delegate', sessionId: SESSION, targetId: 'subagent-1' }, effect, () =>
      Promise.resolve(),
    ),
  ).rejects.toThrow(UI_TEXT.playbookUnavailable)
  return effect
}

/** A window whose worker is a stand-in that only does what the test says. */
/**
 * A stand-in worker's side of one dispatch: it admits the work and has it
 * started, and when the window reports the start it does `then`.
 */
function started(then: (boundary: ReturnType<typeof thread>) => void) {
  return (boundary: ReturnType<typeof thread>, request: unknown): void => {
    if (typeof request !== 'object' || request === null || !('type' in request)) return
    if (request.type === 'dispatch') boundary.say({ type: 'effect', dispatch: 1 })
    else if (request.type === 'effectDone') then(boundary)
  }
}

function standIn(
  overrides: Partial<PlaybookWindowDeps> = {},
  hear: (boundary: ReturnType<typeof thread>, request: unknown) => void = () => undefined,
) {
  const recorded = recordedLog()
  const threads: ReturnType<typeof thread>[] = []
  const startWorker = vi.fn<PlaybookWindowDeps['startWorker']>(() => {
    const boundary = thread()
    threads.push(boundary)
    boundary.port.on('message', (request) => {
      hear(boundary, request)
    })
    return boundary.handle
  })
  const endJob = vi.fn(() => Promise.resolve())
  const window = createPlaybookWindow({
    bundlePath: 'dist/playbook.js',
    startWorker,
    agentDataFolder: path.join(tmpdir(), 'muse-playbook-no-such-data'),
    workspaceRoot: path.join(tmpdir(), 'muse-playbook-no-such-workspace'),
    isWorkspaceTrusted: () => true,
    platform: 'win32',
    systemRoot: String.raw`C:\Windows`,
    shellJobAssembly: () => Promise.resolve('job.dll'),
    reviewCharter: () => 'charter',
    log: recorded.log,
    endJob,
    ...overrides,
  })
  windows.push(window)
  const events = subscriber()
  window.subscribe(SESSION, events)
  return { window, startWorker, threads, endJob, events, ...recorded }
}

// Real rounds, each under the POSIX supervisor or the Windows job.
describe('a window and its worker', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('reads and changes the journal the CLI and the ACP agent use, with no worker before it', async () => {
    const setup = live()
    expect(setup.startWorker).not.toHaveBeenCalled()
    const first = playbookSnapshotSchema.parse(await setup.window.surface.read())
    expect(first.settings.rules.threeStrikes).toEqual({ enabled: true })
    expect(first.records).toEqual([])
    const changed = playbookSnapshotSchema.parse(
      await setup.window.surface.change({
        rule: 'offload',
        enabled: false,
        reason: 'One machine.',
      }),
    )
    expect(changed.settings.rules.offload).toMatchObject({ enabled: false, reason: 'One machine.' })
    expect(existsSync(path.join(setup.repository.dataFolder, PLAYBOOK_RECORD_FOLDER))).toBe(true)
    expect(setup.startWorker).toHaveBeenCalledOnce()
    // The worker was told the window's language, not left with a default it chose.
    expect(setup.startWorker.mock.calls[0]?.[1]).toMatchObject({
      workspaceFolder: setup.repository.workspace,
      locale: 'en',
    })
  })

  it('starts no worker for anything that is not orchestrated', async () => {
    const setup = live()
    await expect(setup.window.openReview(SESSION, [], [CHILD])).resolves.toBeUndefined()
    await expect(
      setup.window.openReview(SESSION, [PANEL_FILES.store], [{ ...CHILD, files: [] }]),
    ).resolves.toBeUndefined()
    await expect(setup.window.openReview(SESSION, [PANEL_FILES.store], [])).resolves.toBeUndefined()
    // No journal on this machine: a dispatch is not the playbook's, and runs as it always did.
    const effect = vi.fn(() => Promise.resolve('started'))
    const completion = vi.fn(() => Promise.resolve())
    await expect(
      setup.window.dispatch(
        { kind: 'bestOfN', sessionId: SESSION, targetId: undefined },
        effect,
        completion,
      ),
    ).resolves.toBe('started')
    expect(effect).toHaveBeenCalledOnce()
    expect(completion).not.toHaveBeenCalled()
    // Nor are an Agent map's rows read from a journal that does not exist, or no rows at all.
    await expect(
      setup.window.agents([
        { itemId: 'row-1', agentId: CHILD.agentId, sessionId: CHILD.sessionId },
      ]),
    ).resolves.toEqual({})
    await expect(setup.window.agents([])).resolves.toEqual({})
    expect(setup.startWorker).not.toHaveBeenCalled()
    expect(existsSync(setup.repository.dataFolder)).toBe(false)
  })

  it('sends a review of files no child changed exactly as it is', async () => {
    const setup = live()
    await expect(
      setup.window.openReview(SESSION, [PANEL_FILES.notes], [CHILD]),
    ).resolves.toBeUndefined()
    // A child that is the conversation's own session is no child of it.
    await expect(
      setup.window.openReview(SESSION, [PANEL_FILES.store], [{ ...CHILD, sessionId: SESSION }]),
    ).resolves.toBeUndefined()
    expect(setup.events.note).not.toHaveBeenCalled()
    expect(setup.startWorker).not.toHaveBeenCalled()
    expect(existsSync(setup.repository.dataFolder)).toBe(false)
  })

  it('keeps such a review ordinary where a playbook review would be refused', async () => {
    // Restricted Mode, and a worker that cannot start: neither is asked about files no child changed.
    const startWorker = vi.fn<PlaybookWindowDeps['startWorker']>(() => {
      throw new Error('this worker must never start')
    })
    const setup = live({ isWorkspaceTrusted: () => false, startWorker })
    await expect(
      setup.window.openReview(SESSION, [PANEL_FILES.notes], [CHILD]),
    ).resolves.toBeUndefined()
    expect(startWorker).not.toHaveBeenCalled()
    // The same child's own file, there, is refused: that one is the playbook's.
    await expect(setup.window.openReview(SESSION, [PANEL_FILES.store], [CHILD])).rejects.toThrow(
      UI_TEXT.playbookUnavailable,
    )
  })

  it('counts a child’s review, adds only the charter, and tells the conversation its round', async () => {
    const setup = live()
    const ticket = await setup.window.openReview(SESSION, [PANEL_FILES.store], [CHILD])
    if (ticket === undefined) throw new Error('A playbook review was expected')
    const parts = [{ type: 'text', text: 'the review request' }] as const
    expect(ticket.parts(parts)).toEqual([
      ...parts,
      { type: 'text', text: 'charter for src/core/schedules' },
    ])
    // Everything but the review's reply and the turn's end stays on this side.
    ticket.observe({ type: 'textDelta', itemId: 'reply', field: 'text', delta: 'thinking' })
    ticket.observe(reviewReply('turn-1', coveredReview([RACE])))
    ticket.observe(turnEnd('turn-1'))
    expect(ticket.isClosed).toBe(false)
    ticket.bind('turn-1')
    await eventually(() => {
      expect(setup.events.rounds).toHaveBeenCalledOnce()
    })
    expect(ticket.isClosed).toBe(true)
    expect(setup.events.rounds.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        moduleKey: 'src/core/schedules',
        round: 1,
        findings: [
          expect.objectContaining({ title: RACE.title, severity: 'P2', isAnswered: false }),
        ],
      }),
    ])
    const [boundary] = setup.threads
    expect(boundary?.sent.map((message) => message.type)).toEqual([
      'reviewOpen',
      'reviewObserve',
      'reviewObserve',
      'reviewBind',
    ])
  })

  it('refuses the next review with the policy’s own note until the findings are answered', async () => {
    const setup = live()
    const rounds = await reviewed(setup, 'turn-1')
    const refusal = await refusalOf(setup.window.openReview(SESSION, [PANEL_FILES.store], [CHILD]))
    expect(refusal).toBeInstanceOf(PlaybookRefusal)
    expect(refusal).toMatchObject({
      note: { code: 'answersPending', module: 'src/core/schedules' },
    })
    await eventually(() => {
      expect(setup.events.note).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'answersPending' }),
        undefined,
      )
    })
    await answered(setup, rounds)
    await expect(setup.window.standing(SESSION)).resolves.toEqual([
      expect.objectContaining({
        round: 1,
        findings: [expect.objectContaining({ isAnswered: true })],
      }),
    ])
    await expect(
      setup.window.openReview(SESSION, [PANEL_FILES.store], [CHILD]),
    ).resolves.toBeDefined()
  })

  it('starts governed work once admitted, and keeps verifying after the caller has its answer', async () => {
    const setup = live()
    await answered(setup, await reviewed(setup, 'turn-1'))
    const gate = Promise.withResolvers<undefined>()
    const effect = vi.fn(() => Promise.resolve('submission'))
    const completion = vi.fn(async (submission: string, _signal: AbortSignal) => {
      expect(submission).toBe('submission')
      await gate.promise
    })
    await expect(
      setup.window.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId },
        effect,
        completion,
      ),
    ).resolves.toBe('submission')
    // The caller has its answer; the round is still open until the child ends.
    await eventually(() => {
      expect(completion).toHaveBeenCalledOnce()
    })
    const leases = async () => {
      const snapshot = playbookSnapshotSchema.parse(await setup.window.surface.read())
      return snapshot.records.flatMap((record) =>
        record.kind === 'lease' ? [record.value.status] : [],
      )
    }
    await expect(leases()).resolves.toSatisfy(
      (statuses: readonly string[]) => statuses.at(-1) === 'held',
    )
    gate.resolve(undefined)
    // The child ended: its commits are verified and the round's lease let go.
    await eventually(async () => {
      await expect(leases()).resolves.toSatisfy(
        (statuses: readonly string[]) => statuses.at(-1) === 'released',
      )
    })
    expect(setup.events.failure).not.toHaveBeenCalled()
    const [boundary] = setup.threads
    expect(boundary?.sent.map((message) => message.type)).toEqual(
      expect.arrayContaining(['dispatch', 'effectDone', 'completionDone']),
    )
  })

  it('refuses the fourth patch round before any work starts, on the row that asked', async () => {
    const setup = live()
    for (const turn of ['turn-1', 'turn-2', 'turn-3'])
      await answered(setup, await reviewed(setup, turn))
    expect(setup.events.offer).toHaveBeenCalledWith(expect.any(String), 'src/core/schedules')
    const effect = vi.fn(() => Promise.resolve('never'))
    const refusal = await refusalOf(
      setup.window.dispatch(
        { kind: 'subagent', sessionId: SESSION, targetId: undefined, itemId: 'row-9' },
        effect,
        () => Promise.resolve(),
      ),
    )
    expect(refusal).toBeInstanceOf(PlaybookRefusal)
    expect(refusal).toMatchObject({ note: { code: 'redesignRequired', round: 3 } })
    expect(effect).not.toHaveBeenCalled()
    await eventually(() => {
      expect(setup.events.note).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'redesignRequired', module: 'src/core/schedules' }),
        'row-9',
      )
    })
    // The decision the person accepts is recorded for the redesign to run under.
    const [standing] = await setup.window.standing(SESSION)
    await expect(
      setup.window.recordDesign(SESSION, standing?.moduleId ?? '', {
        failureClass: 'concurrency',
        whyPatchesFailed: 'Each patch kept the read and the write apart.',
        structuralChange: 'One atomic claim replaces the two steps.',
        planLocation: 'PLAN.md#D200',
      }),
    ).resolves.toBe(true)
    await expect(setup.window.standing(SESSION)).resolves.toEqual([
      expect.objectContaining({ design: 'pending' }),
    ])
  })

  it('gives each child’s row its own records', async () => {
    const setup = live()
    await reviewed(setup, 'turn-1')
    const records = await setup.window.agents([
      { itemId: 'row-1', agentId: CHILD.agentId, sessionId: CHILD.sessionId },
      { itemId: 'row-2', agentId: 'subagent-2', sessionId: `${SESSION}:subagent-2` },
    ])
    expect(Object.keys(records)).toEqual(['row-1'])
  })
})

describe('a window that cannot believe its worker', () => {
  it('is unavailable without a folder, and never starts a worker for it', async () => {
    const setup = standIn({ workspaceRoot: undefined })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.startWorker).not.toHaveBeenCalled()
  })

  it('refuses an orchestrated review in a workspace that is not trusted', async () => {
    const setup = standIn({ isWorkspaceTrusted: () => false })
    await expect(setup.window.openReview(SESSION, [PANEL_FILES.store], [CHILD])).rejects.toThrow(
      UI_TEXT.playbookUnavailable,
    )
    expect(setup.startWorker).not.toHaveBeenCalled()
  })

  it('refuses everything a crashed worker owed, and starts a fresh one for the next request', async () => {
    const setup = standIn({}, (boundary) => {
      boundary.crash()
    })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.lines).toContain(
      'error: The playbook worker crashed; its pending requests are refused',
    )
    expect(setup.threads[0]?.terminate).toHaveBeenCalledOnce()
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.startWorker).toHaveBeenCalledTimes(2)
  })

  it('ends a worker that says nothing while it owes an answer, and every job it had not seen end', async () => {
    const STUCK = String.raw`Local\MuseSparkPlaybook-stuck`
    const EARLIER = String.raw`Local\MuseSparkPlaybook-earlier`
    // The worker names two jobs whose end it has not seen; then nothing more comes.
    const setup = standIn({ silenceMs: 60 }, (boundary) => {
      boundary.say({ type: 'job', names: [EARLIER, STUCK] })
    })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.lines).toContain(
      'error: The playbook worker said nothing while it owed an answer; its pending requests are refused',
    )
    expect(setup.threads[0]?.terminate).toHaveBeenCalledOnce()
    for (const name of [EARLIER, STUCK])
      expect(setup.endJob).toHaveBeenCalledWith(name, 'job.dll', String.raw`C:\Windows`)
    expect(setup.endJob).toHaveBeenCalledTimes(2)
  })

  it('ends no job the worker has seen end', async () => {
    const setup = standIn({}, (boundary) => {
      boundary.say({ type: 'job', names: [String.raw`Local\MuseSparkPlaybook-done`] })
      boundary.say({ type: 'job', names: [] })
      boundary.crash()
    })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.endJob).not.toHaveBeenCalled()
  })

  it('keeps believing a worker that reports each call, however long the answer takes', async () => {
    const snapshot = { settings: defaultPlaybookSettings(PLAYBOOK_PANEL_TEAM), records: [] }
    const setup = standIn({ silenceMs: 60 }, (boundary) => {
      // Four reports, each inside the bound; the answer after more than the bound in all.
      for (let beat = 1; beat <= 4; beat += 1)
        setTimeout(() => {
          boundary.say({ type: 'alive' })
        }, beat * 30)
      setTimeout(() => {
        boundary.say({ type: 'result', id: 1, value: snapshot })
      }, 150)
    })
    await expect(setup.window.surface.read()).resolves.toEqual(snapshot)
    expect(setup.lines.filter((line) => line.startsWith('error:'))).toEqual([])
    expect(setup.threads[0]?.terminate).not.toHaveBeenCalled()
  })

  it('ends a worker that speaks outside the protocol, whatever it claimed', async () => {
    const setup = standIn({}, (boundary) => {
      boundary.say({ type: 'result', id: 'one', value: { allowed: true } })
    })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.lines).toContain(
      'error: The playbook worker sent a message outside its protocol; its pending requests are refused',
    )
    expect(setup.threads[0]?.terminate).toHaveBeenCalledOnce()
  })

  it('checks the shape of an answer it asked for, and allows nothing on a wrong one', async () => {
    const setup = standIn({ agentDataFolder: journalFolder() }, (boundary, request) => {
      if (typeof request === 'object' && request !== null && 'id' in request)
        boundary.say({ type: 'result', id: Number(request.id), value: 'allowed' })
    })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(await refusedWork(setup.window)).not.toHaveBeenCalled()
  })

  it('never runs the work of a dispatch its worker did not admit', async () => {
    // A journal folder exists, so the dispatch is asked about; the worker never answers.
    const setup = standIn({ agentDataFolder: journalFolder(), silenceMs: 60 })
    const effect = await refusedWork(setup.window)
    expect(setup.threads[0]?.sent.map((message) => message.type)).toEqual(['dispatch'])
    expect(effect).not.toHaveBeenCalled()
  })

  it('tells the conversation when work that started could not be certified', async () => {
    // The work is admitted and started; the worker dies before it can verify it.
    const setup = standIn(
      { agentDataFolder: journalFolder() },
      started((boundary) => {
        boundary.crash()
      }),
    )
    await expect(
      setup.window.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: 'subagent-1' },
        () => Promise.resolve('running'),
        () => Promise.resolve(),
      ),
    ).resolves.toBe('running')
    await eventually(() => {
      expect(setup.events.failure).toHaveBeenCalledOnce()
    })
  })

  it('ends its worker with the window, and is unavailable afterwards', async () => {
    const setup = standIn({}, () => {
      setup.window.dispose()
    })
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.threads[0]?.terminate).toHaveBeenCalledOnce()
    expect(setup.lines.filter((line) => line.startsWith('error:'))).toEqual([])
    await expect(setup.window.surface.read()).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.startWorker).toHaveBeenCalledOnce()
  })
})

/** A look at a journal folder that is not there. */
function absent(): Promise<never> {
  return Promise.reject(Object.assign(new Error('absent'), { code: 'ENOENT' }))
}

describe('a window that is closing, or cannot see its journal', () => {
  it('aborts admitted work that is still running when its worker is lost, or the window closes', async () => {
    for (const lose of ['crash', 'dispose'] as const) {
      // The work is admitted, started, and its end is being waited for.
      const setup = standIn(
        { agentDataFolder: journalFolder() },
        started((boundary) => {
          boundary.say({ type: 'completion', dispatch: 1 })
        }),
      )
      const waiting = Promise.withResolvers<AbortSignal>()
      await setup.window.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: 'subagent-1' },
        () => Promise.resolve('running'),
        (_submission, signal) => {
          waiting.resolve(signal)
          // The child's end never comes by itself in this test.
          return new Promise(() => undefined)
        },
      )
      const signal = await waiting.promise
      expect(signal.aborted).toBe(false)
      if (lose === 'crash') setup.threads[0]?.crash()
      else setup.window.dispose()
      expect(signal.aborted).toBe(true)
    }
  })

  it('refuses a dispatch when the journal folder cannot be looked at', async () => {
    const setup = standIn({
      access: () => Promise.reject(Object.assign(new Error('private path'), { code: 'EACCES' })),
    })
    expect(await refusedWork(setup.window)).not.toHaveBeenCalled()
    // Nor are an Agent map's rows read past a folder that cannot be looked at.
    await expect(
      setup.window.agents([{ itemId: 'row-1', agentId: 'subagent-1', sessionId: 'child-1' }]),
    ).rejects.toThrow(UI_TEXT.playbookUnavailable)
    // Nor is "nothing is under review" said of a conversation whose journal may be there.
    await expect(setup.window.standing(SESSION)).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.startWorker).not.toHaveBeenCalled()
    expect(setup.lines).toContain(
      'error: The playbook journal folder could not be read; the request is refused',
    )
    expect(setup.lines.join('\n')).not.toContain('private path')
  })

  it('runs a dispatch as it always did only when the journal folder is confirmed absent', async () => {
    const access = vi.fn(absent)
    const setup = standIn({ access })
    await expect(
      setup.window.dispatch(
        { kind: 'bestOfN', sessionId: SESSION, targetId: undefined },
        () => Promise.resolve('started'),
        () => Promise.resolve(),
      ),
    ).resolves.toBe('started')
    expect(access).toHaveBeenCalledOnce()
    // With no journal nothing is under review either, and no thread is started to say so.
    await expect(setup.window.standing(SESSION)).resolves.toEqual([])
    expect(setup.startWorker).not.toHaveBeenCalled()
  })

  it('starts nothing once the window has closed, though it was asked before', async () => {
    const look = Promise.withResolvers<undefined>()
    const setup = standIn({
      access: async () => {
        await look.promise
        await absent()
      },
    })
    const effect = vi.fn(() => Promise.resolve('started after disposal'))
    const asked = setup.window.dispatch(
      { kind: 'bestOfN', sessionId: SESSION, targetId: undefined },
      effect,
      () => Promise.resolve(),
    )
    setup.window.dispose()
    // Only now does the look at the folder come back: there is no journal.
    look.resolve(undefined)
    await expect(asked).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(effect).not.toHaveBeenCalled()
  })
})

describe('the worker', () => {
  it('answers a request it cannot read as unavailable, and guesses at nothing', async () => {
    const boundary = thread()
    const heard: unknown[] = []
    boundary.handle.on('message', (raw) => {
      heard.push(raw)
    })
    servePlaybook(boundary.port, {
      kind: 'museSparkPlaybook',
      agentDataFolder: path.join(tmpdir(), 'muse-playbook-no-such-data'),
      workspaceFolder: process.cwd(),
      table: {},
      locale: 'en',
    })
    for (const raw of [
      { type: 'allowEverything', id: 7 },
      { type: 'change', id: 8, change: { rule: 'neverAround', enabled: false, reason: 'no' } },
      { type: 'dispatch', id: 9, kind: 'team', sessionId: SESSION, isTrusted: true },
      { type: 'read' },
      'read',
    ])
      boundary.raw(raw)
    await eventually(() => {
      expect(heard).toHaveLength(3)
    })
    expect(heard).toEqual([
      { type: 'unavailable', id: 7 },
      { type: 'unavailable', id: 8 },
      { type: 'unavailable', id: 9 },
    ])
  })
})
