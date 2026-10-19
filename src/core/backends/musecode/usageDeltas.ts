// The usage journal's live writers for Muse Code frames (PLAN.md D26): each
// cumulative report's known delta and each completion's own counters. This
// module has no value imports, so the activation bundle keeps only the loader
// (MuseCodeHost.usageNotesLoader) while these writers load with
// dist/usageService.js on the first session.
import type { AgentEvent, TokenUsageCompletion } from '../../../shared/agentEvents'
import type { SubscriptionUsage } from '../../../shared/usage'
import type { UsageRecording } from '../../usage/recording'

/** What dist/usageService.js serves the activation bundle for live journaling. */
export interface UsageNotesBundle {
  readonly MuseUsageDeltas: typeof MuseUsageDeltas
  readonly museCodeLimitInput: typeof museCodeLimitInput
}

/** The journal's limit snapshot for one `usage/changed` meter reading: the
 * meter's tier names the subscription plan, except an empty tier, which the
 * label reader falls back from. Exported for the exact-assertion test. */
export function museCodeLimitInput(
  usage: SubscriptionUsage,
): Parameters<UsageRecording['limit']>[0] {
  return {
    backend: 'museCode',
    provider: 'museCode',
    source: 'museCode',
    observedAt: usage.observedAtMs,
    // An empty tier names no plan; the label reader falls back then.
    ...(usage.tier !== '' && { plan: usage.tier }),
    windows: [
      {
        id: 'window',
        usedPercent: usage.window.usedPercent,
        resetsAt: usage.window.resetsAtMs,
        windowMins: usage.window.windowDurationMins,
      },
      {
        id: 'weekly',
        usedPercent: usage.weekly.usedPercent,
        resetsAt: usage.weekly.resetsAtMs,
      },
    ],
  }
}

/** Each MSP report is journaled immediately: one completion's own counters
 * where the frame carries them (1.4), else the known cumulative delta. */
export class MuseUsageDeltas {
  private baseline: { inputTokens: number; outputTokens: number; cachedTokens?: number } | undefined
  private startedAt: number | undefined
  private currentModel: string
  public constructor(
    private readonly recording: UsageRecording,
    private readonly sessionId: string,
    modelId: string,
    isNew: boolean,
    private readonly now: () => number = Date.now,
  ) {
    this.currentModel = modelId
    if (isNew) this.baseline = { inputTokens: 0, outputTokens: 0 }
  }
  /** One completion's own counters, wall time and model: never a re-derived split. */
  private noteCompletion(
    event: Extract<AgentEvent, { type: 'tokenUsage' }>,
    model: string,
    startedAt: number,
    at: number,
  ): void {
    const completion: TokenUsageCompletion | undefined = event.completion
    if (completion === undefined) return
    if (completion.inputTokens === 0 && completion.outputTokens === 0) return
    this.recording.note(
      {
        input_tokens: completion.inputTokens,
        output_tokens: completion.outputTokens,
        ...((completion.cachedTokens !== undefined ||
          completion.cacheWriteTokens !== undefined) && {
          input_tokens_details: {
            ...(completion.cachedTokens !== undefined && {
              cached_tokens: completion.cachedTokens,
            }),
            ...(completion.cacheWriteTokens !== undefined && {
              cache_write_tokens: completion.cacheWriteTokens,
            }),
          },
        }),
        ...(completion.reasoningTokens !== undefined && {
          output_tokens_details: { reasoning_tokens: completion.reasoningTokens },
        }),
      },
      {
        backend: 'museCode',
        provider: 'museCode',
        model,
        session: this.sessionId,
        kind: 'turn',
        pricing: { kind: 'plan' },
        startedAt,
        durationMs:
          completion.durationMs !== undefined && Number.isFinite(completion.durationMs)
            ? Math.max(0, completion.durationMs)
            : Math.max(0, at - startedAt),
        outcome: 'incomplete',
      },
    )
  }
  public receive(event: AgentEvent, isReplay = false): void {
    if (isReplay) {
      if (event.type === 'tokenUsage')
        this.baseline = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.cachedTokens !== undefined && { cachedTokens: event.cachedTokens }),
        }
      return
    }
    if (event.type === 'turnStarted') {
      this.startedAt = this.now()
      return
    }
    if (event.type === 'turnCompleted') {
      this.startedAt = undefined
      return
    }
    if (event.type === 'modelChanged') {
      this.currentModel = event.modelId
      return
    }
    if (event.type !== 'tokenUsage') return
    const next = {
      inputTokens: event.inputTokens,
      outputTokens: event.outputTokens,
      ...(event.cachedTokens !== undefined && { cachedTokens: event.cachedTokens }),
    }
    const prior = this.baseline
    this.baseline = next
    if (event.modelId !== undefined) this.currentModel = event.modelId
    // The tier the request was really sent as is this completion's own
    // effective model; the standing model is only the fallback for frames
    // that predate it. A later model change must not rename an earlier call.
    const model = event.completion?.modelId ?? event.modelId ?? this.currentModel
    if (event.completion !== undefined) {
      const at = this.now()
      // The CLI can deliver the same completion-bearing frame twice; its
      // cumulative totals then did not move. Only a forward move records,
      // the same rule headless counting uses (`isCountedCompletion` in
      // runExec.ts), so the journal and the request count never count the
      // same report differently.
      const base = prior ?? { inputTokens: 0, outputTokens: 0 }
      const hasMovedForward =
        next.inputTokens >= base.inputTokens &&
        next.outputTokens >= base.outputTokens &&
        (next.inputTokens > base.inputTokens || next.outputTokens > base.outputTokens)
      if (!hasMovedForward) return
      // The frame carries this completion's own wall time: its start is
      // the notification time minus that duration, not the turn's start,
      // so later requests in one turn do not overlap the first. Frames
      // without a duration keep the turn start (then the receipt time).
      const ownDuration = event.completion.durationMs
      const completionStartedAt =
        ownDuration !== undefined && Number.isFinite(ownDuration)
          ? Math.max(0, at - Math.max(0, ownDuration))
          : (this.startedAt ?? at)
      this.noteCompletion(event, model, completionStartedAt, at)
      return
    }
    if (
      prior === undefined ||
      next.inputTokens < prior.inputTokens ||
      next.outputTokens < prior.outputTokens
    )
      return
    const input = next.inputTokens - prior.inputTokens
    const output = next.outputTokens - prior.outputTokens
    if (input === 0 && output === 0) return
    // The cumulative cache reads sum on the same basis as the prompt total,
    // so their deltas journal where the wire reports them; a report without
    // them only moves the baseline, never invents them. A cached delta
    // journals only when it stays within the input delta it was read from:
    // the journal refuses more cached than input, and a note must never
    // lose its input and output to a bad cached count.
    let cached: number | undefined
    const priorCached = prior.cachedTokens
    const nextCached = next.cachedTokens
    if (
      priorCached !== undefined &&
      nextCached !== undefined &&
      nextCached >= priorCached &&
      nextCached - priorCached <= input
    )
      cached = nextCached - priorCached
    const at = this.now()
    const startedAt = this.startedAt ?? at
    this.recording.note(
      {
        input_tokens: input,
        output_tokens: output,
        ...(cached !== undefined && { input_tokens_details: { cached_tokens: cached } }),
      },
      {
        backend: 'museCode',
        provider: 'museCode',
        model,
        session: this.sessionId,
        kind: 'turn',
        pricing: { kind: 'plan' },
        startedAt,
        durationMs: Math.max(0, at - startedAt),
        outcome: 'incomplete',
      },
    )
  }
}
