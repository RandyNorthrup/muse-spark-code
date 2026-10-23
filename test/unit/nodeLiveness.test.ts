// M110r Y2: liveness states from each side's own view, and waiting rows that say so.
import { describe, expect, it } from 'vitest'
import { NODE_HEARTBEAT_MS, UI_TEXT } from '../../src/shared/constants'
import { fill, formatTime, formatUnit } from '../../src/shared/l10n/text'
import {
  LivenessTracker,
  livenessStateText,
  reconnectDelayMs,
  waitingRowText,
} from '../../src/core/devices/liveness'

describe('liveness states', () => {
  it('online within the miss window, unreachable past it', () => {
    const tracker = new LivenessTracker()
    tracker.onHeartbeat(1, 1000, 2000)
    expect(tracker.view(1000 + 2 * NODE_HEARTBEAT_MS, 3000).state).toBe('online')
    expect(tracker.view(1000 + 3 * NODE_HEARTBEAT_MS, 4000).state).toBe('unreachable')
  })
  it('an old heartbeat is a replay, never a sign of life', () => {
    const tracker = new LivenessTracker()
    tracker.onHeartbeat(2, 1000, 2000)
    tracker.onHeartbeat(1, 50_000, 60_000)
    const view = tracker.view(1000 + 3 * NODE_HEARTBEAT_MS, 70_000)
    expect(view.state).toBe('unreachable')
    expect(view.lastSeenWall).toBe(2000)
  })
  it('a signed shutdown notice takes the node offline at once', () => {
    const tracker = new LivenessTracker()
    tracker.onHeartbeat(1, 1000, 2000)
    tracker.onShutdownNotice(3000)
    const view = tracker.view(1001, 3001)
    expect(view.state).toBe('offline')
    expect(view.offlineReason).toBe('shutdown-notice')
    expect(view.nextTryInMs).toBeUndefined()
  })
  it('unreachable never becomes offline except by notice or the person’s own interval', () => {
    const without = new LivenessTracker()
    without.onHeartbeat(1, 1000, 2000)
    expect(without.view(1_000_000_000, 2_000_000_000).state).toBe('unreachable')
    const withSetting = new LivenessTracker({ offlineAfterMs: 3_600_000 })
    withSetting.onHeartbeat(1, 1000, 2000)
    const lateMono = 1000 + 3 * NODE_HEARTBEAT_MS
    expect(withSetting.view(lateMono, 2000 + 3_599_999).state).toBe('unreachable')
    const view = withSetting.view(lateMono, 2000 + 3_600_000)
    expect(view.state).toBe('offline')
    expect(view.offlineReason).toBe('offline-after')
  })
  it('attempts and paths show on the row until the next heartbeat', () => {
    const tracker = new LivenessTracker()
    tracker.onHeartbeat(1, 1000, 2000)
    tracker.onAttemptScheduled(7, 12_000, 20_000, [{ path: 'address', lastSeenWall: 2000 }])
    const view = tracker.view(1000 + 3 * NODE_HEARTBEAT_MS, 21_000)
    expect(view).toMatchObject({ state: 'unreachable', attempt: 7, nextTryInMs: 12_000 })
    expect(view.paths).toEqual([{ path: 'address', lastSeenWall: 2000 }])
    tracker.onHeartbeat(2, 30_000, 31_000)
    expect(tracker.view(30_001, 31_001)).toMatchObject({ state: 'online', attempt: 0 })
  })
})

describe('reconnect backoff', () => {
  it('backs off exponentially with jitter, capped at the reconnect maximum', () => {
    expect(reconnectDelayMs(0, 0)).toBe(NODE_HEARTBEAT_MS)
    expect(reconnectDelayMs(1, 0)).toBe(2 * NODE_HEARTBEAT_MS)
    const jittered = reconnectDelayMs(1, 0.5)
    expect(jittered).toBeGreaterThan(2 * NODE_HEARTBEAT_MS)
    expect(jittered).toBeLessThanOrEqual(2 * NODE_HEARTBEAT_MS + NODE_HEARTBEAT_MS)
    expect(reconnectDelayMs(100, 0.99)).toBe(30_000)
  })
})

describe('rows', () => {
  it('the state word and the waiting row name who, since when, and the next try', () => {
    expect(livenessStateText('online')).toBe(UI_TEXT.nodeLivenessOnline)
    expect(livenessStateText('offline')).toBe(UI_TEXT.nodeLivenessOffline)
    expect(livenessStateText('unreachable', 75_600_000)).toBe(
      fill(UI_TEXT.nodeLivenessUnreachable, { time: formatTime(75_600_000) }),
    )
    const tracker = new LivenessTracker()
    tracker.onAttemptScheduled(7, 12_000, 75_600_000, [])
    const row = waitingRowText('build-pi', tracker.view(1_000_000, 75_612_000))
    expect(row).toBe(
      fill(UI_TEXT.nodeWaitingRow, {
        node: 'build-pi',
        time: formatTime(75_600_000),
        attempt: '7',
        delay: formatUnit(12, 'second'),
      }),
    )
  })
})
