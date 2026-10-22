// Muse Code's cumulative usage journals through the real chain: the wire
// mapper, the session deltas, the recording and the on-disk journal. The
// first two tokenUsage frames below are the recorded 2026-10-08 exchange
// (docs/research/m105-captures/u16-2026-10-08.jsonl, CLI 1.4.2): the first
// cumulative carries no cache counter, the second carries cacheReadTokens.
// Both notes journal input and output; neither invents a cached split, so
// Cached Input stays honestly unreported for this session. A third frame
// grows the cache counter inside its input delta, and that bounded cached
// delta journals with the input and output it was read from.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { mapNotification } from '../../src/core/backends/musecode/mapNotification'
import { MuseUsageDeltas } from '../../src/core/backends/musecode/usageDeltas'
import { createUsageRecording } from '../../src/core/usage/recording'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
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

describe('Muse usage deltas over the real journal', () => {
  it('journals input and output without inventing cached splits', async () => {
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'rel0190-usage-deltas-'))
    roots.push(dataFolder)
    let ids = 0
    const store = new UsageJournalStore(new NodeUsageFs(dataFolder, () => NOW), {
      writerId: 'deltas-test',
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
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        modelId: 'muse-spark-1.3-contributor',
        cumulative: { promptTokens: 24_999, outputTokens: 770, totalTokens: 25_769 },
      }),
    )
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        modelId: 'muse-spark-1.3-contributor',
        cumulative: {
          promptTokens: 50_789,
          outputTokens: 887,
          totalTokens: 51_676,
          cacheReadTokens: 24_945,
        },
      }),
    )
    // A third frame grows the cache counter inside its input delta: the
    // cached delta journals with the input and output it was read from.
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        modelId: 'muse-spark-1.3-contributor',
        cumulative: {
          promptTokens: 60_789,
          outputTokens: 987,
          totalTokens: 61_776,
          cacheReadTokens: 29_945,
        },
      }),
    )
    await recording.flush()
    const journal = await store.read()
    expect(journal.records).toHaveLength(3)
    const [first, second, third] = journal.records
    expect(first?.tokens.input).toBe(24_999)
    expect(first?.tokens.output).toBe(770)
    expect(first?.tokens.cached).toBeUndefined()
    expect(second?.tokens.input).toBe(25_790)
    expect(second?.tokens.output).toBe(117)
    // The cache counter only sets the baseline here: its first appearance
    // journals no cached delta.
    expect(second?.tokens.cached).toBeUndefined()
    expect(third?.tokens.input).toBe(10_000)
    expect(third?.tokens.output).toBe(100)
    expect(third?.tokens.cached).toBe(5000)
  })

  it('journals a reported completion as completed, served where the frame names it', async () => {
    // RLWINFIX2 item 4: every `session/tokenUsage` frame is one model call
    // that completed (SDK SessionTokenUsageParams: "one per model
    // completion that reports usage"), so its record's outcome is
    // completed, never incomplete — on the per-completion path and the
    // cumulative-delta path alike. The frame's effective modelId is the
    // model that served the call. Frames shaped like the recorded
    // 2026-10-08 exchange (docs/research/m105-captures/u16-2026-10-08.jsonl,
    // CLI 1.4.2): the first completion finishes with tool_calls, the
    // second carries no finish reason, the third predates per-completion
    // usage, the fourth names no model.
    const dataFolder = await mkdtemp(path.join(tmpdir(), 'rel0190-usage-outcome-'))
    roots.push(dataFolder)
    let ids = 0
    const store = new UsageJournalStore(new NodeUsageFs(dataFolder, () => NOW), {
      writerId: 'outcome-test',
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
    const deltas = new MuseUsageDeltas(recording, sessionId, 'muse-spark-1.3', true, () => NOW)
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        modelId: 'muse-spark-1.3-contributor',
        usage: {
          inputTokens: 24_999,
          outputTokens: 770,
          cachedTokens: 0,
          cacheWriteTokens: 0,
          cacheReadTokens: 0,
          reasoningTokens: 574,
        },
        promptTokens: 24_999,
        totalTokens: 25_769,
        finishReason: 'tool_calls',
        durationMs: 8167,
        cumulative: { promptTokens: 24_999, outputTokens: 770, totalTokens: 25_769 },
      }),
    )
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        modelId: 'muse-spark-1.3-contributor',
        usage: {
          inputTokens: 25_790,
          outputTokens: 117,
          cachedTokens: 24_945,
          cacheWriteTokens: 0,
          cacheReadTokens: 24_945,
          reasoningTokens: 85,
        },
        promptTokens: 25_790,
        totalTokens: 25_907,
        durationMs: 12_502,
        cumulative: {
          promptTokens: 50_789,
          outputTokens: 887,
          totalTokens: 51_676,
          cacheReadTokens: 24_945,
        },
      }),
    )
    // A frame that predates per-completion usage journals its delta.
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        modelId: 'muse-spark-1.3-contributor',
        cumulative: { promptTokens: 60_789, outputTokens: 987, totalTokens: 61_776 },
      }),
    )
    // A frame that names no model: the record keeps the last model
    // the CLI named and names no served model.
    deltas.receive(
      tokenUsageEvent({
        sessionId,
        cumulative: { promptTokens: 70_789, outputTokens: 1087, totalTokens: 71_876 },
      }),
    )
    await recording.flush()
    const journal = await store.read()
    expect(journal.records).toHaveLength(4)
    const [first, second, third, fourth] = journal.records
    expect(first?.outcome).toBe('completed')
    expect(first?.model).toBe('muse-spark-1.3-contributor')
    expect(first?.served).toBe('muse-spark-1.3-contributor')
    expect(second?.outcome).toBe('completed')
    expect(second?.served).toBe('muse-spark-1.3-contributor')
    expect(third?.outcome).toBe('completed')
    expect(third?.served).toBe('muse-spark-1.3-contributor')
    expect(fourth?.outcome).toBe('completed')
    expect(fourth?.model).toBe('muse-spark-1.3-contributor')
    expect(fourth?.served).toBeUndefined()
  })
})
