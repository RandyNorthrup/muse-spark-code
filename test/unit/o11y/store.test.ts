// M111 lane OB: the ring store appends batches to owner-only day files,
// serves recent logs, traces, crashes and metric windows, and prunes to
// retention. Real files under a temp root; Windows runs the unsupported
// boundary instead (nodeNativeTest).
import { rm } from 'node:fs/promises'
import { afterEach, describe, expect } from 'vitest'
import { MILLISECONDS_PER_DAY } from '../../../src/shared/constants'
import { buildCrashRecord } from '../../../src/core/o11y/crash'
import { O11yRingStore } from '../../../src/runtime/o11y/store'
import { NodePrivateFiles } from '../../../src/runtime/node/privateFiles'
import { nodeNativeTest, nodeTempRoot } from '../helpers/nodeNative'

const NOW = Date.UTC(2026, 9, 31, 12, 0, 0)
const directories: string[] = []

async function setup(): Promise<{ store: O11yRingStore; dir: string }> {
  const dir = await nodeTempRoot('m111-ob-store-')
  directories.push(dir)
  return { store: new O11yRingStore(new NodePrivateFiles(dir), () => NOW), dir }
}

afterEach(async () => {
  for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('o11y ring store', () => {
  nodeNativeTest('appends and serves each signal newest-first', async () => {
    const { store } = await setup()
    await store.appendLogs([
      { at: NOW - 2000, component: 'node', severity: 9, message: 'first', attributes: [] },
      { at: NOW - 1000, component: 'sysd', severity: 17, message: 'second', attributes: [] },
    ])
    await store.appendMetrics([
      { at: NOW - 1000, component: 'node', name: 'cpu.percent', value: 12, attributes: [] },
    ])
    await store.appendSpans([
      {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        component: 'node',
        name: 'op',
        startMs: NOW - 1000,
        endMs: NOW,
        error: true,
        attributes: [],
      },
    ])
    const built = buildCrashRecord(
      { component: 'shell', kind: 'panic', code: 'SIGSEGV' },
      NOW - 500,
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    await store.appendCrash(built.record)

    const logs = await store.readRecentLogs(10)
    expect(logs.records.map((record) => record.message)).toEqual(['second', 'first'])
    expect(logs.skipped).toEqual({ lines: 0, files: 0 })
    const traces = await store.readRecentTraces(10)
    expect(traces.traces).toHaveLength(1)
    expect(traces.traces[0]?.spans).toHaveLength(1)
    const crashes = await store.readRecentCrashes(10)
    expect(crashes.records).toHaveLength(1)
    expect(crashes.records[0]).toMatchObject({ component: 'shell', code: 'SIGSEGV' })
    const window = await store.readMetricWindow(NOW - MILLISECONDS_PER_DAY, NOW, 20)
    expect(window.series).toHaveLength(1)
    expect(window.series[0]).toMatchObject({ component: 'node', name: 'cpu.percent' })
    expect(window.series[0]?.buckets).toHaveLength(1)
    expect(window.series[0]?.buckets[0]).toMatchObject({ count: 1, avg: 12, min: 12, max: 12 })
  })

  nodeNativeTest('prunes day files past retention and leaves strangers alone', async () => {
    const { store, dir } = await setup()
    const files = new NodePrivateFiles(dir)
    await files.write('metrics-2026-10-20.jsonl', '{"at":1}\n')
    await files.write('metrics-2026-10-31.jsonl', '{"at":2}\n')
    await files.write('notes.txt', 'not ours\n')
    const pruned = await store.prune()
    expect(pruned.deleted).toEqual(['metrics-2026-10-20.jsonl'])
    expect(await files.list()).toEqual(['metrics-2026-10-31.jsonl', 'notes.txt'])
  })

  nodeNativeTest('skips malformed lines and counts them on the read', async () => {
    const { store, dir } = await setup()
    const files = new NodePrivateFiles(dir)
    await files.write(
      'logs-2026-10-31.jsonl',
      '{"at":1}\nnot json\n{"at":1761912000000,"component":"node","severity":9,"message":"ok","attributes":[]}\n',
    )
    const logs = await store.readRecentLogs(10)
    expect(logs.records.map((record) => record.message)).toEqual(['ok'])
    expect(logs.skipped.lines).toBe(2)
  })
})
