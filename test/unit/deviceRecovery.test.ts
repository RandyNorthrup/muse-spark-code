import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import type * as FileSystem from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { AttemptJournal } from '../../src/core/devices/attemptJournal'
import { DeviceReceiver } from '../../src/host/devices/deviceReceiver'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import type { DeviceChannel } from '../../src/host/devices/deviceChannel'
import type { DeviceFrame } from '../../src/shared/devices'
import {
  deferred,
  useExecutionFixture,
  responseBody,
  reconciledBody,
  executionProtection,
  executionUsage,
  signedDispatch,
} from './helpers/deviceExecutionFixtures'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof FileSystem>()
  return { ...fs, open: vi.fn(fs.open) }
})
const fixture = useExecutionFixture('check', async () => {
  const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
  vi.mocked(open).mockImplementation(actual.open)
})
function cancellationIds(count: number) {
  const { request } = fixture()
  return Array.from({ length: count }, (_, index) => ({
    ...request.identity,
    attemptId: index.toString(16).padStart(DEVICE_LIMITS.idChars, '0'),
  }))
}
async function restart(incarnation = 'f'.repeat(32)) {
  const { directory, owner, execution, policy } = fixture()
  const journal = await AttemptJournal.open(directory, owner, executionProtection)
  const receiver = await DeviceReceiver.open(incarnation, journal, execution, policy)
  return { receiver, journal }
}
async function terminal() {
  const { receiver, request, retirement, lease } = fixture()
  await receiver.dispatch(request)
  retirement.resolve({
    usage: { ...executionUsage, certainty: 'known', retainedLiabilityUsd: 0, returnedUsd: 1 },
  })
  await vi.waitFor(() => {
    expect(lease.release).toHaveBeenCalledOnce()
  })
}
function transport(incarnation: string): DeviceChannel {
  return {
    pairId: fixture().request.identity.pairId,
    receiverIncarnationId: incarnation,
    isReceiver: true,
    send: vi.fn(),
    close: vi.fn(),
  }
}
function envelope(incarnation: string, body: DeviceFrame['body']): DeviceFrame {
  return {
    version: 1,
    pairId: fixture().request.identity.pairId,
    receiverIncarnationId: incarnation,
    requestId: '0'.repeat(32),
    body,
  }
}

describe('receiver restart and ownership reconciliation', () => {
  it.each(['cancel', 'pause'])(
    'RVM100E2-P2-4 delivers Stop at full memory tombstones and keeps capacity latched after %s failure and retirement',
    async (failure) => {
      const { journal, request, execution, policy, lease, retirement } = fixture()
      vi.spyOn(journal, 'cancellations').mockResolvedValueOnce(
        cancellationIds(DEVICE_LIMITS.tombstones - 1),
      )
      const receiver = await DeviceReceiver.open(
        request.identity.receiverIncarnationId,
        journal,
        execution,
        policy,
      )
      receiver.resumeQueue()
      await receiver.dispatch(request)
      await receiver.cancel({ ...request.identity, attemptId: 'f'.repeat(32) })
      expect(receiver.blockedReason).toBe('capacity')
      const fresh = signedDispatch({
        ...request,
        identity: { ...request.identity, attemptId: '1'.repeat(32) },
      })
      expect(await responseBody(receiver.dispatch(fresh))).toEqual({
        kind: 'failure',
        reason: 'reconcile-required',
      })
      if (failure === 'cancel')
        lease.cancel.mockRejectedValueOnce(new Error('unproved cancellation at full tombstones'))
      else {
        lease.pause.mockRejectedValueOnce(new Error('unproved pause at full tombstones'))
        receiver.disconnect()
      }
      await expect(receiver.cancel(request.identity)).rejects.toThrow('capacity')
      expect(lease.cancel).toHaveBeenCalledOnce()
      retirement.resolve({ usage: executionUsage })
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledOnce()
      })
      expect(receiver.blockedReason).toBe('capacity')
      await receiver.reconcile([request.identity])
      expect(() => {
        receiver.resumeQueue()
      }).toThrow('uncertain')
    },
  )
  it('RVM100E2-P2-4 restores the capacity latch when cancellation evidence is full', async () => {
    const { journal, request, execution, policy } = fixture()
    vi.spyOn(journal, 'cancellations').mockResolvedValueOnce(
      cancellationIds(DEVICE_LIMITS.tombstones),
    )
    const receiver = await DeviceReceiver.open(
      request.identity.receiverIncarnationId,
      journal,
      execution,
      policy,
    )
    expect(receiver.blockedReason).toBe('capacity')
    expect(() => {
      receiver.resumeQueue()
    }).toThrow('uncertain')
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'reconcile-required',
    })
    expect(execution.admit).not.toHaveBeenCalled()
  })
  it('RVM100E2-P2-4 keeps cancel-before-admission tombstones across compaction and reopen', async () => {
    const { receiver, request, journal, execution, lease } = fixture()
    await receiver.cancel(request.identity)
    await journal.compact(Date.now() + DEVICE_LIMITS.terminalRetentionMs * 100)
    const reopened = await restart(request.identity.receiverIncarnationId)
    reopened.receiver.resumeQueue()
    expect(await responseBody(reopened.receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'grant',
    })
    expect(await reopened.journal.cancellations()).toEqual([request.identity])
    expect(
      await responseBody(
        reopened.receiver.dispatch(
          signedDispatch({
            ...request,
            identity: { ...request.identity, taskId: '0'.repeat(32) },
          }),
        ),
      ),
    ).toEqual({ kind: 'failure', reason: 'payload-changed' })
    expect(execution.admit).not.toHaveBeenCalled()
    expect(lease.start).not.toHaveBeenCalled()
  })
  it.each(['resolve', 'reject'])(
    'RVM100E2-P2-3 ignores a late cancel %s confirmation after complete retirement',
    async (completion) => {
      const { receiver, request, lease, retirement, journal } = fixture()
      await receiver.dispatch(request)
      const confirmation = deferred<undefined>()
      lease.cancel.mockReturnValueOnce(confirmation.promise)
      const cancel = receiver.cancel(request.identity)
      retirement.resolve({ usage: executionUsage })
      await vi.waitFor(() => {
        expect(lease.release).toHaveBeenCalledOnce()
      })
      if (completion === 'resolve') confirmation.resolve(undefined)
      else confirmation.reject(new Error('stale cancel rejection'))
      await expect(cancel).resolves.toBeUndefined()
      expect(receiver.blockedReason).toBeUndefined()
      expect(await journal.lookup(request.identity)).toMatchObject({
        outcome: { state: 'retired' },
      })
      await receiver.reconcile([request.identity])
      receiver.resumeQueue()
      expect(receiver.paused).toBe(false)
    },
  )
  it.each(['flush-failure', 'file-loss', 'corruption'])(
    'RVM100E-P2-1 cancels live work despite journal %s and keeps occupancy',
    async (damage) => {
      const { receiver, request, directory, lease, fixture: counts } = fixture()
      const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
      if (damage === 'flush-failure') {
        let stages = 0
        vi.mocked(open).mockImplementation(async (...args) => {
          const handle = await actual.open(...args)
          if (String(args[0]).replaceAll('\\', '/').endsWith('.stage') && ++stages === 3)
            vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('synthetic flush failure'))
          return handle
        })
      }
      await receiver.dispatch(request)
      expect(counts.launches).toBe(1)
      if (damage === 'file-loss') await rm(path.join(directory, 'attempts.json'))
      else if (damage === 'corruption') await writeFile(path.join(directory, 'attempts.json'), '{}')
      await expect(receiver.cancel(request.identity)).rejects.toThrow('storage')
      expect(lease.cancel).toHaveBeenCalledOnce()
      expect(lease.release).not.toHaveBeenCalled()
      expect(counts.occupied).toBe(1)
      expect(receiver.blockedReason).toBe('storage')
      expect(await responseBody(receiver.dispatch(request))).toEqual({
        kind: 'failure',
        reason: 'storage',
      })
    },
  )
  it.each(['pairId', 'boardId', 'taskId', 'attemptId', 'receiverIncarnationId'] as const)(
    'RVM100E-P2-1 refuses changed %s control even with an unreadable journal',
    async (field) => {
      const { receiver, request, directory, lease } = fixture()
      await receiver.dispatch(request)
      await rm(path.join(directory, 'attempts.json'))
      await expect(
        receiver.cancel({ ...request.identity, [field]: 'f'.repeat(32) }),
      ).rejects.toThrow()
      expect(lease.cancel).not.toHaveBeenCalled()
    },
  )
  it('RVM100E-P2-1 records cancellation uncertainty without retiring a live attempt', async () => {
    const { receiver, request, journal, lease } = fixture()
    await receiver.dispatch(request)
    await receiver.cancel(request.identity)
    expect(lease.cancel).toHaveBeenCalledOnce()
    expect(await journal.lookup(request.identity)).toMatchObject({
      outcome: { state: 'uncertain', occupied: request.caps, usage: executionUsage },
    })
    expect(lease.release).not.toHaveBeenCalled()
  })
  it('RVM100E-P2-1 reports an unproved local cancellation without releasing occupancy', async () => {
    const { receiver, request, lease, journal } = fixture()
    await receiver.dispatch(request)
    lease.cancel.mockRejectedValueOnce(new Error('synthetic unproved cancellation'))
    await expect(receiver.cancel(request.identity)).rejects.toThrow(
      'synthetic unproved cancellation',
    )
    expect(receiver.blockedReason).toBe('uncertain')
    expect(receiver.paused).toBe(true)
    expect(lease.release).not.toHaveBeenCalled()
    expect(await journal.cancellations()).toContainEqual(request.identity)
  })
  it('RVM100E-P2-1 reports unavailable cancellation evidence over the authenticated channel', async () => {
    const { receiver, request, directory, lease } = fixture()
    await receiver.dispatch(request)
    await rm(path.join(directory, 'attempts.json'))
    const channel = transport(request.identity.receiverIncarnationId)
    await receiver.receive(
      envelope(request.identity.receiverIncarnationId, {
        kind: 'cancel',
        identity: request.identity,
      }),
      channel,
    )
    expect(lease.cancel).toHaveBeenCalledOnce()
    expect(channel.send).toHaveBeenCalledWith(
      expect.objectContaining({ body: { kind: 'failure', reason: 'storage' } }),
    )
    expect(lease.release).not.toHaveBeenCalled()
  })
  it('recovers launch-before-confirmation with original identity, occupancy and uncertain spending', async () => {
    const { request, journal, execution, fixture: counts } = fixture()
    await journal.admit(request, executionUsage, Date.now())
    await journal.advance(
      request.identity,
      (row) => ({ ...row, state: 'launch-intent', revision: row.revision + 1 }),
      Date.now(),
    )
    const recovered = await restart()
    expect(execution.retain).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          outcome: expect.objectContaining({ state: 'launch-intent', occupied: request.caps }),
        }),
      ]),
    )
    expect(() => {
      recovered.receiver.resumeQueue()
    }).toThrow('uncertain')
    const replies = await recovered.receiver.reconcile([request.identity])
    expect(replies[0]).toMatchObject({
      receiverIncarnationId: 'f'.repeat(32),
      body: {
        kind: 'reconciled',
        outcomes: [
          {
            identity: request.identity,
            state: 'uncertain',
            occupied: request.caps,
            usage: executionUsage,
          },
        ],
      },
    })
    recovered.receiver.resumeQueue()
    expect(await responseBody(recovered.receiver.dispatch(request))).toMatchObject({
      kind: 'reconciled',
    })
    const relocated = signedDispatch({
      ...request,
      identity: { ...request.identity, receiverIncarnationId: 'f'.repeat(32) },
    })
    expect(await responseBody(recovered.receiver.dispatch(relocated))).toEqual({
      kind: 'failure',
      reason: 'payload-changed',
    })
    expect(counts.launches).toBe(0)
    expect(execution.admit).not.toHaveBeenCalled()
  })
  it('reconciles a delayed terminal reply through a new incarnation without credit or launch twice', async () => {
    const { request, journal, lease, fixture: counts } = fixture()
    await terminal()
    const old = await journal.lookup(request.identity)
    const { receiver, journal: recoveredJournal } = await restart()
    const replies = await receiver.reconcile([request.identity])
    expect(replies[0]?.body).toMatchObject({
      kind: 'reconciled',
      outcomes: [old?.kind === 'receiver-record' ? old.outcome : undefined],
    })
    const link = transport('f'.repeat(32))
    for (let index = 0; index < 2; index += 1)
      await receiver.receive(
        envelope('f'.repeat(32), {
          kind: 'acknowledge',
          identity: request.identity,
          payloadDigest: request.payloadDigest,
          settlementId: executionUsage.settlementId,
        }),
        link,
      )
    expect(lease.release).toHaveBeenCalledOnce()
    expect(counts.launches).toBe(1)
    expect(await recoveredJournal.lookup(request.identity)).toEqual(old)
  })
  it('returns the retained tombstone on replay after acknowledged result cleanup and restart', async () => {
    const { request, journal, fixture: counts } = fixture()
    await terminal()
    await journal.acknowledge(request.identity, request.payloadDigest, executionUsage.settlementId)
    await journal.compact(Date.now() + DEVICE_LIMITS.terminalRetentionMs * 2)
    const { receiver } = await restart()
    const replies = await receiver.reconcile([request.identity])
    expect(replies[0]?.body).toMatchObject({
      kind: 'tombstone',
      record: {
        identity: request.identity,
        payloadDigest: request.payloadDigest,
        usage: { settlementId: executionUsage.settlementId },
      },
    })
    expect(await responseBody(receiver.dispatch(request))).toMatchObject({ kind: 'tombstone' })
    await receiver.receive(
      envelope('f'.repeat(32), {
        kind: 'acknowledge',
        identity: request.identity,
        payloadDigest: request.payloadDigest,
        settlementId: executionUsage.settlementId,
      }),
      transport('f'.repeat(32)),
    )
    expect(counts.launches).toBe(1)
  })
  it('preserves a terminal artifact exactly through historical reconciliation', async () => {
    const { receiver, request, retirement, lease } = fixture()
    await receiver.dispatch(request)
    const artifact = {
      identity: request.identity,
      repositoryId: request.repositoryId,
      artifactId: '0'.repeat(32),
      baseCommit: request.snapshot.baseCommit,
      headCommit: 'c'.repeat(40),
      tree: 'd'.repeat(40),
      bundleDigest: 'e'.repeat(64),
      bundleBytes: 1,
      expandedBytes: 1,
      objectCount: 1,
      fileCount: 1,
    }
    retirement.resolve({ usage: executionUsage, artifact })
    await vi.waitFor(() => {
      expect(lease.release).toHaveBeenCalledOnce()
    })
    const recovered = await restart()
    expect(await reconciledBody(recovered.receiver.reconcile([request.identity]))).toMatchObject({
      kind: 'reconciled',
      outcomes: [{ artifact }],
    })
  })
  it('preserves attempts through full logout and runtime folder cleanup', async () => {
    const { journal, request, parent } = fixture()
    await journal.admit(request, executionUsage, Date.now())
    const runtime = path.join(parent, 'runtime')
    const pairs = path.join(parent, 'pairing')
    await mkdir(runtime)
    await mkdir(pairs)
    await writeFile(path.join(runtime, 'socket-observation'), 'gone')
    await writeFile(path.join(pairs, 'public-pair-metadata'), 'unlinked')
    await rm(runtime, { recursive: true })
    await rm(pairs, { recursive: true })
    const { receiver } = await restart()
    expect(await reconciledBody(receiver.reconcile([request.identity]))).toMatchObject({
      outcomes: [{ identity: request.identity, occupied: request.caps, usage: executionUsage }],
    })
  })
  it('cannot accept old live control on a new channel or erase uncertain work by unlinking', async () => {
    const { receiver, request, lease } = fixture()
    await receiver.dispatch(request)
    receiver.disconnect()
    const recovered = await restart()
    await expect(
      recovered.receiver.receive(
        envelope('f'.repeat(32), { kind: 'cancel', identity: request.identity }),
        transport('f'.repeat(32)),
      ),
    ).rejects.toThrow()
    await expect(
      recovered.receiver.reconcile([{ ...request.identity, pairId: '0'.repeat(32) }]),
    ).rejects.toThrow('payload-changed')
    expect(lease.release).not.toHaveBeenCalled()
    expect(await recovered.journal.lookup(request.identity)).toMatchObject({
      outcome: { occupied: request.caps },
    })
  })
  it.each(['admitted', 'launch-intent', 'running', 'paused', 'uncertain'] as const)(
    'never relaunches a recovered %s attempt',
    async (phase) => {
      const { journal, request, fixture: counts } = fixture()
      await journal.admit(request, executionUsage, Date.now())
      if (phase !== 'admitted')
        await journal.advance(
          request.identity,
          (row) => ({ ...row, revision: row.revision + 1, state: 'launch-intent' }),
          Date.now(),
        )
      if (phase !== 'admitted' && phase !== 'launch-intent')
        await journal.advance(
          request.identity,
          (row) => ({ ...row, revision: row.revision + 1, state: phase }),
          Date.now(),
        )
      const { receiver } = await restart()
      await receiver.reconcile([request.identity])
      expect(await responseBody(receiver.dispatch(request))).toMatchObject({
        kind: 'reconciled',
        outcomes: [{ state: 'uncertain', occupied: request.caps }],
      })
      expect(counts.launches).toBe(0)
    },
  )
  it.each(['admission', 'launch-intent'])(
    'refuses dispatch before start on a failed %s flush',
    async (phase) => {
      const { receiver, request, lease, fixture: counts } = fixture()
      const actual = await vi.importActual<typeof FileSystem>('node:fs/promises')
      let stages = 0
      vi.mocked(open).mockImplementation(async (...args) => {
        const handle = await actual.open(...args)
        if (String(args[0]).replaceAll('\\', '/').endsWith('.stage')) {
          stages += 1
          if (phase === 'admission' || stages === 2)
            vi.spyOn(handle, 'sync').mockRejectedValueOnce(new Error('synthetic disk full'))
        }
        return handle
      })
      expect(await responseBody(receiver.dispatch(request))).toEqual({
        kind: 'failure',
        reason: 'storage',
      })
      expect(counts.launches).toBe(0)
      expect(lease.start).not.toHaveBeenCalled()
      expect(lease.release).not.toHaveBeenCalled()
      expect(receiver.blockedReason).toBe('storage')
      expect(() => {
        receiver.resumeQueue()
      }).toThrow('uncertain')
    },
  )
  it('retains unconfirmed start, cancellation and retirement-observation failure without release', async () => {
    const {
      receiver,
      request,
      lease,
      journal,
      retirement,
      observeOutcome,
      fixture: counts,
    } = fixture()
    lease.start.mockImplementationOnce(() => {
      counts.launches += 1
      return Promise.reject(new Error('start confirmation lost'))
    })
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'uncertain',
    })
    expect(await responseBody(receiver.dispatch(request))).toMatchObject({ kind: 'reconciled' })
    await receiver.cancel(request.identity)
    expect(lease.cancel).toHaveBeenCalledOnce()
    const uncertain = observeOutcome('uncertain')
    retirement.reject(new Error('no complete local proof'))
    await uncertain
    expect(await journal.lookup(request.identity)).toMatchObject({
      outcome: { state: 'uncertain', occupied: request.caps },
    })
    expect(counts.launches).toBe(1)
    expect(lease.release).not.toHaveBeenCalled()
  })
  it('holds capacity across disconnect after launch and delayed confirmation', async () => {
    const { receiver, request, lease, fixture: counts } = fixture()
    const confirm = deferred<undefined>()
    lease.start.mockImplementationOnce(() => {
      counts.launches += 1
      return confirm.promise
    })
    const dispatch = receiver.dispatch(request)
    await vi.waitFor(() => {
      expect(counts.launches).toBe(1)
    })
    receiver.disconnect()
    confirm.resolve(undefined)
    await dispatch
    expect(receiver.paused).toBe(true)
    expect(await responseBody(receiver.dispatch(request))).toMatchObject({ kind: 'reconciled' })
    expect(counts.launches).toBe(1)
    expect(lease.release).not.toHaveBeenCalled()
  })
  it('does not release when a direct parent exits with an unproved surviving descendant', async () => {
    const { receiver, request, lease, fixture: counts, journal } = fixture()
    const parentScript =
      "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}); process.stdout.write(String(child.pid)); child.unref();"
    const parent = spawn(process.execPath, ['-e', parentScript], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {},
    })
    const done = once(parent, 'exit')
    let output = ''
    parent.stdout.on('data', (bytes: Buffer) => {
      output += bytes.toString('utf8')
    })
    await done
    const childPid = Number(output)
    expect(Number.isSafeInteger(childPid) && childPid > 0).toBe(true)
    try {
      process.kill(childPid, 0)
      await receiver.dispatch(request)
      receiver.disconnect()
      await receiver.cancel(request.identity)
      await receiver.reconcile([request.identity])
      const fresh = signedDispatch({
        ...request,
        identity: { ...request.identity, attemptId: '0'.repeat(32) },
      })
      receiver.resumeQueue()
      expect(await responseBody(receiver.dispatch(fresh))).toEqual({
        kind: 'failure',
        reason: 'capacity',
      })
      await journal.compact(Date.now() + DEVICE_LIMITS.terminalRetentionMs * 100)
      expect(lease.release).not.toHaveBeenCalled()
      expect(counts.launches).toBe(1)
      expect(await journal.lookup(request.identity)).toMatchObject({
        outcome: { occupied: request.caps, usage: executionUsage },
      })
    } finally {
      // Owned short-lived test descendant cleanup only; no terminal proof is inferred.
      process.kill(childPid)
    }
  })
  it('keeps terminal-write failure occupied and blocks further dispatch even after local exit', async () => {
    const { receiver, request, directory, retirement, lease, fixture: counts } = fixture()
    await receiver.dispatch(request)
    await rm(path.join(directory, 'attempts.json'))
    retirement.resolve({ usage: executionUsage })
    await vi.waitFor(() => {
      expect(receiver.blockedReason).toBe('storage')
    })
    expect(lease.release).not.toHaveBeenCalled()
    expect(counts.occupied).toBe(1)
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'storage',
    })
    await expect(readFile(path.join(directory, 'attempts.json'))).rejects.toThrow()
  })
  it('blocks resume when a confirmed run loses its complete local retirement proof', async () => {
    const { receiver, request, retirement, journal, lease, observeOutcome } = fixture()
    await receiver.dispatch(request)
    const uncertain = observeOutcome('uncertain')
    retirement.reject(new Error('unproved descendant'))
    await vi.waitFor(() => {
      expect(receiver.blockedReason).toBe('uncertain')
    })
    await uncertain
    await receiver.reconcile([request.identity])
    expect(() => {
      receiver.resumeQueue()
    }).toThrow('uncertain')
    expect(await journal.lookup(request.identity)).toMatchObject({
      outcome: { state: 'uncertain', occupied: request.caps },
    })
    expect(lease.release).not.toHaveBeenCalled()
  })
  it('allows explicit resume only after a lost confirmation is locally retired and reconciled', async () => {
    const { receiver, request, lease, retirement } = fixture()
    lease.start.mockRejectedValueOnce(new Error('confirmation lost'))
    expect(await responseBody(receiver.dispatch(request))).toEqual({
      kind: 'failure',
      reason: 'uncertain',
    })
    retirement.resolve({ usage: executionUsage })
    await vi.waitFor(() => {
      expect(lease.release).toHaveBeenCalledOnce()
    })
    expect(receiver.blockedReason).toBeUndefined()
    expect(() => {
      receiver.resumeQueue()
    }).toThrow('uncertain')
    await receiver.reconcile([request.identity])
    receiver.resumeQueue()
    expect(receiver.paused).toBe(false)
  })
  it('ignores a delayed pause rejection after authoritative retirement', async () => {
    const { receiver, request, lease, retirement } = fixture()
    const pause = deferred<undefined>()
    lease.pause.mockReturnValueOnce(pause.promise)
    await receiver.dispatch(request)
    receiver.disconnect()
    retirement.resolve({ usage: executionUsage })
    await vi.waitFor(() => {
      expect(lease.release).toHaveBeenCalledOnce()
    })
    pause.reject(new Error('stale pause reply'))
    await Promise.resolve()
    expect(receiver.blockedReason).toBeUndefined()
    await receiver.reconcile([request.identity])
    receiver.resumeQueue()
  })
})
