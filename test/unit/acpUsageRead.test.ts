// RLF-MACLIVE F2: the ACP usage read covers Muse Code sessions. A Muse
// Code turn's journaled records feed the snapshot through the real chain:
// the wire mapper, the session deltas, the recording, the on-disk journal
// and the real daily-ledger reader. The tokenUsage frames are the recorded
// 2026-10-08 exchange (docs/research/m105-captures/u16-2026-10-08.jsonl,
// CLI 1.4.2), the same frames museUsageDeltas.test.ts journals.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readAcpUsage } from '../../src/acp/accounting'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { MuseUsageDeltas } from '../../src/core/backends/musecode/usageDeltas'
import { createUsageRecording } from '../../src/core/usage/recording'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { createAcpAccounting } from '../../src/runtime/acpAccounting'
import { readRuntimeDailyBudget } from '../../src/runtime/runtimeAccountingEntry'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'

const NOW = 1_790_000_000_000
const sessionId = 'session-1'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function tokenUsageEvent(params: Record<string, unknown>) {
  const mapped = mapNotification({ method: 'session/tokenUsage', params })
  if (typeof mapped === 'string' || !('event' in mapped) || mapped.event.type !== 'tokenUsage')
    throw new Error('recorded frame did not map')
  return mapped.event
}

async function museCodeAccounting(isHistoryOn: boolean) {
  const dataFolder = await mkdtemp(path.join(tmpdir(), 'muse-acp-usage-'))
  roots.push(dataFolder)
  let ids = 0
  const store = new UsageJournalStore(new NodeUsageFs(dataFolder, () => NOW), {
    writerId: 'acp-usage-test',
    isEnabled: () => true,
    now: () => NOW,
    onWriteError: () => undefined,
  })
  const recording = createUsageRecording({
    client: 'test',
    now: () => NOW,
    newId: () => `note-${String((ids += 1))}`,
    isEnabled: () => true,
    writer: () => Promise.resolve(store),
    log: {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  })
  const deltas = new MuseUsageDeltas(
    recording,
    sessionId,
    'muse-spark-1.3-contributor',
    true,
    () => NOW,
  )
  const accounting = createAcpAccounting({
    recording,
    isEnabled: () => isHistoryOn,
    runtime: { readUsageBudgets: () => readRuntimeDailyBudget({ dataFolder, now: () => NOW }) },
    dataFolder,
    now: () => NOW,
    sleep: () => Promise.resolve(),
  })
  return {
    feed(frames: readonly Record<string, unknown>[]) {
      for (const params of frames) deltas.receive(tokenUsageEvent(params))
    },
    accounting,
    async snapshot() {
      await recording.flush()
      return await readAcpUsage(accounting, sessionId)
    },
  }
}

const RECORDED_FRAMES = [
  {
    sessionId,
    modelId: 'muse-spark-1.3-contributor',
    cumulative: { promptTokens: 24_999, outputTokens: 770, totalTokens: 25_769 },
  },
  {
    sessionId,
    modelId: 'muse-spark-1.3-contributor',
    cumulative: {
      promptTokens: 50_789,
      outputTokens: 887,
      totalTokens: 51_676,
      cacheReadTokens: 24_945,
    },
  },
]

describe('ACP usage read over Muse Code journal records', () => {
  it('snapshots the session with plan-priced requests and no settled dollars', async () => {
    const rig = await museCodeAccounting(true)
    rig.feed(RECORDED_FRAMES)
    const snapshot = await rig.snapshot()
    expect(snapshot.available).toBe(true)
    // Both completions journaled; neither settles dollars on a subscription.
    expect(snapshot.session.requests).toBe(2)
    expect(snapshot.session.planRequests).toBe(2)
    expect(snapshot.session.settledUsd).toBe('0')
    expect(snapshot.session.tokens.input).toBeGreaterThan(0)
    expect(snapshot.session.tokens.output).toBeGreaterThan(0)
    expect(snapshot.session.unknownRequests).toBe(0)
  })

  it('refuses the read where history is disabled', async () => {
    const rig = await museCodeAccounting(false)
    rig.feed(RECORDED_FRAMES)
    await expect(rig.snapshot()).rejects.toThrow('Usage history unavailable')
  })
})
