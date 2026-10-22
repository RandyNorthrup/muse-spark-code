// Liveness and reachability, kept apart (M110r Y2, PLAN.md D90.25).
// Heartbeats ride the E2E channel with sequence numbers; each side judges
// from its own view. Online means a heartbeat within the miss window;
// unreachable means missed heartbeats with retries running; offline means
// only the node's signed shutdown notice or the person's own
// offline-after interval. Every task waiting on a node says so. Pure,
// except the clocks the caller passes.

import {
  MILLISECONDS_PER_SECOND,
  MINUTES_PER_HOUR,
  NODE_HEARTBEAT_MISS,
  NODE_HEARTBEAT_MS,
  NODE_RECONNECT_MAX_MS,
  SECONDS_PER_MINUTE,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatTime, formatUnit } from '../../shared/l10n/text'

/** One side's own view of a pair: online, unreachable, or offline. */
export type LivenessState = 'online' | 'unreachable' | 'offline'

/** A discovery path and when the node was last seen on it. */
export interface LivenessPath {
  readonly path: 'address' | 'dns-sd' | 'overlay' | 'relay'
  readonly lastSeenWall: number | undefined
}

/** What the rows in every UI show for one node. */
export interface LivenessView {
  readonly state: LivenessState
  readonly lastSeenWall: number | undefined
  readonly unreachableSinceWall: number | undefined
  readonly attempt: number
  readonly nextTryInMs: number | undefined
  readonly paths: readonly LivenessPath[]
  readonly offlineReason: 'shutdown-notice' | 'offline-after' | undefined
}

export interface LivenessConfig {
  /** The person's own offline-after interval; absent means a node goes offline only on its signed notice. */
  readonly offlineAfterMs?: number | undefined
  readonly heartbeatMs?: number | undefined
  readonly missCount?: number | undefined
}

/**
Track one pair's liveness. Heartbeat timing runs on the monotonic clock
(the wall clock may skew); the rows show wall time. Sequence numbers only
move forward: an old heartbeat is a replay, never a sign of life.
*/
export class LivenessTracker {
  private lastSequence = -1
  private lastSeenMono: number | undefined
  private lastSeenWallValue: number | undefined
  private unreachableSinceWallValue: number | undefined
  private shutdownNoticeWall: number | undefined
  private attemptCount = 0
  private nextTryInMsValue: number | undefined
  private readonly paths = new Map<LivenessPath['path'], number | undefined>()

  constructor(private readonly config: LivenessConfig = {}) {}

  private get heartbeatMs(): number {
    return this.config.heartbeatMs ?? NODE_HEARTBEAT_MS
  }

  private get missCount(): number {
    return this.config.missCount ?? NODE_HEARTBEAT_MISS
  }

  /** A heartbeat arrived: sequence, monotonic arrival, wall arrival. */
  onHeartbeat(sequence: number, atMono: number, atWall: number): void {
    if (sequence <= this.lastSequence) return
    this.lastSequence = sequence
    this.lastSeenMono = atMono
    this.lastSeenWallValue = atWall
    this.unreachableSinceWallValue = undefined
    this.attemptCount = 0
    this.nextTryInMsValue = undefined
  }

  /** The node's own signed shutdown notice arrived (verified by the channel). */
  onShutdownNotice(atWall: number): void {
    this.shutdownNoticeWall = atWall
  }

  /** A re-resolution attempt was scheduled; the row shows it. */
  onAttemptScheduled(
    attempt: number,
    nextTryInMs: number,
    atWall: number,
    paths: readonly LivenessPath[],
  ): void {
    this.attemptCount = attempt
    this.nextTryInMsValue = nextTryInMs
    this.unreachableSinceWallValue ??= atWall
    for (const path of paths) this.paths.set(path.path, path.lastSeenWall)
  }

  /** Note where the node was last seen without a full heartbeat. */
  onPathSeen(path: LivenessPath['path'], atWall: number): void {
    this.paths.set(path, atWall)
  }

  view(atMono: number, atWall: number): LivenessView {
    const lastSeenWall = this.lastSeenWallValue
    const lastSeenMono = this.lastSeenMono
    let offlineReason: 'shutdown-notice' | 'offline-after' | undefined
    if (this.shutdownNoticeWall !== undefined) offlineReason = 'shutdown-notice'
    else if (
      lastSeenWall !== undefined &&
      this.config.offlineAfterMs !== undefined &&
      atWall - lastSeenWall >= this.config.offlineAfterMs
    )
      offlineReason = 'offline-after'
    if (offlineReason !== undefined) {
      return {
        state: 'offline',
        lastSeenWall,
        unreachableSinceWall: this.unreachableSinceWallValue,
        attempt: this.attemptCount,
        nextTryInMs: undefined,
        paths: [...this.paths].map(([path, seen]) => ({ path, lastSeenWall: seen })),
        offlineReason,
      }
    }
    const isOnline =
      lastSeenMono !== undefined && atMono - lastSeenMono < this.missCount * this.heartbeatMs
    return {
      state: isOnline ? 'online' : 'unreachable',
      lastSeenWall,
      unreachableSinceWall: isOnline ? undefined : (this.unreachableSinceWallValue ?? atWall),
      attempt: this.attemptCount,
      nextTryInMs: isOnline ? undefined : this.nextTryInMsValue,
      paths: [...this.paths].map(([path, seen]) => ({ path, lastSeenWall: seen })),
      offlineReason: undefined,
    }
  }
}

/**
The re-resolution wait before `attempt` (0-based): exponential backoff in
heartbeat units with uniform jitter, capped at the reconnect maximum. It
paces our own polling, never stops work.
*/
export function reconnectDelayMs(attempt: number, jitterSample: number): number {
  const base = NODE_HEARTBEAT_MS
  const exponential = Math.min(base * 2 ** Math.max(0, attempt), NODE_RECONNECT_MAX_MS)
  return Math.min(exponential + Math.floor(jitterSample * base), NODE_RECONNECT_MAX_MS)
}

function delayText(delayMs: number): string {
  const seconds = Math.max(1, Math.round(delayMs / MILLISECONDS_PER_SECOND))
  if (seconds < SECONDS_PER_MINUTE) return formatUnit(seconds, 'second')
  const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
  return minutes < MINUTES_PER_HOUR
    ? formatUnit(minutes, 'minute')
    : formatUnit(Math.floor(minutes / MINUTES_PER_HOUR), 'hour')
}

/**
The state word for badges and rows, read when shown (D33).
*/
export function livenessStateText(state: LivenessState, sinceWall?: number): string {
  switch (state) {
    case 'online': {
      return UI_TEXT.nodeLivenessOnline
    }
    case 'offline': {
      return UI_TEXT.nodeLivenessOffline
    }
    case 'unreachable': {
      return fill(UI_TEXT.nodeLivenessUnreachable, {
        time: sinceWall === undefined ? '—' : formatTime(sinceWall),
      })
    }
  }
}

/**
A task row waiting on a node, read when shown (D33): who, since when,
which attempt, and the next try. Attempt 0 with no scheduled try is a
node never tried yet.
*/
export function waitingRowText(nodeLabel: string, view: LivenessView): string {
  return fill(UI_TEXT.nodeWaitingRow, {
    node: nodeLabel,
    time: view.unreachableSinceWall === undefined ? '—' : formatTime(view.unreachableSinceWall),
    attempt: String(view.attempt),
    delay: view.nextTryInMs === undefined ? '—' : delayText(view.nextTryInMs),
  })
}
