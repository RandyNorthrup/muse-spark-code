// The panel's governor (M116, PLAN.md D96.11; lane C-M116-6): the one policy
// module, its journal and the panel integration, bound to the host's facts
// about a conversation's child agents. The VS Code window runs it on a worker
// thread; nothing here knows that. Synchronous wherever the policy is.
//
// Nothing is governed that is not orchestrated: a review of files no child
// changed is not opened here at all, and a dispatch from a conversation with
// no module under review returns `ungoverned` before any lease or git call.

import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '../../shared/agentEvents'
import {
  PLAYBOOK_PANEL_LANE,
  PLAYBOOK_PANEL_TEAM,
  PLAYBOOK_PATCH_ROUNDS_MAX,
  PLAYBOOK_SURFACE_LANE,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  REVIEW_FINDINGS_LANGUAGE,
} from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import type {
  PlaybookDecision,
  PlaybookDesignDecision,
  PlaybookFindingClass,
  PlaybookModule,
  PlaybookRecord,
  PlaybookRound,
  PlaybookWhyNote,
} from '../../shared/playbook'
import type { ReviewBlock } from '../../shared/reviewFindings'
import { FilePlaybookJournal } from '../../core/orchestration/playbook/journal'
import {
  moduleStates,
  PLAYBOOK_BRIEF_NOTE,
  PLAYBOOK_IDENTITY_NOTE,
  PLAYBOOK_LEASE_NOTE,
  PLAYBOOK_RELEASE_NOTE,
  PLAYBOOK_USER_NOTE,
} from '../../core/orchestration/playbook/modules'
import {
  PlaybookOutcomes,
  type PlaybookHookAdmission,
} from '../../core/orchestration/playbook/outcomes'
import { OrchestratorPlaybook } from '../../core/orchestration/playbook/policy'
import {
  conversationModules,
  dispatchModules,
  dispatchWork,
  isOpenModule,
  moduleKeyOf,
  newRedesignLane,
  panelBoard,
  reviewModules,
  workspaceFile,
  type PanelChild,
  type PanelModuleStanding,
  type PanelReviewModule,
} from '../../core/orchestration/panelLanes'
import {
  PanelPlaybook,
  reviewBlocks,
  type PanelDispatchKind,
  type PanelPlaybookRegistry,
  type PanelPlaybookReview,
} from '../../core/orchestration/panelPlaybook'
import {
  PlaybookIntegration,
  type PlaybookWork,
} from '../../core/orchestration/playbookIntegration'
import type { PlaybookChange, PlaybookSurfacePort } from './command'
import { createPlaybookSurface } from './surface'

/** Notes the record keeps but a conversation is not told: nothing was changed or refused. */
const QUIET_NOTES: ReadonlySet<PlaybookWhyNote['code']> = new Set([
  'checksPassed',
  'briefRecorded',
  'ruleDisabled',
])
const INTERNAL_NOTES: ReadonlySet<string> = new Set([
  PLAYBOOK_BRIEF_NOTE,
  PLAYBOOK_IDENTITY_NOTE,
  PLAYBOOK_LEASE_NOTE,
  PLAYBOOK_RELEASE_NOTE,
  PLAYBOOK_USER_NOTE,
])
/** A detached checkout has no branch: its work is recorded against the branch namespace. */
const DETACHED_REFS = 'refs/heads'

export interface PanelGovernorEvents {
  /** The why-note of a decision that changed or refused something. */
  note(sessionId: string, note: PlaybookWhyNote): void
  /** The playbook calls for a redesign of this module. */
  offerRedesign(sessionId: string, module: PlaybookModule): void
  /** The repository's own hook output, scrubbed, for the person only. */
  hookOutput(sessionId: string, output: string): void
  /** Something of this conversation's could not be certified or kept. */
  failure(sessionId: string): void
}

export interface PanelGovernorOptions {
  readonly agentDataFolder: string
  /** The trusted workspace folder; never a model-supplied path. */
  readonly workspaceFolder: string
  readonly hookAdmission: PlaybookHookAdmission
  readonly events: PanelGovernorEvents
  readonly now?: () => number
}

/** One finding of a counted round as a card shows it; the title is the review's, never journalled. */
export interface PanelFinding {
  readonly id: string
  readonly file: string
  readonly severity: 'P1' | 'P2' | 'P3'
  readonly line?: number | undefined
  readonly class?: PlaybookFindingClass | undefined
  readonly title?: string | undefined
  readonly isAnswered: boolean
}

/** A module's standing for the conversation reviewing it. */
export interface PanelModuleSummary {
  readonly moduleId: string
  readonly moduleKey: string
  readonly round: number
  readonly phase: PlaybookRound['phase']
  readonly findings: readonly PanelFinding[]
  readonly design?: PlaybookDesignDecision['outcome'] | undefined
  readonly isEscalated: boolean
  /** The patch rounds are spent and no design decision is pending: one is due. */
  readonly isRedesignDue: boolean
}

export type PanelReviewOpening =
  | { readonly kind: 'ordinary' }
  | {
      readonly kind: 'playbook'
      /** What the reviewer charter is given beside the request: trusted ids, never review text. */
      readonly modules: readonly PanelReviewTarget[]
    }

export interface PanelReviewTarget {
  readonly moduleId: string
  readonly moduleKey: string
  readonly prior?: PlaybookRound | undefined
  readonly design?: PlaybookDesignDecision | undefined
}

export interface PanelReviewProgress {
  readonly isClosed: boolean
  /** The rounds this review counted, once it closed. */
  readonly rounds: readonly PanelModuleSummary[]
}

/** The design decision as the person accepted it; identity, lane and time are the governor's. */
export interface PanelDesignFields {
  readonly failureClass: string
  readonly whyPatchesFailed: string
  readonly structuralChange: string
  readonly planLocation: string
}

export type PanelAnswer = Extract<
  PlaybookRound['answers'][number],
  { status: 'fixed' | 'disputed' | 'residual' }
>

export interface PanelDispatchRequest {
  readonly kind: PanelDispatchKind
  readonly sessionId: string
  readonly targetId: string | undefined
  /** Whether the workspace may run git and its own hooks at all. */
  readonly isTrusted: boolean
}

export interface PanelDispatchCallbacks {
  /** Starts the work; every admission has passed when this runs. */
  readonly effect: () => Promise<void>
  /** Resolves when the child's own work has ended; `signal` aborts it. */
  readonly completion: (signal: AbortSignal) => Promise<void>
}

interface Conversation {
  readonly panel: PanelPlaybook
  readonly integration: PlaybookIntegration
  /** What the registry answers the integration's next lookup with. */
  context: PanelReviewModule | undefined
  prior: PlaybookRound | undefined
  work: PlaybookWork | undefined
}

interface ReviewTicket {
  readonly context: PanelReviewModule
  readonly ticket: PanelPlaybookReview
  /** The module's counted rounds when the review opened. */
  readonly counted: number
  titles: readonly ReviewBlock['findings'][number][]
}

interface OpenReview {
  readonly sessionId: string
  readonly tickets: readonly ReviewTicket[]
}

function bounded(text: string): string {
  return text.trim().slice(0, REVIEW_FINDING_TEXT_MAX_CHARS).trimEnd()
}

function countedRounds(records: readonly PlaybookRecord[], moduleId: string): number {
  return records.filter(
    (record) =>
      record.kind === 'round' &&
      record.value.class === undefined &&
      record.value.module.id === moduleId,
  ).length
}

/** Whether the journal's settings and a module's strikes call for a design decision now. */
function isRedesignDue(records: readonly PlaybookRecord[], standing: PanelModuleStanding): boolean {
  const settings = records.findLast((record) => record.kind === 'settings')?.value
  return (
    settings?.rules.threeStrikes.enabled !== false &&
    standing.strikes > (settings?.patchRoundsMax ?? PLAYBOOK_PATCH_ROUNDS_MAX) &&
    standing.design?.outcome !== 'pending'
  )
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error(UI_TEXT.playbookUnavailable)
  return value
}

export class PanelGovernor {
  private readonly policy: OrchestratorPlaybook
  private readonly surface: PlaybookSurfacePort
  private readonly conversations = new Map<string, Conversation>()
  private readonly reviews = new Map<string, OpenReview>()
  private readonly waits = new Map<string, (signal: AbortSignal) => Promise<void>>()
  /** Subjects the person decided in the operation now running; never kept. */
  private readonly userDecisions = new Set<string>()
  private readonly now: () => number

  constructor(private readonly options: PanelGovernorOptions) {
    this.now = options.now ?? Date.now
    const { agentDataFolder, workspaceFolder, hookAdmission } = options
    this.policy = new OrchestratorPlaybook({
      journal: new FilePlaybookJournal(agentDataFolder, workspaceFolder),
      teamId: PLAYBOOK_PANEL_TEAM,
      laneId: PLAYBOOK_PANEL_LANE,
      workspaceFolder,
      now: this.now,
      // Only a decision the person made in the panel, for exactly its subject.
      authorizeOverride: (_evidence, subject) => this.userDecisions.has(subject),
      // The panel merges nothing and offloads nothing: both fail closed.
      drillRequirements: { guards: () => [] },
      checkAdmission: { admit: () => false },
      hookAdmission,
    })
    this.surface = createPlaybookSurface({
      agentDataFolder,
      workspaceFolder,
      teamId: PLAYBOOK_PANEL_TEAM,
      laneId: PLAYBOOK_SURFACE_LANE,
      now: this.now,
    })
  }

  private outcomes(): PlaybookOutcomes {
    return new PlaybookOutcomes(this.options.workspaceFolder, this.options.hookAdmission)
  }

  private conversation(sessionId: string): Conversation {
    const existing = this.conversations.get(sessionId)
    if (existing !== undefined) return existing
    const { events } = this.options
    const integration = new PlaybookIntegration(
      this.policy,
      { readBoard: () => panelBoard(this.policy.getRecord()) },
      {
        note: (note) => {
          if (!QUIET_NOTES.has(note.code)) events.note(sessionId, note)
        },
        offerRedesign: (module) => {
          events.offerRedesign(sessionId, module)
        },
        hookOutput: (output) => {
          events.hookOutput(sessionId, output)
        },
        failure: () => {
          events.failure(sessionId)
        },
      },
    )
    const registry: PanelPlaybookRegistry = {
      dispatch: () => required(conversation.work),
      review: () => {
        const { module, agents } = required(conversation.context)
        return { module, agents }
      },
      // The charter is the host's to add (its own lazily read text): the
      // registry only notes which round the reviewer must answer for.
      reviewParts: (parts, _context, prior) => {
        conversation.prior = prior
        return parts
      },
      waitForCompletion: async (work, _submission, signal) => {
        await required(this.waits.get(work.id))(signal)
      },
      stopReview: () => {
        events.failure(sessionId)
      },
      recordDispatch: () => {
        // The journal's brief note (base and digest) is the dispatch's durable record.
      },
      snapshotRepositoryConfig: () => this.outcomes().digest(),
      recordRepositoryDrift: () => {
        events.failure(sessionId)
      },
    }
    const conversation: Conversation = {
      integration,
      panel: new PanelPlaybook(integration, registry),
      context: undefined,
      prior: undefined,
      work: undefined,
    }
    this.conversations.set(sessionId, conversation)
    return conversation
  }

  /**
   * A finding's file as the journal names it, by resolved file identity;
   * undefined when it is not shown to be a file of the workspace. The path
   * is the reviewer's own words. One that cannot be read, resolved or named
   * puts its finding under no module, as one that resolves elsewhere does:
   * it may not undo the round, or a reply's wording could keep a round from
   * being counted. The reply itself is in the transcript either way.
   */
  private relative(file: string): string | undefined {
    try {
      return workspaceFile(this.options.workspaceFolder, file)
    } catch {
      return undefined
    }
  }

  private summary(
    standing: PanelModuleStanding,
    titles: ReviewTicket['titles'],
    records: readonly PlaybookRecord[],
  ): PanelModuleSummary {
    const unused = [...titles]
    return {
      moduleId: standing.module.id,
      moduleKey: standing.module.key,
      round: standing.round.round,
      phase: standing.round.phase,
      findings: standing.round.findings.map((finding): PanelFinding => {
        const index = unused.findIndex(
          (candidate) => candidate.file === finding.file && candidate.line === finding.line,
        )
        const [match] = index === -1 ? [] : unused.splice(index, 1)
        return {
          id: finding.id,
          file: finding.file,
          severity: finding.severity,
          ...(finding.line !== undefined && { line: finding.line }),
          ...(finding.class !== undefined && { class: finding.class }),
          ...(match !== undefined && { title: match.title }),
          isAnswered: standing.round.answers.some((answer) => answer.findingId === finding.id),
        }
      }),
      design: standing.design?.outcome,
      isEscalated: standing.isEscalated,
      isRedesignDue: isRedesignDue(records, standing),
    }
  }

  private progress(reviewId: string, review: OpenReview): PanelReviewProgress {
    if (review.tickets.some(({ ticket }) => !ticket.isClosed))
      return { isClosed: false, rounds: [] }
    this.reviews.delete(reviewId)
    const records = this.policy.getRecord()
    const standings = conversationModules(records, review.sessionId)
    return {
      isClosed: true,
      rounds: review.tickets.flatMap(({ context, counted, titles }) => {
        const standing = standings.find((entry) => entry.module.id === context.module.id)
        return standing !== undefined && countedRounds(records, context.module.id) > counted
          ? [this.summary(standing, titles, records)]
          : []
      }),
    }
  }

  private settle(reviewId: string, apply: (review: OpenReview) => void): PanelReviewProgress {
    const review = this.reviews.get(reviewId)
    if (review === undefined) return { isClosed: true, rounds: [] }
    try {
      apply(review)
    } catch (error) {
      // A result that cannot certify counts nothing, for any module.
      this.reviews.delete(reviewId)
      for (const { ticket } of review.tickets) ticket.cancel()
      throw error
    }
    return this.progress(reviewId, review)
  }

  /** The one block as a module's review sees it: its own directories' findings and resolutions. */
  private ownBlock(entry: ReviewTicket, block: ReviewBlock): ReviewBlock {
    const prior = new Set(
      moduleStates(this.policy.getRecord())
        .get(entry.context.module.id)
        ?.current?.findings.map((finding) => finding.id),
    )
    return {
      findings: block.findings.flatMap((finding) => {
        const file = this.relative(finding.file)
        return file !== undefined && entry.context.keys.includes(moduleKeyOf(file))
          ? [{ ...finding, file }]
          : []
      }),
      ...(block.coverage !== undefined && { coverage: block.coverage }),
      ...(block.resolution !== undefined && {
        resolution: block.resolution.filter((item) => prior.has(item.findingId)),
      }),
    }
  }

  private async dispatchOn(
    conversation: Conversation,
    request: PanelDispatchRequest,
    standings: readonly PanelModuleStanding[],
    facts: { readonly refs: readonly string[]; readonly commit: string },
    callbacks: PanelDispatchCallbacks,
  ): Promise<void> {
    const [standing, ...rest] = standings
    if (standing === undefined) {
      await callbacks.effect()
      return
    }
    const { kind, sessionId, targetId } = request
    const work = dispatchWork(kind, sessionId, targetId, standing, facts.refs, facts.commit)
    conversation.work = work
    // Only the innermost module waits for the child itself; the others wait
    // for the round inside them, which has finished when their effect has.
    this.waits.set(work.id, rest.length === 0 ? callbacks.completion : () => Promise.resolve())
    try {
      await conversation.panel.dispatch(kind, sessionId, targetId, async () => {
        await this.dispatchOn(conversation, request, rest, facts, callbacks)
      })
    } finally {
      this.waits.delete(work.id)
    }
  }

  private decided(sessionId: string, decision: PlaybookDecision, module: PlaybookModule): boolean {
    this.conversation(sessionId).integration.explain(decision, module)
    return decision.kind === 'allow'
  }

  private module(moduleId: string): PlaybookModule {
    return required(moduleStates(this.policy.getRecord()).get(moduleId)).module
  }

  /** The journal-backed settings and record, as the CLI and ACP read them. */
  read(): Promise<unknown> {
    return this.surface.read()
  }

  change(change: PlaybookChange): Promise<unknown> {
    return this.surface.change(change)
  }

  /** The records that concern each child: its rounds, its modules' decisions and notes. */
  agentRecords(
    children: readonly {
      readonly itemId: string
      readonly agentId: string
      readonly sessionId: string
    }[],
  ): Record<string, PlaybookRecord[]> {
    const records = this.policy.getRecord()
    const result: Record<string, PlaybookRecord[]> = {}
    for (const child of children) {
      const rounds = records.flatMap((record) =>
        record.kind === 'round' &&
        record.value.implementerId === child.agentId &&
        record.value.implementerSessionId === child.sessionId
          ? [record]
          : [],
      )
      if (rounds.length === 0) continue
      const ids = new Set(rounds.map((round) => round.value.module.id))
      const keys = new Set(rounds.map((round) => round.value.module.key))
      result[child.itemId] = [
        ...rounds,
        ...records.filter(
          (record) =>
            (record.kind === 'design' && ids.has(record.value.module.id)) ||
            (record.kind === 'note' &&
              !QUIET_NOTES.has(record.value.code) &&
              !INTERNAL_NOTES.has(record.value.laneId ?? '') &&
              keys.has(record.value.module ?? '')),
        ),
      ]
    }
    return result
  }

  /** The modules this conversation reviews that still owe something. */
  standing(sessionId: string): PanelModuleSummary[] {
    const records = this.policy.getRecord()
    return conversationModules(records, sessionId)
      .filter((standing) => isOpenModule(standing))
      .map((standing) => this.summary(standing, [], records))
  }

  /**
   * Opens a review of `files`. No child of the conversation changed any of
   * them: `ordinary`, and nothing was read, written or leased. Otherwise one
   * admitted review per module; a refusal of any (its why-note said) cancels
   * the others and throws.
   */
  openReview(
    reviewId: string,
    sessionId: string,
    files: readonly string[],
    children: readonly PanelChild[],
  ): PanelReviewOpening {
    const contexts = reviewModules(
      {
        workspaceFolder: this.options.workspaceFolder,
        hookAdmission: this.options.hookAdmission,
        records: () => this.policy.getRecord(),
      },
      sessionId,
      files,
      children,
    )
    if (contexts.length === 0) return { kind: 'ordinary' }
    const conversation = this.conversation(sessionId)
    const tickets: ReviewTicket[] = []
    const modules: PanelReviewTarget[] = []
    try {
      for (const context of contexts) {
        conversation.context = context
        const counted = countedRounds(this.policy.getRecord(), context.module.id)
        const ticket = conversation.panel.review(sessionId, context.module.files)
        tickets.push({ context, ticket, counted, titles: [] })
        conversation.prior = undefined
        ticket.parts([])
        const design = moduleStates(this.policy.getRecord()).get(context.module.id)?.design
        modules.push({
          moduleId: context.module.id,
          moduleKey: context.module.key,
          prior: conversation.prior,
          design: design !== undefined && design.outcome !== 'impossible' ? design : undefined,
        })
      }
    } catch (error) {
      for (const { ticket } of tickets) ticket.cancel()
      throw error
    } finally {
      conversation.context = undefined
    }
    this.reviews.set(reviewId, { sessionId, tickets })
    return { kind: 'playbook', modules }
  }

  /**
   * A finished reply or the turn's end. Each module's review sees the one
   * block with the findings of its own directories (and the resolutions of
   * its own prior findings); a finding in a file of no reviewed module is
   * counted nowhere.
   */
  observeReview(reviewId: string, event: AgentEvent): PanelReviewProgress {
    return this.settle(reviewId, (review) => {
      if (event.type !== 'itemCompleted' || event.item.text === undefined) {
        for (const { ticket } of review.tickets) ticket.observe(event)
        return
      }
      const blocks = reviewBlocks(event.item.text)
      for (const entry of review.tickets) {
        const own = blocks.map((block) => this.ownBlock(entry, block))
        entry.titles = own.flatMap((block) => block.findings)
        entry.ticket.observe({
          ...event,
          item: {
            ...event.item,
            text: own
              .map((block) => `\`\`\`${REVIEW_FINDINGS_LANGUAGE}\n${JSON.stringify(block)}\n\`\`\``)
              .join('\n'),
          },
        })
      }
    })
  }

  bindReview(reviewId: string, turnId: string): PanelReviewProgress {
    return this.settle(reviewId, (review) => {
      for (const { ticket } of review.tickets) ticket.bind(turnId)
    })
  }

  cancelReview(reviewId: string): void {
    const tickets = this.reviews.get(reviewId)?.tickets ?? []
    this.reviews.delete(reviewId)
    for (const { ticket } of tickets) ticket.cancel()
  }

  /**
   * A dispatch from a conversation. With no module of its own under review
   * it is `ungoverned`: the caller runs it as it always did, and nothing was
   * leased or read from git. Otherwise it is a fix or redesign round on each
   * of those modules: every admission before `effect`, the child's own end
   * through `completion`, then the hook receipts of what it committed.
   */
  async dispatch(
    request: PanelDispatchRequest,
    callbacks: PanelDispatchCallbacks,
  ): Promise<'ungoverned' | 'completed'> {
    const standings = dispatchModules(this.policy.getRecord(), request.sessionId, request.targetId)
    if (standings.length === 0) return 'ungoverned'
    // A governed round reads git and runs the repository's own hooks.
    if (!request.isTrusted) throw new Error(UI_TEXT.playbookUnavailable)
    const head = this.outcomes().head()
    await this.dispatchOn(
      this.conversation(request.sessionId),
      request,
      standings,
      { refs: [head.ref ?? DETACHED_REFS], commit: head.commit },
      callbacks,
    )
    return 'completed'
  }

  /** The person's answers to a module's findings; false when the policy still wants more. */
  answer(sessionId: string, moduleId: string, answers: readonly PanelAnswer[]): boolean {
    const module = this.module(moduleId)
    return this.decided(sessionId, this.policy.answerFindings(module, [...answers]), module)
  }

  /**
   * The design decision the person accepted in the panel. That acceptance is
   * the only authority this operation carries, and it ends with it.
   */
  recordDesign(sessionId: string, moduleId: string, fields: PanelDesignFields): boolean {
    const module = this.module(moduleId)
    const classes = new Set(
      moduleStates(this.policy.getRecord())
        .get(moduleId)
        ?.current?.findings.map((finding) => finding.class),
    )
    const [single] = classes.size === 1 ? [...classes] : []
    const subject = `redesign:${module.id}`
    this.userDecisions.add(subject)
    try {
      return this.decided(
        sessionId,
        this.policy.recordDesignDecision({
          id: randomUUID(),
          module,
          ...(single !== undefined && { class: single }),
          failureClass: bounded(fields.failureClass),
          whyPatchesFailed: bounded(fields.whyPatchesFailed),
          structuralChange: bounded(fields.structuralChange),
          planLocation: fields.planLocation.trim(),
          redesignLane: newRedesignLane(),
          outcome: 'pending',
          at: this.now(),
        }),
        module,
      )
    } finally {
      this.userDecisions.delete(subject)
    }
  }
}
