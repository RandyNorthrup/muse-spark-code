// M98-U: synchronous approval fences over S's injected background runner.
import {
  JudgeEntryStore,
  type JudgeEntryHandle,
  type JudgeEntryParts,
  type JudgeReadyOutcome,
} from './entries'
import type { JudgeQuestion } from './judge'

export interface JudgeUseJob {
  readonly entryKey: JudgeEntryHandle
  readonly stateText: string
  readonly questions: readonly JudgeQuestion[]
}

/** The fence never exposes model text, probabilities or an authority to allow. */
export interface JudgeFence {
  read(): JudgeReadyOutcome | undefined
  card(onCaution: () => void): void
  discard(): void
}

export interface JudgeAdvisory {
  start(action: JudgeEntryParts, stateText: string): JudgeFence | undefined
  discardTurn(sessionId: string, turnId: string): void
  discardSession(sessionId: string): void
  readonly isSideSession?: ((sessionId: string) => boolean) | undefined
}

export interface JudgeUseDeps {
  /** Reads the current mode/source policy. Off must not create a runner. */
  readonly isOn: (action: JudgeEntryParts) => boolean
  /** Lazily creates S's source, with its transport admitted by lane A. */
  readonly createRunner: (
    entries: JudgeEntryStore,
    action: JudgeEntryParts,
    signal: AbortSignal,
  ) => { judge(job: JudgeUseJob): void }
  /** First-charge consent, if paid; must re-bind after its waits (lane A). */
  readonly prepare: (action: JudgeEntryParts, signal: AbortSignal) => Promise<boolean>
  readonly question: () => JudgeQuestion
  readonly onError: (error: unknown) => void
  /** M75 replays supply independent labels outside this content-free sample. */
  readonly onFence?: ((sample: JudgeFenceSample) => void) | undefined
}

export interface JudgeFenceSample {
  readonly backend: string
  readonly ready: boolean
  readonly caution: boolean
}

interface LiveFence {
  readonly action: JudgeEntryParts
  readonly stop: AbortController
  outcome: JudgeReadyOutcome | undefined
  onCaution: (() => void) | undefined
}

class ObservedEntries extends JudgeEntryStore {
  public constructor(
    private readonly isReadyLive: (
      handle: JudgeEntryHandle,
      outcome: JudgeReadyOutcome | 'failed',
    ) => boolean,
  ) {
    super()
  }

  public override settle(handle: JudgeEntryHandle, outcome: JudgeReadyOutcome | 'failed'): boolean {
    const isAccepted = super.settle(handle, outcome)
    return isAccepted && this.isReadyLive(handle, outcome)
  }
}

/** Memory-only; discarded handles abort consent and cannot update another card. */
export class JudgeUse implements JudgeAdvisory {
  private readonly live = new Map<JudgeEntryHandle, LiveFence>()
  private readonly entries = new ObservedEntries((handle, outcome) => {
    const live = this.live.get(handle)
    if (live === undefined) return false
    if (!this.deps.isOn(live.action)) {
      this.discard(handle)
      return false
    }
    live.outcome = outcome === 'failed' ? undefined : outcome
    if (outcome === 'caution') live.onCaution?.()
    // A card callback may synchronously answer; S must not cache that discarded entry.
    return this.live.get(handle) === live
  })

  public constructor(private readonly deps: JudgeUseDeps) {}

  private async run(handle: JudgeEntryHandle, live: LiveFence, stateText: string): Promise<void> {
    if (!(await this.deps.prepare(live.action, live.stop.signal))) {
      this.entries.settle(handle, 'failed')
      return
    }
    // A held modal is not permission to judge a replaced action or changed mode.
    if (live.stop.signal.aborted || this.live.get(handle) !== live || !this.deps.isOn(live.action))
      return
    const runner = this.deps.createRunner(this.entries, live.action, live.stop.signal)
    runner.judge({ entryKey: handle, stateText, questions: [this.deps.question()] })
  }

  private fence(handle: JudgeEntryHandle): JudgeFence {
    return {
      read: () => {
        const live = this.live.get(handle)
        const outcome =
          live !== undefined && this.deps.isOn(live.action)
            ? this.entries.readLatch(handle)
            : undefined
        if (live !== undefined) {
          this.deps.onFence?.({
            backend: live.action.backend,
            ready: outcome !== undefined,
            caution: outcome === 'caution',
          })
        }
        this.discard(handle)
        return outcome
      },
      card: (onCaution) => {
        const live = this.live.get(handle)
        if (live === undefined) return
        if (!this.deps.isOn(live.action)) {
          this.discard(handle)
          return
        }
        live.onCaution = onCaution
        if (live.outcome === 'caution') onCaution()
      },
      discard: () => {
        this.discard(handle)
      },
    }
  }

  private discard(handle: JudgeEntryHandle): void {
    this.live.get(handle)?.stop.abort()
    this.live.delete(handle)
    this.entries.discard(handle)
  }

  public start(action: JudgeEntryParts, stateText: string): JudgeFence | undefined {
    if (!this.deps.isOn(action)) return undefined
    const handle = this.entries.start(action)
    if (this.live.has(handle)) return this.fence(handle)
    const live: LiveFence = {
      action,
      stop: new AbortController(),
      outcome: undefined,
      onCaution: undefined,
    }
    this.live.set(handle, live)
    void this.run(handle, live, stateText).catch((error: unknown) => {
      this.entries.settle(handle, 'failed')
      this.deps.onError(error)
    })
    return this.fence(handle)
  }

  public discardTurn(sessionId: string, turnId: string): void {
    for (const [handle, live] of this.live) {
      if (live.action.sessionId === sessionId && live.action.turnId === turnId) this.discard(handle)
    }
  }

  public discardSession(sessionId: string): void {
    for (const [handle, live] of this.live) {
      if (live.action.sessionId === sessionId) this.discard(handle)
    }
  }
}

/** Muse Code's captured raw JSON is keyed by its parsed arguments, not serialization order. */
export function startApprovalJudge(
  judge: JudgeAdvisory | undefined,
  action: Omit<JudgeEntryParts, 'args'>,
  rawArgs: string,
  stateText: string,
): JudgeFence | undefined {
  if (judge === undefined) return undefined
  let args: unknown
  try {
    args = JSON.parse(rawArgs)
  } catch {
    return undefined
  }
  return judge.start({ ...action, args }, stateText)
}
