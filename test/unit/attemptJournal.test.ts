import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import type * as FileSystem from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AttemptJournal, type DeviceOutcome } from '../../src/core/devices/attemptJournal'
import { deviceJournalRecordSchema } from '../../src/shared/devices'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  useExecutionFixture,
  executionProtection,
  executionUsage,
  signedDispatch,
} from './helpers/deviceExecutionFixtures'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FileSystem>()
  return { ...fs, open: vi.fn(fs.open), rename: vi.fn(fs.rename), lstat: vi.fn(fs.lstat) }
})
const fixture = useExecutionFixture('check')
async function retire() {
  const { journal, request } = fixture()
  await journal.admit(request, executionUsage, Date.now())
  return await journal.advance(
    request.identity,
    (row) => ({
      ...row,
      revision: row.revision + 1,
      state: 'retired',
      occupied: {
        workers: 0,
        processes: 0,
        heavyChecks: 0,
        tokens: 0,
        spendUsd: 0,
        artifactBytes: 0,
      },
    }),
    Date.now(),
  )
}

describe('durable attempt ownership', () => {
  it('persists source intent and hashes validated payload independent of key order', async () => {
    const { journal, request, directory, owner } = fixture()
    const first = await journal.sourceIntent(request, 100)
    const reordered = signedDispatch({
      ...request,
      snapshot: {
        tree: request.snapshot.tree,
        manifestDigest: request.snapshot.manifestDigest,
        baseCommit: request.snapshot.baseCommit,
      },
    })
    expect(reordered.payloadDigest).toBe(request.payloadDigest)
    expect(await journal.sourceIntent(reordered, 100 + 1)).toEqual(first)
    const restored = await AttemptJournal.open(directory, owner, executionProtection)
    expect(await restored.lookup(request.identity)).toEqual(first)
  })
  it('serializes duplicate admission and rejects changed payload or tuple under an attempt id', async () => {
    const { journal, request } = fixture()
    await expect(
      journal.admit({ ...request, payloadDigest: '0'.repeat(64) }, executionUsage, Date.now()),
    ).rejects.toThrow('payload-changed')
    const replies = await Promise.all([
      journal.admit(request, executionUsage, Date.now()),
      journal.admit(request, executionUsage, Date.now()),
    ])
    expect(replies[0]).toEqual(replies[1])
    expect(await journal.records()).toHaveLength(1)
    await expect(
      journal.admit(signedDispatch({ ...request, mode: 'auto' }), executionUsage, Date.now()),
    ).rejects.toThrow('payload-changed')
    await expect(
      journal.lookup({ ...request.identity, receiverIncarnationId: 'f'.repeat(32) }),
    ).rejects.toThrow('payload-changed')
    await expect(
      journal.admit({ ...request, payloadDigest: '0'.repeat(64) }, executionUsage, Date.now()),
    ).rejects.toThrow('payload-changed')
  })
  it('requires monotonic revisions, immutable identity/digest/settlement and one launch intent', async () => {
    const { journal, request } = fixture()
    await journal.admit(request, executionUsage, Date.now())
    await expect(
      journal.advance(
        request.identity,
        (row) => ({ ...row, state: 'running', revision: row.revision + 1 }),
        Date.now(),
      ),
    ).rejects.toThrow('uncertain')
    const invalidChanges: ((row: DeviceOutcome) => Partial<DeviceOutcome>)[] = [
      (row) => ({ usage: { ...row.usage, settlementId: 'f'.repeat(32) } }),
      (row) => ({ revision: row.revision }),
      (row) => ({ identity: { ...row.identity, boardId: 'f'.repeat(32) } }),
      () => ({ payloadDigest: '0'.repeat(64) }),
      (row) => ({ occupied: { ...row.occupied, workers: 0 } }),
      (row) => ({ usage: { ...row.usage, retainedLiabilityUsd: 0 } }),
    ]
    for (const change of invalidChanges) {
      await expect(
        journal.advance(
          request.identity,
          (row) => ({ ...row, state: 'uncertain', revision: row.revision + 1, ...change(row) }),
          Date.now(),
        ),
      ).rejects.toThrow('uncertain')
    }
    await journal.advance(
      request.identity,
      (row) => ({ ...row, state: 'launch-intent', revision: row.revision + 1 }),
      Date.now(),
    )
    await expect(
      journal.advance(
        request.identity,
        (row) => ({ ...row, state: 'launch-intent', revision: row.revision + 1 }),
        Date.now(),
      ),
    ).rejects.toThrow('uncertain')
  })
  it('retains full outcomes until acknowledged and keeps permanent settlement tombstones', async () => {
    const { journal, request, directory, owner } = fixture()
    const terminal = await retire()
    const future = Date.now() + DEVICE_LIMITS.terminalRetentionMs * 2
    await journal.compact(future)
    expect(await journal.lookup(request.identity)).toMatchObject({
      kind: 'receiver-record',
      outcome: terminal,
    })
    await expect(
      journal.acknowledge(request.identity, request.payloadDigest, 'f'.repeat(32)),
    ).rejects.toThrow('payload-changed')
    await expect(
      journal.acknowledge(request.identity, '0'.repeat(64), terminal.usage.settlementId),
    ).rejects.toThrow('payload-changed')
    await journal.acknowledge(request.identity, request.payloadDigest, terminal.usage.settlementId)
    await journal.acknowledge(request.identity, request.payloadDigest, terminal.usage.settlementId)
    await journal.compact(Date.now())
    expect(await journal.lookup(request.identity)).toMatchObject({ kind: 'receiver-record' })
    await journal.compact(future)
    const row = await journal.lookup(request.identity)
    expect(row).toMatchObject({
      kind: 'tombstone',
      identity: request.identity,
      usage: executionUsage,
      revision: terminal.revision,
      outcomeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const restored = await AttemptJournal.open(directory, owner, executionProtection)
    expect(await restored.admit(request, executionUsage, future)).toEqual(row)
    await restored.acknowledge(request.identity, request.payloadDigest, terminal.usage.settlementId)
    expect(await restored.lookup(request.identity)).toEqual(row)
  })
  it('never acknowledges unresolved work or ages out occupancy and liability', async () => {
    const { journal, request } = fixture()
    const record = await journal.admit(request, executionUsage, Date.now())
    await expect(
      journal.acknowledge(request.identity, request.payloadDigest, executionUsage.settlementId),
    ).rejects.toThrow('uncertain')
    await journal.compact(Date.now() + DEVICE_LIMITS.terminalRetentionMs * 100)
    expect(await journal.lookup(request.identity)).toEqual(record)
  })
  it('stops admissions at the unresolved cap without deleting any old attempt', async () => {
    const { journal, request, directory, owner } = fixture()
    const records = Array.from({ length: DEVICE_LIMITS.unresolvedAttempts }, (_, index) => ({
      kind: 'receiver-record',
      recordedAt: 0,
      outcome: {
        identity: { ...request.identity, attemptId: index.toString(16).padStart(32, '0') },
        payloadDigest: request.payloadDigest,
        revision: 1,
        state: 'uncertain',
        occupied: request.caps,
        usage: { ...executionUsage, settlementId: index.toString(16).padStart(32, '0') },
      },
    }))
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({
        version: 1,
        records: records.map((row) => deviceJournalRecordSchema.parse(row)),
        acknowledgements: [],
      }),
    )
    const restored = await AttemptJournal.open(directory, owner, executionProtection)
    await expect(restored.admit(request, executionUsage, Date.now())).rejects.toThrow('capacity')
    expect(await restored.records()).toHaveLength(DEVICE_LIMITS.unresolvedAttempts)
    expect(await journal.lookup(request.identity)).toBeUndefined()
  })
  it.each([
    '',
    '{',
    '{"version":99}',
    '{"version":1,"version":1}',
    '{"version":1,"version":1,"records":[],"acknowledgements":[]}',
    'missing',
  ])('refuses damaged state %s and never creates an empty journal', async (damage) => {
    const { directory, owner, journal, request } = fixture()
    const file = path.join(directory, 'attempts.json')
    await journal.admit(request, executionUsage, Date.now())
    if (damage === 'missing') await rm(file)
    else await writeFile(file, damage)
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      /^storage$/,
    )
    await expect(AttemptJournal.create(directory, owner, executionProtection)).rejects.toThrow(
      /^storage$/,
    )
    if (damage !== 'missing') expect(await readFile(file, 'utf8')).toBe(damage)
  })
  it('refuses stage remnants, duplicate records and unknown private fields', async () => {
    const { directory, owner, journal, request } = fixture()
    await journal.admit(request, executionUsage, Date.now())
    const rows = await journal.records()
    const file = path.join(directory, 'attempts.json')
    await writeFile(
      file,
      JSON.stringify({ version: 1, records: [...rows, ...rows], acknowledgements: [] }),
    )
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        records: rows,
        acknowledgements: [],
        providerSecret: 'synthetic-extra-field',
      }),
    )
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
    await writeFile(file, JSON.stringify({ version: 1, records: rows, acknowledgements: [] }))
    await writeFile(path.join(directory, '.abandoned.stage'), '{}')
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
  })
  it('refuses directory loss and does not reset replay evidence after logout/runtime cleanup', async () => {
    const { directory, parent, journal, request, owner } = fixture()
    await journal.admit(request, executionUsage, Date.now())
    await rm(directory, { recursive: true })
    await expect(journal.lookup(request.identity)).rejects.toThrow('storage')
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
    await expect(AttemptJournal.create(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
    expect(await readFile(path.join(parent, '.durable.initialized'), 'utf8')).toBe('1')
  })
  it('latches unwritable, failed flush and failed replacement state with no success reset', async () => {
    const { journal, request } = fixture()
    vi.mocked(rename).mockRejectedValueOnce(new Error('synthetic write failure'))
    await expect(journal.admit(request, executionUsage, Date.now())).rejects.toThrow(/^storage$/)
    await expect(journal.lookup(request.identity)).rejects.toThrow(/^storage$/)
  })
  it('refuses missing exclusive ownership and unsafe Windows ACL/durability bindings', async () => {
    const { directory, owner } = fixture()
    owner.assertOwner.mockRejectedValueOnce(new Error('not owner'))
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
    await expect(
      AttemptJournal.open(directory, owner, {
        assertPrivate: () => Promise.resolve(),
        assertSafeAncestor: () => Promise.reject(new Error('unsafe ancestor')),
        syncDirectory: () => Promise.resolve(),
      }),
    ).rejects.toThrow('storage')
    vi.stubGlobal('process', { ...process, platform: 'win32' })
    await expect(AttemptJournal.open(directory, owner)).rejects.toThrow('storage')
    await expect(
      AttemptJournal.open(directory, owner, {
        assertPrivate: () => Promise.reject(new Error('ACL')),
        assertSafeAncestor: () => Promise.resolve(),
        syncDirectory: () => Promise.resolve(),
      }),
    ).rejects.toThrow('storage')
  })
  it('refuses symlink/hardlink/ancestor and native file substitution before using terminal data', async () => {
    const { directory, journal, request, owner, parent } = fixture()
    await retire()
    const file = path.join(directory, 'attempts.json')
    const replacement = path.join(parent, 'forged.json')
    await writeFile(replacement, await readFile(file), { mode: 0o600 })
    await rename(replacement, file)
    await expect(journal.lookup(request.identity)).rejects.toThrow('storage')
    const restored = await AttemptJournal.open(directory, owner, executionProtection)
    await link(file, path.join(parent, 'hardlink.json'))
    await expect(restored.lookup(request.identity)).rejects.toThrow('storage')
    await rm(path.join(parent, 'hardlink.json'))
    const alias = path.join(parent, 'alias')
    await symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(AttemptJournal.open(alias, owner, executionProtection)).rejects.toThrow('storage')
  })
  it('refuses broad directory/file permissions and unsafe ancestors', async () => {
    const { directory, owner, parent } = fixture()
    if (process.platform === 'win32') {
      await expect(
        AttemptJournal.open(directory, owner, {
          assertPrivate: () => Promise.reject(new Error('unsafe ACL')),
          assertSafeAncestor: () => Promise.resolve(),
          syncDirectory: () => Promise.resolve(),
        }),
      ).rejects.toThrow('storage')
      return
    }
    await chmod(path.join(directory, 'attempts.json'), 0o644)
    await expect(AttemptJournal.open(directory, owner)).rejects.toThrow('storage')
    await chmod(path.join(directory, 'attempts.json'), 0o600)
    await chmod(directory, 0o755)
    await expect(AttemptJournal.open(directory, owner)).rejects.toThrow('storage')
    await chmod(directory, 0o700)
    await chmod(parent, 0o777)
    await expect(AttemptJournal.open(directory, owner)).rejects.toThrow('storage')
    await chmod(parent, 0o700)
  })
  it('flushes admission and launch files before atomic replacement and directory flush', async () => {
    const { journal, request } = fixture()
    const events: string[] = []
    vi.mocked(open).mockImplementation(async (...args) => {
      const fs = await vi.importActual<typeof FileSystem>('node:fs/promises')
      const handle = await fs.open(...args)
      if (String(args[0]).replaceAll('\\', '/').endsWith('.stage')) {
        const fsync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          events.push('file-flush')
          await fsync()
        })
      }
      if (String(args[0]).replaceAll('\\', '/').endsWith('/durable')) {
        const directorySync = handle.sync.bind(handle)
        vi.spyOn(handle, 'sync').mockImplementation(async () => {
          events.push('directory-flush')
          await directorySync()
        })
      }
      return handle
    })
    vi.mocked(rename).mockImplementation(async (...args) => {
      events.push('replace')
      const fs = await vi.importActual<typeof FileSystem>('node:fs/promises')
      await fs.rename(...args)
    })
    await journal.admit(request, executionUsage, Date.now())
    expect(events).toEqual(['file-flush', 'replace', 'directory-flush'])
  })
  it('refuses duplicate settlement ids and corrupt acknowledgement bindings', async () => {
    const { journal, request, directory, owner } = fixture()
    await journal.admit(request, executionUsage, Date.now())
    const second = signedDispatch({
      ...request,
      identity: { ...request.identity, attemptId: '0'.repeat(32) },
    })
    await expect(journal.admit(second, executionUsage, Date.now())).rejects.toThrow('storage')
    const rows = await AttemptJournal.open(directory, owner, executionProtection)
    const records = await rows.records()
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({
        version: 1,
        records,
        acknowledgements: [{ attemptId: request.identity.attemptId, recordedAt: 0 }],
      }),
    )
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
  })
  it('refuses an oversized journal before reading its advertised bytes', async () => {
    const { directory, owner } = fixture()
    const file = path.join(directory, 'attempts.json')
    const handle = await open(file, 'r+')
    await handle.truncate(DEVICE_LIMITS.journalBytes + 1)
    await handle.close()
    vi.mocked(open).mockClear()
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
    expect(open).not.toHaveBeenCalled()
  })
  it('blocks further admissions when full terminal retention is exhausted', async () => {
    const { request, directory, owner } = fixture()
    const records = Array.from({ length: DEVICE_LIMITS.terminalRecords }, (_, index) =>
      deviceJournalRecordSchema.parse({
        kind: 'receiver-record',
        outcome: {
          identity: { ...request.identity, attemptId: index.toString(16).padStart(32, '0') },
          payloadDigest: request.payloadDigest,
          revision: 1,
          state: 'retired',
          occupied: {
            workers: 0,
            processes: 0,
            heavyChecks: 0,
            tokens: 0,
            spendUsd: 0,
            artifactBytes: 0,
          },
          usage: { ...executionUsage, settlementId: index.toString(16).padStart(32, '0') },
        },
        recordedAt: 0,
      }),
    )
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({ version: 1, records, acknowledgements: [] }),
    )
    const restored = await AttemptJournal.open(directory, owner, executionProtection)
    await expect(restored.admit(request, executionUsage, Date.now())).rejects.toThrow('capacity')
    expect(await restored.records()).toHaveLength(DEVICE_LIMITS.terminalRecords)
  })
  it('refuses wrong-owner terminal data and replacement of the authoritative directory', async () => {
    const { directory, owner, journal, request } = fixture()
    await retire()
    if (process.platform !== 'win32') {
      const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
      for (const target of [path.join(directory, 'attempts.json'), path.dirname(directory)]) {
        vi.mocked(lstat).mockImplementation(async (...args) => {
          const sample = await actual.lstat(...args)
          if (String(args[0]).replaceAll('\\', '/') === target.replaceAll('\\', '/'))
            Object.defineProperty(sample, 'uid', {
              value: 1n + BigInt(typeof process.getuid === 'function' ? process.getuid() : 0),
            })
          return sample
        })
        await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
          'storage',
        )
      }
      vi.mocked(lstat).mockImplementation(actual.lstat)
    }
    await rename(directory, `${directory}-original`)
    await mkdir(directory, { mode: 0o700 })
    await rename(
      path.join(`${directory}-original`, 'attempts.json'),
      path.join(directory, 'attempts.json'),
    )
    await expect(journal.lookup(request.identity)).rejects.toThrow('storage')
  })
  it('rejects a durable source intent whose payload no longer matches its digest', async () => {
    const { journal, request, directory, owner } = fixture()
    await journal.sourceIntent(request, Date.now())
    const record = await journal.lookup(request.identity)
    if (record?.kind !== 'source-intent') throw new Error('missing source intent')
    record.dispatch.mode = 'auto'
    await writeFile(
      path.join(directory, 'attempts.json'),
      JSON.stringify({ version: 1, records: [record], acknowledgements: [] }),
    )
    await expect(AttemptJournal.open(directory, owner, executionProtection)).rejects.toThrow(
      'storage',
    )
  })
  it('settles source intent once, retains its replay evidence and cannot settle receiver-owned work', async () => {
    const { journal, request } = fixture()
    await journal.sourceIntent(request, Date.now())
    const outcome = {
      identity: request.identity,
      payloadDigest: request.payloadDigest,
      revision: 2,
      state: 'retired',
      occupied: {
        workers: 0,
        processes: 0,
        heavyChecks: 0,
        tokens: 0,
        spendUsd: 0,
        artifactBytes: 0,
      },
      usage: executionUsage,
    } as const
    await expect(
      journal.settleSource({ ...outcome, state: 'uncertain', occupied: request.caps }, Date.now()),
    ).rejects.toThrow('uncertain')
    await expect(
      journal.settleSource({ ...outcome, payloadDigest: '0'.repeat(64) }, Date.now()),
    ).rejects.toThrow('payload-changed')
    const stored = await journal.settleSource(outcome, Date.now())
    expect(await journal.settleSource(outcome, Date.now())).toEqual(stored)
    await expect(journal.settleSource({ ...outcome, revision: 1 }, Date.now())).rejects.toThrow(
      'uncertain',
    )
    await expect(
      journal.settleSource(
        { ...outcome, usage: { ...executionUsage, returnedUsd: 1 } },
        Date.now(),
      ),
    ).rejects.toThrow('uncertain')
    await journal.acknowledge(request.identity, request.payloadDigest, executionUsage.settlementId)
    await journal.compact(Date.now() + DEVICE_LIMITS.terminalRetentionMs * 2)
    expect(await journal.settleSource(outcome, Date.now())).toMatchObject({ kind: 'tombstone' })
    const local = signedDispatch({
      ...request,
      identity: { ...request.identity, attemptId: '0'.repeat(32) },
    })
    await journal.admit(local, { ...executionUsage, settlementId: '0'.repeat(32) }, Date.now())
    await expect(
      journal.settleSource(
        {
          ...outcome,
          identity: local.identity,
          payloadDigest: local.payloadDigest,
          usage: { ...executionUsage, settlementId: '0'.repeat(32) },
        },
        Date.now(),
      ),
    ).rejects.toThrow('uncertain')
    expect(await journal.lookup(local.identity)).toMatchObject({
      outcome: { state: 'admitted', occupied: local.caps },
    })
  })
})
