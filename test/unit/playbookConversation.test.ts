// A conversation's use of its window's playbook (M116, lane C-M116-6; PLAN.md
// D96.16 and D96.17): what a review turn, a dispatch, a subagent the backend
// asks about and the notice's button do, over a window and VS Code pickers
// that the tests stand in. No worker, no git and no model is involved.
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import {
  PATCH_DOCUMENT_MAX_PAGES,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_REFUSAL_MODEL_TEXT,
} from '../../src/shared/constants'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { PlaybookWhyNote } from '../../src/shared/playbook'
import type { AgentSession, OutputPageRequest, TurnPart } from '../../src/core/agent/agentBackend'
import type { PanelModuleSummary } from '../../src/runtime/playbook/governor'
import { playbookNoteText } from '../../src/runtime/playbook/text'
import {
  createPlaybookConversation,
  playbookAdmission,
  playbookRefusalModelText,
  playbookSpawnGapText,
  type PlaybookConversationHost,
  type PlaybookPick,
  type PlaybookSpawnRequest,
  type PlaybookUi,
} from '../../src/host/playbook/playbookConversation'
import {
  PlaybookRefusal,
  type PlaybookConversationEvents,
  type PlaybookDispatch,
  type PlaybookWindow,
  type PlaybookWindowReview,
} from '../../src/host/playbook/playbookWindow'
import { SPAWN_CHOICES } from './helpers/playbook/fakeConversation'

const SESSION = 'session-1'
const CHILD_SESSION = 'child-1'
const AGENT = 'subagent-1'
const STORE = 'src/core/schedules/store.ts'
const PARTS: readonly TurnPart[] = [{ type: 'text', text: 'Review the working tree.' }]
const CHARTER: TurnPart = { type: 'text', text: 'the reviewer charter' }
const NOTE: PlaybookWhyNote = {
  rule: 'threeStrikes',
  code: 'answersPending',
  module: 'src/core/schedules',
  at: Date.UTC(2026, 9, 11),
  needsUser: true,
}
/** What a model reads of `NOTE`: the journal's rule and reason, by their codes. */
const REFUSED_TEXT = playbookRefusalModelText(new PlaybookRefusal(NOTE))

/** A child's item, with the files the host saw it change. */
function changed(...files: string[]): ItemSnapshot {
  return {
    itemId: 'item-1',
    kind: 'toolCall',
    status: 'completed',
    changedFiles: files.map((file) => ({ path: file, added: 1, removed: 0 })),
  }
}

/** A child's edit whose files are in its stored patch only. */
const PATCHED: ItemSnapshot = {
  itemId: 'item-2',
  kind: 'toolCall',
  status: 'completed',
  patchRef: { id: 'src/core/schedules/store', byteLen: 64 },
}

/** One page of a stored output, as a backend serves it. */
function pageOf(content: string, offsetBytes: number, isLast: boolean) {
  return {
    content,
    encoding: 'utf8',
    mediaType: 'application/json',
    offsetBytes,
    byteLen: content.length,
    eof: isLast,
  }
}

function module(overrides: Partial<PanelModuleSummary> = {}): PanelModuleSummary {
  return {
    moduleId: 'module-1',
    moduleKey: 'src/core/schedules',
    round: 1,
    phase: 'fix',
    findings: [],
    isEscalated: false,
    isRedesignDue: false,
    ...overrides,
  }
}

function finding(id: string, isAnswered = false): PanelModuleSummary['findings'][number] {
  return { id, file: STORE, severity: 'P2', line: 7, title: `Finding ${id}`, isAnswered }
}

/** A playbook review ticket that records what the binding did with it. */
function ticket(): PlaybookWindowReview & {
  readonly observed: AgentEvent[]
  readonly bound: string[]
  readonly cancelled: { count: number }
  close(): void
} {
  const state = { isClosed: false }
  const observed: AgentEvent[] = []
  const bound: string[] = []
  const cancelled = { count: 0 }
  return {
    get isClosed() {
      return state.isClosed
    },
    parts: (parts) => [...parts, CHARTER],
    observe: (event) => {
      observed.push(event)
    },
    bind: (turnId) => {
      bound.push(turnId)
    },
    cancel: () => {
      cancelled.count += 1
    },
    observed,
    bound,
    cancelled,
    close: () => {
      state.isClosed = true
    },
  }
}

type Step =
  | { readonly kind: 'many'; readonly keep: (label: string) => boolean }
  | { readonly kind: 'one'; readonly label: string | undefined }
  | { readonly kind: 'text'; readonly text: string | undefined }

/** The list of findings with nothing left ticked as fixed. */
const UNTICK_ALL: Step = { kind: 'many', keep: () => false }

/** A finding answered as disputed, for a reason. */
function disputedWith(reason: string): Step[] {
  return [
    { kind: 'one', label: UI_TEXT.playbookDispositions.disputed },
    { kind: 'text', text: reason },
  ]
}

/** VS Code's pickers, answering from a script; a step of the wrong kind is a test error. */
function scripted(steps: Step[]): { readonly ui: PlaybookUi; readonly asked: string[] } {
  const asked: string[] = []
  const next = (): Step => {
    const step = steps.shift()
    if (step === undefined) throw new Error('The picker script ran out')
    return step
  }
  function showQuickPick<T extends PlaybookPick>(
    items: readonly T[],
    options: { readonly title?: string; readonly canPickMany: true },
  ): PromiseLike<T[] | undefined>
  function showQuickPick<T extends PlaybookPick>(
    items: readonly T[],
    options: { readonly title?: string },
  ): PromiseLike<T | undefined>
  function showQuickPick<T extends PlaybookPick>(
    items: readonly T[],
    options: { readonly title?: string; readonly canPickMany?: boolean },
  ): PromiseLike<T[] | T | undefined> {
    asked.push(options.title ?? '')
    const step = next()
    if (options.canPickMany === true) {
      if (step.kind !== 'many') throw new Error(`The picker script has ${step.kind} for a list`)
      return Promise.resolve(items.filter((item) => step.keep(item.label)))
    }
    if (step.kind !== 'one') throw new Error(`The picker script has ${step.kind} for a choice`)
    return Promise.resolve(items.find((item) => item.label === step.label))
  }
  return {
    asked,
    ui: {
      showQuickPick,
      showInputBox: (options) => {
        asked.push(options.prompt ?? '')
        const step = next()
        if (step.kind !== 'text') throw new Error(`The picker script has ${step.kind} for a text`)
        return Promise.resolve(step.text)
      },
    },
  }
}

interface Scene {
  /** What the window says is under review for the conversation. */
  readonly standing?: readonly PanelModuleSummary[]
  /** What `openReview` answers: a ticket, or nothing for an ordinary review. */
  readonly ticket?: PlaybookWindowReview
  /** What the window refuses every request with. */
  readonly refusal?: Error
  readonly child?: readonly ItemSnapshot[]
  /** Who admits a model's subagent in the backend's mode; the backend asks unless a test says otherwise. */
  readonly spawnAdmission?: ReturnType<PlaybookConversationHost['spawnAdmission']>
  readonly steps?: Step[]
}

function scene(given: Scene = {}) {
  const told: { level: string; text: string; hasAction: boolean }[] = []
  const events = new Map<string, PlaybookConversationEvents>()
  const dispatched: PlaybookDispatch[] = []
  const ends: Promise<void>[] = []
  const stop = new AbortController()
  const refused = (): Promise<never> | undefined =>
    given.refusal === undefined ? undefined : Promise.reject(given.refusal)
  const window: PlaybookWindow = {
    surface: { read: vi.fn(), change: vi.fn() },
    agents: vi.fn(() => Promise.resolve({})),
    standing: vi.fn(() => refused() ?? Promise.resolve([...(given.standing ?? [])])),
    openReview: vi.fn(() => refused() ?? Promise.resolve(given.ticket)),
    dispatch: async <T>(
      request: PlaybookDispatch,
      effect: () => Promise<T>,
      completion: (submission: T, signal: AbortSignal) => Promise<void>,
    ): Promise<T> => {
      dispatched.push(request)
      if (given.refusal !== undefined) throw given.refusal
      const submission = await effect()
      ends.push(completion(submission, stop.signal))
      return submission
    },
    answer: vi.fn(() => Promise.resolve(true)),
    recordDesign: vi.fn(() => Promise.resolve(true)),
    subscribe: (sessionId, conversation) => {
      events.set(sessionId, conversation)
      return () => {
        events.delete(sessionId)
      }
    },
    dispose: vi.fn(),
  }
  const pickers = scripted(given.steps ?? [])
  // The conversation's backend: a child session's items, and its stored patches.
  const readSession = vi.fn((_sessionId: string) =>
    Promise.resolve({ mode: 'inline', items: given.child ?? [], name: undefined, todos: [] }),
  )
  const readSessionOutput = vi.fn((_sessionId: string, page: OutputPageRequest) =>
    // A stored patch, in the shape the backends keep one (M4), in one page.
    Promise.resolve(
      pageOf(JSON.stringify({ files: [{ path: `${page.outputRef}.ts`, hunks: [] }] }), 0, true),
    ),
  )
  const conversation = createPlaybookConversation(window, pickers.ui, {
    notice: (level, text, hasAction) => {
      told.push({ level, text, hasAction })
    },
    backend: () => Promise.resolve({ readSession, readSessionOutput }),
    spawnAdmission: () => given.spawnAdmission ?? 'asked',
  })
  return {
    conversation,
    window,
    told,
    events,
    dispatched,
    ends,
    stop,
    readSession,
    readSessionOutput,
    ...pickers,
  }
}

/** Muse Code's own request to start a subagent, as captured (M18). */
const SPAWN: PlaybookSpawnRequest = {
  type: 'approvalRequested',
  approvalId: 'a1',
  itemId: 'spawn-1',
  toolName: 'subagent_spawn',
  rawArgs: '{}',
  requirementId: { approvalId: 'a1', sourceIndex: 0 },
  subject: { kind: 'tool', toolName: 'subagent_spawn' },
  availableChoices: [...SPAWN_CHOICES],
  isJudgeEscalated: false,
  isProtectedWrite: false,
}

/** The same request for another subagent: an approval of its own. */
function another(approvalId: string): PlaybookSpawnRequest {
  return { ...SPAWN, approvalId, requirementId: { approvalId, sourceIndex: 0 } }
}

function choiceIds(request: PlaybookSpawnRequest | undefined): string[] | undefined {
  return request?.availableChoices.map((choice) => choice.choiceId)
}

/** The backend's answer to a request, for a spawn that must not be answered. */
function unasked() {
  return vi.fn<AgentSession['decideApproval']>(() =>
    Promise.reject(new Error('This request was not to be answered')),
  )
}

/** A review request of the conversation's one child agent. */
function request(submit: (parts: readonly TurnPart[]) => Promise<{ turnId: string }>) {
  const listeners = new Set<(event: AgentEvent) => void>()
  return {
    listeners,
    review: {
      sessionId: SESSION,
      files: [STORE],
      agents: [{ agentId: AGENT, sessionId: CHILD_SESSION }],
      bestOfN: undefined,
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

/** Whether a promise has settled by now, without waiting for it. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  const pending = Symbol('pending')
  // One turn of the event loop first: a promise resolved just now settles within it.
  await new Promise((resolve) => {
    setImmediate(resolve)
  })
  return (await Promise.race([promise, Promise.resolve(pending)])) !== pending
}

/** The wait for the end of the first round the window was given. */
function firstRound(setup: ReturnType<typeof scene>): Promise<void> {
  const [round] = setup.ends
  if (round === undefined) throw new Error('The window was given no completion')
  return round
}

describe('a review turn', () => {
  it('sends a review the window calls ordinary exactly as it is, and follows nothing', async () => {
    const setup = scene({ child: [changed('docs/notes.md')] })
    const submit = vi.fn((_parts: readonly TurnPart[]) => Promise.resolve({ turnId: 'turn-1' }))
    const sent = request(submit)
    await expect(setup.conversation.review(sent.review)).resolves.toEqual({ turnId: 'turn-1' })
    // The very parts it was given: not a copy, no charter.
    expect(submit).toHaveBeenCalledExactlyOnceWith(PARTS)
    expect(submit.mock.calls[0]?.[0]).toBe(PARTS)
    expect(sent.listeners.size).toBe(0)
    expect(setup.told).toEqual([])
  })

  it('gives the window the files the host saw each child change, and nothing a model said', async () => {
    const setup = scene({ child: [changed(STORE, STORE), changed('src/core/schedules/clock.ts')] })
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSession).toHaveBeenCalledExactlyOnceWith(CHILD_SESSION)
    expect(setup.window.openReview).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      [STORE],
      [{ agentId: AGENT, sessionId: CHILD_SESSION, files: [STORE, 'src/core/schedules/clock.ts'] }],
    )
  })

  it('reads a child’s stored patch for the files it changed, from the child’s own session', async () => {
    const setup = scene({ child: [PATCHED] })
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSessionOutput).toHaveBeenCalledExactlyOnceWith(
      CHILD_SESSION,
      expect.objectContaining({ itemId: 'item-2', outputRef: 'src/core/schedules/store' }),
    )
    expect(setup.window.openReview).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      [STORE],
      [{ agentId: AGENT, sessionId: CHILD_SESSION, files: [STORE] }],
    )
  })

  it('reads a stored patch whole, however many pages it takes', async () => {
    const setup = scene({ child: [PATCHED] })
    const document = JSON.stringify({ files: [{ path: STORE, hunks: [] }] })
    const half = Math.floor(document.length / 2)
    setup.readSessionOutput
      .mockResolvedValueOnce(pageOf(document.slice(0, half), 0, false))
      .mockResolvedValueOnce(pageOf(document.slice(half), half, true))
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSessionOutput.mock.calls.map(([, page]) => page.offsetBytes)).toEqual([
      0,
      half,
    ])
    expect(setup.window.openReview).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      [STORE],
      [{ agentId: AGENT, sessionId: CHILD_SESSION, files: [STORE] }],
    )
  })

  it('refuses the review on a stored patch that never ends, or that does not read as one', async () => {
    const submit = vi.fn(() => Promise.resolve({ turnId: 'turn-1' }))
    const endless = scene({ child: [PATCHED] })
    endless.readSessionOutput.mockResolvedValue(pageOf('{"files":[', 0, false))
    await expect(endless.conversation.review(request(submit).review)).rejects.toThrow(
      UI_TEXT.playbookEvidenceUnreadable,
    )
    // It stops at the bound every stored patch is read under, and reads no further.
    expect(endless.readSessionOutput).toHaveBeenCalledTimes(PATCH_DOCUMENT_MAX_PAGES)
    const garbled = scene({ child: [PATCHED] })
    garbled.readSessionOutput.mockResolvedValueOnce(pageOf('not a patch document', 0, true))
    await expect(garbled.conversation.review(request(submit).review)).rejects.toThrow(
      UI_TEXT.playbookEvidenceUnreadable,
    )
    expect(endless.window.openReview).not.toHaveBeenCalled()
    expect(garbled.window.openReview).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('takes a child whose own items say it changed nothing for no child at all', async () => {
    const setup = scene()
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.window.openReview).toHaveBeenCalledExactlyOnceWith(SESSION, [STORE], [])
    // Nothing was orchestrated, so the conversation is not followed either.
    expect(setup.events.size).toBe(0)
  })

  it('refuses the review when what a child changed cannot be read, and says why', async () => {
    const setup = scene({ child: [changed(STORE)] })
    setup.readSession.mockRejectedValueOnce(new Error('the session is gone'))
    const submit = vi.fn(() => Promise.resolve({ turnId: 'turn-1' }))
    // Unknown is not "changed nothing": the review is not called ordinary on it.
    await expect(setup.conversation.review(request(submit).review)).rejects.toThrow(
      UI_TEXT.playbookEvidenceUnreadable,
    )
    expect(setup.window.openReview).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
    // A stored patch that cannot be read is the same: the files it changed are not known.
    const patched = scene({ child: [PATCHED] })
    patched.readSessionOutput.mockRejectedValueOnce(new Error('the page is gone'))
    await expect(patched.conversation.review(request(submit).review)).rejects.toThrow(
      UI_TEXT.playbookEvidenceUnreadable,
    )
    expect(submit).not.toHaveBeenCalled()
  })

  it('refuses a review whose evidence is longer than the journal can hold, and cuts nothing to fit', async () => {
    const many = Array.from(
      { length: PLAYBOOK_RECORD_MAX + 1 },
      (_, index) => `src/${String(index)}.ts`,
    )
    const setup = scene({ child: [changed(...many)] })
    const submit = vi.fn(() => Promise.resolve({ turnId: 'turn-1' }))
    await expect(setup.conversation.review(request(submit).review)).rejects.toThrow(
      UI_TEXT.playbookUnavailable,
    )
    expect(setup.window.openReview).not.toHaveBeenCalled()
    expect(submit).not.toHaveBeenCalled()
  })

  it('counts the best-of-N attempt the person took as a child', async () => {
    const run: BestOfNRun = {
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
        worktreePath: `/tmp/${name}`,
        status: 'completed',
        requestsMade: 1,
        ceilingReached: false,
        approvalsDenied: 0,
        files: [{ path: STORE, insertions: 1, deletions: 0 }],
        changedLines: 1,
      })),
    }
    const setup = scene()
    const sent = request(() => Promise.resolve({ turnId: 'turn-1' }))
    await setup.conversation.review({ ...sent.review, agents: [], bestOfN: run })
    expect(setup.window.openReview).toHaveBeenCalledExactlyOnceWith(
      SESSION,
      [STORE],
      [{ agentId: 'attempt-b', sessionId: 'run-1:attempt-b', files: [STORE] }],
    )
  })

  it('sends a playbook review with the charter, binds it to its turn and watches it to its end', async () => {
    const admitted = ticket()
    const setup = scene({ ticket: admitted, child: [changed(STORE)] })
    const submit = vi.fn(() => Promise.resolve({ turnId: 'turn-7' }))
    const sent = request(submit)
    await expect(setup.conversation.review(sent.review)).resolves.toEqual({ turnId: 'turn-7' })
    expect(submit).toHaveBeenCalledExactlyOnceWith([...PARTS, CHARTER])
    expect(admitted.bound).toEqual(['turn-7'])
    // The conversation is followed, and the review's own events reach the ticket.
    expect(setup.events.has(SESSION)).toBe(true)
    const event: AgentEvent = { type: 'turnCompleted', turnId: 'turn-7', terminal: 'completed' }
    for (const listener of sent.listeners) listener(event)
    expect(admitted.observed).toEqual([event])
    // A ticket that has closed is let go on the next event.
    admitted.close()
    for (const listener of sent.listeners) listener(event)
    expect(sent.listeners.size).toBe(0)
  })

  it('refuses in the playbook’s own words, and sends nothing', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE), child: [changed(STORE)] })
    const submit = vi.fn(() => Promise.resolve({ turnId: 'turn-1' }))
    await expect(setup.conversation.review(request(submit).review)).rejects.toThrow(
      playbookNoteText(NOTE),
    )
    expect(submit).not.toHaveBeenCalled()
  })

  it('cancels the review when its turn cannot be sent', async () => {
    const admitted = ticket()
    const setup = scene({ ticket: admitted, child: [changed(STORE)] })
    const sent = request(() => Promise.reject(new Error('the backend is busy')))
    await expect(setup.conversation.review(sent.review)).rejects.toThrow('the backend is busy')
    expect(admitted.cancelled.count).toBe(1)
    expect(admitted.bound).toEqual([])
    expect(sent.listeners.size).toBe(0)
  })
})

describe('a dispatch', () => {
  it('runs at once for a conversation that has no session yet', async () => {
    const setup = scene()
    await expect(
      setup.conversation.dispatch('bestOfN', undefined, undefined, () => Promise.resolve('ran')),
    ).resolves.toBe('ran')
    expect(setup.dispatched).toEqual([])
  })

  it('goes through the window, and its round ends when the child’s row does', async () => {
    const setup = scene()
    await expect(
      setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve('sent')),
    ).resolves.toBe('sent')
    expect(setup.dispatched).toEqual([{ kind: 'delegate', sessionId: SESSION, targetId: AGENT }])
    const end = firstRound(setup)
    expect(await isSettled(end)).toBe(false)
    // Another child's end is not this round's.
    setup.conversation.ended(SESSION, 'subagent-2')
    expect(await isSettled(end)).toBe(false)
    setup.conversation.ended(SESSION, AGENT)
    expect(await isSettled(end)).toBe(true)
  })

  it('ends a best-of-N round with its run, and every open round with the next review', async () => {
    const setup = scene()
    await setup.conversation.dispatch('bestOfN', SESSION, undefined, () => Promise.resolve())
    await setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
    const [run, delegate] = setup.ends
    if (run === undefined || delegate === undefined) throw new Error('A completion is missing')
    setup.conversation.ended(SESSION, undefined)
    expect(await isSettled(run)).toBe(true)
    expect(await isSettled(delegate)).toBe(false)
    // The review that follows reads what the fix round did: the round is over.
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(await isSettled(delegate)).toBe(true)
  })

  it('waits for the child’s own end where the caller can see it, and stops waiting when told to', async () => {
    const setup = scene()
    const ended = vi.fn((_submission: string, signal: AbortSignal) => {
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          resolve()
        })
      })
    })
    await setup.conversation.dispatch('subagent', SESSION, AGENT, () => Promise.resolve('x'), ended)
    expect(ended).toHaveBeenCalledExactlyOnceWith('x', setup.stop.signal)
    const end = firstRound(setup)
    expect(await isSettled(end)).toBe(false)
    setup.stop.abort()
    expect(await isSettled(end)).toBe(true)
  })

  it('says a refusal in the playbook’s own words, and never runs the work', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const effect = vi.fn(() => Promise.resolve('ran'))
    await expect(setup.conversation.dispatch('delegate', SESSION, AGENT, effect)).rejects.toThrow(
      playbookNoteText(NOTE),
    )
    expect(effect).not.toHaveBeenCalled()
  })
})

describe('a subagent the backend asks about', () => {
  it('is handed back exactly as it came while the conversation has nothing under review', async () => {
    const setup = scene()
    const decide = unasked()
    // The very request: no choice is taken from a conversation the playbook does not govern.
    await expect(setup.conversation.spawnRequest(SESSION, SPAWN, decide)).resolves.toBe(SPAWN)
    expect(setup.dispatched).toEqual([])
    expect(setup.told).toEqual([])
    expect(decide).not.toHaveBeenCalled()
  })

  it('is admitted as a round of its own, without the choice that would stop the asking', async () => {
    const setup = scene({ standing: [module()] })
    const decide = unasked()
    const first = await setup.conversation.spawnRequest(SESSION, SPAWN, decide)
    const second = await setup.conversation.spawnRequest(SESSION, another('a2'), decide)
    // "Allow for this session" is gone; allowing once and rejecting stay.
    expect(choiceIds(first)).toEqual(['allow_once', 'abort'])
    expect(choiceIds(second)).toEqual(['allow_once', 'abort'])
    // The first request said again is the one already asked about: no third round.
    const again = await setup.conversation.spawnRequest(SESSION, SPAWN, decide)
    expect(choiceIds(again)).toEqual(['allow_once', 'abort'])
    expect(setup.dispatched).toEqual([
      { kind: 'subagent', sessionId: SESSION, targetId: undefined },
      { kind: 'subagent', sessionId: SESSION, targetId: undefined },
    ])
    // The conversation is told why, once.
    expect(setup.told).toEqual([
      { level: 'info', text: UI_TEXT.playbookSpawnEachAsked, hasAction: false },
    ])
    expect(decide).not.toHaveBeenCalled()
    // Nobody can name the child yet: the round ends with the next child's row.
    const round = firstRound(setup)
    expect(await isSettled(round)).toBe(false)
    setup.conversation.ended(SESSION, AGENT)
    expect(await isSettled(round)).toBe(true)
  })

  it('ends the round it opened for a spawn the person then turned down', async () => {
    const setup = scene({ standing: [module()] })
    await setup.conversation.spawnRequest(SESSION, SPAWN, unasked())
    const round = firstRound(setup)
    expect(await isSettled(round)).toBe(false)
    // Another approval's end, and another conversation's, are not this round's.
    setup.conversation.approvalResolved(SESSION, 'a-file-write', 'abort')
    setup.conversation.approvalResolved('session-2', 'a1', 'abort')
    expect(await isSettled(round)).toBe(false)
    setup.conversation.approvalResolved(SESSION, 'a1', 'abort')
    expect(await isSettled(round)).toBe(true)
  })

  it('keeps the round of an approved spawn open for its child, and ends it with the child’s row', async () => {
    const setup = scene({ standing: [module()] })
    await setup.conversation.spawnRequest(SESSION, SPAWN, unasked())
    const round = firstRound(setup)
    setup.conversation.approvalResolved(SESSION, 'a1', 'approved')
    setup.conversation.childBegan(SESSION)
    expect(await isSettled(round)).toBe(false)
    setup.conversation.ended(SESSION, AGENT)
    expect(await isSettled(round)).toBe(true)
  })

  it('learns from a child no approved request speaks for that the backend does not ask here, for good', async () => {
    const setup = scene({ standing: [module()] })
    // Asked and approved, then its child: the backend asked.
    await setup.conversation.spawnRequest(SESSION, SPAWN, unasked())
    setup.conversation.approvalResolved(SESSION, 'a1', 'approved')
    setup.conversation.childBegan(SESSION)
    await expect(setup.conversation.hasGap(SESSION)).resolves.toBe(false)
    // A request the person turned down speaks for no child.
    await setup.conversation.spawnRequest(SESSION, another('a2'), unasked())
    setup.conversation.approvalResolved(SESSION, 'a2', 'abort')
    await expect(setup.conversation.hasGap(SESSION)).resolves.toBe(false)
    // A child nobody was asked about: an allow rule of the person's own, known by this alone.
    setup.conversation.childBegan(SESSION)
    await expect(setup.conversation.hasGap(SESSION)).resolves.toBe(true)
    await expect(setup.conversation.gap(SESSION)).resolves.toBe(playbookSpawnGapText())
    // Being asked again later does not undo what was seen.
    await setup.conversation.spawnRequest(SESSION, another('a3'), unasked())
    setup.conversation.approvalResolved(SESSION, 'a3', 'approved')
    await expect(setup.conversation.hasGap(SESSION)).resolves.toBe(true)
    // Another conversation of the window is not this one.
    await expect(setup.conversation.hasGap('session-2')).resolves.toBe(false)
  })

  it('learns nothing from the children of a backend whose own host admits each one', async () => {
    const setup = scene({ standing: [module()], spawnAdmission: 'host' })
    setup.conversation.childBegan(SESSION)
    setup.conversation.childBegan(SESSION)
    await expect(setup.conversation.hasGap(SESSION)).resolves.toBe(false)
  })

  it('answers a refused spawn with the request’s own rejection and the playbook’s reason', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const decide = vi.fn<AgentSession['decideApproval']>(() => Promise.resolve())
    await expect(setup.conversation.spawnRequest(SESSION, SPAWN, decide)).resolves.toBeUndefined()
    // The model reads English, with the journal's own codes for the rule and the reason.
    expect(decide).toHaveBeenCalledExactlyOnceWith({
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
      feedback: REFUSED_TEXT,
    })
    expect(REFUSED_TEXT).toContain('rule: threeStrikes; reason: answersPending')
    expect(REFUSED_TEXT).toContain('module: src/core/schedules')
    // The why-note is the window's to show; the binding adds no notice of its own.
    expect(setup.told).toEqual([])
  })

  it('refuses when the playbook cannot be asked, and says so to the model and the person', async () => {
    const setup = scene({ refusal: new Error('the worker is gone') })
    const decide = vi.fn<AgentSession['decideApproval']>(() => Promise.resolve())
    await expect(setup.conversation.spawnRequest(SESSION, SPAWN, decide)).resolves.toBeUndefined()
    expect(decide.mock.calls[0]?.[0]).toMatchObject({
      choiceId: 'abort',
      feedback: PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkUnavailable,
    })
    expect(setup.told).toEqual([
      { level: 'error', text: UI_TEXT.playbookUnavailable, hasAction: false },
    ])
  })

  it('sends a rejection that takes no feedback without any', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const decide = vi.fn<AgentSession['decideApproval']>(() => Promise.resolve())
    const plain = SPAWN.availableChoices.map((choice) => ({ ...choice, acceptsFeedback: false }))
    await setup.conversation.spawnRequest(SESSION, { ...SPAWN, availableChoices: plain }, decide)
    expect(decide).toHaveBeenCalledExactlyOnceWith({
      approvalId: 'a1',
      choiceId: 'abort',
      requirementId: { approvalId: 'a1', sourceIndex: 0 },
    })
  })

  it('leaves the request to the person, one spawn at a time, when its refusal cannot be sent', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const decide = vi.fn<AgentSession['decideApproval']>(() =>
      Promise.reject(new Error('the session is closing')),
    )
    const shown = await setup.conversation.spawnRequest(SESSION, SPAWN, decide)
    expect(choiceIds(shown)).toEqual(['allow_once', 'abort'])
    // Said again, it is given the same card, and nothing more is sent for it.
    expect(choiceIds(await setup.conversation.spawnRequest(SESSION, SPAWN, unasked()))).toEqual([
      'allow_once',
      'abort',
    ])
    // A request with no way to reject is shown the same way, and nothing is sent for it.
    const approvals = SPAWN.availableChoices.filter((choice) => choice.decision === 'approved')
    const only = await setup.conversation.spawnRequest(
      SESSION,
      { ...another('a2'), availableChoices: approvals },
      unasked(),
    )
    expect(choiceIds(only)).toEqual(['allow_once'])
    // No round was opened for either: turning one down ends nothing, and is no error.
    setup.conversation.approvalResolved(SESSION, 'a1', 'abort')
    expect(setup.ends).toEqual([])
  })
})

/** A child whose work is not over, whenever it is asked. */
function isOverYet(): boolean {
  return false
}

/** A refusal as a caller might make its own result of it: both wordings, in order. */
function bothWordings(reason: string, shown: string): string {
  return `${reason} / ${shown}`
}

/** A Model API conversation's spawn of a child that never finishes, through the window's playbook. */
function newChild(setup: ReturnType<typeof scene>, effect: () => Promise<string>): Promise<string> {
  return playbookAdmission(setup.window)(
    'subagent',
    SESSION,
    undefined,
    effect,
    isOverYet,
    bothWordings,
  )
}

describe('a Model API conversation’s new child work', () => {
  it('runs through the window’s dispatch, and ends the round when the caller’s child is over', async () => {
    const setup = scene()
    const child: { isOver: boolean; wake?: () => void } = { isOver: false }
    const isOver = vi.fn((wake: () => void) => {
      child.wake = wake
      return child.isOver
    })
    await expect(
      playbookAdmission(setup.window)(
        'delegate',
        SESSION,
        AGENT,
        () => Promise.resolve('sent'),
        isOver,
        bothWordings,
      ),
    ).resolves.toBe('sent')
    expect(setup.dispatched).toEqual([{ kind: 'delegate', sessionId: SESSION, targetId: AGENT }])
    const end = firstRound(setup)
    // Asked as the wait began: the child is still at work.
    expect(isOver).toHaveBeenCalledOnce()
    expect(await isSettled(end)).toBe(false)
    // A change that is not the end changes nothing; the end does.
    child.wake?.()
    expect(await isSettled(end)).toBe(false)
    child.isOver = true
    child.wake?.()
    expect(await isSettled(end)).toBe(true)
  })

  it('stops waiting for a child that never finishes when the wait is called off', async () => {
    const setup = scene()
    await newChild(setup, () => Promise.resolve('started'))
    const end = firstRound(setup)
    expect(await isSettled(end)).toBe(false)
    setup.stop.abort()
    expect(await isSettled(end)).toBe(true)
  })

  it('makes a refusal the caller’s own result, in both wordings, and never runs the work', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const effect = vi.fn(() => Promise.resolve('ran'))
    await expect(newChild(setup, effect)).resolves.toBe(
      `${REFUSED_TEXT} / ${playbookNoteText(NOTE)}`,
    )
    expect(effect).not.toHaveBeenCalled()
  })

  it('refuses, saying the playbook could not be asked, when that is why', async () => {
    const setup = scene({ refusal: new Error('the worker is gone') })
    const effect = vi.fn(() => Promise.resolve('ran'))
    await expect(newChild(setup, effect)).resolves.toBe(
      `${PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkUnavailable} / ${UI_TEXT.playbookUnavailable}`,
    )
    expect(effect).not.toHaveBeenCalled()
  })

  it('throws on what the work itself threw, as it is', async () => {
    const setup = scene()
    const broken = new Error('the child could not start')
    await expect(newChild(setup, () => Promise.reject(broken))).rejects.toBe(broken)
  })
})

describe('what a followed conversation is told', () => {
  it('shows each why-note, offer and counted round with the playbook’s button', async () => {
    const setup = scene({ standing: [module()] })
    await setup.conversation.spawnRequest(SESSION, SPAWN, unasked())
    setup.told.length = 0
    const events = setup.events.get(SESSION)
    if (events === undefined) throw new Error('The conversation is not followed')
    events.note(NOTE, undefined)
    events.offer('module-1', 'src/core/schedules')
    events.rounds([module({ round: 2, findings: [finding('f1')] })])
    events.hookOutput('lint failed')
    events.failure()
    expect(setup.told.map((notice) => [notice.level, notice.hasAction])).toEqual([
      ['warning', true],
      ['warning', true],
      ['info', true],
      ['warning', false],
      ['error', false],
    ])
    expect(setup.told[0]?.text).toBe(playbookNoteText(NOTE))
    expect(setup.told[2]?.text).toContain('src/core/schedules')
    expect(setup.told[3]?.text).toBe('lint failed')
    expect(setup.told[4]?.text).toBe(UI_TEXT.playbookNotCertified)
  })

  it('says, with each counted round, that a mode which starts subagents unasked is not admitted', async () => {
    const setup = scene({ standing: [module()], spawnAdmission: 'unasked' })
    await setup.conversation.spawnRequest(SESSION, SPAWN, unasked())
    setup.told.length = 0
    setup.events.get(SESSION)?.rounds([module()])
    expect(setup.told.at(-1)).toEqual({
      level: 'info',
      text: playbookSpawnGapText(),
      hasAction: false,
    })
    await expect(setup.conversation.hasGap(SESSION)).resolves.toBe(true)
    await expect(setup.conversation.gap(SESSION)).resolves.toBe(playbookSpawnGapText())
  })

  it('has no gap to name while the backend asks, or while nothing is under review', async () => {
    const asking = scene({ standing: [module()] })
    await expect(asking.conversation.gap(SESSION)).resolves.toBeUndefined()
    // A backend that asks is never read about: there is nothing to find out.
    expect(asking.window.standing).not.toHaveBeenCalled()
    const idle = scene({ spawnAdmission: 'unasked' })
    await expect(idle.conversation.hasGap(SESSION)).resolves.toBe(false)
    await expect(idle.conversation.gap(SESSION)).resolves.toBeUndefined()
    await expect(idle.conversation.hasGap(undefined)).resolves.toBe(false)
  })

  it('says that it cannot say when the journal cannot be read, and never that there is no gap', async () => {
    const unreadable = scene({ refusal: new Error('unreadable'), spawnAdmission: 'unasked' })
    // The map's question fails as a failure; the status line carries the unavailable words.
    await expect(unreadable.conversation.hasGap(SESSION)).rejects.toThrow('unreadable')
    await expect(unreadable.conversation.gap(SESSION)).resolves.toBe(UI_TEXT.playbookUnavailable)
  })
})

describe('the notice’s button', () => {
  it('records disputed and residual answers as the person gave them, and asks nothing about an answered finding', async () => {
    const open = module({
      findings: [finding('f1'), finding('f2'), finding('f3'), finding('done', true)],
    })
    const setup = scene({
      standing: [open],
      steps: [
        // Nothing is left ticked as fixed: each open finding is asked about in turn.
        UNTICK_ALL,
        ...disputedWith('  It is intended.  '),
        { kind: 'one', label: UI_TEXT.playbookDispositions.residual },
        { kind: 'text', text: 'slow path' },
        { kind: 'text', text: 'bounded by the cap' },
        { kind: 'text', text: 'M130' },
        ...disputedWith('Not a defect.'),
      ],
    })
    await setup.conversation.act(SESSION)
    expect(setup.window.answer).toHaveBeenCalledExactlyOnceWith(SESSION, 'module-1', [
      { findingId: 'f1', status: 'disputed', reason: 'It is intended.' },
      {
        findingId: 'f2',
        status: 'residual',
        name: 'slow path',
        whySafe: 'bounded by the cap',
        followUp: 'M130',
      },
      { findingId: 'f3', status: 'disputed', reason: 'Not a defect.' },
    ])
    expect(setup.told.at(-1)).toEqual({
      level: 'info',
      text: UI_TEXT.playbookNotes.checksPassed,
      hasAction: false,
    })
  })

  it('takes every finding left ticked as fixed', async () => {
    const open = module({ findings: [finding('f1'), finding('f2')] })
    const setup = scene({ standing: [open], steps: [{ kind: 'many', keep: () => true }] })
    await setup.conversation.act(SESSION)
    expect(setup.window.answer).toHaveBeenCalledExactlyOnceWith(SESSION, 'module-1', [
      { findingId: 'f1', status: 'fixed' },
      { findingId: 'f2', status: 'fixed' },
    ])
  })

  it('writes nothing when a picker is dismissed half way', async () => {
    const open = module({ findings: [finding('f1'), finding('f2')] })
    const setup = scene({
      standing: [open],
      steps: [
        UNTICK_ALL,
        ...disputedWith('A reason.'),
        // The second finding's choice is dismissed.
        { kind: 'one', label: undefined },
      ],
    })
    await setup.conversation.act(SESSION)
    expect(setup.window.answer).not.toHaveBeenCalled()
  })

  it('records the design decision’s four fields when a redesign is due', async () => {
    const due = module({ isRedesignDue: true, round: 4 })
    const setup = scene({
      standing: [due],
      steps: [
        { kind: 'text', text: 'shared mutable state' },
        { kind: 'text', text: 'each patch moved the race' },
        { kind: 'text', text: 'one owner for the schedule store' },
        { kind: 'text', text: 'docs/plan/schedules.md' },
      ],
    })
    await setup.conversation.act(SESSION)
    expect(setup.asked).toEqual([
      UI_TEXT.playbookDesignFields.failureClass,
      UI_TEXT.playbookDesignFields.whyPatchesFailed,
      UI_TEXT.playbookDesignFields.structuralChange,
      UI_TEXT.playbookDesignFields.planLocation,
    ])
    expect(setup.window.recordDesign).toHaveBeenCalledExactlyOnceWith(SESSION, 'module-1', {
      failureClass: 'shared mutable state',
      whyPatchesFailed: 'each patch moved the race',
      structuralChange: 'one owner for the schedule store',
      planLocation: 'docs/plan/schedules.md',
    })
  })

  it('asks which module when more than one is open', async () => {
    const other = module({ moduleId: 'module-2', moduleKey: 'src/core/clock', isRedesignDue: true })
    const setup = scene({
      standing: [module(), other],
      steps: [
        { kind: 'one', label: 'src/core/clock' },
        { kind: 'text', text: undefined },
      ],
    })
    await setup.conversation.act(SESSION)
    // The one picked was the one asked about; its first field was dismissed, so nothing was recorded.
    expect(setup.asked).toEqual([UI_TEXT.playbookTitle, UI_TEXT.playbookDesignFields.failureClass])
    expect(setup.window.recordDesign).not.toHaveBeenCalled()
  })

  it('says so when nothing is open, and when the journal cannot be read', async () => {
    const empty = scene()
    await empty.conversation.act(SESSION)
    expect(empty.told).toEqual([{ level: 'info', text: UI_TEXT.playbookEmpty, hasAction: false }])
    const unreadable = scene({ refusal: new Error('unreadable') })
    await unreadable.conversation.act(SESSION)
    expect(unreadable.told).toEqual([
      { level: 'error', text: UI_TEXT.playbookUnavailable, hasAction: false },
    ])
  })
})

describe('a conversation that ends', () => {
  it('stops following, cancels its open reviews and ends every round that waited', async () => {
    const admitted = ticket()
    const setup = scene({ ticket: admitted, child: [changed(STORE)] })
    const sent = request(() => Promise.resolve({ turnId: 'turn-1' }))
    await setup.conversation.review(sent.review)
    await setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
    const end = firstRound(setup)
    setup.conversation.dispose()
    expect(setup.events.size).toBe(0)
    expect(sent.listeners.size).toBe(0)
    expect(admitted.cancelled.count).toBe(1)
    expect(await isSettled(end)).toBe(true)
  })
})
