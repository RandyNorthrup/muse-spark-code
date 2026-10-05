// Computed ceilings per entry (M96 lane A, PLAN.md D75): the lowest of the
// provider's limit (documented, or from headers), our hard ceiling and the
// machine's. No level and no edit ever passes it. A 429, or a low remaining
// header, halves the entry's running cap down to 1; each
// TEAM_THROTTLE_RECOVER_MS without another 429 adds one back, up to the
// entry's configured cap. No `vscode` here.

import {
  TEAM_EXTERNAL_AGENT_DEFAULT,
  TEAM_ENGINE_HARD_CEILING,
  TEAM_EXTERNAL_AGENT_CEILING,
  TEAM_MUSE_CODE_HOST_CEILING,
  TEAM_META_CONTRIBUTOR_RPM,
  TEAM_META_CONTRIBUTOR_TPM,
  TEAM_META_STANDARD_RPM,
  TEAM_META_STANDARD_TPM,
  TEAM_ORCHESTRATOR_HEADROOM,
  TEAM_THROTTLE_HEADROOM_LOW,
  TEAM_WORKER_RPM_ESTIMATE,
  TEAM_WORKER_TPM_ESTIMATE,
} from '../../shared/constants'
import type { TeamAgentKind } from './teamPool'

/** Which Meta tier a key bills: the documented per-team limits differ. */
export type TeamMetaTier = 'standard' | 'contributor'

/** The documented per-team limits for a Meta tier (research §4.7). */
export function metaTeamLimits(tier: TeamMetaTier): { readonly rpm: number; readonly tpm: number } {
  return tier === 'standard'
    ? { rpm: TEAM_META_STANDARD_RPM, tpm: TEAM_META_STANDARD_TPM }
    : { rpm: TEAM_META_CONTRIBUTOR_RPM, tpm: TEAM_META_CONTRIBUTOR_TPM }
}

/** Everything one ceiling computation reads. */
export interface TeamCeilingSource {
  readonly kind: TeamAgentKind
  /** Documented limits, else the headers' observed ones; absent where the provider documents none. */
  readonly providerRpm: number | undefined
  readonly providerTpm: number | undefined
  /** A worker's own rate, from the local record once it has five tasks; estimates before that. */
  readonly workerRpm: number | undefined
  readonly workerTpm: number | undefined
  /** The machine side: `museSpark.teamMaxWorkers` for engines, `teamMaxProcessWorkers` otherwise. */
  readonly machineLimit: number
}

/**
 * The ceiling for one agent: the lowest of the provider's limit, our hard
 * ceiling and the machine's, including zero. Where the provider documents
 * none (Gemini), 429s decide: the provider side drops out until throttling
 * halves the entry below it.
 */
export function computeTeamCeiling(source: TeamCeilingSource): number {
  return Math.max(
    0,
    Math.min(
      providerCeilingSide(source),
      hardCeilingSide(source.kind),
      Math.floor(source.machineLimit),
    ),
  )
}

/** The provider's share of its documented (or header-observed) limits, as concurrency. */
function providerCeilingSide(source: TeamCeilingSource): number {
  switch (source.kind) {
    case 'museCode': {
      return TEAM_MUSE_CODE_HOST_CEILING
    }
    case 'external': {
      return TEAM_EXTERNAL_AGENT_DEFAULT
    }
    case 'engine': {
      const workerRpm = source.workerRpm ?? TEAM_WORKER_RPM_ESTIMATE
      const workerTpm = source.workerTpm ?? TEAM_WORKER_TPM_ESTIMATE
      return Math.min(
        source.providerRpm === undefined
          ? Infinity
          : Math.floor((TEAM_ORCHESTRATOR_HEADROOM * source.providerRpm) / Math.max(1, workerRpm)),
        source.providerTpm === undefined
          ? Infinity
          : Math.floor((TEAM_ORCHESTRATOR_HEADROOM * source.providerTpm) / Math.max(1, workerTpm)),
      )
    }
  }
}

/** Our hard ceiling for the kind: no level and no edit passes it. */
function hardCeilingSide(kind: TeamAgentKind): number {
  switch (kind) {
    case 'engine': {
      return TEAM_ENGINE_HARD_CEILING
    }
    case 'museCode': {
      return TEAM_MUSE_CODE_HOST_CEILING
    }
    case 'external': {
      return TEAM_EXTERNAL_AGENT_CEILING
    }
  }
}

/**
 * Whether a remaining header is low enough to throttle: under 10% of the
 * limit it names (D75).
 */
export function isLowRemainingHeader(remaining: number, limit: number): boolean {
  return (
    Number.isFinite(remaining) &&
    Number.isFinite(limit) &&
    limit > 0 &&
    remaining / limit < TEAM_THROTTLE_HEADROOM_LOW
  )
}

/**
 * The live running cap per entry: the configured cap, halved on every
 * throttle signal down to 1, recovering one step per quiet interval.
 * Throttling is per entry; the rate-limit mark that skips an agent is
 * teamPool's (a plan or key is shared, a running cap is not).
 */
export class TeamThrottleTracker {
  private readonly state = new Map<string, { current: number; changedMs: number }>()

  /**
   * @param configuredCap The entry's running cap: the level's, or a custom value.
   * @param recoverMs Quiet time per step back (TEAM_THROTTLE_RECOVER_MS).
   * @param now The clock, injectable so tests skip the wait.
   */
  public constructor(
    private readonly configuredCap: (entryId: string) => number,
    private readonly recoverMs: number,
    private readonly now: () => number,
  ) {}

  private current(entryId: string): number {
    return Math.min(
      this.state.get(entryId)?.current ?? this.configuredCap(entryId),
      this.configuredCap(entryId),
    )
  }

  private recover(entryId: string, nowMs: number): void {
    const kept = this.state.get(entryId)
    if (kept === undefined) {
      return
    }
    const configured = this.configuredCap(entryId)
    let { changedMs } = kept
    let current = Math.min(kept.current, configured)
    while (current < configured && nowMs - changedMs >= this.recoverMs) {
      current += 1
      changedMs += this.recoverMs
    }
    if (changedMs !== kept.changedMs || current !== kept.current) {
      this.state.set(entryId, { current, changedMs })
    }
  }

  /** The entry's running cap right now: throttled, or recovering. */
  public cap(entryId: string): number {
    this.recover(entryId, this.now())
    return this.current(entryId)
  }

  /** Whether the Agent map shows "throttled by provider" for the entry. */
  public isThrottled(entryId: string): boolean {
    return this.cap(entryId) < this.configuredCap(entryId)
  }

  /** A 429 or a low remaining header on the entry: halve, down to 1. */
  public noteThrottle(entryId: string): void {
    const at = this.now()
    const current = this.cap(entryId)
    this.state.set(entryId, { current: Math.max(1, Math.floor(current / 2)), changedMs: at })
  }

  /** A reset or a new day hands headroom back: forget the throttle. */
  public clear(entryId: string): void {
    this.state.delete(entryId)
  }
}
