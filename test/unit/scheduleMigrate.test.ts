import { mkdtempSync, writeFileSync } from 'node:fs'
import { readFile, stat, utimes, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import { createScheduleStore } from '../../src/core/schedules/store'
import { migrateSchedules } from '../../src/core/schedules/migrate'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import {
  createFileScheduleStore,
  createFileScheduleMigrationSource,
} from '../../src/host/backend/fileScheduleStore'
import { SCHEDULE_MIN_INTERVAL_MS, SCHEDULE_CLAIM_RETENTION_MS } from '../../src/shared/constants'
import { scheduleV1ToV2 } from '../../src/shared/scheduleV2'
import { fakeV1Schedule } from './helpers/schedules/fixtures'
import { FakeLogOutputChannel } from './helpers/fakes'
import { removeFolder } from './helpers/temporaryFolders'

const root = mkdtempSync(path.join(tmpdir(), 'muse-m115-migration-'))
afterAll(() => removeFolder(root))

async function fixture(name: string) {
  const directory = path.join(root, name, 'v1')
  const job = {
    ...fakeV1Schedule(),
    fireCount: 0,
    expiresAtMs: fakeV1Schedule().createdAtMs + 100 * SCHEDULE_MIN_INTERVAL_MS,
  }
  const old = createFileScheduleStore({
    directory,
    now: () => job.createdAtMs,
    log: new FakeLogOutputChannel(),
  })
  await old.create(job)
  const store = createScheduleStore(createNodeScheduleFs(path.join(root, name, 'shared')))
  return { directory, job, old, store, source: createFileScheduleMigrationSource(directory) }
}

describe('M115 verified M52 migration', () => {
  it('copies and reopens a real M52 job with all fields preserved before removing it', async () => {
    const { job, directory, store, source, old } = await fixture('copy')
    expect(await migrateSchedules(source, store, 'workspace-1', 'America/Los_Angeles')).toBe(1)
    const list = await store.list('workspace-1')
    expect(list).toEqual([scheduleV1ToV2(job, 'workspace-1', 'America/Los_Angeles')])
    expect(list[0]).toMatchObject({
      paused: true,
      mode: 'manual',
      grant: { rules: [], destinationIds: [], paidCapUsd: 0 },
      paidCapUsd: 0,
    })
    expect(list[0]?.paidConsent).toBeUndefined()
    await expect(stat(path.join(directory, `${job.id}.json`))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await old.claim(job, job.nextFireAtMs)).toBe(false)
    expect(await readdir(directory)).toEqual([`${job.id}.json.migration`])
  })
  it('preserves the source and refuses old admission when destination verification fails', async () => {
    const { job, directory, store, source, old } = await fixture('verify')
    const before = await readFile(path.join(directory, `${job.id}.json`), 'utf8')
    const invalidReader = { ...store, list: () => Promise.resolve([]) }
    await expect(migrateSchedules(source, invalidReader, 'workspace-1', 'UTC')).rejects.toThrow(
      'VerificationFailed',
    )
    expect(await readFile(path.join(directory, `${job.id}.json`), 'utf8')).toBe(before)
    expect(await old.list(job.sessionId)).toEqual([])
    expect(await old.claim(job, job.nextFireAtMs)).toBe(false)
    // Retry after a process failure verifies the already copied record.
    expect(await migrateSchedules(source, store, 'workspace-1', 'UTC')).toBe(1)
  })
  it('retains source bytes if anything changes after the snapshot was copied', async () => {
    const { job, directory, store, source } = await fixture('changed')
    const wrapped = {
      ...source,
      async removeVerified(entry: Parameters<typeof source.removeVerified>[0]) {
        await writeFile(
          path.join(directory, `${job.id}.json`),
          JSON.stringify({ ...job, prompt: 'Changed' }),
        )
        await source.removeVerified(entry)
      },
    }
    await expect(migrateSchedules(wrapped, store, 'workspace-1', 'UTC')).rejects.toThrow(
      'SourceChanged',
    )
    expect(
      JSON.parse(await readFile(path.join(directory, `${job.id}.json`), 'utf8')),
    ).toMatchObject({ prompt: 'Changed' })
  })
  it('carries empty, corrupt and invalid crash receipts into permanent v2 replay fences', async () => {
    for (const [index, content] of ['', '{', '{"admittedAtMs":"invalid"}'].entries()) {
      const { job, directory, store, source } = await fixture(`crash-${String(index)}`)
      const receipt = path.join(directory, `${job.id}.${String(job.nextFireAtMs)}.claim`)
      await writeFile(receipt, content)
      const admission = (job.createdAtMs + 2 * SCHEDULE_MIN_INTERVAL_MS + 0.5) / 1000
      await utimes(receipt, admission, admission)
      const meta = await stat(receipt)
      await migrateSchedules(source, store, 'workspace-1', 'UTC')
      const [migrated] = await store.list('workspace-1')
      expect(migrated).toMatchObject({
        fireCount: 1,
        lastFireAtMs: job.nextFireAtMs,
        nextFireAtMs: Math.ceil(meta.mtimeMs + SCHEDULE_MIN_INTERVAL_MS),
      })
      expect(migrated?.trigger).toEqual({
        kind: 'interval',
        everyMs: SCHEDULE_MIN_INTERVAL_MS,
        anchorMs: migrated?.nextFireAtMs,
      })
      expect(await store.claim(`${job.id}:${String(job.nextFireAtMs)}`)).toBe(false)
      expect(await readFile(receipt, 'utf8')).toBe(content)
      const after = await stat(receipt)
      expect(after.mtimeMs).toBe(meta.mtimeMs)
    }
  })
  it('preserves nonzero old counters and refuses to restore stale migrated authority', async () => {
    const { job, directory, store, source } = await fixture('authority')
    const counted = { ...job, fireCount: 2 }
    await writeFile(path.join(directory, `${job.id}.json`), JSON.stringify(counted))
    const original = scheduleV1ToV2(counted, 'workspace-1', 'UTC')
    await store.create(original)
    await store.update({
      ...original,
      grant: {
        rules: [{ id: 'read', kind: 'tool', name: 'read_file' }],
        destinationIds: [],
        paidCapUsd: 0,
      },
    })
    await expect(migrateSchedules(source, store, 'workspace-1', 'UTC')).rejects.toThrow(
      'VerificationFailed',
    )
    const list = await store.list('workspace-1')
    expect(list[0]?.fireCount).toBe(2)
    expect(list[0]?.grant.rules).toHaveLength(1)
    expect(await stat(path.join(directory, `${job.id}.json`))).toBeDefined()
  })
  it('leaves malformed source records intact and never invents a successful migration', async () => {
    const { job, directory, store, source } = await fixture('invalid')
    await writeFile(path.join(directory, `${job.id}.json`), 'private phrase')
    await expect(migrateSchedules(source, store, 'workspace-1', 'UTC')).rejects.toThrow(
      'scheduleStoredJsonInvalid',
    )
    expect(await readFile(path.join(directory, `${job.id}.json`), 'utf8')).toBe('private phrase')
    expect(await store.list('workspace-1')).toEqual([])
  })
  it('burns a raced v1 receipt but refuses its send when migration seals during admission', async () => {
    const { directory, job } = await fixture('seal-race')
    let calls = 0
    const old = createFileScheduleStore({
      directory,
      log: new FakeLogOutputChannel(),
      now: () => {
        calls += 1
        if (calls === 2) writeFileSync(path.join(directory, `${job.id}.json.migration`), '')
        return job.createdAtMs
      },
    })
    expect(await old.claim(job, job.nextFireAtMs)).toBe(false)
    expect(
      await stat(path.join(directory, `${job.id}.${String(job.nextFireAtMs)}.claim`)),
    ).toBeDefined()
  })
  it('keeps sealed sources and old receipts intact despite v1 expiry and cleanup', async () => {
    const { directory, job, source } = await fixture('sealed-cleanup')
    const receipt = path.join(directory, `${job.id}.${String(job.nextFireAtMs)}.claim`)
    const content = JSON.stringify({ admittedAtMs: job.createdAtMs })
    await writeFile(receipt, content)
    await utimes(receipt, job.createdAtMs / 1000, job.createdAtMs / 1000)
    await source.freeze()
    const old = createFileScheduleStore({
      directory,
      log: new FakeLogOutputChannel(),
      now: () => job.createdAtMs + SCHEDULE_CLAIM_RETENTION_MS + SCHEDULE_MIN_INTERVAL_MS,
    })
    expect(await old.list(job.sessionId)).toEqual([])
    expect(await readFile(receipt, 'utf8')).toBe(content)
    expect(await stat(path.join(directory, `${job.id}.json`))).toBeDefined()
  })
})
