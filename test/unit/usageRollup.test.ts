import { mkdtemp, readFile, rm, writeFile, utimes } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { onTestFinished, describe, expect, it, vi } from 'vitest'
import {
  UsageJournalStore,
  USAGE_JOURNAL_ROOT,
  rollupUsageRecords,
} from '../../src/core/usage/journalStore'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import type { UsageRecord } from '../../src/shared/usageJournal'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { USAGE_HISTOGRAM_EDGES_MS, USAGE_ROLLUP_LOCK_STALE_MS } from '../../src/shared/constants'

function record(day: string, id = day) {
  const at = new Date(`${day}T12:00:00`).getTime()
  return createUsageRecord(
    { input_tokens: 100, output_tokens: 20 },
    {
      id,
      at,
      startedAt: at - 50,
      client: 'Zed',
      backend: 'modelApi',
      provider: 'ollama',
      model: 'local',
      kind: 'turn',
      outcome: 'completed',
      durationMs: 50,
      firstTokenMs: 10,
      pricing: { kind: 'local' },
    },
  )
}
async function rig() {
  const root = await mkdtemp(path.join(tmpdir(), 'm102-rollup-'))
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const fs = new NodeUsageFs(root)
  const store = new UsageJournalStore(fs, {
    writerId: 'rollup',
    now: () => new Date(2026, 9, 5, 12).getTime(),
    isEnabled: () => true,
    onWriteError: vi.fn(),
  })
  return { root, fs, store, record }
}

describe('usage rollup and retention', () => {
  it('retries a snapshot when retention reclaims its generation between rollups and raw days', async () => {
    const { store, root, record } = await rig()
    store.append(record('2026-09-01'))
    await store.flush()
    let clock = Date.now()
    const readerFs = new NodeUsageFs(root, () => clock)
    const options = {
      writerId: 'reader',
      now: () => new Date(2026, 9, 5, 12).getTime(),
      isEnabled: () => true,
      onWriteError: vi.fn(),
    }
    const reader = new UsageJournalStore(readerFs, options)
    const retainer = new UsageJournalStore(new NodeUsageFs(root, () => clock), options)
    const listing = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const list = readerFs.list.bind(readerFs)
    let hasPaused = false
    vi.spyOn(readerFs, 'list').mockImplementation(async (folder) => {
      if (!hasPaused && folder === `${USAGE_JOURNAL_ROOT}/days`) {
        hasPaused = true
        listing.resolve(undefined)
        await resume.promise
      }
      return await list(folder)
    })
    const pending = reader.read()
    try {
      await listing.promise
      expect(await retainer.retain()).toBe(false)
      clock += USAGE_ROLLUP_LOCK_STALE_MS + 1000
      expect(await retainer.retain()).toBe(true)
      resume.resolve(undefined)
      expect(await pending).toMatchObject({
        recordCount: 1,
        records: [],
        rollups: [{ day: '2026-09-01', records: 1 }],
      })
      expect(await reader.read()).toMatchObject({ recordCount: 1 })
    } finally {
      resume.resolve(undefined)
      await pending
    }
  })
  it('refuses busy snapshots and bounds retries when both generations are lost', async () => {
    const { store, fs } = await rig()
    const held = await fs.acquireLock(
      `${USAGE_JOURNAL_ROOT}/rollup.lock`,
      USAGE_ROLLUP_LOCK_STALE_MS,
    )
    await expect(store.read()).rejects.toThrow('usageLocked')
    await held?.release()
    const release = vi.fn().mockResolvedValue(undefined)
    const acquire = vi.spyOn(fs, 'acquireLock').mockResolvedValue({
      token: 'lost-owner',
      generation: 1,
      isHeld: () => Promise.resolve(false),
      release,
    })
    await expect(store.read()).rejects.toThrow('usageLockLost')
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(release).toHaveBeenCalledTimes(2)
  })
  it('reads a complete atomic rollup replacement when its size changes after stat', async () => {
    const { store, fs, record } = await rig()
    store.append(record('2026-09-01'))
    await store.flush()
    await store.retain()
    const file = `${USAGE_JOURNAL_ROOT}/rollups/2026-09.json`
    const stat = fs.stat.bind(fs)
    let hasReplaced = false
    vi.spyOn(fs, 'stat').mockImplementation(async (relative) => {
      const observed = await stat(relative)
      if (relative === file && !hasReplaced) {
        hasReplaced = true
        await fs.writeFileAtomically(
          file,
          JSON.stringify({
            v: 1,
            month: '2026-09',
            days: ['2026-09-01', '2026-09-02'],
            rows: rollupUsageRecords([record('2026-09-01'), record('2026-09-02')]),
            limits: [],
          }),
        )
      }
      return observed
    })
    expect(await store.read()).toMatchObject({
      recordCount: 2,
      rollups: [{ records: 1 }, { records: 1 }],
    })
    expect(await store.read()).toMatchObject({ recordCount: 2 })
  })
  it('rolls old days up exactly once and leaves 30 detailed days', async () => {
    const { store, fs, record, root } = await rig()
    store.append(record('2026-09-05'))
    store.append(record('2026-09-06'))
    store.append(record('2026-10-05'))
    await store.flush()
    expect(await store.retain()).toBe(true)
    const first = await store.read()
    expect(first.records.map((entry) => entry.day)).toEqual(['2026-09-06', '2026-10-05'])
    expect(first.rollups).toHaveLength(1)
    expect(first.recordCount).toBe(3)
    const file = path.join(root, USAGE_JOURNAL_ROOT, 'rollups', '2026-09.json')
    const before = await readFile(file)
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/days/2026-09-05`)).toEqual([])
    await store.retain()
    expect(await readFile(file)).toEqual(before)
    expect(await store.read()).toMatchObject({ recordCount: 3 })
  })
  it('caches unchanged rollups by size and mtime and reloads a same-size replacement', async () => {
    const { store, fs, record, root } = await rig()
    store.append(record('2026-09-01'))
    await store.flush()
    await store.retain()
    const read = vi.spyOn(fs, 'read')
    await store.read()
    expect(read).toHaveBeenCalledTimes(1)
    await store.read()
    expect(read).toHaveBeenCalledTimes(1)
    const file = path.join(root, USAGE_JOURNAL_ROOT, 'rollups', '2026-09.json')
    const text = await readFile(file, 'utf8')
    await writeFile(file, text.replace('"input":100', '"input":101'))
    const updated = new Date(Date.now() + 1000)
    await utimes(file, updated, updated)
    expect(await store.read()).toMatchObject({ rollups: [{ tokens: { input: 101 } }] })
    expect(read).toHaveBeenCalledTimes(2)
  })
  it('survives a crash after atomic publication before raw deletion without counting twice', async () => {
    const { store, fs, record } = await rig()
    store.append(record('2026-09-04'))
    await store.flush()
    const remove = vi.spyOn(fs, 'remove').mockRejectedValueOnce(new Error('crash-after-rollup'))
    await expect(store.retain()).rejects.toThrow('crash-after-rollup')
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/days/2026-09-04`)).toHaveLength(1)
    const recovered = await store.read()
    expect(recovered.records).toHaveLength(0)
    expect(recovered.rollups[0]?.records).toBe(1)
    expect(recovered.recordCount).toBe(1)
    remove.mockRestore()
    await store.retain()
    expect(await store.read()).toMatchObject({ recordCount: 1 })
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/days/2026-09-04`)).toEqual([])
  })
  it('a crash before atomic publication retains raw data and recovers safely', async () => {
    const { store, fs, record } = await rig()
    store.append(record('2026-09-03'))
    await store.flush()
    const publish = vi
      .spyOn(fs, 'writeFileAtomically')
      .mockRejectedValueOnce(new Error('crash-before-publication'))
    await expect(store.retain()).rejects.toThrow('crash-before-publication')
    expect(await store.read()).toMatchObject({ records: [{ day: '2026-09-03' }] })
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/rollups`)).toEqual([])
    publish.mockRestore()
    await store.retain()
    expect(await store.read()).toMatchObject({ recordCount: 1 })
  })
  it('expires rollup rows by day, deletes old months and validates the setting', async () => {
    const { store, record, fs, root } = await rig()
    for (const day of ['2025-01-01', '2026-08-01', '2026-09-04', '2026-10-05'])
      store.append(record(day))
    await store.flush()
    await store.retain(365)
    expect(await store.read()).toMatchObject({ recordCount: 3 })
    await store.retain(40)
    expect(await store.read()).toMatchObject({ recordCount: 2 })
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/rollups`)).toEqual(['2026-09.json'])
    await store.retain(30)
    expect(await store.read()).toMatchObject({ recordCount: 1 })
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/rollups`)).toEqual([])
    expect(
      await readFile(
        path.join(root, USAGE_JOURNAL_ROOT, 'days', '2026-10-05', 'rollup.jsonl'),
        'utf8',
      ),
    ).toContain('2026-10-05')
    await expect(store.retain(29)).rejects.toThrow()
    await expect(store.retain(1826)).rejects.toThrow()
  })
  it('keeps torn, malformed and future raw days intact and reports future rollups', async () => {
    const { store, fs, record, root } = await rig()
    store.append(record('2026-09-01'))
    store.append(record('2026-09-02'))
    await store.flush()
    const bad = `${USAGE_JOURNAL_ROOT}/days/2026-09-01/rollup.jsonl`
    const future = `${USAGE_JOURNAL_ROOT}/days/2026-09-02/rollup.jsonl`
    await fs.append(bad, '{torn')
    await fs.append(future, '{"v":2}\n')
    const before = await readFile(path.join(root, bad))
    await store.retain()
    expect(await readFile(path.join(root, bad))).toEqual(before)
    expect(await store.read()).toMatchObject({ newerVersionRecords: 1 })
    await fs.writeFileAtomically(`${USAGE_JOURNAL_ROOT}/rollups/2026-08.json`, '{"v":2}\n')
    expect(await store.read()).toMatchObject({
      newerVersionRecords: 1,
      newerVersionFiles: 1,
      recordCount: 3,
    })
    expect(await store.read()).toMatchObject({
      newerVersionRecords: 1,
      newerVersionFiles: 1,
      recordCount: 3,
    })
    expect(await store.retain()).toBe(false)
  })
  it('refuses corrupt or mismatched rollups without deleting raw history', async () => {
    const { store, fs, record, root } = await rig()
    store.append(record('2026-09-01'))
    await store.flush()
    await fs.writeFileAtomically(
      `${USAGE_JOURNAL_ROOT}/rollups/2026-08.json`,
      '{"v":1,"month":"2026-08","days":[],"rows":[],"limits":[],"prompt":"privacy-canary"}',
    )
    await expect(store.read()).rejects.toThrow()
    await expect(store.retain()).rejects.toThrow()
    expect(await fs.list(`${USAGE_JOURNAL_ROOT}/days/2026-09-01`)).toHaveLength(1)
    await writeFile(
      path.join(root, USAGE_JOURNAL_ROOT, 'rollups', '2026-08.json'),
      '{"v":1,"month":"2026-07","days":[],"rows":[],"limits":[]}',
    )
    await expect(store.read()).rejects.toThrow('invalidRollupMonth')
    const row = rollupUsageRecords([record('2026-09-01')])[0]!
    for (const malformed of [
      { v: 1, month: '2026-08', days: ['2026-08-01'], rows: [row], limits: [] },
      { v: 1, month: '2026-08', days: ['2026-08-01', '2026-08-01'], rows: [], limits: [] },
      { v: 1, month: '2026-08', days: ['2026-09-01'], rows: [], limits: [] },
      {
        v: 1,
        month: '2026-08',
        days: ['2026-08-01'],
        rows: [{ ...row, day: '2026-08-01', latencyHistogram: [1] }],
        limits: [],
      },
    ]) {
      await fs.writeFileAtomically(
        `${USAGE_JOURNAL_ROOT}/rollups/2026-08.json`,
        JSON.stringify(malformed),
      )
      await expect(store.read()).rejects.toThrow()
    }
  })
  it('exclusive maintenance and reset refuse a held lock and release after errors', async () => {
    const { store, fs, record } = await rig()
    store.append(record('2026-09-01'))
    await store.flush()
    const held = await fs.acquireLock(
      `${USAGE_JOURNAL_ROOT}/rollup.lock`,
      USAGE_ROLLUP_LOCK_STALE_MS,
    )
    expect(await store.retain()).toBe(false)
    await expect(store.reset()).rejects.toThrow('usageLocked')
    await held?.release()
    const acquire = vi.spyOn(fs, 'acquireLock').mockResolvedValueOnce({
      token: 'lost-owner',
      generation: 1,
      isHeld: () => Promise.resolve(false),
      release: vi.fn().mockResolvedValue(undefined),
    })
    await expect(store.retain()).rejects.toThrow('usageLockLost')
    acquire.mockRestore()
    expect(await store.retain()).toBe(true)
  })
  it('keeps certainty dimensions, optional sums, units, snapshots and histogram percentiles', async () => {
    const { store, record } = await rig()
    const durations = [1, 125, 126, 250, 1000, 6000, 128_000, 256_000]
    const records = durations.map((durationMs, index) => ({
      ...record('2026-09-01', `latency-${String(index)}`),
      durationMs,
      retries: 2,
      rateLimited: true,
      packedAvoided: 5,
      units: { images: 1 },
    }))
    const rows = rollupUsageRecords(records)
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.records).toBe(8)
    expect(row.tokens).toEqual({ input: 800, output: 160 })
    expect(row.units.images).toBe(8)
    expect(row.cost).toEqual({ certainty: 'local', usd: 0 })
    expect(row.retries).toBe(16)
    expect(row.rateLimited).toBe(8)
    expect(row.packedAvoided).toBe(40)
    expect(row.latencyHistogram).toHaveLength(12)
    expect(row.latencyHistogram.reduce((a, b) => a + b, 0)).toBe(8)
    for (const percentile of [0.5, 0.95]) {
      const rank = Math.ceil(durations.length * percentile)
      let seen = 0
      const bucket = row.latencyHistogram.findIndex((count) => {
        seen += count
        return seen >= rank
      })
      const raw = durations.toSorted((a, b) => a - b)[rank - 1]!
      const lower = bucket === 0 ? 0 : USAGE_HISTOGRAM_EDGES_MS[bucket - 1]!
      const upper = USAGE_HISTOGRAM_EDGES_MS[bucket] ?? Infinity
      expect(raw).toBeGreaterThanOrEqual(lower)
      expect(raw).toBeLessThanOrEqual(upper)
    }
    const unknown = {
      ...record('2026-09-01', 'unknown'),
      tokens: {},
      durationMs: undefined,
      firstTokenMs: undefined,
      cost: { certainty: 'unpriced' },
    } satisfies UsageRecord
    expect(rollupUsageRecords([unknown])[0]).toMatchObject({
      tokens: {},
      units: {},
      cost: { certainty: 'unpriced' },
      durationSamples: 0,
      latencyHistogram: Array.from({ length: 12 }, () => 0),
    })
    for (const entry of [...records, unknown]) store.append(entry)
    store.append({
      v: 1,
      type: 'limit',
      id: 'snapshot',
      at: records[0]!.at,
      day: '2026-09-01',
      timezoneOffsetMins: 0,
      client: 'Zed',
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: records[0]!.at,
      windows: [],
    })
    await store.flush()
    await store.retain()
    const result = await store.read()
    expect(result.rollups).toHaveLength(2)
    expect(result.limits).toHaveLength(1)
    expect(result.recordCount).toBe(10)
  })
  it('keeps original days across DST and a timezone move', async () => {
    const { store, fs, record } = await rig()
    const originalTz = process.env['TZ']
    try {
      process.env['TZ'] = 'America/Los_Angeles'
      const dst = record('2026-03-08')
      store.append(dst)
      await store.flush()
      process.env['TZ'] = 'Asia/Tokyo'
      await store.retain()
      const result = await store.read()
      expect(result.rollups[0]?.day).toBe('2026-03-08')
      expect(await fs.list(`${USAGE_JOURNAL_ROOT}/days/2026-03-08`)).toEqual([])
    } finally {
      if (originalTz === undefined) delete process.env['TZ']
      else process.env['TZ'] = originalTz
    }
  })
})
