// A conversation's use of its window's playbook (M116, lane C-M116-6; PLAN.md
// D96.16 and D96.17). The conversation controller lends three small things
// (a notice, its backend, whether that backend asks before a spawn) and
// calls in at four points: a review turn, a dispatch, a spawn the backend
// asks about, and the notice's button. Everything else lives here,
// in the lazy bundle, so a conversation that orchestrates nothing pays for
// none of it.
//
// What counts as orchestrated is host evidence only: the child sessions the
// controller recorded and the files their own items say they changed, and a
// best-of-N attempt the person took. No model text decides it.

import type { AgentEvent, ItemSnapshot } from '../../shared/agentEvents'
import type { BestOfNRun } from '../../shared/bestOfN'
import {
  PLAYBOOK_ID_MAX_CHARS,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_REFUSAL_MODEL_TEXT,
  REVIEW_FINDING_PATH_MAX_CHARS,
  REVIEW_FINDING_TEXT_MAX_CHARS,
} from '../../shared/constants'
import { fill, plural, UI_TEXT } from '../../shared/l10n/text'
import type { AgentHost, AgentSession, TurnPart } from '../../core/agent/agentBackend'
import { agentReceiptFiles } from '../../core/agent/agentReceiptFiles'
import type { SubagentAdmission } from '../../core/backends/modelapi/subagentTools'
import type { PanelChild } from '../../core/orchestration/panelLanes'
import type { PanelAnswer, PanelFinding, PanelModuleSummary } from '../../runtime/playbook/governor'
import { playbookNoteText } from '../../runtime/playbook/text'
import { PlaybookRefusal, type PlaybookWindow, type PlaybookWindowReview } from './playbookWindow'
import type { PlaybookDispatchKind } from './workerProtocol'

/** A round on a child nobody can name yet ends with the next child's row. */
const NEW_CHILD = ':subagent'
const BEST_OF_N = ':bestOfN'
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
  /** Whether the backend asks the host before it starts a subagent, in its mode now. */
  asksBeforeSpawn(): boolean
}

/** The backend's own request to start a subagent, as its approval card would show it. */
export type PlaybookSpawnRequest = Extract<AgentEvent, { type: 'approvalRequested' }>

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
  /**
   * A subagent the backend asks about before it starts one (Muse Code,
   * D96.17). Resolves with the request to put before the person: as it came
   * when the spawn is not the playbook's; without the choices that would
   * stop the asking when the playbook admitted it, or when its refusal could
   * not be sent. Undefined: refused, and answered through `decide` with the
   * request's own rejection and the playbook's reason.
   */
  spawnRequest(
    sessionId: string,
    request: PlaybookSpawnRequest,
    decide: AgentSession['decideApproval'],
  ): Promise<PlaybookSpawnRequest | undefined>
  /**
   * A spawn request that was put before the person came to anything but an
   * approval: no child starts, so the round the playbook opened for it is over.
   */
  spawnDeclined(sessionId: string | undefined): void
  /** A child's row reached its end, or (no agent named) a best-of-N run did. */
  ended(sessionId: string | undefined, agentId: string | undefined): void
  /** The notice's button: what this conversation owes its playbook, in VS Code's pickers. */
  act(sessionId: string | undefined): Promise<void>
  /** The plain line a governed conversation is owed while its mode starts subagents unasked. */
  gap(sessionId: string | undefined): Promise<string | undefined>
  dispose(): void
}

interface Waiter {
  readonly key: string
  readonly resolve: () => void
}

function bounded(text: string, max: number): string {
  return text.slice(0, max)
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
          if (signal.aborted || isOver(wake)) resolve()
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

/** Whether a choice of an approval request lets the tool run. */
function isApproval(choice: PlaybookSpawnRequest['availableChoices'][number]): boolean {
  return choice.decision.startsWith('approved')
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

/** The line for a mode in which the backend starts subagents without asking. */
export function playbookSpawnGapText(): string {
  return fill(UI_TEXT.playbookSpawnsNotAdmitted, {
    auto: UI_TEXT.permissionModes.auto,
    bypass: UI_TEXT.permissionModes.bypassPermissions,
  })
}

export function createPlaybookConversation(
  window: PlaybookWindow,
  ui: PlaybookUi,
  host: PlaybookConversationHost,
): PlaybookConversation {
  const followed = new Map<string, () => void>()
  const reviews = new Set<{ readonly ticket: PlaybookWindowReview; readonly stop: () => void }>()
  const rounds = new Map<string, Set<Waiter>>()
  /** Conversations told once that each subagent is asked about. */
  const toldEach = new Set<string>()

  const sweep = (): void => {
    for (const review of reviews) {
      if (!review.ticket.isClosed) continue
      review.stop()
      reviews.delete(review)
    }
  }

  const follow = (sessionId: string): void => {
    if (followed.has(sessionId)) return
    followed.set(
      sessionId,
      window.subscribe(sessionId, {
        note: (note) => {
          host.notice(note.needsUser ? 'warning' : 'info', playbookNoteText(note), true)
        },
        offer: (_moduleId, moduleKey) => {
          host.notice(
            'warning',
            fill(UI_TEXT.playbookNotes.designRequired, { module: moduleKey }),
            true,
          )
        },
        rounds: (counted) => {
          sweep()
          for (const round of counted) host.notice('info', roundText(round), true)
          // No silent gap: a mode that starts subagents unasked is said, once per count.
          if (!host.asksBeforeSpawn()) host.notice('info', playbookSpawnGapText(), false)
        },
        hookOutput: (output) => {
          host.notice('warning', output, false)
        },
        failure: () => {
          sweep()
          host.notice('error', UI_TEXT.playbookNotCertified, false)
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

  /** The conversation's children that changed something, by the host's own records. */
  const evidence = async (
    request: Pick<PlaybookReviewRequest<unknown>, 'files' | 'agents' | 'bestOfN'>,
  ): Promise<PanelChild[]> => {
    if (request.files.length === 0) return []
    const children: PanelChild[] = []
    for (const agent of request.agents.slice(0, PLAYBOOK_RECORD_MAX)) {
      let items: readonly ItemSnapshot[] = []
      try {
        // The child's own items, each with the files its recorded patches changed.
        const backend = await host.backend()
        const history = await backend.readSession(agent.sessionId)
        items = await agentReceiptFiles(history.items, (page) =>
          backend.readSessionOutput(agent.sessionId, page),
        )
      } catch {
        // A child session that cannot be read is no evidence of a change.
      }
      const files = [
        ...new Set(items.flatMap((item) => item.changedFiles?.map((file) => file.path) ?? [])),
      ]
      if (files.length > 0) children.push({ ...agent, files: files.slice(0, PLAYBOOK_RECORD_MAX) })
    }
    const run = request.bestOfN
    const taken = run?.runAttempts.find(
      (attempt) => run.takenBranch !== undefined && attempt.branch === run.takenBranch,
    )
    if (run !== undefined && taken !== undefined && taken.files.length > 0)
      children.push({
        agentId: taken.attemptId,
        sessionId: taken.sessionId ?? `${run.runId}:${taken.attemptId}`,
        files: taken.files.map((file) => file.path).slice(0, PLAYBOOK_RECORD_MAX),
      })
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
      host.notice('info', UI_TEXT.playbookNotes.checksPassed, false)
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
      host.notice(
        'info',
        `${UI_TEXT.playbookDesignDecision}: ${UI_TEXT.playbookDesignPending}`,
        false,
      )
  }

  /**
   * Whether a spawn the backend asks about is the playbook's, admitted as a
   * round of its own. False: nothing is under review, so it is not. A
   * refusal rejects.
   */
  const isSpawnAdmitted = async (sessionId: string): Promise<boolean> => {
    const open = await window.standing(sessionId)
    if (open.length === 0) return false
    follow(sessionId)
    await window.dispatch(
      { kind: 'subagent', sessionId, targetId: undefined },
      () => Promise.resolve(),
      (_submission, signal) => roundEnd(sessionId, NEW_CHILD, signal),
    )
    if (!toldEach.has(sessionId)) {
      toldEach.add(sessionId)
      host.notice('info', UI_TEXT.playbookSpawnEachAsked, false)
    }
    return true
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
      const { sessionId } = request
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
      if (sessionId === undefined) return await effect()
      follow(sessionId)
      try {
        return await window.dispatch(
          { kind, sessionId, targetId },
          effect,
          async (submission, signal) => {
            await (ended === undefined
              ? roundEnd(sessionId, targetId ?? `:${kind}`, signal)
              : ended(submission, signal))
          },
        )
      } catch (error) {
        throw said(error)
      }
    },
    spawnRequest: async (sessionId, request, decide) => {
      // One spawn at a time: the choices that would stop the asking are not offered.
      const once = {
        ...request,
        availableChoices: request.availableChoices.filter(
          (choice) => choice.scope === 'once' || !isApproval(choice),
        ),
      }
      try {
        return (await isSpawnAdmitted(sessionId)) ? once : request
      } catch (error) {
        // A refusal's why-note reached the conversation as it was decided; this did not.
        if (!(error instanceof PlaybookRefusal))
          host.notice('error', UI_TEXT.playbookUnavailable, false)
        const reject = request.availableChoices.find((choice) => !isApproval(choice))
        if (reject === undefined) return once
        try {
          await decide({
            approvalId: request.approvalId,
            choiceId: reject.choiceId,
            requirementId: request.requirementId,
            ...(reject.acceptsFeedback === true && {
              feedback: playbookRefusalModelText(error),
            }),
          })
          // Answered: there is nothing to put before the person.
          return
        } catch {
          // The refusal is in the transcript. Unsent, the request stays the person's
          // to answer, one spawn at a time.
          return once
        }
      }
    },
    spawnDeclined: (sessionId) => {
      if (sessionId !== undefined) settle(sessionId, NEW_CHILD)
    },
    ended: (sessionId, agentId) => {
      if (sessionId === undefined) return
      settle(sessionId, agentId ?? BEST_OF_N)
      if (agentId !== undefined) settle(sessionId, NEW_CHILD)
    },
    act: async (sessionId) => {
      if (sessionId === undefined) return
      follow(sessionId)
      try {
        const open = await window.standing(sessionId)
        const module = await chosen(open)
        if (module === undefined) {
          if (open.length === 0) host.notice('info', UI_TEXT.playbookEmpty, false)
          return
        }
        const unanswered = module.findings.filter((finding) => !finding.isAnswered)
        if (unanswered.length > 0) await answer(sessionId, module, unanswered)
        else if (module.isRedesignDue) await design(sessionId, module)
        else
          host.notice(
            'info',
            module.design === 'pending'
              ? `${UI_TEXT.playbookDesignDecision}: ${UI_TEXT.playbookDesignPending}`
              : UI_TEXT.playbookNotes.checksPassed,
            false,
          )
      } catch {
        host.notice('error', UI_TEXT.playbookUnavailable, false)
      }
    },
    gap: async (sessionId) => {
      let open: readonly PanelModuleSummary[] = []
      try {
        if (sessionId !== undefined && !host.asksBeforeSpawn())
          open = await window.standing(sessionId)
      } catch {
        // A journal that cannot be read says nothing about a gap.
      }
      return open.length > 0 ? playbookSpawnGapText() : undefined
    },
    dispose: () => {
      for (const stop of followed.values()) stop()
      followed.clear()
      for (const review of reviews) {
        review.stop()
        review.ticket.cancel()
      }
      reviews.clear()
      for (const sessionId of rounds.keys()) settle(sessionId)
      rounds.clear()
    },
  }
}
