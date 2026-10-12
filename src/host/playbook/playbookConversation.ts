// A conversation's use of its window's playbook (M116, lane C-M116-6; PLAN.md
// D96.16 and D96.17). The conversation controller lends three small things
// (a notice and its backend) and calls in at a review turn, a dispatch,
// an observed Muse Code child's live row, and the notice's button. Everything else lives here,
// in the lazy bundle, so a conversation that orchestrates nothing pays for
// none of it.
//
// What counts as orchestrated is host evidence only: the child sessions the
// controller recorded and the files their own items say they changed, and a
// best-of-N attempt the person took. No model text decides it.

import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import { agentFilesFromPatch } from '../../shared/agentReceipt'
import type { BestOfNRun } from '../../shared/bestOfN'
import {
  OUTPUT_PAGE_BYTES,
  PATCH_DOCUMENT_MAX_PAGES,
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_REFUSAL_MODEL_TEXT,
  REVIEW_FINDING_PATH_MAX_CHARS,
  REVIEW_FINDING_TEXT_MAX_CHARS,
} from '../../shared/constants'
import { fill, formatNumber, plural, UI_TEXT } from '../../shared/l10n/text'
import type { AgentHost, TurnPart } from '../../core/agent/agentBackend'
import type { SubagentAdmission } from '../../core/backends/modelapi/subagentTools'
import { bounded as boundId, type PanelChild } from '../../core/orchestration/panelLanes'
import { screenModulePath } from '../../core/orchestration/playbook/modules'
import type { PanelAnswer, PanelFinding, PanelModuleSummary } from '../../runtime/playbook/governor'
import { playbookNoteText } from '../../runtime/playbook/text'
import { PlaybookRefusal, type PlaybookWindow, type PlaybookWindowReview } from './playbookWindow'
import type { PlaybookDispatchKind } from './workerProtocol'

const BEST_OF_N = ':bestOfN'
const IN_PROGRESS_STATUS = 'inProgress'
/** A refusal that names no module, in the model's text. */
const UNNAMED_MODULE = 'none named'

export interface PlaybookPick {
  readonly label: string
  readonly description?: string
  readonly picked?: boolean
}

interface PickOptions {
  readonly title?: string
  readonly placeHolder?: string
  readonly ignoreFocusOut?: boolean
}

/** VS Code's own pickers, exactly as `vscode.window` has them. */
export interface PlaybookUi {
  showQuickPick<T extends PlaybookPick>(
    items: readonly T[],
    options: PickOptions & { readonly canPickMany: true },
  ): PromiseLike<T[] | undefined>
  showQuickPick<T extends PlaybookPick>(
    items: readonly T[],
    options: PickOptions,
  ): PromiseLike<T | undefined>
  showInputBox(options: {
    readonly title?: string
    readonly prompt?: string
    readonly ignoreFocusOut?: boolean
  }): PromiseLike<string | undefined>
}

/** What a conversation lends its playbook. */
export interface PlaybookConversationHost {
  /** Says `text` in the conversation; `hasAction` puts the playbook's button on it. */
  notice(level: 'info' | 'warning' | 'error', text: string, hasAction: boolean): void
  /** The conversation's backend, for a child session's own items and stored outputs. */
  backend(): Promise<Pick<AgentHost, 'readSession' | 'readSessionOutput'>>
}

export interface PlaybookReviewRequest<T> {
  readonly sessionId: string
  /** The files under review, as the review's own material lists them. */
  readonly files: readonly string[]
  /** The conversation's child agents, by the ids the host recorded their rows under. */
  readonly agents: readonly { readonly agentId: string; readonly sessionId: string }[]
  readonly bestOfN: BestOfNRun | undefined
  readonly parts: readonly TurnPart[]
  readonly listen: (listener: (event: AgentEvent) => void) => () => void
  readonly submit: (parts: readonly TurnPart[]) => Promise<T>
}

export interface PlaybookConversation {
  /**
   * Sends a review turn. Files no child changed: `submit` gets `parts`
   * exactly as they came, and nothing else happens. Otherwise the review is
   * admitted first (a refusal rejects with the playbook's reason and nothing
   * is sent), carries the reviewer charter, and its reply is counted.
   */
  review<T extends { readonly turnId: string }>(request: PlaybookReviewRequest<T>): Promise<T>
  /**
   * Runs `effect` once the playbook admits it, or at once when the dispatch
   * is not the playbook's. `ended` waits for the child's own end; without
   * one the round ends with `ended(...)` below or the next review.
   */
  dispatch<T>(
    kind: PlaybookDispatchKind,
    sessionId: string | undefined,
    targetId: string | undefined,
    effect: () => Promise<T>,
    ended?: (submission: T, signal: AbortSignal) => Promise<void>,
  ): Promise<T>
  /** A live Muse Code row, keyed before its child session id arrives. */
  observed(sessionId: string | undefined, item: ItemSnapshot): Promise<void>
  /** A child's row reached its end, or (no agent named) a best-of-N run did. */
  ended(sessionId: string | undefined, agentId: string | undefined): void
  /** The notice's button: what this conversation owes its playbook, in VS Code's pickers. */
  act(sessionId: string | undefined): Promise<void>
  dispose(): void
}

interface Waiter {
  readonly key: string
  readonly resolve: () => void
}

function bounded(text: string, max: number): string {
  return text.slice(0, max)
}

/** Whether a list is longer than the journal's own bound for one. */
function isOverBound(list: readonly unknown[]): boolean {
  return list.length > PLAYBOOK_RECORD_MAX
}

/**
 * Why a child's contribution cannot be reviewed (M116, PLAN.md D96.17): the
 * closed list. A finding about that child, never a refusal of the
 * conversation: its round is counted, and every other child is reviewed.
 */
type BlockedReading =
  | { readonly code: 'nameWithheld' }
  | { readonly code: 'patchTooLarge'; readonly size: number; readonly bound: number }
  | { readonly code: 'patchUnreadable' }
  | { readonly code: 'identityUnreadable' }
  | { readonly code: 'tooManyFiles'; readonly count: number; readonly bound: number }

/** The bound every stored patch is read under, in bytes. */
const PATCH_DOCUMENT_MAX_BYTES = PATCH_DOCUMENT_MAX_PAGES * OUTPUT_PAGE_BYTES

/** The cache key for a conversation's blocked finding about one child. */
function blockedKey(sessionId: string, agent: { readonly sessionId: string }): string {
  return JSON.stringify([sessionId, agent.sessionId])
}

/** A blocked finding in the words the person reads; a withheld name is never named. */
function blockedText(agentId: string, reading: BlockedReading): string {
  switch (reading.code) {
    case 'nameWithheld': {
      return fill(UI_TEXT.playbookBlockedName, { child: agentId })
    }
    case 'patchTooLarge': {
      return fill(UI_TEXT.playbookBlockedLarge, {
        child: agentId,
        size: formatNumber(reading.size),
        bound: formatNumber(reading.bound),
      })
    }
    case 'identityUnreadable':
    case 'patchUnreadable': {
      return fill(UI_TEXT.playbookBlockedUnreadable, { child: agentId })
    }
    case 'tooManyFiles': {
      return fill(UI_TEXT.playbookBlockedMany, {
        child: agentId,
        count: formatNumber(reading.count),
        bound: formatNumber(reading.bound),
      })
    }
  }
}

/**
 * The files a child's stored patch names, read whole however many pages it
 * takes. What cannot be read is not evidence that nothing changed: a patch
 * the host calls larger than any edit's, or one that does not read as a
 * patch, comes back as the blocked finding it is.
 */
async function patchFiles(
  backend: Pick<AgentHost, 'readSessionOutput'>,
  sessionId: string,
  itemId: string,
  patchRef: { readonly id: string; readonly byteLen: number },
): Promise<
  | { readonly files: NonNullable<ReturnType<typeof agentFilesFromPatch>> }
  | { readonly blocked: BlockedReading }
> {
  if (patchRef.byteLen > PATCH_DOCUMENT_MAX_BYTES)
    return {
      blocked: { code: 'patchTooLarge', size: patchRef.byteLen, bound: PATCH_DOCUMENT_MAX_BYTES },
    }
  let document = ''
  let offsetBytes = 0
  for (let page = 0; page < PATCH_DOCUMENT_MAX_PAGES; page += 1) {
    let chunk
    try {
      chunk = await backend.readSessionOutput(sessionId, {
        itemId,
        outputRef: patchRef.id,
        offsetBytes,
        lengthBytes: OUTPUT_PAGE_BYTES,
      })
    } catch {
      return { blocked: { code: 'patchUnreadable' } }
    }
    document += chunk.content
    if (chunk.eof) {
      const files = agentFilesFromPatch(document)
      return files === undefined ? { blocked: { code: 'patchUnreadable' } } : { files }
    }
    offsetBytes = chunk.offsetBytes + chunk.byteLen
  }
  return { blocked: { code: 'patchUnreadable' } }
}

/** A refusal in the words the person reads; anything else as it is. */
function said(error: unknown): unknown {
  return error instanceof PlaybookRefusal ? new Error(playbookNoteText(error.note)) : error
}

/**
 * Why subagent work was not admitted, for the model that asked for it:
 * English, with the journal's own codes for the rule and the reason.
 */
export function playbookRefusalModelText(error: unknown): string {
  if (!(error instanceof PlaybookRefusal))
    return PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkUnavailable
  const { rule, code, module } = error.note
  return fill(PLAYBOOK_REFUSAL_MODEL_TEXT.playbookWorkRefused, {
    rule,
    code,
    module: module ?? UNNAMED_MODULE,
  })
}

/**
 * A Model API conversation's new child work (`ModelApiHostDeps.playbook`): the
 * window's dispatch. The round ends when the caller says its child's work is
 * over; a refusal is the caller's own result, made from both wordings.
 */
export function playbookAdmission(window: Pick<PlaybookWindow, 'dispatch'>): SubagentAdmission {
  return async (kind, sessionId, targetId, effect, isOver, refused) => {
    const work = { isStarted: false }
    const start = (): ReturnType<typeof effect> => {
      work.isStarted = true
      return effect()
    }
    const ended = (_submission: unknown, signal: AbortSignal): Promise<void> =>
      new Promise((resolve) => {
        // Asked now, on each change of the child, and when the wait is called off.
        const wake = (): void => {
          // Asked first even on the way out: the host removes this wait
          // from the child's waiter set only through that answer, so an
          // aborted wait leaves no callback behind.
          if (isOver(wake) || signal.aborted) resolve()
        }
        signal.addEventListener('abort', wake, { once: true })
        wake()
      })
    try {
      return await window.dispatch({ kind, sessionId, targetId }, start, ended)
    } catch (error) {
      // What the work itself threw is its caller's; anything before it is the refusal.
      if (work.isStarted) throw error
      return refused(
        playbookRefusalModelText(error),
        error instanceof PlaybookRefusal
          ? playbookNoteText(error.note)
          : UI_TEXT.playbookUnavailable,
      )
    }
  }
}

function findingLabel(finding: PanelFinding): string {
  return `${finding.severity} ${finding.file}${finding.line === undefined ? '' : `:${String(finding.line)}`}`
}

function roundText(round: PanelModuleSummary): string {
  const counted = `${UI_TEXT.playbookTitle}: ${round.moduleKey} · ${plural(UI_TEXT.playbookStrikeBadge, round.round)}`
  return round.findings.some((finding) => !finding.isAnswered)
    ? `${counted}. ${fill(UI_TEXT.playbookNotes.answersPending, { module: round.moduleKey })}`
    : counted
}

export function createPlaybookConversation(
  window: PlaybookWindow,
  ui: PlaybookUi,
  host: PlaybookConversationHost,
  /**
   * Tells which file a changed path names; throws when it cannot be told
   * (the window's own identity read). Absent where no workspace names
   * files, and no identity is checked.
   */
  resolveIdentity?: (file: string) => unknown,
): PlaybookConversation {
  const followed = new Map<string, () => void>()
  const reviews = new Set<{ readonly ticket: PlaybookWindowReview; readonly stop: () => void }>()
  const rounds = new Map<string, Set<Waiter>>()
  let isClosed = false
  /**
   * Every live row by the round its first arrival opened: an arrival older
   * than what was seen is ignored, and a terminal state is final.
   */
  const observed = new Map<
    string,
    Map<string, { readonly status: string; readonly round: number }>
  >()
  const completed = new Map<string, Set<string>>()
  const notice: PlaybookConversationHost['notice'] = (level, text, hasAction) => {
    if (!isClosed) host.notice(level, text, hasAction)
  }
  const assertOpen = (): void => {
    if (isClosed) throw new Error(UI_TEXT.playbookUnavailable)
  }

  const sweep = (): void => {
    for (const review of reviews) {
      if (!review.ticket.isClosed) continue
      review.stop()
      reviews.delete(review)
    }
  }

  const follow = (sessionId: string): void => {
    if (isClosed || followed.has(sessionId)) return
    followed.set(
      sessionId,
      window.subscribe(sessionId, {
        note: (note) => {
          notice(note.needsUser ? 'warning' : 'info', playbookNoteText(note), true)
        },
        offer: (_moduleId, moduleKey) => {
          notice('warning', fill(UI_TEXT.playbookNotes.designRequired, { module: moduleKey }), true)
        },
        rounds: (counted) => {
          sweep()
          for (const round of counted) notice('info', roundText(round), true)
        },
        hookOutput: (output) => {
          notice('warning', output, false)
        },
        failure: () => {
          sweep()
          notice('error', UI_TEXT.playbookNotCertified, false)
        },
      }),
    )
  }

  /** Ends the rounds of a conversation that wait on `key`; all of them without one. */
  const settle = (sessionId: string, key?: string): void => {
    const waiting = rounds.get(sessionId)
    if (waiting === undefined) return
    for (const waiter of waiting) {
      if (key !== undefined && waiter.key !== key) continue
      waiting.delete(waiter)
      waiter.resolve()
    }
  }

  const roundEnd = (sessionId: string, key: string, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
      if (isClosed || signal.aborted || completed.get(sessionId)?.has(key) === true) {
        resolve()
        return
      }
      const waiting = rounds.get(sessionId) ?? new Set<Waiter>()
      rounds.set(sessionId, waiting)
      const waiter: Waiter = { key, resolve }
      waiting.add(waiter)
      signal.addEventListener(
        'abort',
        () => {
          waiting.delete(waiter)
          resolve()
        },
        { once: true },
      )
    })

  /**
   * The files a child's own items say it changed: each item's recorded
   * files, or those its stored patch names. A patch that cannot be read
   * comes back blocked; a session that cannot be read rejects, and the
   * caller reports that child as unreadable.
   */
  const changedBy = async (
    sessionId: string,
  ): Promise<string[] | { readonly blocked: BlockedReading }> => {
    const backend = await host.backend()
    const { items } = await backend.readSession(sessionId)
    const files = new Set<string>()
    for (const item of items) {
      if (item.changedFiles !== undefined) {
        for (const file of item.changedFiles) files.add(file.path)
        continue
      }
      if (item.patchRef === undefined) continue
      const patch = await patchFiles(backend, sessionId, item.itemId, item.patchRef)
      if ('blocked' in patch) return patch
      for (const file of patch.files) files.add(file.path)
    }
    return [...files]
  }

  /** A blocked child's finding, told once and journaled once per child round. */
  const blockedCache = new Map<
    string,
    {
      sessionId: string
      agentId: string
      files: string[]
      blocked: NonNullable<PanelChild['blocked']>
    }
  >()
  const blockedRounds = new Map<string, number>()

  /**
   * A new round for this child re-opens its contribution: forget the last
   * one. Answers the round it opened: rows are ordered by it, and a
   * completion settles only the waiter of its own round.
   */
  const childRounds = new Map<string, Map<string, number>>()
  const unblock = (sessionId: string, agentId: string): number => {
    for (const [key, cached] of blockedCache) {
      if (cached.sessionId !== sessionId || cached.agentId !== agentId) continue
      blockedCache.delete(key)
      blockedRounds.set(key, (blockedRounds.get(key) ?? 0) + 1)
    }
    const perChild = childRounds.get(sessionId) ?? new Map<string, number>()
    childRounds.set(sessionId, perChild)
    const round = (perChild.get(agentId) ?? 0) + 1
    perChild.set(agentId, round)
    return round
  }

  const block = (
    sessionId: string,
    agent: { readonly agentId: string; readonly sessionId: string },
    reading: BlockedReading,
    files: string[],
  ): PanelChild => {
    const key = blockedKey(sessionId, agent)
    const blocked: NonNullable<PanelChild['blocked']> = {
      id: boundId(`${agent.sessionId}:${agent.agentId}:${String(blockedRounds.get(key) ?? 0)}`),
      code: reading.code,
      text: blockedText(agent.agentId, reading),
    }
    blockedCache.set(key, { sessionId, agentId: agent.agentId, files, blocked })
    notice('warning', blocked.text, false)
    return { ...agent, files, blocked }
  }

  /**
   * One agent's evidence: the files the host saw it change, without the
   * names the journal cannot hold. A contribution that cannot be read is a
   * finding about that child, journaled once per child round: the next
   * review does not read it again as if new, and every other child and any
   * review of files no child touched proceed normally. A file whose
   * identity cannot be told is the same kind of finding, so one child's
   * unreadable file never refuses another child's review.
   */
  const childEvidence = async (
    sessionId: string,
    agent: { readonly agentId: string; readonly sessionId: string },
  ): Promise<PanelChild | undefined> => {
    const key = blockedKey(sessionId, agent)
    const cached = blockedCache.get(key)
    if (cached?.agentId === agent.agentId)
      return { ...agent, files: cached.files, blocked: cached.blocked }
    let read: string[]
    try {
      const changed = await changedBy(agent.sessionId)
      if ('blocked' in changed) return block(sessionId, agent, changed.blocked, [])
      read = changed
    } catch {
      return block(sessionId, agent, { code: 'patchUnreadable' }, [])
    }
    const kept: string[] = []
    let isWithheld = false
    for (const file of read) {
      if (screenModulePath(file) === 'withheld') isWithheld = true
      else kept.push(file)
    }
    if (kept.length > PLAYBOOK_RECORD_MAX)
      return block(
        sessionId,
        agent,
        { code: 'tooManyFiles', count: read.length, bound: PLAYBOOK_RECORD_MAX },
        [],
      )
    if (isWithheld) return block(sessionId, agent, { code: 'nameWithheld' }, kept)
    try {
      // One child's identity is resolved per child: a file that cannot be
      // told refuses no other child's review.
      for (const file of kept) resolveIdentity?.(file)
    } catch {
      return block(sessionId, agent, { code: 'identityUnreadable' }, [])
    }
    return kept.length === 0 ? undefined : { ...agent, files: kept }
  }

  /**
   * The conversation's children that changed something, by the host's own
   * records. Past the journal's bound nothing is cut short to fit: a review
   * of more files, or of more children, than the journal holds is refused.
   */
  const evidence = async (
    request: Pick<PlaybookReviewRequest<unknown>, 'sessionId' | 'files' | 'agents' | 'bestOfN'>,
  ): Promise<PanelChild[]> => {
    if (request.files.length === 0) return []
    const children: PanelChild[] = []
    for (const agent of request.agents) {
      const child = await childEvidence(request.sessionId, agent)
      if (child !== undefined) children.push(child)
    }
    const run = request.bestOfN
    const taken = run?.runAttempts.find(
      (attempt) => run.takenBranch !== undefined && attempt.branch === run.takenBranch,
    )
    if (run !== undefined && taken !== undefined && taken.files.length > 0)
      children.push({
        agentId: taken.attemptId,
        sessionId: taken.sessionId ?? `${run.runId}:${taken.attemptId}`,
        files: taken.files.map((file) => file.path),
      })
    // Past the journal's bound nothing is cut short to fit: a review that a
    // child may have a part in is refused.
    if (
      children.length > 0 &&
      [request.files, children, ...children.map((child) => child.files)].some((list) =>
        isOverBound(list),
      )
    )
      throw new Error(UI_TEXT.playbookUnavailable)
    return children
  }

  /** One line of text from the person; undefined when they gave none. */
  const asked = async (title: string, prompt: string, max: number): Promise<string | undefined> => {
    const given = await ui.showInputBox({ title, prompt, ignoreFocusOut: true })
    const value = given?.trim()
    return value === undefined || value === '' ? undefined : bounded(value, max)
  }

  /** How a finding that is not fixed is answered: disputed, or a named residual. */
  const otherAnswer = async (finding: PanelFinding): Promise<PanelAnswer | undefined> => {
    const title = findingLabel(finding)
    const how = await ui.showQuickPick(
      [
        { label: UI_TEXT.playbookDispositions.disputed, status: 'disputed' as const },
        { label: UI_TEXT.playbookDispositions.residual, status: 'residual' as const },
      ],
      { title, ignoreFocusOut: true },
    )
    if (how === undefined) return undefined
    if (how.status === 'disputed') {
      const reason = await asked(title, UI_TEXT.playbookAnswerReason, REVIEW_FINDING_TEXT_MAX_CHARS)
      return reason === undefined
        ? undefined
        : { findingId: finding.id, status: 'disputed', reason }
    }
    const name = await asked(title, UI_TEXT.playbookDispositions.residual, PLAYBOOK_ID_MAX_CHARS)
    if (name === undefined) return undefined
    const whySafe = await asked(title, UI_TEXT.playbookAnswerWhySafe, REVIEW_FINDING_TEXT_MAX_CHARS)
    if (whySafe === undefined) return undefined
    const followUp = await asked(
      title,
      UI_TEXT.playbookAnswerFollowUp,
      REVIEW_FINDING_TEXT_MAX_CHARS,
    )
    return followUp === undefined
      ? undefined
      : { findingId: finding.id, status: 'residual', name, whySafe, followUp }
  }

  const answer = async (
    sessionId: string,
    module: PanelModuleSummary,
    open: readonly PanelFinding[],
  ): Promise<void> => {
    // Every finding starts ticked as fixed; the ones unticked are asked about one by one.
    const fixed = await ui.showQuickPick(
      open.map((finding) => ({
        label: findingLabel(finding),
        ...(finding.title !== undefined && { description: finding.title }),
        picked: true,
        id: finding.id,
      })),
      {
        title: `${UI_TEXT.playbookTitle}: ${module.moduleKey}`,
        placeHolder: UI_TEXT.playbookDispositions.fixed,
        canPickMany: true,
        ignoreFocusOut: true,
      },
    )
    if (fixed === undefined) return
    const answers: PanelAnswer[] = []
    for (const finding of open) {
      const given: PanelAnswer | undefined = fixed.some((pick) => pick.id === finding.id)
        ? { findingId: finding.id, status: 'fixed' }
        : await otherAnswer(finding)
      // A picker the person dismissed answers nothing: no half record is written.
      if (given === undefined) return
      answers.push(given)
    }
    if (await window.answer(sessionId, module.moduleId, answers))
      notice('info', UI_TEXT.playbookNotes.checksPassed, false)
  }

  /** Plan a redesign: the design decision's four fields, recorded as the person gave them. */
  const design = async (sessionId: string, module: PanelModuleSummary): Promise<void> => {
    const title = `${UI_TEXT.playbookPlanRedesign}: ${module.moduleKey}`
    const fields = UI_TEXT.playbookDesignFields
    const failureClass = await asked(title, fields.failureClass, REVIEW_FINDING_TEXT_MAX_CHARS)
    if (failureClass === undefined) return
    const whyPatchesFailed = await asked(
      title,
      fields.whyPatchesFailed,
      REVIEW_FINDING_TEXT_MAX_CHARS,
    )
    if (whyPatchesFailed === undefined) return
    const structuralChange = await asked(
      title,
      fields.structuralChange,
      REVIEW_FINDING_TEXT_MAX_CHARS,
    )
    if (structuralChange === undefined) return
    const planLocation = await asked(title, fields.planLocation, REVIEW_FINDING_PATH_MAX_CHARS)
    if (planLocation === undefined) return
    const isRecorded = await window.recordDesign(sessionId, module.moduleId, {
      failureClass,
      whyPatchesFailed,
      structuralChange,
      planLocation,
    })
    if (isRecorded)
      notice('info', `${UI_TEXT.playbookDesignDecision}: ${UI_TEXT.playbookDesignPending}`, false)
  }

  /** The module the person means: the only open one, or the one they pick. */
  const chosen = async (
    open: readonly PanelModuleSummary[],
  ): Promise<PanelModuleSummary | undefined> => {
    const [only] = open
    if (open.length <= 1) return only
    const pick = await ui.showQuickPick(
      open.map((module) => ({
        label: module.moduleKey,
        description: plural(UI_TEXT.playbookStrikeBadge, module.round),
        id: module.moduleId,
      })),
      { title: UI_TEXT.playbookTitle, ignoreFocusOut: true },
    )
    return pick === undefined ? undefined : open.find((module) => module.moduleId === pick.id)
  }

  return {
    review: async (request) => {
      assertOpen()
      const { sessionId } = request
      const seen = observed.get(sessionId)?.keys() ?? []
      for (const key of seen) completed.get(sessionId)?.add(key)
      // The fix rounds before it are over: their work is what this review reads.
      settle(sessionId)
      const children = await evidence(request)
      if (children.length > 0) follow(sessionId)
      let ticket: PlaybookWindowReview | undefined
      try {
        ticket = await window.openReview(sessionId, request.files, children)
      } catch (error) {
        throw said(error)
      }
      if (isClosed) {
        ticket?.cancel()
        assertOpen()
      }
      if (ticket === undefined) return await request.submit(request.parts)
      const admitted = ticket
      const review = {
        ticket: admitted,
        stop: request.listen((event) => {
          admitted.observe(event)
          sweep()
        }),
      }
      reviews.add(review)
      try {
        const submission = await request.submit(admitted.parts(request.parts))
        admitted.bind(submission.turnId)
        return submission
      } catch (error) {
        review.stop()
        reviews.delete(review)
        admitted.cancel()
        throw error
      }
    },
    dispatch: async (kind, sessionId, targetId, effect, ended) => {
      assertOpen()
      if (sessionId === undefined) return await effect()
      // A new round for this child re-opens its contribution. Its end
      // waits on this round only (`child:round`), never the child alone.
      const round = targetId === undefined ? undefined : unblock(sessionId, targetId)
      const waitKey =
        targetId === undefined || round === undefined ? `:${kind}` : `${targetId}:${String(round)}`
      follow(sessionId)
      try {
        return await window.dispatch(
          { kind, sessionId, targetId },
          () => {
            assertOpen()
            return effect()
          },
          async (submission, signal) => {
            if (isClosed) return
            await (ended === undefined
              ? roundEnd(sessionId, waitKey, signal)
              : ended(submission, signal))
          },
        )
      } catch (error) {
        throw said(error)
      }
    },
    observed: async (sessionId, item) => {
      if (
        isClosed ||
        sessionId === undefined ||
        item.kind !== 'subagent' ||
        item.subagentId === undefined
      )
        return
      const agentId = item.subagentId
      const key = `${agentId}:${item.itemId}`
      const seen = observed.get(sessionId) ?? new Map<string, { status: string; round: number }>()
      observed.set(sessionId, seen)
      const finished = completed.get(sessionId) ?? new Set<string>()
      completed.set(sessionId, finished)
      const prior = seen.get(key)
      if (prior !== undefined) {
        // A terminal state is final: an arrival older than what was seen is
        // ignored, so a replayed row settles no later round.
        if (prior.status !== IN_PROGRESS_STATUS) return
        if (item.status === IN_PROGRESS_STATUS) return
        seen.set(key, { status: item.status, round: prior.round })
        finished.add(key)
        settle(sessionId, key)
        // A completion settles only the waiter of its own round.
        const current = childRounds.get(sessionId)?.get(agentId) ?? prior.round
        if (prior.round === current) settle(sessionId, `${agentId}:${String(prior.round)}`)
        return
      }
      // A first live row opens a new round for this child.
      const round = unblock(sessionId, agentId)
      seen.set(key, { status: item.status, round })
      if (item.status !== IN_PROGRESS_STATUS) {
        finished.add(key)
        settle(sessionId, key)
      }
      follow(sessionId)
      try {
        await window.dispatch(
          { kind: 'subagent', sessionId, targetId: agentId },
          () => {
            assertOpen()
            return Promise.resolve()
          },
          (_submission, signal) => roundEnd(sessionId, key, signal),
        )
      } catch (error) {
        if (!(error instanceof PlaybookRefusal)) notice('error', UI_TEXT.playbookUnavailable, false)
      }
    },
    ended: (sessionId, agentId) => {
      if (sessionId === undefined) return
      // A live end for one child ends its round waits, whatever round each
      // waits on; a replayed row never reaches here, so no later round is
      // settled by an old completion.
      const key = agentId ?? BEST_OF_N
      const waiting = rounds.get(sessionId)
      if (waiting === undefined) return
      for (const waiter of waiting) {
        if (waiter.key !== key && !waiter.key.startsWith(`${key}:`)) continue
        waiting.delete(waiter)
        waiter.resolve()
      }
    },
    act: async (sessionId) => {
      if (sessionId === undefined) return
      follow(sessionId)
      try {
        const open = await window.standing(sessionId)
        const module = await chosen(open)
        if (module === undefined) {
          if (open.length === 0) notice('info', UI_TEXT.playbookEmpty, false)
          return
        }
        const unanswered = module.findings.filter((finding) => !finding.isAnswered)
        if (unanswered.length > 0) await answer(sessionId, module, unanswered)
        else if (module.isRedesignDue) await design(sessionId, module)
        else
          notice(
            'info',
            module.design === 'pending'
              ? `${UI_TEXT.playbookDesignDecision}: ${UI_TEXT.playbookDesignPending}`
              : UI_TEXT.playbookNotes.checksPassed,
            false,
          )
      } catch {
        notice('error', UI_TEXT.playbookUnavailable, false)
      }
    },
    dispose: () => {
      isClosed = true
      for (const stop of followed.values()) stop()
      followed.clear()
      for (const review of reviews) {
        review.stop()
        review.ticket.cancel()
      }
      reviews.clear()
      for (const sessionId of rounds.keys()) settle(sessionId)
      rounds.clear()
      observed.clear()
      completed.clear()
      blockedCache.clear()
      blockedRounds.clear()
      childRounds.clear()
    },
  }
}
