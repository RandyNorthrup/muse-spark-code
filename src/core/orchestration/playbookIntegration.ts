import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import type { PlaybookBrief } from './playbookBrief'
import type {
  PlaybookCommand,
  PlaybookCheck,
  PlaybookCheckDecision,
  PlaybookDecision,
  PlaybookLane,
  PlaybookLease,
  PlaybookModule,
  PlaybookPlanPort,
  PlaybookPolicy,
  PlaybookPushRange,
  PlaybookRecord,
  PlaybookRequester,
  PlaybookWhyNote,
} from '../../shared/playbook'

/** These facts come from the harness registry, never from a model's task text. */
export interface PlaybookWork {
  readonly id: string
  readonly module: PlaybookModule
  readonly lane?: { readonly milestoneId: string; readonly id: string }
  readonly refs: readonly string[]
  readonly requester: PlaybookRequester
  readonly brief: PlaybookBrief
  /** The registry resolves equivalent effects/subjects across tools and agents. */
  readonly commands: readonly PlaybookCommand[]
}

export interface PlaybookIntegrationEvents {
  note(note: PlaybookWhyNote): void
  offerRedesign(module: PlaybookModule): void
  hookOutput(output: string): void
  failure(error: unknown): void
}

export interface PlaybookIntegrationPolicy extends PlaybookPolicy {
  getRecord(): readonly PlaybookRecord[]
  beforeFixRound(module: PlaybookModule, laneId?: string): PlaybookDecision
}

/** A refusal is identified structurally across separately loaded bundles. */
export class PlaybookRefusedError extends Error {
  constructor(readonly note: PlaybookWhyNote) {
    super(UI_TEXT.playbookUnavailable)
    this.name = 'PlaybookRefusedError'
  }
}

/** Shared by the panel, M96/M96c, M110's runtime host and M115w. */
export class PlaybookIntegration {
  private readonly active = new Set<string>()
  constructor(
    readonly policy: PlaybookIntegrationPolicy,
    private readonly plan: PlaybookPlanPort,
    private readonly events: PlaybookIntegrationEvents,
  ) {}

  /** Look up fresh board facts immediately before dispatch/merge, not at pick time. */
  private lane(identity: NonNullable<PlaybookWork['lane']>, lanes: readonly PlaybookLane[]) {
    const matches = lanes.filter(
      (lane) => lane.milestoneId === identity.milestoneId && lane.id === identity.id,
    )
    if (matches.length !== 1 || !matches[0]) throw new Error(UI_TEXT.playbookUnavailable)
    return matches[0]
  }

  explain(decision: PlaybookDecision, module?: PlaybookModule): void {
    this.events.note(decision.note)
    if (module && ['redesignRequired', 'designRequired'].includes(decision.note.code))
      this.events.offerRedesign(module)
  }

  require(decision: PlaybookDecision, module?: PlaybookModule): void {
    this.explain(decision, module)
    if (decision.kind === 'refuse') throw new PlaybookRefusedError(decision.note)
  }

  start(work: PlaybookWork): ManagedPlaybookWork {
    if (!work.id.trim() || this.active.has(work.id)) throw new Error(UI_TEXT.playbookUnavailable)
    // G3: the brief renders structurally and its hash records before any
    // admission, for every orchestrator (panel, M96, M110, M115w alike).
    this.require(this.policy.recordBrief(work.module, work.brief), work.module)
    let decision: PlaybookDecision
    if (work.lane) {
      const board = this.plan.readBoard()
      const lane = this.lane(work.lane, board.lanes)
      if (lane.module.id !== work.module.id) throw new Error(UI_TEXT.playbookUnavailable)
      decision = this.policy.beforeDispatch(lane, board)
    } else decision = this.policy.beforeFixRound(work.module, work.id)
    this.require(decision, work.module)
    if (decision.kind !== 'allow' || !decision.lease) throw new Error(UI_TEXT.playbookUnavailable)
    try {
      for (const command of work.commands)
        this.require(this.policy.beforeCommand(command, work.requester), work.module)
      const workId = this.policy.beginWork(work.module, work.refs)
      this.active.add(work.id)
      return new ManagedPlaybookWork(this, work.module, decision.lease, workId, () => {
        this.active.delete(work.id)
      })
    } catch (error) {
      this.require(this.policy.releasePatch(work.module, decision.lease), work.module)
      throw error
    }
  }

  /** M96c picks from the whole board so merged local prerequisites remain in the DAG. */
  pick(): PlaybookLane | undefined {
    const board = this.plan.readBoard()
    const queue = board.lanes.map((lane) => ({
      ...lane,
      starts: lane.starts.filter((dependency) => {
        const qualified = dependency.includes(':')
          ? dependency
          : `${lane.milestoneId}:${dependency}`
        return !board.mergedPrerequisites.includes(qualified)
      }),
    }))
    const ordered = this.policy.order(queue)
    if (ordered.kind === 'refuse') {
      this.require(ordered)
      return undefined
    }
    for (const note of ordered.notes) this.events.note(note)
    const next = ordered.queue.find((lane) => !lane.merged)
    return next ? this.lane(next, board.lanes) : undefined
  }

  merge(identity: NonNullable<PlaybookWork['lane']>, effect: () => void): void {
    const lane = this.lane(identity, this.plan.readBoard().lanes)
    this.require(this.policy.beforeMerge(lane), lane.module)
    effect()
  }

  /** G24: the milestone's residual register must be empty or accepted before
   * the release effect runs. The merge queue calls this, not the lanes. */
  release(milestoneId: string, effect: () => void): void {
    const board = this.plan.readBoard()
    this.require(this.policy.releaseReady(milestoneId, board.lanes))
    effect()
  }

  async check<T>(
    check: PlaybookCheck,
    effect: (target: PlaybookCheckDecision['target']) => Promise<T>,
  ): Promise<T> {
    const decision = this.policy.beforeCheck(check, this.plan.readBoard())
    this.require(decision)
    if (decision.kind !== 'allow') throw new Error(UI_TEXT.playbookUnavailable)
    return await effect(decision.target)
  }

  showHookOutput(output: string): void {
    if (output) this.events.hookOutput(output)
  }

  failed(error: unknown): void {
    this.events.failure(error)
  }
}

/** Only the admitted generation can renew, finish or cancel. Keep it in the registry. */
export class ManagedPlaybookWork {
  private closed = false

  constructor(
    private readonly integration: PlaybookIntegration,
    private readonly module: PlaybookModule,
    private readonly lease: PlaybookLease,
    readonly workId: string,
    private readonly onClosed: () => void,
  ) {}

  renew(): void {
    if (this.closed) throw new Error(UI_TEXT.playbookUnavailable)
    this.integration.require(
      this.integration.policy.renewPatch(this.module, this.lease),
      this.module,
    )
  }

  cancel(): void {
    if (this.closed) return
    this.integration.require(
      this.integration.policy.releasePatch(this.module, this.lease),
      this.module,
    )
    this.closed = true
    this.onClosed()
  }

  complete(): void {
    this.renew()
    const verified = this.integration.policy.verifyWork(this.workId)
    this.integration.showHookOutput(verified.output)
    this.integration.require(verified.decision, this.module)
    this.integration.require(this.integration.policy.finishWork(this.workId), this.module)
    this.cancel()
  }

  /** The callback must push these frozen OIDs, never resolve branch names later. */
  push(range: PlaybookPushRange, effect: (range: PlaybookPushRange) => void): void {
    this.renew()
    const exact = structuredClone(range)
    const verified = this.integration.policy.verifyWork(this.workId, exact)
    this.integration.showHookOutput(verified.output)
    this.integration.require(verified.decision, this.module)
    this.integration.require(this.integration.policy.beforePush(this.workId, exact), this.module)
    effect(exact)
  }
}

/** The runner must stop its actual job tree on abort and await its exit before returning. */
export async function runPlaybookWork<T>(
  work: ManagedPlaybookWork,
  effect: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController()
  let renewalError: Error | undefined
  const timer = setInterval(() => {
    try {
      work.renew()
    } catch (error) {
      renewalError = error instanceof Error ? error : new Error(UI_TEXT.playbookUnavailable)
      controller.abort()
    }
  }, PLAYBOOK_LAUNDER_WINDOW_MS / 2)
  timer.unref()
  try {
    const result = await effect(controller.signal)
    if (renewalError !== undefined) throw renewalError
    work.complete()
    return result
  } finally {
    clearInterval(timer)
    work.cancel()
  }
}
