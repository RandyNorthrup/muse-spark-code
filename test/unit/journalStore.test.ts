import { mkdtemp, readFile, writeFile, mkdir, rm, stat, utimes, symlink } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fork } from 'node:child_process'
import { build } from 'esbuild'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UsageJournalStore, USAGE_JOURNAL_ROOT } from '../../src/core/usage/journalStore'
import { createUsageRecord } from '../../src/core/usage/journalRecord'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { USAGE_ROLLUP_LOCK_STALE_MS } from '../../src/shared/constants'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  roots.length = 0
})
async function rig() {
  const root = await mkdtemp(path.join(tmpdir(), 'm102-j-'))
  roots.push(root)
  const fs = new NodeUsageFs(root)
  const error = vi.fn()
  const now = new Date(2026, 9, 5, 12).getTime()
  const record = createUsageRecord(
    { input_tokens: 100, output_tokens: 20 },
    {
      id: 'test',
      at: now,
      startedAt: now - 50,
      client: 'cli',
      backend: 'modelApi',
      provider: 'test',
      model: 'unknown',
      kind: 'turn',
      outcome: 'completed',
    },
  )
  const store = new UsageJournalStore(fs, {
    writerId: 'test-writer',
    now: () => now,
    isEnabled: () => true,
    onWriteError: error,
  })
  return {
    root,
    fs,
    error,
    now,
    record,
    store,
    file: `${USAGE_JOURNAL_ROOT}/days/2026-10-05/test-writer.jsonl`,
  }
}

describe('usage journal store and Node filesystem', () => {
  it('queues one private file per writer/day and reads limit snapshots too', async () => {
    const { root, store, record, file } = await rig()
    store.append(record)
    store.append({
      v: 1,
      type: 'limit',
      id: 'limit',
      at: record.at,
      day: record.day,
      timezoneOffsetMins: 0,
      client: 'Zed',
      backend: 'museCode',
      provider: 'museCode',
      source: 'museCode',
      observedAt: record.at,
      windows: [],
    })
    await store.flush()
    const result = await store.read()
    expect(result.records).toEqual([record])
    expect(result.limits).toHaveLength(1)
    expect(result.recordCount).toBe(2)
    const text = await readFile(path.join(root, file), 'utf8')
    expect(text.trim().split('\n')).toHaveLength(2)
    const permissions = await stat(path.join(root, file))
    if (process.platform !== 'win32') expect(permissions.mode & 0o777).toBe(0o600)
  })
  it('history off writes no files and queued writes recheck the setting', async () => {
    const { fs, now, record } = await rig()
    let isEnabled = false
    const store = new UsageJournalStore(fs, {
      writerId: 'off',
      now: () => now,
      isEnabled: () => isEnabled,
      onWriteError: vi.fn(),
    })
    store.append(record)
    await store.flush()
    expect(await fs.list('usage')).toEqual([])
    isEnabled = true
    store.append(record)
    isEnabled = false
    await store.flush()
    expect(await fs.list('usage')).toEqual([])
  })
  it('swallows write failures and logs one fixed diagnostic without error content', async () => {
    const { fs, now, record } = await rig()
    const error = vi.fn()
    vi.spyOn(fs, 'append').mockRejectedValue(new Error('private-path-and-key-canary'))
    const store = new UsageJournalStore(fs, {
      writerId: 'errors',
      now: () => now,
      isEnabled: () => true,
      onWriteError: error,
    })
    expect(() => {
      store.append(record)
      store.append(record)
    }).not.toThrow()
    await expect(store.flush()).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledExactlyOnceWith('usageWriteFailed')
    const secondError = vi.fn()
    const second = new UsageJournalStore(fs, {
      writerId: 'second',
      now: () => now,
      isEnabled: () => true,
      onWriteError: secondError,
    })
    second.append(record)
    await second.flush()
    expect(secondError).not.toHaveBeenCalled()
    expect(JSON.stringify(error.mock.calls)).not.toContain('canary')
  })
  it('validates records before writing and never persists planted privacy canaries', async () => {
    const { store, fs, record } = await rig()
    store.append({
      ...record,
      prompt: 'prompt-canary',
      path: '/path-canary',
      keyDigest: 'digest-canary',
      toolArguments: 'arguments-canary',
    })
    await store.flush()
    expect(await fs.list('usage')).toEqual([])
    expect(
      () =>
        new UsageJournalStore(fs, {
          writerId: '../escape',
          now: Date.now,
          isEnabled: () => true,
          onWriteError: vi.fn(),
        }),
    ).toThrow()
  })
  it('contains normalisation and context failures so a settled model call cannot fail', async () => {
    const { store, record } = await rig()
    expect(() => {
      store.noteUsage({ input_tokens: -1 }, record)
    }).not.toThrow()
    expect(() => {
      store.noteUsage({ input_tokens: 100, output_tokens: 20 }, { ...record, model: '' })
    }).not.toThrow()
    await store.flush()
    expect(await store.read()).toMatchObject({ records: [], recordCount: 0 })
    store.noteUsage({ input_tokens: 100, output_tokens: 20 }, record)
    await store.flush()
    expect(await store.read()).toMatchObject({ records: [{ id: record.id }], recordCount: 1 })
  })
  it('tolerates and counts torn lines, malformed entries and newer versions', async () => {
    const { store, fs, record, file } = await rig()
    await fs.append(
      file,
      `${JSON.stringify(record)}\n{"v":2,"prompt":"future-canary"}\ninvalid-json\n{"v":1`,
    )
    const result = await store.read()
    expect(result.records).toEqual([record])
    expect(result.newerVersionRecords).toBe(1)
    expect(result.tornLines).toBe(1)
    expect(result.invalidLines).toBe(1)
    expect(JSON.stringify(result)).not.toContain('future-canary')
  })
  it('reads only appended bytes, completes a torn UTF-8 tail and reloads on replacement/truncation', async () => {
    const { store, fs, record, file, root } = await rig()
    const read = vi.spyOn(fs, 'read')
    const first = `${JSON.stringify(record)}\n`
    const next = `${JSON.stringify({ ...record, id: 'tail', client: 'Éditeur' })}\n`
    const encoded = Buffer.from(next)
    const split = encoded.indexOf(Buffer.from('É')) + 1
    await fs.append(file, first)
    // Replace the deliberately split byte fragment with actual UTF-8 bytes.
    await writeFile(
      path.join(root, file),
      Buffer.concat([Buffer.from(first), encoded.subarray(0, split)]),
    )
    const partial = await store.read()
    expect(partial.records).toHaveLength(1)
    expect(partial.tornLines).toBe(1)
    const firstStat = await fs.stat(file)
    expect(firstStat).toBeDefined()
    await writeFile(path.join(root, file), encoded.subarray(split), { flag: 'a' })
    const grown = await store.read()
    expect(grown.records).toHaveLength(2)
    expect(grown.records[1]?.client).toBe('Éditeur')
    expect(grown.tornLines).toBe(0)
    expect(read.mock.calls.at(-1)?.[1]).toBe(Buffer.byteLength(first))
    const count = read.mock.calls.length
    await store.read()
    expect(read).toHaveBeenCalledTimes(count)
    await writeFile(path.join(root, file), `${JSON.stringify({ ...record, id: 'replace' })}\n`)
    const changed = await store.read()
    expect(changed.records.map((entry) => entry.id)).toEqual(['replace'])
    expect(read.mock.calls.at(-1)?.[1]).toBe(0)
    await writeFile(path.join(root, file), `${JSON.stringify({ ...record, id: 'same-size' })}\n`)
    await store.read()
    await writeFile(path.join(root, file), `${JSON.stringify({ ...record, id: 'same-sizz' })}\n`)
    await utimes(path.join(root, file), new Date(), new Date(Date.now() + 1000))
    expect(await store.read()).toMatchObject({ records: [{ id: 'same-sizz' }] })
    expect(read.mock.calls.at(-1)?.[1]).toBe(0)
  })
  it('rejects oversized, invalid-day and invalid-UTF-8 records on read', async () => {
    const { store, fs, record, file, root } = await rig()
    await fs.append(
      file,
      `${JSON.stringify({ ...record, day: '2026-10-04' })}\n${'x'.repeat(4096)}\n`,
    )
    await writeFile(path.join(root, file), Buffer.from([0xff, 0x0a]), { flag: 'a' })
    await fs.append(file, `${JSON.stringify({ v: 2, padding: 'x'.repeat(4096) })}\n`)
    await writeFile(
      path.join(root, file),
      Buffer.concat([Buffer.from('{"v":2,"data":"'), Buffer.from([0xff]), Buffer.from('"}\n')]),
      { flag: 'a' },
    )
    const result = await store.read()
    expect(result.records).toEqual([])
    expect(result.invalidLines).toBe(5)
    expect(result.newerVersionRecords).toBe(0)
  })
  it('reset removes only usage and keeps budget ledgers and grants byte-identical', async () => {
    const { root, store, fs, record } = await rig()
    const siblings = ['budget-journal', 'paid-daily', 'tab-spend', 'paid-grants']
    for (const name of siblings) {
      await mkdir(path.join(root, name))
      await writeFile(path.join(root, name, 'proof'), `${name}\n`)
    }
    store.append(record)
    await store.flush()
    await store.reset()
    expect(await fs.list('usage')).toEqual([])
    expect(await store.read()).toMatchObject({ recordCount: 0 })
    for (const name of siblings)
      expect(await readFile(path.join(root, name, 'proof'), 'utf8')).toBe(`${name}\n`)
  })
  it('uses exclusive locks, recovers stale locks and never releases a successor', async () => {
    const { fs, root } = await rig()
    const file = `${USAGE_JOURNAL_ROOT}/rollup.lock`
    const first = await fs.acquireLock(file, USAGE_ROLLUP_LOCK_STALE_MS)
    expect(first).toBeDefined()
    expect(await fs.acquireLock(file, USAGE_ROLLUP_LOCK_STALE_MS)).toBeUndefined()
    const past = new Date(Date.now() - USAGE_ROLLUP_LOCK_STALE_MS - 1000)
    await utimes(path.join(root, file), past, past)
    const second = await fs.acquireLock(file, USAGE_ROLLUP_LOCK_STALE_MS)
    expect(second).toBeDefined()
    expect(await first?.isHeld()).toBe(false)
    await first?.release()
    expect(await second?.isHeld()).toBe(true)
    await second?.release()
    // A crash immediately after wx can leave an empty lock and marker.
    await fs.append(file, '')
    await utimes(path.join(root, file), past, past)
    const marker = `${file}.empty.reclaim`
    await fs.append(marker, '')
    expect(await fs.acquireLock(file, USAGE_ROLLUP_LOCK_STALE_MS)).toBeUndefined()
    await utimes(path.join(root, marker), past, past)
    const recovered = await fs.acquireLock(file, USAGE_ROLLUP_LOCK_STALE_MS)
    expect(recovered).toBeDefined()
    await recovered?.release()
  })
  it('confines all filesystem operations and refuses linked data folders', async () => {
    const { fs, root } = await rig()
    for (const relative of [
      '../budget-journal',
      'usage/../../paid-daily',
      'usage//v1',
      '/usage',
      'paid-daily',
    ])
      await expect(fs.remove(relative)).rejects.toThrow('invalidUsagePath')
    const outside = await mkdtemp(path.join(tmpdir(), 'm102-j-outside-'))
    roots.push(outside)
    await writeFile(path.join(outside, 'proof'), 'private-canary')
    await symlink(
      outside,
      path.join(root, 'usage'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(fs.append('usage/proof', 'overwrite')).rejects.toThrow('linkedUsagePath')
    await expect(fs.remove('usage')).rejects.toThrow('linkedUsagePath')
    expect(await readFile(path.join(outside, 'proof'), 'utf8')).toBe('private-canary')
  })
  it('scans 30 days × 2,000 calls warm within 300 ms without rereading bytes', async () => {
    const { store, fs, record } = await rig()
    const read = vi.spyOn(fs, 'read')
    for (let offset = 0; offset < 30; offset += 1) {
      const day = new Date(Date.parse('2026-10-05T00:00:00Z') - offset * 86_400_000)
        .toISOString()
        .slice(0, 10)
      const lines = Array.from({ length: 2000 }, (_, index) =>
        JSON.stringify({ ...record, id: `${day}-${String(index)}`, day }),
      ).join('\n')
      await fs.append(`${USAGE_JOURNAL_ROOT}/days/${day}/benchmark.jsonl`, `${lines}\n`)
    }
    const cold = await store.read()
    expect(cold.records).toHaveLength(60_000)
    const bytesReads = read.mock.calls.length
    const start = performance.now()
    const warm = await store.read()
    const elapsed = performance.now() - start
    expect(warm.records).toHaveLength(60_000)
    expect(read).toHaveBeenCalledTimes(bytesReads)
    expect(elapsed).toBeLessThanOrEqual(300)
  })
  it('keeps model completion independent of a held journal write and serialises queued appends', async () => {
    const { store, fs, record } = await rig()
    const held = Promise.withResolvers<undefined>()
    const append = vi.spyOn(fs, 'append').mockImplementationOnce(() => held.promise)
    store.append(record)
    store.append({ ...record, id: 'queued' })
    await Promise.resolve()
    await Promise.resolve()
    try {
      expect(append).toHaveBeenCalledTimes(1)
    } finally {
      held.resolve(undefined)
    }
    await store.flush()
    expect(append).toHaveBeenCalledTimes(2)
  })
  it('two child processes append 5,000 records each without losing or interleaving lines', async () => {
    const { root } = await rig()
    const worker = path.join(root, 'worker.cjs')
    await build({
      stdin: {
        contents: `import { UsageJournalStore } from './src/core/usage/journalStore'; import { createUsageRecord } from './src/core/usage/journalRecord'; import { NodeUsageFs } from './src/runtime/usage/nodeUsageFs'; async function run() { const id = process.argv[3]; const at = new Date(2026,9,5,12).getTime(); const store = new UsageJournalStore(new NodeUsageFs(process.argv[2]), { writerId: id, now: () => at, isEnabled: () => true, onWriteError: () => { throw new Error('write failure') } }); for (let i=0;i<5000;i++) store.append(createUsageRecord({ input_tokens: i, output_tokens: 1 }, { id: id+'-'+i, at, startedAt: at, client: id, backend: 'modelApi', provider: 'test', model: 'unpriced', kind: 'turn', outcome: 'completed' })); await store.flush(); } run().catch(() => { process.exitCode = 1 });`,
        resolveDir: process.cwd(),
        sourcefile: 'journal-worker.ts',
      },
      outfile: worker,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      logLevel: 'silent',
    })
    await Promise.all(
      ['child-a', 'child-b'].map(
        (id) =>
          new Promise<void>((resolve, reject) => {
            const child = fork(worker, [root, id], { stdio: 'ignore', env: {} })
            child.on('error', reject)
            child.on('exit', (code) => {
              if (code === 0) resolve()
              else reject(new Error(`writer exit ${String(code)}`))
            })
          }),
      ),
    )
    const store = new UsageJournalStore(new NodeUsageFs(root), {
      writerId: 'reader',
      now: Date.now,
      isEnabled: () => true,
      onWriteError: vi.fn(),
    })
    const result = await store.read()
    expect(result.records).toHaveLength(10_000)
    expect(result.invalidLines + result.tornLines).toBe(0)
    expect(new Set(result.records.map((record) => record.id)).size).toBe(10_000)
    for (const id of ['child-a', 'child-b']) {
      const records = result.records.filter((record) => record.client === id)
      expect(records.map((record) => record.tokens.input)).toEqual(
        Array.from({ length: 5000 }, (_, index) => index),
      )
      const text = await readFile(
        path.join(root, USAGE_JOURNAL_ROOT, 'days', '2026-10-05', `${id}.jsonl`),
        'utf8',
      )
      expect(text.trim().split('\n')).toHaveLength(5000)
    }
  })
})
