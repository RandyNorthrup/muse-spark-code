import type { AgentEvent } from '../../shared/agentEvents'
import type { TurnPart } from '../agent/agentBackend'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../shared/constants'
import { UI_TEXT } from '../../shared/l10n/text'
import type {
  PlaybookModule,
  PlaybookReviewAgents,
  PlaybookLease,
  PlaybookRound,
} from '../../shared/playbook'
import { parseReviewBlock, type ReviewBlock } from '../../shared/reviewFindings'
import { type PlaybookIntegration, runPlaybookWork, type PlaybookWork } from './playbookIntegration'
import { renderPlaybookBrief, type RenderedPlaybookBrief } from './playbookBrief'

export type PanelDispatchKind = 'subagent' | 'delegate' | 'bestOfN' | 'team' | 'node' | 'watchdog'

export interface PlaybookReviewContext {
  readonly module: PlaybookModule
  readonly agents: PlaybookReviewAgents
}

/** Real registry bindings are supplied by the host, in all editors and the runtime. */
export interface PanelPlaybookRegistry {
  dispatch(kind: PanelDispatchKind, sessionId: string | undefined, targetId?: string): PlaybookWork
  review(sessionId: string, files: readonly string[]): PlaybookReviewContext
  /** K's charter, read lazily; ordinary M70 review requests never call it. */
  reviewParts(
    parts: readonly TurnPart[],
    context: PlaybookReviewContext,
    prior: PlaybookRound | undefined,
  ): readonly TurnPart[]
  /** A dispatch acknowledgement/agent summary is not a completion receipt. Await the
   * actual runner's job tree, tests and result channel, stopping it on signal abort. */
  waitForCompletion(work: PlaybookWork, submission: unknown, signal: AbortSignal): Promise<void>
  stopReview(context: PlaybookReviewContext): void
  /** Persist dispatch evidence in the board/job record before a worker starts (G3/G4). */
  recordDispatch(workId: string, brief: RenderedPlaybookBrief): void
  /** G17: snapshot the shared repository configuration read-only through the trusted
   * Git runner; drift is a durable owner item, never a job's own success claim. */
  snapshotRepositoryConfig(): string
  recordRepositoryDrift(workId: string, before: string, after: string): void
}

export interface PanelPlaybookPort {
  dispatch<T>(
    kind: PanelDispatchKind,
    sessionId: string | undefined,
    targetId: string | undefined,
    effect: (signal: AbortSignal, brief: RenderedPlaybookBrief) => Promise<T>,
  ): Promise<T>
  review(sessionId: string, files: readonly string[]): PanelPlaybookReview
}

export interface PanelPlaybookReview {
  readonly isClosed: boolean
  parts(parts: readonly TurnPart[]): readonly TurnPart[]
  observe(event: AgentEvent): void
  bind(turnId: string): void
  cancel(): void
}

/** Only the extension-owned fenced format is parsed; this is not a provider wire parser. */
function reviewBlocks(text: string): readonly ReviewBlock[] {
  return Array.from(
    text.matchAll(/^```muse-review[^\S\n]*\r?\n([\s\S]*?)^```[^\S\n]*$/gmu),
    (block) => {
      const review = parseReviewBlock(block[1] ?? '')
      if (!review) throw new Error(UI_TEXT.playbookUnavailable)
      return review
    },
  )
}

export class PanelPlaybook implements PanelPlaybookPort {
  constructor(
    private readonly integration: PlaybookIntegration,
    private readonly registry: PanelPlaybookRegistry,
  ) {}

  async dispatch<T>(
    kind: PanelDispatchKind,
    sessionId: string | undefined,
    targetId: string | undefined,
    effect: (signal: AbortSignal, brief: RenderedPlaybookBrief) => Promise<T>,
  ): Promise<T> {
    const work = structuredClone(this.registry.dispatch(kind, sessionId, targetId))
    const brief = renderPlaybookBrief(work.brief)
    const configBefore = this.registry.snapshotRepositoryConfig()
    const managed = this.integration.start(work)
    return await runPlaybookWork(managed, async (signal) => {
      this.registry.recordDispatch(managed.workId, brief)
      const submission = await effect(signal, brief)
      await this.registry.waitForCompletion(work, submission, signal)
      const configAfter = this.registry.snapshotRepositoryConfig()
      if (configAfter !== configBefore) {
        this.registry.recordRepositoryDrift(managed.workId, configBefore, configAfter)
        throw new Error(UI_TEXT.playbookUnavailable)
      }
      return submission
    })
  }

  review(sessionId: string, files: readonly string[]): PanelPlaybookReview {
    // Normalize before the trusted registry lookup, including Windows capture paths.
    const context = structuredClone(
      this.registry.review(
        sessionId,
        files.map((file) => file.replaceAll('\\', '/')),
      ),
    )
    const admission = this.integration.policy.beforeReview(context.module, context.agents)
    this.integration.require(admission, context.module)
    if (admission.kind !== 'allow' || !admission.lease) throw new Error(UI_TEXT.playbookUnavailable)
    return new PanelReview(this.integration, this.registry, context, admission.lease)
  }
}

/** Events can beat the send acknowledgement. Count only its bound, completed turn. */
class PanelReview implements PanelPlaybookReview {
  private turnId: string | undefined
  private closed = false
  private readonly turns = new Map<string, { reviews: ReviewBlock[]; terminal?: string }>()
  private readonly timer: ReturnType<typeof setInterval>

  constructor(
    private readonly integration: PlaybookIntegration,
    private readonly registry: PanelPlaybookRegistry,
    private readonly context: PlaybookReviewContext,
    private readonly lease: PlaybookLease,
  ) {
    this.timer = setInterval(() => {
      try {
        this.integration.require(
          this.integration.policy.renewPatch(this.context.module, this.lease),
          this.context.module,
        )
      } catch (error) {
        this.close()
        this.registry.stopReview(this.context)
        this.integration.failed(error)
      }
    }, PLAYBOOK_LAUNDER_WINDOW_MS / 2)
    this.timer.unref()
  }

  private close(): void {
    this.closed = true
    clearInterval(this.timer)
    this.turns.clear()
  }

  private settle(): void {
    if (this.closed || this.turnId === undefined) return
    const turn = this.turns.get(this.turnId)
    if (!turn?.terminal) return
    if (turn.terminal !== 'completed') {
      this.cancel()
      return
    }
    if (turn.reviews.length !== 1 || !turn.reviews[0]) {
      this.cancel()
      throw new Error(UI_TEXT.playbookUnavailable)
    }
    const decision = this.integration.policy.afterReview(
      this.context.module,
      turn.reviews[0],
      this.context.agents,
      this.lease,
    )
    this.integration.explain(decision, this.context.module)
    // A consumed review releases in P, even when its new strike refuses more patches.
    const isConsumed = this.integration.policy
      .getRecord()
      .some(
        (record) =>
          record.kind === 'round' && record.value.lease?.generation === this.lease.generation,
      )
    if (isConsumed) this.close()
    else this.cancel()
  }

  get isClosed(): boolean {
    return this.closed
  }

  parts(parts: readonly TurnPart[]): readonly TurnPart[] {
    if (this.closed) throw new Error(UI_TEXT.playbookUnavailable)
    const previous = this.integration.policy
      .getRecord()
      .findLast(
        (record) =>
          record.kind === 'round' &&
          record.value.class === undefined &&
          record.value.module.id === this.context.module.id,
      )
    return this.registry.reviewParts(
      parts,
      this.context,
      previous?.kind === 'round' ? previous.value : undefined,
    )
  }

  observe(event: AgentEvent): void {
    if (this.closed) return
    let turnId: string | undefined
    if (event.type === 'itemCompleted') turnId = event.item.turnId
    else if (event.type === 'turnCompleted') turnId = event.turnId
    if (!turnId || (this.turnId !== undefined && this.turnId !== turnId)) return
    if (event.type !== 'itemCompleted' && event.type !== 'turnCompleted') return
    const turn = this.turns.get(turnId) ?? { reviews: [] }
    this.turns.set(turnId, turn)
    if (
      event.type === 'itemCompleted' &&
      event.item.kind === 'agentMessage' &&
      event.item.status === 'completed' &&
      event.item.text
    )
      turn.reviews.push(...reviewBlocks(event.item.text))
    if (event.type === 'turnCompleted') turn.terminal = event.terminal
    this.settle()
  }

  bind(turnId: string): void {
    if (this.closed || this.turnId !== undefined) throw new Error(UI_TEXT.playbookUnavailable)
    this.turnId = turnId
    for (const key of this.turns.keys()) if (key !== turnId) this.turns.delete(key)
    this.settle()
  }

  cancel(): void {
    if (this.closed) return
    this.close()
    this.integration.require(
      this.integration.policy.releasePatch(this.context.module, this.lease),
      this.context.module,
    )
  }
}
