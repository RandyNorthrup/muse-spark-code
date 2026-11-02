// M111 lane OB: the fixtures the observability suites share: a temp
// root with an initialised state store, the desktop's all-ready probes,
// and one seeded record per signal. Real files and the real store; the
// caller removes the root it is given.
import { NODE_ZERO_DIGEST } from '../../../src/shared/constants'
import type { DesktopProbe } from '../../../src/core/o11y/readiness'
import type { O11ySpan } from '../../../src/core/o11y/signals'
import { NodeStateStore } from '../../../src/runtime/node/state'
import type { O11yRingStore } from '../../../src/runtime/o11y/store'
import { nodeState } from './node/records'
import { nodeTempRoot } from './nodeNative'
import { recordCalls } from './recordCalls'

/** A temp root with an initialised state store; the caller removes the root. */
export async function o11yStateRoot(label: string): Promise<{
  dir: string
  state: NodeStateStore
  reported: { calls: [unknown][]; fn: (error: unknown) => void }
}> {
  const dir = await nodeTempRoot(label)
  const reported = recordCalls<[unknown]>()
  const state = new NodeStateStore(dir, reported.fn)
  await state.initialize({ ...nodeState(), auditHead: { seq: 0, hash: NODE_ZERO_DIGEST } })
  return { dir, state, reported }
}

/** The desktop's probes, every one ready and the ping landed in time. */
export function o11yReadyProbes(): [DesktopProbe, DesktopProbe, DesktopProbe, DesktopProbe] {
  return [
    { component: 'compositor', ready: true, detail: 'ping-ok', pingMs: 12 },
    { component: 'shell', ready: true, detail: 'surfaces-mapped' },
    { component: 'app', ready: true, detail: 'windows-responsive' },
    { component: 'sysd', ready: true, detail: 'services-connected' },
  ]
}

/** One errored span under the fixed test trace. */
export function o11ySpan(startMs: number, endMs: number): O11ySpan {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    component: 'node',
    name: 'op',
    startMs,
    endMs,
    error: true,
    attributes: [],
  }
}

/** One log, one metric point and one span in the store, all at `at`. */
export async function seedO11ySignals(store: O11yRingStore, at: number): Promise<void> {
  await store.appendLogs([{ at, component: 'node', severity: 9, message: 'up', attributes: [] }])
  await store.appendMetrics([
    { at, component: 'node', name: 'cpu.percent', value: 12, attributes: [] },
  ])
  await store.appendSpans([o11ySpan(at, at + 1000)])
}
