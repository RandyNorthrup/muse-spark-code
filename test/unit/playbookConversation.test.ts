// A conversation's use of its window's playbook (M116, lane C-M116-6; PLAN.md
// D96.16 and D96.17): what a review turn, a dispatch, a subagent the backend
// asks about and the notice's button do, over a scripted window, scripted
// pickers and a scripted backend. No worker, no git and no model is involved.
import { describe, expect, it, vi } from 'vitest'

/** A function that runs `impl` and keeps the calls it saw, in order. */
function keepCalls<T extends unknown[], R>(
  impl: (...args: T) => R,
): ((...args: T) => R) & {
  calls: T[]
} {
  const calls: T[] = []
  const fn = (...args: T): R => {
    calls.push(args)
    return impl(...args)
  }
  return Object.assign(fn, { calls })
}

/** A log sink that keeps nothing: the scenes assert on notices, not log lines. */
const noopLog = (_message: string): void => undefined

/** A port function that runs `fallback` and keeps its calls; answers can be scripted. */
function scriptedPort<T extends unknown[], R>(fallback: (...args: T) => R) {
  const calls: T[] = []
  const queued: ((...args: T) => R)[] = []
  let current = fallback
  const fn = (...args: T): R => {
    calls.push(args)
    const next = queued.shift()
    return next === undefined ? current(...args) : next(...args)
  }
  return Object.assign(fn, {
    calls,
    /** Answer every later call with `make`. */
    answer: (make: (...args: T) => R) => {
      current = make
    },
    /** Answer the next call with `make`. */
    answerOnce: (make: (...args: T) => R) => {
      queued.push(make)
    },
    /** Fail the next call with `make`. */
    failOnce: (make: (...args: T) => R) => {
      queued.push(make)
    },
  })
}
import type { AgentEvent, ItemSnapshot } from '../../src/shared/agentEvents'
import type { BestOfNRun } from '../../src/shared/bestOfN'
import {
  OUTPUT_PAGE_BYTES,
  PATCH_DOCUMENT_MAX_PAGES,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_REFUSAL_MODEL_TEXT,
} from '../../src/shared/constants'
import { fill, formatNumber, UI_TEXT } from '../../src/shared/l10n/text'
import type { PlaybookWhyNote } from '../../src/shared/playbook'
import type { OutputPageRequest, TurnPart } from '../../src/core/agent/agentBackend'
import type { PanelModuleSummary } from '../../src/runtime/playbook/governor'
import { playbookNoteText } from '../../src/runtime/playbook/text'
import {
  createPlaybookConversation,
  playbookAdmission,
  playbookRefusalModelText,
  type PlaybookPick,
  type PlaybookUi,
} from '../../src/host/playbook/playbookConversation'
import {
  PlaybookRefusal,
  type PlaybookConversationEvents,
  type PlaybookDispatch,
  type PlaybookWindow,
  type PlaybookWindowReview,
} from '../../src/host/playbook/playbookWindow'

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
  readonly admission?: Promise<void>
  readonly steps?: Step[]
  /** Tells which file a changed path names; throws when it cannot be told. */
  readonly resolveIdentity?: (file: string) => unknown
}

function scene(given: Scene = {}) {
  const told: { level: string; text: string; hasAction: boolean }[] = []
  const events = new Map<string, PlaybookConversationEvents>()
  const dispatched: PlaybookDispatch[] = []
  const ends: Promise<void>[] = []
  const stop = new AbortController()
  const refused = (): Promise<never> | undefined =>
    given.refusal === undefined ? undefined : Promise.reject(given.refusal)
  const openReview = keepCalls<
    Parameters<PlaybookWindow['openReview']>,
    ReturnType<PlaybookWindow['openReview']>
  >(() => refused() ?? Promise.resolve(given.ticket))
  const answer = keepCalls(() => Promise.resolve(true))
  const recordDesign = keepCalls(() => Promise.resolve(true))
  const window: PlaybookWindow = {
    surface: {
      read: keepCalls((): Promise<unknown> => Promise.resolve(undefined)),
      change: keepCalls((): Promise<unknown> => Promise.resolve(undefined)),
    },
    agents: () => Promise.resolve({}),
    standing: keepCalls(() => refused() ?? Promise.resolve([...(given.standing ?? [])])),
    openReview,
    dispatch: async <T>(
      request: PlaybookDispatch,
      effect: () => Promise<T>,
      completion: (submission: T, signal: AbortSignal) => Promise<void>,
    ): Promise<T> => {
      dispatched.push(request)
      if (given.refusal !== undefined) throw given.refusal
      await given.admission
      const submission = await effect()
      ends.push(completion(submission, stop.signal))
      return submission
    },
    answer,
    recordDesign,
    subscribe: (sessionId, conversation) => {
      events.set(sessionId, conversation)
      return () => {
        events.delete(sessionId)
      }
    },
    dispose: keepCalls(() => undefined),
  }
  const pickers = scripted(given.steps ?? [])
  // The conversation's backend: a child session's items, and its stored patches.
  const readSession = scriptedPort((_sessionId: string) =>
    Promise.resolve({ mode: 'inline', items: given.child ?? [], name: undefined, todos: [] }),
  )
  const readSessionOutput = scriptedPort((_sessionId: string, page: OutputPageRequest) =>
    // A stored patch, in the shape the backends keep one (M4), in one page.
    Promise.resolve(
      pageOf(JSON.stringify({ files: [{ path: `${page.outputRef}.ts`, hunks: [] }] }), 0, true),
    ),
  )
  const conversation = createPlaybookConversation(
    window,
    pickers.ui,
    {
      notice: (level, text, hasAction) => {
        told.push({ level, text, hasAction })
      },
      backend: () => Promise.resolve({ readSession, readSessionOutput }),
      log: { trace: noopLog, info: noopLog, warn: noopLog, error: noopLog },
    },
    given.resolveIdentity,
  )
  return {
    conversation,
    // The window with its recorded stubs visible: the conversation took the
    // plain port, and the tests read what it was asked.
    window: Object.assign(window, { openReview, answer, recordDesign }),
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

/** A review that reports one unreadable child and sends nothing else. */
async function expectUnreadable(
  setup: ReturnType<typeof scene>,
  submit: ((parts: readonly TurnPart[]) => Promise<{ turnId: string }>) & {
    calls: (readonly TurnPart[])[][]
  },
  calls: number,
): Promise<void> {
  await expect(setup.conversation.review(request(submit).review)).resolves.toEqual({
    turnId: 'turn-1',
  })
  expect(setup.window.openReview.calls).toEqual([
    [
      SESSION,
      [STORE],
      [
        expect.objectContaining({
          agentId: AGENT,
          files: [],
          blocked: expect.objectContaining({ code: 'patchUnreadable' }),
        }),
      ],
    ],
  ])
  expect(submit.calls).toHaveLength(calls)
}

/** A conversation whose one child’s patch does not read, reviewed once. */
async function blockedOnce(): Promise<ReturnType<typeof scene>> {
  const setup = scene({ child: [PATCHED], ticket: ticket() })
  setup.readSessionOutput.answer(() => Promise.resolve(pageOf('not a patch', 0, true)))
  await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
  return setup
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
    const submit = keepCalls((_parts: readonly TurnPart[]) => Promise.resolve({ turnId: 'turn-1' }))
    const sent = request(submit)
    await expect(setup.conversation.review(sent.review)).resolves.toEqual({ turnId: 'turn-1' })
    // The very parts it was given: not a copy, no charter.
    expect(submit.calls).toEqual([[PARTS]])
    expect(submit.calls[0]?.[0]).toBe(PARTS)
    expect(sent.listeners.size).toBe(0)
    expect(setup.told).toEqual([])
  })

  it('gives the window the files the host saw each child change, and nothing a model said', async () => {
    const setup = scene({ child: [changed(STORE, STORE), changed('src/core/schedules/clock.ts')] })
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSession.calls).toEqual([[CHILD_SESSION]])
    expect(setup.window.openReview.calls).toEqual([
      [
        SESSION,
        [STORE],
        [
          {
            agentId: AGENT,
            sessionId: CHILD_SESSION,
            files: [STORE, 'src/core/schedules/clock.ts'],
          },
        ],
      ],
    ])
  })

  it('reads a child’s stored patch for the files it changed, from the child’s own session', async () => {
    const setup = scene({ child: [PATCHED] })
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSessionOutput.calls).toEqual([
      [
        CHILD_SESSION,
        expect.objectContaining({ itemId: 'item-2', outputRef: 'src/core/schedules/store' }),
      ],
    ])
    expect(setup.window.openReview.calls).toEqual([
      [SESSION, [STORE], [{ agentId: AGENT, sessionId: CHILD_SESSION, files: [STORE] }]],
    ])
  })

  it('reads a stored patch whole, however many pages it takes', async () => {
    const setup = scene({ child: [PATCHED] })
    const document = JSON.stringify({ files: [{ path: STORE, hunks: [] }] })
    const half = Math.floor(document.length / 2)
    setup.readSessionOutput.answerOnce(() =>
      Promise.resolve(pageOf(document.slice(0, half), 0, false)),
    )
    setup.readSessionOutput.answerOnce(() =>
      Promise.resolve(pageOf(document.slice(half), half, true)),
    )
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSessionOutput.calls.map(([, page]) => page.offsetBytes)).toEqual([0, half])
    expect(setup.window.openReview.calls).toEqual([
      [SESSION, [STORE], [{ agentId: AGENT, sessionId: CHILD_SESSION, files: [STORE] }]],
    ])
  })

  it('reports a stored patch that never ends, or that does not read as one, and reviews on', async () => {
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    const endless = scene({ child: [PATCHED] })
    endless.readSessionOutput.answer(() => Promise.resolve(pageOf('{"files":[', 0, false)))
    // It stops at the bound every stored patch is read under, and reads no further.
    await expectUnreadable(endless, submit, 1)
    expect(endless.readSessionOutput.calls).toHaveLength(PATCH_DOCUMENT_MAX_PAGES)
    const garbled = scene({ child: [PATCHED] })
    garbled.readSessionOutput.answerOnce(() =>
      Promise.resolve(pageOf('not a patch document', 0, true)),
    )
    await expectUnreadable(garbled, submit, 2)
  })

  it('takes a child whose own items say it changed nothing for no child at all', async () => {
    const setup = scene()
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.window.openReview.calls).toEqual([[SESSION, [STORE], []]])
    // Nothing was orchestrated, so the conversation is not followed either.
    expect(setup.events.size).toBe(0)
  })

  it('reports a child whose session cannot be read, and reviews on', async () => {
    const setup = scene({ child: [changed(STORE)] })
    setup.readSession.failOnce(() => Promise.reject(new Error('the session is gone')))
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    // Unknown is not "changed nothing": the review is not called ordinary on it.
    await expectUnreadable(setup, submit, 1)
    // A stored patch that cannot be read is the same: its files are a finding, not a refusal.
    const patched = scene({ child: [PATCHED] })
    patched.readSessionOutput.failOnce(() => Promise.reject(new Error('the page is gone')))
    await expectUnreadable(patched, submit, 2)
  })

  it('reports a child that changed more files than the journal can hold, and cuts nothing to fit', async () => {
    const many = Array.from(
      { length: PLAYBOOK_RECORD_MAX + 1 },
      (_, index) => `src/${String(index)}.ts`,
    )
    const setup = scene({ child: [changed(...many)] })
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    await expect(setup.conversation.review(request(submit).review)).resolves.toEqual({
      turnId: 'turn-1',
    })
    const children = setup.window.openReview.calls[0]?.[2]
    expect(children).toEqual([
      expect.objectContaining({
        agentId: AGENT,
        files: [],
        blocked: expect.objectContaining({ code: 'tooManyFiles' }),
      }),
    ])
    expect(setup.told.find((notice) => notice.level === 'warning')?.text).toBe(
      fill(UI_TEXT.playbookBlockedMany, {
        child: AGENT,
        count: formatNumber(PLAYBOOK_RECORD_MAX + 1),
        bound: formatNumber(PLAYBOOK_RECORD_MAX),
      }),
    )
  })

  it('opens two children’s rounds that work unasked, owing nothing for it', async () => {
    const setup = scene({ child: [changed(STORE)], ticket: ticket() })
    await setup.conversation.dispatch('delegate', SESSION, 'subagent-1', () => Promise.resolve())
    await setup.conversation.dispatch('delegate', SESSION, 'subagent-2', () => Promise.resolve())
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    const sent = request(submit)
    await expect(
      setup.conversation.review({
        ...sent.review,
        agents: [
          { agentId: 'subagent-1', sessionId: 'child-1' },
          { agentId: 'subagent-2', sessionId: 'child-2' },
        ],
      }),
    ).resolves.toEqual({ turnId: 'turn-1' })
    // Both rounds are the review's, unmarked: nothing is owed for the work being unasked.
    expect(setup.window.openReview.calls[0]?.[2]).toEqual([
      { agentId: 'subagent-1', sessionId: 'child-1', files: [STORE] },
      { agentId: 'subagent-2', sessionId: 'child-2', files: [STORE] },
    ])
    expect(setup.told).toHaveLength(0)
    expect(submit.calls).toHaveLength(1)
  })

  it('still refuses a review of more files than the journal can hold', async () => {
    const many = Array.from(
      { length: PLAYBOOK_RECORD_MAX + 1 },
      (_, index) => `src/${String(index)}.ts`,
    )
    const setup = scene({ child: [changed(STORE)] })
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    await expect(
      setup.conversation.review({ ...request(submit).review, files: many }),
    ).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(setup.window.openReview.calls).toHaveLength(0)
    expect(submit.calls).toHaveLength(0)
  })

  it.each([
    'nameWithheld',
    'patchTooLarge',
    'patchUnreadable',
    'identityUnreadable',
    'tooManyFiles',
  ] as const)(
    'reports a %s contribution against its child and lets a clean second child proceed',
    async (code) => {
      const secretFile = `src/core/schedules/sk-${'x'.repeat(24)}.ts`
      const unreadableFile = 'src/core/schedules/unreadable.ts'
      const many = Array.from(
        { length: PLAYBOOK_RECORD_MAX + 1 },
        (_, index) => `src/generated/${String(index)}.ts`,
      )
      const patchByteLen =
        code === 'patchTooLarge' ? PATCH_DOCUMENT_MAX_PAGES * OUTPUT_PAGE_BYTES + 1 : 1
      let bad: ItemSnapshot
      switch (code) {
        case 'nameWithheld': {
          bad = changed(STORE, secretFile)
          break
        }
        case 'identityUnreadable': {
          bad = changed(unreadableFile)
          break
        }
        case 'tooManyFiles': {
          bad = changed(...many)
          break
        }
        default: {
          bad = { ...PATCHED, patchRef: { id: 'patch', byteLen: patchByteLen } }
        }
      }
      const setup = scene({
        ticket: ticket(),
        ...(code === 'identityUnreadable' && {
          resolveIdentity: (file: string) => {
            if (file === unreadableFile) throw new Error('EACCES')
          },
        }),
      })
      setup.readSession.answer((sessionId: string) => {
        const items = [sessionId === CHILD_SESSION ? bad : changed(STORE)]
        return Promise.resolve({ mode: 'inline', name: undefined, todos: [], items })
      })
      if (code === 'patchUnreadable')
        setup.readSessionOutput.answer(() => Promise.resolve(pageOf('not a patch', 0, true)))
      const submit = keepCalls(() => Promise.resolve({ turnId: 'clean-review' }))
      const sent = request(submit)
      const review = {
        ...sent.review,
        agents: [...sent.review.agents, { agentId: 'clean-child', sessionId: 'clean-session' }],
      }
      await expect(setup.conversation.review(review)).resolves.toEqual({ turnId: 'clean-review' })
      const children = setup.window.openReview.calls[0]?.[2]
      const [blocked] = children?.filter((child) => child.agentId === AGENT) ?? []
      expect(blocked).toEqual({
        agentId: AGENT,
        sessionId: CHILD_SESSION,
        files: code === 'nameWithheld' ? [STORE] : [],
        blocked: expect.objectContaining({ code }),
      })
      // The clean child's review completes beside it.
      expect(children).toContainEqual({
        agentId: 'clean-child',
        sessionId: 'clean-session',
        files: [STORE],
      })
      // The person is told, with the child's label and never a withheld name.
      const warnings = setup.told.filter((notice) => notice.level === 'warning')
      expect(warnings).toHaveLength(1)
      expect(warnings[0]?.text).toContain(AGENT)
      expect(warnings[0]?.text).not.toContain(secretFile)
      expect(warnings[0]?.text).not.toContain('x'.repeat(24))
      if (code === 'patchTooLarge') expect(setup.readSessionOutput.calls).toHaveLength(0)
      // The next review does not read the same blocked contribution again as
      // if new: the marker is re-sent with its id, and told once. The clean
      // child is read again; the blocked one is not.
      const blockedReads = setup.readSession.calls.filter(
        ([sessionId]) => sessionId === CHILD_SESSION,
      ).length
      const outputs = setup.readSessionOutput.calls.length
      await expect(setup.conversation.review(review)).resolves.toEqual({ turnId: 'clean-review' })
      expect(
        setup.readSession.calls.filter(([sessionId]) => sessionId === CHILD_SESSION),
      ).toHaveLength(blockedReads)
      expect(setup.readSession.calls).toHaveLength(blockedReads + 2)
      expect(setup.readSessionOutput.calls).toHaveLength(outputs)
      expect(setup.window.openReview.calls[1]?.[2]?.[0]).toEqual(blocked)
      expect(setup.told.filter((notice) => notice.level === 'warning')).toHaveLength(1)
    },
  )

  it('reads a blocked contribution again after a new round for that child', async () => {
    const setup = await blockedOnce()
    const [first] = setup.window.openReview.calls[0]?.[2] ?? []
    expect(first?.blocked?.code).toBe('patchUnreadable')
    await setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSession.calls).toHaveLength(2)
    const [second] = setup.window.openReview.calls[1]?.[2] ?? []
    expect(second?.blocked?.code).toBe('patchUnreadable')
    expect(second?.blocked?.id).not.toBe(first?.blocked?.id)
    expect(setup.told.filter((notice) => notice.level === 'warning')).toHaveLength(2)
  })

  it('reads a blocked contribution again after the child’s first live row', async () => {
    const setup = await blockedOnce()
    expect(setup.readSession.calls).toHaveLength(1)
    await setup.conversation.observed(SESSION, {
      itemId: 'item-9',
      kind: 'subagent',
      status: 'inProgress',
      subagentId: AGENT,
    })
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'turn-1' })).review)
    expect(setup.readSession.calls).toHaveLength(2)
  })

  it('ignores a replayed row after a new round, leaving the new round waiter pending', async () => {
    const setup = scene()
    const running: ItemSnapshot = {
      itemId: 'item-1',
      kind: 'subagent',
      status: 'inProgress',
      subagentId: AGENT,
    }
    const completed: ItemSnapshot = { ...running, status: 'completed' }
    await setup.conversation.observed(SESSION, running)
    await setup.conversation.observed(SESSION, completed)
    expect(await isSettled(firstRound(setup))).toBe(true)
    // A new round for the same child starts its own wait.
    await setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
    expect(setup.dispatched).toHaveLength(2)
    const later = setup.ends[1]
    if (later === undefined) throw new Error('The new round was given no completion')
    // The old row arrives again, running then completed: neither settles the new round.
    await setup.conversation.observed(SESSION, running)
    await setup.conversation.observed(SESSION, completed)
    expect(await isSettled(later)).toBe(false)
    expect(setup.dispatched).toHaveLength(2)
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
    expect(setup.window.openReview.calls).toEqual([
      [SESSION, [STORE], [{ agentId: 'attempt-b', sessionId: 'run-1:attempt-b', files: [STORE] }]],
    ])
  })

  it('sends a playbook review with the charter, binds it to its turn and watches it to its end', async () => {
    const admitted = ticket()
    const setup = scene({ ticket: admitted, child: [changed(STORE)] })
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-7' }))
    const sent = request(submit)
    await expect(setup.conversation.review(sent.review)).resolves.toEqual({ turnId: 'turn-7' })
    expect(submit.calls).toEqual([[[...PARTS, CHARTER]]])
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
    const submit = keepCalls(() => Promise.resolve({ turnId: 'turn-1' }))
    await expect(setup.conversation.review(request(submit).review)).rejects.toThrow(
      playbookNoteText(NOTE),
    )
    expect(submit.calls).toHaveLength(0)
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
    const ended = keepCalls((_submission: string, signal: AbortSignal) => {
      return new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => {
          resolve()
        })
      })
    })
    await setup.conversation.dispatch('subagent', SESSION, AGENT, () => Promise.resolve('x'), ended)
    expect(ended.calls).toEqual([['x', setup.stop.signal]])
    const end = firstRound(setup)
    expect(await isSettled(end)).toBe(false)
    setup.stop.abort()
    expect(await isSettled(end)).toBe(true)
  })

  it('says a refusal in the playbook’s own words, and never runs the work', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const effect = keepCalls(() => Promise.resolve('ran'))
    await expect(setup.conversation.dispatch('delegate', SESSION, AGENT, effect)).rejects.toThrow(
      playbookNoteText(NOTE),
    )
    expect(effect.calls).toHaveLength(0)
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
function newChild(
  setup: ReturnType<typeof scene>,
  effect: () => Promise<string>,
): Promise<string> | undefined {
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
    const isOver = keepCalls((wake: () => void) => {
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
    expect(isOver.calls).toHaveLength(1)
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

  it('removes an aborted wait’s callback from the child’s waiter set', async () => {
    const setup = scene()
    // The host's waiter set, as ModelApiHost keeps one per child.
    const waiters = new Set<() => void>()
    let isOver = false
    const isChildOver = (wake: () => void): boolean => {
      waiters[isOver ? 'delete' : 'add'](wake)
      return isOver
    }
    await playbookAdmission(setup.window)(
      'delegate',
      SESSION,
      AGENT,
      () => Promise.resolve('sent'),
      isChildOver,
      bothWordings,
    )
    await vi.waitFor(() => {
      expect(waiters.size).toBe(1)
    })
    const end = firstRound(setup)
    expect(await isSettled(end)).toBe(false)
    setup.stop.abort()
    expect(await isSettled(end)).toBe(true)
    // The wait is over for the caller, but its callback stays until the
    // child ends: then it is asked, answers over, and is removed.
    expect(waiters.size).toBe(1)
    isOver = true
    for (const wake of waiters) wake()
    expect(waiters.size).toBe(0)
  })

  it('makes a refusal the caller’s own result, in both wordings, and never runs the work', async () => {
    const setup = scene({ refusal: new PlaybookRefusal(NOTE) })
    const effect = keepCalls(() => Promise.resolve('ran'))
    await expect(newChild(setup, effect)).resolves.toBe(
      `${REFUSED_TEXT} / ${playbookNoteText(NOTE)}`,
    )
    expect(effect.calls).toHaveLength(0)
  })

  it('refuses, saying the playbook could not be asked, when that is why', async () => {
    const setup = scene({ refusal: new Error('the worker is gone') })
    const effect = keepCalls(() => Promise.resolve('ran'))
    await expect(newChild(setup, effect)).resolves.toBe(
      `${PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkUnavailable} / ${UI_TEXT.playbookUnavailable}`,
    )
    expect(effect.calls).toHaveLength(0)
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
    await setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
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
    expect(setup.window.answer.calls).toEqual([
      [
        SESSION,
        'module-1',
        [
          { findingId: 'f1', status: 'disputed', reason: 'It is intended.' },
          {
            findingId: 'f2',
            status: 'residual',
            name: 'slow path',
            whySafe: 'bounded by the cap',
            followUp: 'M130',
          },
          { findingId: 'f3', status: 'disputed', reason: 'Not a defect.' },
        ],
      ],
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
    expect(setup.window.answer.calls).toEqual([
      [
        SESSION,
        'module-1',
        [
          { findingId: 'f1', status: 'fixed' },
          { findingId: 'f2', status: 'fixed' },
        ],
      ],
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
    expect(setup.window.answer.calls).toHaveLength(0)
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
    expect(setup.window.recordDesign.calls).toEqual([
      [
        SESSION,
        'module-1',
        {
          failureClass: 'shared mutable state',
          whyPatchesFailed: 'each patch moved the race',
          structuralChange: 'one owner for the schedule store',
          planLocation: 'docs/plan/schedules.md',
        },
      ],
    ])
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
    expect(setup.window.recordDesign.calls).toHaveLength(0)
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

function observedRow(subagentId = AGENT, itemId = 'row-1', status = 'inProgress'): ItemSnapshot {
  return { itemId, subagentId, kind: 'subagent', status }
}

describe('observed Muse Code children after the 1.4.4/1.4.6 capture', () => {
  it('opens exactly one round before the child session id arrives and ends only its own row', async () => {
    const setup = scene()
    const row = observedRow()
    await setup.conversation.observed(SESSION, row)
    await setup.conversation.observed(SESSION, { ...row, childSessionId: CHILD_SESSION })
    expect(setup.dispatched).toEqual([{ kind: 'subagent', sessionId: SESSION, targetId: AGENT }])
    const end = firstRound(setup)
    await setup.conversation.observed(SESSION, observedRow('other', 'other-row', 'completed'))
    await setup.conversation.observed(SESSION, observedRow(AGENT, 'other-row', 'completed'))
    expect(await isSettled(end)).toBe(false)
    await setup.conversation.observed(SESSION, observedRow(AGENT, 'row-1', 'completed'))
    expect(await isSettled(end)).toBe(true)
  })

  it.each(['completed', 'failed', 'cancelled'])(
    'closes the matching round on %s',
    async (status) => {
      const setup = scene()
      await setup.conversation.observed(SESSION, observedRow())
      const end = firstRound(setup)
      await setup.conversation.observed(SESSION, observedRow(AGENT, 'row-1', status))
      expect(await isSettled(end)).toBe(true)
    },
  )

  it('closes a child that never reports at the next review', async () => {
    const setup = scene()
    await setup.conversation.observed(SESSION, observedRow())
    const end = firstRound(setup)
    await setup.conversation.review(request(() => Promise.resolve({ turnId: 'review' })).review)
    expect(await isSettled(end)).toBe(true)
  })

  it('closes on conversation replacement or window reload and accepts no later work', async () => {
    const setup = scene()
    await setup.conversation.observed(SESSION, observedRow())
    const end = firstRound(setup)
    setup.conversation.dispose()
    expect(await isSettled(end)).toBe(true)
    const effect = keepCalls(() => Promise.resolve())
    await expect(setup.conversation.dispatch('delegate', SESSION, AGENT, effect)).rejects.toThrow(
      UI_TEXT.playbookUnavailable,
    )
    expect(effect.calls).toHaveLength(0)
  })

  it.each(['delegate', 'bestOfN', 'subagent'] as const)(
    'closes before an in-flight %s admission and suppresses its notices',
    async (kind) => {
      const admission = Promise.withResolvers<undefined>()
      const setup = scene({ admission: admission.promise })
      const effect = keepCalls(() => Promise.resolve())
      const work =
        kind === 'subagent'
          ? setup.conversation.observed(SESSION, observedRow())
          : setup.conversation.dispatch(kind, SESSION, AGENT, effect)
      const result = settleWork(work)
      const events = setup.events.get(SESSION)
      setup.conversation.dispose()
      events?.note(NOTE, undefined)
      admission.resolve(undefined)
      await result
      expect(effect.calls).toHaveLength(0)
      expect(setup.ends).toEqual([])
      expect(setup.told).toEqual([])
      expect(setup.events.size).toBe(0)
    },
  )

  it('settles a row that ended while admission was in flight', async () => {
    const admission = Promise.withResolvers<undefined>()
    const setup = scene({ admission: admission.promise })
    const work = setup.conversation.observed(SESSION, observedRow())
    await setup.conversation.observed(SESSION, observedRow(AGENT, 'row-1', 'completed'))
    admission.resolve(undefined)
    await work
    expect(await isSettled(firstRound(setup))).toBe(true)
  })
})

async function settleWork(work: Promise<void>): Promise<void> {
  try {
    await work
  } catch {
    // The old conversation was closed before admission returned.
  }
}

it('a repeated live completion does not close a later follow-up', async () => {
  const setup = scene()
  const row = observedRow()
  await setup.conversation.observed(SESSION, row)
  await setup.conversation.observed(SESSION, { ...row, status: 'completed' })
  await setup.conversation.dispatch('delegate', SESSION, AGENT, () => Promise.resolve())
  const end = setup.ends.at(-1)
  if (end === undefined) throw new Error('The follow-up has no completion')
  await setup.conversation.observed(SESSION, { ...row, status: 'completed' })
  expect(await isSettled(end)).toBe(false)
  // The old row arrives again, running then completed: its round is over,
  // so neither arrival settles the follow-up's own round (P2-3: rows are
  // ordered and a terminal state is final).
  await setup.conversation.observed(SESSION, row)
  await setup.conversation.observed(SESSION, { ...row, status: 'completed' })
  expect(await isSettled(end)).toBe(false)
})
