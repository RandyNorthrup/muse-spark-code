// The Muse Code journal rig both journal suites drive: a real recording
// over a real on-disk journal in a temp folder, fed with recorded
// session/tokenUsage frames through the real wire mapper and session
// deltas. One copy: acpUsageRead.test.ts and museUsageDeltas.test.ts share
// it instead of duplicating the setup.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import { mapNotification } from '../../../src/core/backends/musecode/mapNotification'
import { MuseUsageDeltas } from '../../../src/core/backends/musecode/usageDeltas'
import { createUsageRecording, type UsageRecording } from '../../../src/core/usage/recording'
import { UsageJournalStore } from '../../../src/core/usage/journalStore'
import type { UsageRecord } from '../../../src/shared/usageJournal'
import { NodeUsageFs } from '../../../src/runtime/usage/nodeUsageFs'

export const MUSE_JOURNAL_NOW = 1_790_000_000_000
export const MUSE_JOURNAL_SESSION = 'session-1'

// The recorded 2026-10-08 exchange's first two cumulative frames
// (docs/research/m105-captures/u16-2026-10-08.jsonl, CLI 1.4.2): the first
// cumulative carries no cache counter, the second carries cacheReadTokens.
export const MUSE_TOKEN_USAGE_FRAMES: readonly Record<string, unknown>[] = [
  {
    sessionId: MUSE_JOURNAL_SESSION,
    modelId: 'muse-spark-1.3-contributor',
    cumulative: { promptTokens: 24_999, outputTokens: 770, totalTokens: 25_769 },
  },
  {
    sessionId: MUSE_JOURNAL_SESSION,
    modelId: 'muse-spark-1.3-contributor',
    cumulative: {
      promptTokens: 50_789,
      outputTokens: 887,
      totalTokens: 51_676,
      cacheReadTokens: 24_945,
    },
  },
]

const roots: string[] = []

/** Remove every rig folder this file created, after each of its tests. Call once per suite. */
export function registerMuseJournalCleanup(): void {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })
}

function tokenUsageEvent(params: Record<string, unknown>) {
  const mapped = mapNotification({ method: 'session/tokenUsage', params })
  if (typeof mapped === 'string' || !('event' in mapped) || mapped.event.type !== 'tokenUsage')
    throw new Error('recorded frame did not map')
  return mapped.event
}

export interface MuseJournalRig {
  readonly dataFolder: string
  readonly recording: UsageRecording
  feed(frames: readonly Record<string, unknown>[]): void
  read(): Promise<readonly UsageRecord[]>
}

export async function createMuseJournalRig(
  model: string,
  prefix: string,
  writerId: string,
): Promise<MuseJournalRig> {
  const dataFolder = await mkdtemp(path.join(tmpdir(), prefix))
  roots.push(dataFolder)
  let ids = 0
  const store = new UsageJournalStore(new NodeUsageFs(dataFolder, () => MUSE_JOURNAL_NOW), {
    writerId,
    isEnabled: () => true,
    now: () => MUSE_JOURNAL_NOW,
    onWriteError: () => undefined,
  })
  const recording = createUsageRecording({
    client: 'test',
    now: () => MUSE_JOURNAL_NOW,
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
    MUSE_JOURNAL_SESSION,
    model,
    true,
    () => MUSE_JOURNAL_NOW,
  )
  return {
    dataFolder,
    recording,
    feed(frames: readonly Record<string, unknown>[]) {
      for (const params of frames) deltas.receive(tokenUsageEvent(params))
    },
    async read() {
      await recording.flush()
      const journal = await store.read()
      return journal.records
    },
  }
}
