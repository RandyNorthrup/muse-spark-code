// Live peek's tap (M110b K, PLAN.md D90.22): the read-only window onto
// every agent's event stream the harness runs. Each stream gets a
// bounded ring; each viewer gets a cursor into it, never a queue — a
// viewer that lags behind the ring's overwrite gets a "skipped N"
// marker, never backpressure, and live delivery is paced per viewer,
// so a viewer never slows the agent. Events rest unscrubbed in the
// ring (the agent's own process and trust zone) and pass the scrub
// hook — M109's service then the redactor — on the way out, so
// nothing leaves the process unscrubbed. The tap is a pure state
// machine on the caller's monotonic clock: timers and sockets belong
// to the route, which drains viewers on notify and on its own pace.
import { Buffer } from 'node:buffer'
import {
  MILLISECONDS_PER_SECOND,
  PEEK_BUFFER_BYTES,
  PEEK_BUFFER_EVENTS,
  PEEK_MAX_UPDATES_PER_S,
} from '../../shared/constants'
import type { AgentEvent } from '../../shared/agentEvents'
import { PEEK_EVENT_VERSION, type PeekEvent } from '../../shared/peek'
import type { PeekScrubHook } from './scrubHook'

/** One agent's stream as `--list` and `/peek` name it. */
export interface PeekStreamInfo {
  readonly streamId: string
  readonly label: string
}

interface RingEntry {
  readonly seq: number
  readonly event: AgentEvent
  readonly bytes: number
}

interface StreamState {
  readonly info: PeekStreamInfo
  readonly entries: RingEntry[]
  bytesTotal: number
  nextSeq: number
}

interface ViewerState {
  readonly streamId: string
  cursor: number
  tokens: number
  lastMono: number
}

/** A viewer's read end: drain paced live events, then unsubscribe. No send path. */
export interface PeekViewer {
  drain(nowMono: number): Promise<readonly PeekEvent[]>
  unsubscribe(): void
}

/** Time source is the caller's monotonic clock; tests pass it explicitly. */
export class PeekTap {
  private readonly streams = new Map<string, StreamState>()
  private readonly viewers = new Map<number, ViewerState>()
  private nextViewer = 1

  public constructor(private readonly scrub: PeekScrubHook) {}

  private async drainViewer(viewerId: number, nowMono: number): Promise<readonly PeekEvent[]> {
    const viewer = this.viewers.get(viewerId)
    const stream = viewer === undefined ? undefined : this.streams.get(viewer.streamId)
    if (viewer === undefined || stream === undefined) return []
    const elapsedMs = Math.max(0, nowMono - viewer.lastMono)
    viewer.lastMono = nowMono
    viewer.tokens = Math.min(
      PEEK_MAX_UPDATES_PER_S,
      viewer.tokens + (elapsedMs * PEEK_MAX_UPDATES_PER_S) / MILLISECONDS_PER_SECOND,
    )
    const out: PeekEvent[] = []
    const first = stream.entries[0]
    if (first !== undefined && viewer.cursor < first.seq) {
      if (viewer.tokens < 1) return out
      viewer.tokens -= 1
      const skipped = first.seq - viewer.cursor
      out.push({
        v: PEEK_EVENT_VERSION,
        streamId: viewer.streamId,
        seq: viewer.cursor,
        body: { skipped },
      })
      viewer.cursor = first.seq
    }
    for (const entry of stream.entries) {
      if (entry.seq < viewer.cursor || viewer.tokens < 1) continue
      viewer.tokens -= 1
      viewer.cursor = entry.seq + 1
      out.push({
        v: PEEK_EVENT_VERSION,
        streamId: viewer.streamId,
        seq: entry.seq,
        body: await this.scrub(entry.event),
      })
    }
    return out
  }

  /** Name one stream; registering twice is a caller bug. */
  register(streamId: string, label: string): void {
    if (this.streams.has(streamId)) throw new Error(`duplicate peek stream ${streamId}`)
    this.streams.set(streamId, {
      info: { streamId, label },
      entries: [],
      bytesTotal: 0,
      nextSeq: 0,
    })
  }

  /** Drop a stream and unhook its viewers; answers whether it was there. */
  unregister(streamId: string): boolean {
    if (!this.streams.has(streamId)) return false
    this.streams.delete(streamId)
    for (const [viewerId, viewer] of this.viewers) {
      if (viewer.streamId === streamId) this.viewers.delete(viewerId)
    }
    return true
  }

  /** Every stream the tap holds, oldest registration first. */
  list(): readonly PeekStreamInfo[] {
    return Array.from(this.streams.values(), (stream) => stream.info)
  }

  /**
  File one event on its stream. Unknown streams are a caller bug —
  sources register first. Never blocks: the ring ages the oldest out
  past either bound, and viewers behind the overwrite learn it as a
  skip marker on their next drain.
  */
  offer(streamId: string, event: AgentEvent): void {
    const stream = this.streams.get(streamId)
    if (stream === undefined) throw new Error(`peek offer to unknown stream ${streamId}`)
    const seq = stream.nextSeq
    stream.nextSeq += 1
    const entry: RingEntry = { seq, event, bytes: Buffer.byteLength(JSON.stringify(event)) }
    stream.entries.push(entry)
    stream.bytesTotal += entry.bytes
    // The ring always keeps the newest entry: a single event over the
    // byte bound stays rather than vanishing the offer just made.
    while (
      stream.entries.length > PEEK_BUFFER_EVENTS ||
      (stream.entries.length > 1 && stream.bytesTotal > PEEK_BUFFER_BYTES)
    ) {
      const oldest = stream.entries.shift()
      if (oldest !== undefined) stream.bytesTotal -= oldest.bytes
    }
  }

  /**
  Watch a stream live from its end, or from `fromSeq` for catch-up. An
  unknown stream is a viewer miss, never a throw.
  */
  subscribe(streamId: string, nowMono: number, fromSeq?: number): PeekViewer | undefined {
    const stream = this.streams.get(streamId)
    if (stream === undefined) return undefined
    const viewerId = this.nextViewer
    this.nextViewer += 1
    const viewer: ViewerState = {
      streamId,
      cursor: fromSeq ?? stream.nextSeq,
      tokens: PEEK_MAX_UPDATES_PER_S,
      lastMono: nowMono,
    }
    this.viewers.set(viewerId, viewer)
    return {
      drain: (drainMono: number) => this.drainViewer(viewerId, drainMono),
      unsubscribe: () => {
        this.viewers.delete(viewerId)
      },
    }
  }
  /**
  One shot of a stream's recent events, newest last, for `/peek`-style
  readers: no viewer, no cursor, no pacing. An unknown stream is a
  viewer miss, never a throw.
  */
  async tail(streamId: string, maxEvents: number): Promise<readonly PeekEvent[] | undefined> {
    const stream = this.streams.get(streamId)
    if (stream === undefined) return undefined
    const slice = stream.entries.slice(Math.max(0, stream.entries.length - Math.max(0, maxEvents)))
    const out: PeekEvent[] = []
    for (const entry of slice) {
      out.push({
        v: PEEK_EVENT_VERSION,
        streamId,
        seq: entry.seq,
        body: await this.scrub(entry.event),
      })
    }
    return out
  }
}
