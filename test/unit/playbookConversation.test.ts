// A conversation's use of its window's playbook (M116, lane C-M116-6; PLAN.md
// D96.16 and D96.17), on the real composition (RLF-PLAYBOOK): the real
// conversation over the real window, whose real worker code runs behind an
// in-process thread that copies every message, over a real journal and a real
// git repository (and, on Windows, the real contained job). What a review
// turn, a dispatch, an admission, a live row and the notice's button do;
// refusals in the policy's own words; rounds ending with the child, the
// review, or the abort. The review request's submit and listen, the host
// notice, and a best-of-N run the person took (parsed by its schema) are the
// conversation controller's own; the child sessions' own items and VS Code's
// pickers exist only in real use, so the cases that need them left for
// docs/real-life/unproven.md.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import { bestOfNRunSchema } from '../../src/shared/bestOfN'
import {
  PLAYBOOK_RECORD_FOLDER,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_REFUSAL_MODEL_TEXT,
} from '../../src/shared/constants'
import { fill, UI_TEXT } from '../../src/shared/l10n/text'
import type { PlaybookRecord } from '../../src/shared/playbook'
import type { ReviewFinding } from '../../src/shared/reviewFindings'
import type { TurnPart } from '../../src/core/agent/agentBackend'
import {
  FilePlaybookJournal,
  validatedRecords,
} from '../../src/core/orchestration/playbook/journal'
import type { PanelChild } from '../../src/core/orchestration/panelLanes'
import {
  createPlaybookWindow,
  type PlaybookConversationEvents,
  type PlaybookDispatch,
  type PlaybookWindow,
  type PlaybookWindowDeps,
} from '../../src/host/playbook/playbookWindow'
import { servePlaybook } from '../../src/host/playbook/playbookWorker'
import {
  createPlaybookConversation,
  playbookAdmission,
  type PlaybookConversation,
  type PlaybookPick,
  type PlaybookUi,
} from '../../src/host/playbook/playbookConversation'
import { playbookSnapshotSchema } from '../../src/runtime/playbook/command'
import type { PanelModuleSummary } from '../../src/runtime/playbook/governor'
import { playbookNoteText } from '../../src/runtime/playbook/text'
import { compiledJobAssembly, SYSTEM_ROOT } from './helpers/playbook/jobAssembly'
import { keepCalls } from './helpers/playbook/keepCalls'
import { thread } from './helpers/playbook/workerThread'
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

const IS_WINDOWS = process.platform === 'win32'
const SESSION = 'session-1'
const CHILD_SESSION = 'child-1'
const AGENT = 'subagent-1'
/** The file the repository template holds under review: the policy's own module. */
const STORE = PANEL_FILES.store
const PARTS: readonly TurnPart[] = [{ type: 'text', text: 'Review the working tree.' }]
const RACE = {
  file: STORE,
  line: 3,
  severity: 'high',
  title: 'The claim is read and written in two steps',
  class: 'concurrency',
}
const CHILD: PanelChild = { agentId: AGENT, sessionId: CHILD_SESSION, files: [STORE] }
const AGENT2 = 'subagent-2'
const RACE2 = {
  file: PANEL_FILES.panel,
  line: 5,
  severity: 'high',
  title: 'The view reads state it never owned',
  class: 'lifecycle',
}
const CHILD2: PanelChild = {
  agentId: AGENT2,
  sessionId: 'child-2',
  files: [PANEL_FILES.panel],
}

const shared: {
  template?: ReturnType<typeof panelRepositoryTemplate>
  storage?: string
  assembly?: string
} = {}
const open: { remove(): void }[] = []
const windows: { dispose(): void }[] = []
const conversations: PlaybookConversation[] = []

beforeAll(async () => {
  shared.template = panelRepositoryTemplate()
  if (!IS_WINDOWS) return
  shared.storage = await mkdtemp(path.join(tmpdir(), 'muse-playbook-conversation-'))
  shared.assembly = await compiledJobAssembly(shared.storage)
})
afterEach(() => {
  for (const conversation of conversations.splice(0)) conversation.dispose()
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

/**
Waits out real decisions: each is real git processes, and on Windows a
job helper's start as well, which is seconds when PowerShell starts cold.
*/
async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  await vi.waitFor(assertion, { timeout: GOVERNED_ROUND_TIMEOUT_MS / 2 })
}

/** Whether a promise has settled by now, without waiting for it. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending')
  // One turn of the event loop first: a promise resolved just now settles within it.
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
  return (await Promise.race([promise, Promise.resolve(pending)])) !== pending
}

/** One turn of the event loop: whatever was settling has settled. */
function aTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
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

/** A dispatch the conversation asked the window for, and the completion it was owed. */
interface CompletionEntry {
  readonly request: PlaybookDispatch
  completion: Promise<void> | undefined
}

/** VS Code's pickers, which no scene below may open: a call is a test error. */
function showQuickPick<T extends PlaybookPick>(
  items: readonly T[],
  options: {
    readonly title?: string
    readonly placeHolder?: string
    readonly ignoreFocusOut?: boolean
  } & { readonly canPickMany: true },
): PromiseLike<T[] | undefined>
function showQuickPick<T extends PlaybookPick>(
  items: readonly T[],
  options: {
    readonly title?: string
    readonly placeHolder?: string
    readonly ignoreFocusOut?: boolean
  },
): PromiseLike<T | undefined>
function showQuickPick<T extends PlaybookPick>(
  _items: readonly T[],
  _options: {
    readonly title?: string
    readonly placeHolder?: string
    readonly ignoreFocusOut?: boolean
    readonly canPickMany?: boolean
  },
): PromiseLike<T[] | T | undefined> {
  throw new Error('No picker opens in this scene')
}

function noPickers(): PlaybookUi {
  return {
    showQuickPick,
    showInputBox: () => {
      throw new Error('No picker opens in this scene')
    },
  }
}

interface Told {
  readonly level: string
  readonly text: string
  readonly hasAction: boolean
}

/** A window over the real worker code, and the conversation the scene drives on it. */
function live(overrides: Partial<PlaybookWindowDeps> = {}) {
  if (shared.template === undefined) throw new Error('The repository template was not made')
  const repository: PanelRepository = panelRepository(shared.template.directory)
  open.push(repository)
  const recorded = recordedLog()
  const threads: ReturnType<typeof thread>[] = []
  const startWorker = keepCalls<
    Parameters<PlaybookWindowDeps['startWorker']>,
    ReturnType<PlaybookWindowDeps['startWorker']>
  >((_file, data) => {
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
  // The window as the conversation drives it: every call runs the real
  // method, and what it was asked is kept beside it.
  const dispatches: CompletionEntry[] = []
  const subscriptions = { count: 0 }
  const observed: PlaybookWindow = {
    ...window,
    dispatch: <T>(
      request: PlaybookDispatch,
      effect: () => Promise<T>,
      completion: (submission: T, signal: AbortSignal) => Promise<void>,
    ): Promise<T> => {
      const entry: CompletionEntry = { request, completion: undefined }
      dispatches.push(entry)
      return window.dispatch(request, effect, (submission, signal) => {
        const pending = completion(submission, signal)
        entry.completion = pending
        return pending
      })
    },
    subscribe: (sessionId: string, events: PlaybookConversationEvents): (() => void) => {
      subscriptions.count += 1
      const stop = window.subscribe(sessionId, events)
      return () => {
        subscriptions.count -= 1
        stop()
      }
    },
  }
  const spawn = (): {
    readonly conversation: PlaybookConversation
    readonly told: Told[]
    readonly lines: string[]
  } => {
    const told: Told[] = []
    const spoken = recordedLog()
    const conversation = createPlaybookConversation(observed, noPickers(), {
      notice: (level, text, hasAction) => {
        told.push({ level, text, hasAction })
      },
      backend: () => Promise.reject(new Error('No child session is read')),
      log: spoken.log,
    })
    conversations.push(conversation)
    return { conversation, told, lines: spoken.lines }
  }
  return {
    repository,
    window,
    observed,
    dispatches,
    subscriptions,
    startWorker,
    threads,
    spawn,
    ...recorded,
  }
}

type Live = ReturnType<typeof live>

/** A review request of the conversation's own controller, with no children but its own. */
function request(
  submit: (parts: readonly TurnPart[]) => Promise<{ turnId: string }>,
  given: {
    readonly files?: readonly string[]
    readonly agents?: readonly { readonly agentId: string; readonly sessionId: string }[]
    readonly bestOfN?: BestOfNRun | undefined
  } = {},
) {
  const listeners = new Set<(event: AgentEvent) => void>()
  return {
    listeners,
    review: {
      sessionId: SESSION,
      files: given.files ?? [STORE],
      agents: given.agents ?? [],
      bestOfN: given.bestOfN,
      parts: PARTS,
      listen: (listener: (event: AgentEvent) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
      submit,
    },
  }
}

/** A best-of-N run the person took, in the shape the runs keep one. */
function bestOfN(): BestOfNRun {
  return bestOfNRunSchema.parse({
    runId: 'run-1',
    prompt: 'p',
    modelId: 'm',
    baseRef: 'main',
    attempts: 2,
    requestCeilingPerAttempt: 5,
    status: 'completed',
    takenBranch: 'attempt/b',
    runAttempts: ['a', 'b'].map((name) => ({
      attemptId: `attempt-${name}`,
      branch: `attempt/${name}`,
      worktreePath: path.join('worktrees', name),
      status: 'completed',
      requestsMade: 1,
      ceilingReached: false,
      approvalsDenied: 0,
      files: [{ path: STORE, insertions: 1, deletions: 0 }],
      changedLines: 1,
    })),
  })
}

function observedRow(subagentId = AGENT, itemId = 'row-1', status = 'inProgress'): ItemSnapshot {
  return { itemId, subagentId, kind: 'subagent', status }
}

/** A refusal as a caller makes its own result of it: both wordings, in order. */
function bothWordings(reason: string, shown: string): string {
  return `${reason} / ${shown}`
}

/** One whole counted review through the window, as the controller drives it. */
async function reviewedChild(
  setup: Live,
  turnId: string,
  child: PanelChild,
  files: readonly string[],
  race: ReviewFinding,
): Promise<readonly PanelModuleSummary[]> {
  const rounds: PanelModuleSummary[][] = []
  const stop = setup.window.subscribe(SESSION, {
    note: () => undefined,
    offer: () => undefined,
    rounds: (counted) => {
      rounds.push([...counted])
    },
    hookOutput: () => undefined,
    failure: () => undefined,
  })
  try {
    const ticket = await setup.window.openReview(SESSION, files, [child])
    if (ticket === undefined) throw new Error('A playbook review was expected')
    ticket.observe(reviewReply(turnId, coveredReview([race])))
    ticket.observe(turnEnd(turnId))
    ticket.bind(turnId)
    await eventually(() => {
      expect(rounds.length).toBeGreaterThan(0)
    })
    expect(ticket.isClosed).toBe(true)
    return rounds.at(-1) ?? []
  } finally {
    stop()
  }
}

async function reviewed(setup: Live, turnId: string): Promise<readonly PanelModuleSummary[]> {
  return await reviewedChild(setup, turnId, CHILD, [STORE], RACE)
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
  const folder = mkdtempSync(path.join(tmpdir(), 'muse-playbook-conversation-'))
  mkdirSync(path.join(folder, PLAYBOOK_RECORD_FOLDER), { recursive: true })
  open.push({
    remove: () => {
      rmSync(folder, { recursive: true, force: true })
    },
  })
  return folder
}

/** The completion the window owes a round: every governed dispatch gets one. */
async function completionOf(entry: CompletionEntry): Promise<{ readonly done: Promise<void> }> {
  await eventually(() => {
    expect(entry.completion).toBeDefined()
  })
  const { completion } = entry
  if (completion === undefined) throw new Error('The round was given no completion')
  return { done: completion }
}

/** The round's end, once the worker has owed and settled it. */
async function settled(completion: Promise<void>): Promise<void> {
  await eventually(async () => {
    expect(await isSettled(completion)).toBe(true)
  })
}

async function leases(setup: Live): Promise<readonly string[]> {
  const snapshot = playbookSnapshotSchema.parse(await setup.window.surface.read())
  return snapshot.records
    .filter((record) => record.kind === 'lease')
    .map((record) => record.value.status)
}

/**
The latest lease is released: the worker's rounds are all over. The journal
is append-only, so intermediate holds stay held; the last record wins.
*/
async function releasedAll(setup: Live): Promise<void> {
  await eventually(async () => {
    const statuses = await leases(setup)
    expect(statuses.length).toBeGreaterThan(0)
    expect(statuses.at(-1)).toBe('released')
  })
}

/** At least `count` releases are journaled: the rounds before it are over. */
async function releasedCount(setup: Live, count: number): Promise<void> {
  await eventually(async () => {
    const statuses = await leases(setup)
    expect(statuses.filter((status) => status === 'released').length).toBeGreaterThanOrEqual(count)
  })
}

/** The policy's redesign refusal the journal keeps. */
function journalRefusal(setup: Live): PlaybookRecord & { kind: 'note' } {
  const records = validatedRecords(
    new FilePlaybookJournal(setup.repository.dataFolder, setup.repository.workspace).read(),
  )
  const refusal = records.findLast(
    (record): record is PlaybookRecord & { kind: 'note' } =>
      record.kind === 'note' && record.value.code === 'redesignRequired',
  )
  if (refusal === undefined) throw new Error('The refusal was not journaled')
  return refusal
}

describe('without a worker', () => {
  it('sends a review the window calls ordinary exactly as it is, and follows nothing', async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    const submit = keepCalls((_parts: readonly TurnPart[]) => Promise.resolve({ turnId: 'turn-1' }))
    const sent = request(submit)
    await expect(conversation.review(sent.review)).resolves.toEqual({ turnId: 'turn-1' })
    // The very parts it was given: not a copy, no charter.
    expect(submit.calls).toEqual([[PARTS]])
    expect(submit.calls[0]?.[0]).toBe(PARTS)
    expect(sent.listeners.size).toBe(0)
    expect(told).toEqual([])
    expect(setup.subscriptions.count).toBe(0)
    expect(setup.startWorker.calls).toHaveLength(0)
    expect(setup.lines).toEqual([])
  })

  it('still refuses a review of more files than the journal can hold', async () => {
    const setup = live()
    const { conversation } = setup.spawn()
    const many = Array.from(
      { length: PLAYBOOK_RECORD_MAX + 1 },
      (_, index) => `src/${String(index)}.ts`,
    )
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    await expect(
      conversation.review(request(submit, { files: many, bestOfN: bestOfN() }).review),
    ).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.startWorker.calls).toHaveLength(0)
    expect(submit.calls).toHaveLength(0)
    expect(setup.lines).toEqual([])
  })

  it('runs at once for a conversation that has no session yet', async () => {
    const setup = live()
    const { conversation } = setup.spawn()
    await expect(
      conversation.dispatch('bestOfN', undefined, undefined, () => Promise.resolve('ran')),
    ).resolves.toBe('ran')
    expect(setup.dispatches).toEqual([])
    expect(setup.subscriptions.count).toBe(0)
    expect(setup.startWorker.calls).toHaveLength(0)
    expect(setup.lines).toEqual([])
  })

  it('throws on what the work itself threw, as it is', async () => {
    const setup = live()
    const broken = new Error('the child could not start')
    await expect(
      playbookAdmission(setup.observed)(
        'subagent',
        SESSION,
        undefined,
        () => Promise.reject(broken),
        () => {
          throw new Error('The child is never waited on')
        },
        bothWordings,
      ),
    ).rejects.toBe(broken)
    expect(setup.startWorker.calls).toHaveLength(0)
    expect(setup.lines).toEqual([])
  })

  it('refuses, saying the playbook could not be asked, when that is why', async () => {
    const setup = live({ workspaceRoot: undefined, agentDataFolder: journalFolder() })
    const effect = keepCalls(() => Promise.resolve('ran'))
    await expect(
      playbookAdmission(setup.observed)(
        'subagent',
        SESSION,
        undefined,
        effect,
        () => {
          throw new Error('The child is never waited on')
        },
        bothWordings,
      ),
    ).resolves.toBe(
      `${PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkUnavailable} / ${UI_TEXT.playbookUnavailable}`,
    )
    expect(effect.calls).toHaveLength(0)
    expect(setup.startWorker.calls).toHaveLength(0)
    expect(setup.lines).toEqual(['warn: A playbook dispatch failed before its work started: Error'])
  })

  it('says so when nothing is open, and when the journal cannot be read', async () => {
    const empty = live()
    const idle = empty.spawn()
    await idle.conversation.act(SESSION)
    expect(idle.told).toEqual([{ level: 'info', text: UI_TEXT.playbookEmpty, hasAction: false }])
    expect(empty.startWorker.calls).toHaveLength(0)
    expect(empty.lines).toEqual([])
    const unreadable = live({ workspaceRoot: undefined, agentDataFolder: journalFolder() })
    const stuck = unreadable.spawn()
    await stuck.conversation.act(SESSION)
    expect(stuck.told).toEqual([
      { level: 'error', text: UI_TEXT.playbookUnavailable, hasAction: false },
    ])
    expect(stuck.lines).toHaveLength(1)
    expect(stuck.lines[0]).toMatch(/^warn: What the playbook owes/)
    expect(unreadable.startWorker.calls).toHaveLength(0)
    expect(unreadable.lines).toEqual([])
  })

  it('closes before a dispatch starts and suppresses its notices', async () => {
    const setup = live()
    for (const kind of ['delegate', 'bestOfN'] as const) {
      const scene = setup.spawn()
      const effect = keepCalls(() => Promise.resolve())
      const work = scene.conversation.dispatch(kind, SESSION, AGENT, effect)
      scene.conversation.dispose()
      await expect(work).rejects.toThrow(UI_TEXT.playbookUnavailable)
      expect(effect.calls).toHaveLength(0)
      expect(scene.told).toEqual([])
      expect(setup.subscriptions.count).toBe(0)
    }
    expect(setup.dispatches).toHaveLength(2)
    for (const entry of setup.dispatches) expect(entry.completion).toBeUndefined()
    const rows = setup.spawn()
    const row = rows.conversation.observed(SESSION, observedRow())
    rows.conversation.dispose()
    await row
    expect(rows.told).toEqual([])
    expect(rows.lines).toHaveLength(1)
    expect(rows.lines[0]).toMatch(/^warn: A playbook dispatch failed/)
    expect(setup.subscriptions.count).toBe(0)
    expect(setup.dispatches).toHaveLength(3)
    expect(setup.dispatches[2]?.completion).toBeUndefined()
    expect(setup.startWorker.calls).toHaveLength(0)
    expect(setup.lines).toEqual([])
  })
})

// Opening a review runs the policy's own git reads, so this waits out real work.
describe('a review the window opens', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('counts the taken attempt as a child, and cancels the review when its turn cannot be sent', async () => {
    const setup = live()
    const { conversation } = setup.spawn()
    const failed = request(() => Promise.reject(new Error('the backend is busy')), {
      bestOfN: bestOfN(),
    })
    await expect(conversation.review(failed.review)).rejects.toThrow('the backend is busy')
    expect(failed.listeners.size).toBe(0)
    const [boundary] = setup.threads
    const sent = boundary?.sent.map((message) => message.type) ?? []
    expect(sent).toContain('reviewOpen')
    expect(sent).toContain('reviewCancel')
    expect(sent).not.toContain('reviewBind')
    const submit = keepCalls((_parts: readonly TurnPart[]) => Promise.resolve({ turnId: 'turn-1' }))
    const taken = request(submit, { bestOfN: bestOfN() })
    await expect(conversation.review(taken.review)).resolves.toEqual({ turnId: 'turn-1' })
    expect(submit.calls).toEqual([
      [[...PARTS, { type: 'text', text: 'charter for src/core/schedules' }]],
    ])
    const openings = (boundary?.sent ?? []).flatMap((message) =>
      message.type === 'reviewOpen' ? [message] : [],
    )
    expect(openings).toHaveLength(2)
    for (const opening of openings)
      expect(opening.children).toEqual([
        { agentId: 'attempt-b', sessionId: 'run-1:attempt-b', files: [STORE] },
      ])
    expect(setup.subscriptions.count).toBe(1)
    conversation.dispose()
    // The cancelled reviews are released before the repository goes away.
    await setup.window.surface.read()
    expect(
      (boundary?.sent ?? []).filter((message) => message.type === 'reviewCancel'),
    ).toHaveLength(2)
    expect(setup.subscriptions.count).toBe(0)
    expect(setup.lines).toEqual([])
  })
})

// A counted review verifies real commits, so this waits out real work.
describe('a review carried to its end', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('binds its review, refuses until answered, and tells notes, rounds and failure', async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-7' }))
    const first = request(submit, { bestOfN: bestOfN() })
    await expect(conversation.review(first.review)).resolves.toEqual({ turnId: 'turn-7' })
    expect(submit.calls).toEqual([
      [[...PARTS, { type: 'text', text: 'charter for src/core/schedules' }]],
    ])
    expect(setup.subscriptions.count).toBe(1)
    expect(first.listeners.size).toBe(1)
    const [boundary] = setup.threads
    if (boundary === undefined) throw new Error('The review never reached the worker')
    expect(boundary.sent.map((message) => message.type)).toContain('reviewBind')
    for (const listener of first.listeners) {
      listener(reviewReply('turn-7', coveredReview([RACE])))
      listener(turnEnd('turn-7'))
    }
    await eventually(() => {
      expect(told).toHaveLength(1)
    })
    expect(told[0]?.level).toBe('info')
    expect(told[0]?.hasAction).toBe(true)
    expect(told[0]?.text).toContain('src/core/schedules')
    // The ticket closed with its rounds: the next event lets it go.
    for (const listener of first.listeners) listener(turnEnd('turn-7'))
    expect(first.listeners.size).toBe(0)
    // The next review is refused until the findings are answered, and sends nothing.
    const again = keepCalls(() => Promise.resolve({ turnId: 'turn-8' }))
    const second = request(again, { bestOfN: bestOfN() })
    const refusal = await refusalOf(conversation.review(second.review))
    if (!(refusal instanceof Error)) throw new Error('The review was admitted')
    expect(again.calls).toHaveLength(0)
    expect(second.listeners.size).toBe(0)
    await eventually(() => {
      expect(told).toHaveLength(2)
    })
    expect(told[1]?.level).toBe('info')
    expect(told[1]?.hasAction).toBe(true)
    expect(told[1]?.text).toBe(refusal.message)
    expect(told[1]?.text).not.toBe(UI_TEXT.playbookUnavailable)
    // Work the worker dies on cannot be certified: its conversation is told so.
    const effect = keepCalls(() => Promise.resolve('sent'))
    await expect(conversation.dispatch('delegate', SESSION, AGENT, effect)).resolves.toBe('sent')
    const [round] = setup.dispatches
    if (round === undefined) throw new Error('The dispatch never reached the window')
    await completionOf(round)
    boundary.crash()
    await aTurn()
    expect(told.map((notice) => [notice.level, notice.hasAction])).toEqual([
      ['info', true],
      ['info', true],
      ['error', false],
    ])
    expect(told[2]?.text).toBe(UI_TEXT.playbookNotCertified)
    expect(setup.lines).toEqual([
      'error: The playbook worker crashed; its pending requests are refused',
      "warn: A playbook dispatch's work could not be certified: Error",
    ])
  })
})

// Every governed round verifies real commits, so this waits out real work.
describe('governed rounds', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('ends rounds with the child, the run, the next review, or the abort', async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    await reviewed(setup, 'turn-1')
    const sent = keepCalls(() => Promise.resolve('sent-1'))
    await expect(conversation.dispatch('delegate', SESSION, AGENT, sent)).resolves.toBe('sent-1')
    const [first] = setup.dispatches
    if (first === undefined) throw new Error('The dispatch never reached the window')
    expect(first.request).toEqual({ kind: 'delegate', sessionId: SESSION, targetId: AGENT })
    const { done: firstEnd } = await completionOf(first)
    // Another child's end is not this round's.
    conversation.ended(SESSION, 'subagent-2')
    expect(await isSettled(firstEnd)).toBe(false)
    conversation.ended(SESSION, AGENT)
    await settled(firstEnd)
    await releasedAll(setup)
    // One held lease per module: a second round refuses while one is open,
    // so each round ends before the next begins.
    const run = keepCalls(() => Promise.resolve('run'))
    await expect(conversation.dispatch('bestOfN', SESSION, undefined, run)).resolves.toBe('run')
    const [bestOfNEntry] = setup.dispatches.slice(-1)
    if (bestOfNEntry === undefined) throw new Error('A round never reached the window')
    const { done: bestOfNEnd } = await completionOf(bestOfNEntry)
    conversation.ended(SESSION, undefined)
    await settled(bestOfNEnd)
    await releasedAll(setup)
    // The review that follows reads what the fix round did: the round is over.
    const followUp = keepCalls(() => Promise.resolve('sent-2'))
    await expect(conversation.dispatch('delegate', SESSION, AGENT, followUp)).resolves.toBe(
      'sent-2',
    )
    const [delegateEntry] = setup.dispatches.slice(-1)
    if (delegateEntry === undefined) throw new Error('A round never reached the window')
    const { done: delegateEnd } = await completionOf(delegateEntry)
    const submit = keepCalls((_parts: readonly TurnPart[]) => Promise.resolve({ turnId: 'turn-2' }))
    await conversation.review(request(submit).review)
    expect(submit.calls[0]?.[0]).toBe(PARTS)
    await settled(delegateEnd)
    await releasedAll(setup)
    expect(told).toEqual([])
    // The caller's own wait sees the submission, and stops when told to.
    const waited: [string, AbortSignal][] = []
    const waitedEnd = keepCalls((submission: string, signal: AbortSignal) => {
      waited.push([submission, signal])
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          resolve()
        })
      })
    })
    await expect(
      conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve('x'), waitedEnd),
    ).resolves.toBe('x')
    const [aborted] = setup.dispatches.slice(-1)
    if (aborted === undefined) throw new Error('The dispatch never reached the window')
    const { done: abortedEnd } = await completionOf(aborted)
    expect(waited).toHaveLength(1)
    expect(waited[0]?.[0]).toBe('x')
    expect(waited[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(waited[0]?.[1].aborted).toBe(false)
    setup.window.dispose()
    await settled(abortedEnd)
    expect(told).toEqual([{ level: 'error', text: UI_TEXT.playbookNotCertified, hasAction: false }])
    expect(setup.lines).toEqual([
      "warn: A playbook dispatch's work could not be certified: Error",
      "warn: A playbook dispatch's answer could not be sent: Error",
    ])
  })

  it('ends an admission with the child or the abort, leaving no callback behind', async () => {
    const setup = live()
    const admit = playbookAdmission(setup.observed)
    await reviewed(setup, 'turn-1')
    const child: { isOver: boolean; wake?: () => void } = { isOver: false }
    const isOver = keepCalls((wake: () => void) => {
      child.wake = wake
      return child.isOver
    })
    await expect(
      admit('delegate', SESSION, AGENT, () => Promise.resolve('sent'), isOver, bothWordings),
    ).resolves.toBe('sent')
    const [first] = setup.dispatches
    if (first === undefined) throw new Error('The dispatch never reached the window')
    expect(first.request).toEqual({ kind: 'delegate', sessionId: SESSION, targetId: AGENT })
    const { done: firstEnd } = await completionOf(first)
    // Asked as the wait began: the child is still at work.
    expect(isOver.calls).toHaveLength(1)
    // A change that is not the end changes nothing; the end does.
    child.wake?.()
    expect(await isSettled(firstEnd)).toBe(false)
    child.isOver = true
    child.wake?.()
    await settled(firstEnd)
    await releasedAll(setup)
    // The host's waiter set, as ModelApiHost keeps one per child.
    const waiters = new Set<() => void>()
    let isChildOver = false
    const isOverAgain = keepCalls((wake: () => void): boolean => {
      waiters[isChildOver ? 'delete' : 'add'](wake)
      return isChildOver
    })
    await expect(
      admit('delegate', SESSION, AGENT, () => Promise.resolve('sent-2'), isOverAgain, bothWordings),
    ).resolves.toBe('sent-2')
    const [second] = setup.dispatches.slice(-1)
    if (second === undefined) throw new Error('The dispatch never reached the window')
    const { done: secondEnd } = await completionOf(second)
    expect(waiters.size).toBe(1)
    expect(isOverAgain.calls).toHaveLength(1)
    setup.window.dispose()
    await settled(secondEnd)
    expect(isOverAgain.calls).toHaveLength(2)
    // The wait is over for the caller, but its callback stays until the
    // child ends: then it is asked, answers over, and is removed.
    expect(waiters.size).toBe(1)
    isChildOver = true
    for (const wake of waiters) wake()
    expect(waiters.size).toBe(0)
    expect(setup.lines).toEqual([
      "warn: A playbook dispatch's work could not be certified: Error",
      "warn: A playbook dispatch's answer could not be sent: Error",
    ])
  })

  it("says a refusal in the playbook's own words, and never runs the work", async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    // The team allows one patch round: the next round's fix work is refused.
    await setup.window.surface.change({ patchRoundsMax: 1 })
    await answered(setup, await reviewed(setup, 'turn-1'))
    await reviewed(setup, 'turn-2')
    const effect = keepCalls(() => Promise.resolve('never'))
    const refusal = await refusalOf(conversation.dispatch('delegate', SESSION, AGENT, effect))
    if (!(refusal instanceof Error)) throw new Error('The dispatch was admitted')
    expect(effect.calls).toHaveLength(0)
    // The refusal's why-note, and the redesign it calls for.
    await eventually(() => {
      expect(told).toHaveLength(2)
    })
    const journaled = journalRefusal(setup)
    expect(journaled.value.rule).toBe('threeStrikes')
    const module = journaled.value.module
    if (module === undefined) throw new Error('The refusal names no module')
    expect(module).toBe('src/core/schedules')
    expect(told[0]).toEqual({
      level: 'info',
      text: playbookNoteText(journaled.value),
      hasAction: true,
    })
    expect(told[1]).toEqual({
      level: 'warning',
      text: fill(UI_TEXT.playbookNotes.designRequired, { module }),
      hasAction: true,
    })
    expect(refusal.message).toBe(told[0]?.text)
    // The same refusal as the caller's own result, in both wordings.
    const again = keepCalls(() => Promise.resolve('never'))
    const result = await playbookAdmission(setup.observed)(
      'delegate',
      SESSION,
      AGENT,
      again,
      () => {
        throw new Error('The child is never waited on')
      },
      bothWordings,
    )
    expect(again.calls).toHaveLength(0)
    await eventually(() => {
      expect(told).toHaveLength(4)
    })
    expect(told[2]?.text).toBe(told[0]?.text)
    expect(told[3]).toEqual(told[1])
    const refusedText = told[2]?.text
    if (refusedText === undefined) throw new Error('The second refusal was not told')
    const second = journalRefusal(setup)
    expect(second.value.module).toBe(module)
    expect(result).toBe(
      `${fill(PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkRefused, {
        rule: second.value.rule,
        code: second.value.code,
        module,
      })} / ${refusedText}`,
    )
    expect(setup.lines).toEqual([
      'info: A playbook dispatch was refused: PlaybookRefusal',
      'info: A playbook dispatch was refused: PlaybookRefusal',
    ])
  })

  it('opens one round per live row and ends only its own', async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    await reviewed(setup, 'turn-1')
    const row = observedRow()
    await conversation.observed(SESSION, row)
    const [first] = setup.dispatches
    if (first === undefined) throw new Error('The row never reached the window')
    expect(first.request).toEqual({ kind: 'subagent', sessionId: SESSION, targetId: AGENT })
    const { done: firstEnd } = await completionOf(first)
    await conversation.observed(SESSION, { ...row, childSessionId: CHILD_SESSION })
    expect(setup.dispatches).toHaveLength(1)
    // A row that is not this round's ends nothing; its own round is refused
    // while this one holds the module's lease, and the refusal is told.
    await conversation.observed(SESSION, observedRow('other', 'other-row', 'completed'))
    await conversation.observed(SESSION, observedRow(AGENT, 'other-row', 'completed'))
    await eventually(() => {
      expect(told).toHaveLength(2)
    })
    expect(setup.dispatches).toHaveLength(3)
    expect(setup.dispatches[1]?.completion).toBeUndefined()
    expect(setup.dispatches[2]?.completion).toBeUndefined()
    const refused = {
      level: 'warning',
      text: 'Playbook: lane Status waits for patchReservation.',
      hasAction: true,
    }
    expect(told).toEqual([refused, refused])
    expect(await isSettled(firstEnd)).toBe(false)
    await conversation.observed(SESSION, observedRow(AGENT, 'row-1', 'completed'))
    await settled(firstEnd)
    await releasedAll(setup)
    for (const [index, status] of ['completed', 'failed', 'cancelled'].entries()) {
      const itemId = `terminal-${String(index)}`
      await conversation.observed(SESSION, observedRow(AGENT, itemId))
      const [entry] = setup.dispatches.slice(-1)
      if (entry === undefined) throw new Error('The row never reached the window')
      await conversation.observed(SESSION, observedRow(AGENT, itemId, status))
      const { done } = await completionOf(entry)
      await settled(done)
      await releasedAll(setup)
    }
    expect(setup.lines).toEqual([
      'info: A playbook dispatch was refused: PlaybookRefusal',
      'info: A playbook dispatch was refused: PlaybookRefusal',
    ])
  })

  it('ends a silent child at the next review, and everything at dispose', async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    await reviewed(setup, 'turn-1')
    await conversation.observed(SESSION, observedRow())
    const [first] = setup.dispatches
    if (first === undefined) throw new Error('The row never reached the window')
    const { done: firstEnd } = await completionOf(first)
    const submit = keepCalls((_parts: readonly TurnPart[]) => Promise.resolve({ turnId: 'turn-2' }))
    await conversation.review(request(submit).review)
    expect(submit.calls[0]?.[0]).toBe(PARTS)
    await settled(firstEnd)
    await releasedAll(setup)
    await conversation.observed(SESSION, observedRow(AGENT, 'row-2'))
    const [second] = setup.dispatches.slice(-1)
    if (second === undefined) throw new Error('The row never reached the window')
    const { done: secondEnd } = await completionOf(second)
    conversation.dispose()
    await settled(secondEnd)
    expect(setup.subscriptions.count).toBe(0)
    const effect = keepCalls(() => Promise.resolve())
    await expect(conversation.dispatch('delegate', SESSION, AGENT, effect)).rejects.toThrow(
      UI_TEXT.playbookUnavailable,
    )
    expect(effect.calls).toHaveLength(0)
    await releasedAll(setup)
    expect(told).toEqual([])
    expect(setup.lines).toEqual([])
  })

  it('settles rows that ended early, and replays settle nothing later', async () => {
    const setup = live()
    const { conversation, told } = setup.spawn()
    await reviewed(setup, 'turn-1')
    // The row ended while its admission was in flight: the round still settles.
    const row = observedRow()
    const work = conversation.observed(SESSION, row)
    await conversation.observed(SESSION, { ...row, status: 'completed' })
    await work
    const [early] = setup.dispatches
    if (early === undefined) throw new Error('The row never reached the window')
    const { done: earlyEnd } = await completionOf(early)
    await settled(earlyEnd)
    await releasedAll(setup)
    // A repeated completion does not close a later follow-up.
    const followUpRow = observedRow(AGENT, 'row-2')
    await conversation.observed(SESSION, followUpRow)
    const [second] = setup.dispatches.slice(-1)
    if (second === undefined) throw new Error('The row never reached the window')
    await conversation.observed(SESSION, { ...followUpRow, status: 'completed' })
    const { done: rowEnd } = await completionOf(second)
    await settled(rowEnd)
    await releasedAll(setup)
    const followUp = keepCalls(() => Promise.resolve('follow-up'))
    await expect(conversation.dispatch('delegate', SESSION, AGENT, followUp)).resolves.toBe(
      'follow-up',
    )
    const [third] = setup.dispatches.slice(-1)
    if (third === undefined) throw new Error('The dispatch never reached the window')
    const { done: followUpEnd } = await completionOf(third)
    await conversation.observed(SESSION, { ...followUpRow, status: 'completed' })
    expect(await isSettled(followUpEnd)).toBe(false)
    // The old row arrives again, running then completed: its round is over,
    // so neither arrival settles the follow-up's own round.
    await conversation.observed(SESSION, followUpRow)
    await conversation.observed(SESSION, { ...followUpRow, status: 'completed' })
    expect(await isSettled(followUpEnd)).toBe(false)
    conversation.ended(SESSION, AGENT)
    await settled(followUpEnd)
    await releasedAll(setup)
    // A replayed row after a new round leaves the new round waiter pending.
    const replayed = observedRow(AGENT, 'row-3')
    await conversation.observed(SESSION, replayed)
    const [fourth] = setup.dispatches.slice(-1)
    if (fourth === undefined) throw new Error('The row never reached the window')
    await conversation.observed(SESSION, { ...replayed, status: 'completed' })
    const { done: replayEnd } = await completionOf(fourth)
    await settled(replayEnd)
    await releasedAll(setup)
    await conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
    const [fifth] = setup.dispatches.slice(-1)
    if (fifth === undefined) throw new Error('The dispatch never reached the window')
    const { done: replayedEnd } = await completionOf(fifth)
    expect(setup.dispatches).toHaveLength(5)
    expect(setup.dispatches.slice(-2).map((entry) => entry.request.kind)).toEqual([
      'subagent',
      'delegate',
    ])
    await conversation.observed(SESSION, replayed)
    await conversation.observed(SESSION, { ...replayed, status: 'completed' })
    expect(await isSettled(replayedEnd)).toBe(false)
    conversation.ended(SESSION, AGENT)
    await settled(replayedEnd)
    await releasedAll(setup)
    expect(told).toEqual([])
    expect(setup.lines).toEqual([])
  })

  it('stops following, cancels its open reviews and ends every round that waited', async () => {
    const setup = live()
    const { conversation } = setup.spawn()
    await answered(setup, await reviewed(setup, 'turn-1'))
    await reviewedChild(setup, 'turn-2', CHILD2, [PANEL_FILES.panel], RACE2)
    // The ticket is on the store module; the dispatch fixes the panel, whose
    // lease it holds: one held lease per module, so each holds its own.
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-9' }))
    const sent = request(submit, { bestOfN: bestOfN() })
    await expect(conversation.review(sent.review)).resolves.toEqual({ turnId: 'turn-9' })
    expect(sent.listeners.size).toBe(1)
    expect(setup.subscriptions.count).toBe(1)
    await conversation.dispatch('delegate', SESSION, AGENT2, () => Promise.resolve())
    const [round] = setup.dispatches
    if (round === undefined) throw new Error('The dispatch never reached the window')
    expect(round.request).toEqual({ kind: 'delegate', sessionId: SESSION, targetId: AGENT2 })
    const { done: roundEnd } = await completionOf(round)
    conversation.dispose()
    expect(setup.subscriptions.count).toBe(0)
    expect(sent.listeners.size).toBe(0)
    await settled(roundEnd)
    await releasedCount(setup, 4)
    expect(setup.lines).toEqual([])
    const [boundary] = setup.threads
    expect(
      (boundary?.sent ?? []).filter((message) => message.type === 'reviewCancel'),
    ).toHaveLength(1)
  })
})
