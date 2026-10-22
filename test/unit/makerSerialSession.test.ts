import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimHardwareLease,
  didStopHardwareLease,
  stopHardwareLease,
  serialLeaseResource,
} from '../../src/core/maker/lease'
import {
  runSerialAction as engineRunSerialAction,
  type SerialActionInput,
  type SerialApprovalRequest,
  type SerialSessionDependencies,
} from '../../src/core/maker/serial/session'
import type { SerialCapture, SerialProcess } from '../../src/core/maker/serial/process'
import { makerLeaseDeps } from './helpers/makerSerial'

// The host UI reviews the exact rendered payload before answering, exactly as
// production does (ports.ts MakerApproval.review, then answer with the same
// target). Every confirm below runs through this review; a refusal still comes
// from production checks on the answer, never from a skipped review.
function runSerialAction(input: unknown, deps: SerialSessionDependencies) {
  return engineRunSerialAction(input, {
    ...deps,
    confirm: (request, review) => {
      review({
        v: 1,
        type: 'makerPayloadReviewed',
        id: request.id,
        digest: request.digest,
        isComplete: true,
      })
      return deps.confirm(request, review)
    },
  })
}

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

function allow(request: SerialApprovalRequest) {
  return { id: request.id, digest: request.digest, target: request.target, decision: 'allow_once' }
}

const classifyReplacement: SerialSessionDependencies['classify'] = (input) =>
  Promise.resolve(input.identity.vid === '303a' ? 'actuate' : 'refused')

function enteredSignal() {
  const entered = new AbortController()
  const waiting = new Promise<void>((resolve) => {
    entered.signal.addEventListener(
      'abort',
      () => {
        resolve()
      },
      { once: true },
    )
  })
  return { entered, waiting }
}

async function fixture() {
  const directory = await mkdtemp(
    path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'm103-session-'),
  )
  directories.push(directory)
  const port = path.join(directory, 'fake-port')
  await writeFile(port, '')
  const input: SerialActionInput = {
    operation: 'write',
    identity: { port, vid: '303a', pid: '1001', serialNumber: 'one' },
    baud: 115_200,
    durationMs: 100,
    dtr: false,
    rts: false,
    payloadHex: '00ff41',
  }
  const abort = new AbortController()
  const write = vi.fn<SerialProcess['write']>().mockResolvedValue(undefined)
  const close = vi.fn<SerialProcess['close']>().mockResolvedValue(undefined)
  const capture: SerialCapture = { bytes: Buffer.from('reply'), reason: 'ended' }
  const transport: SerialProcess = {
    pid: undefined,
    write,
    close,
    result: Promise.resolve(capture),
  }
  const confirm = vi.fn((request: SerialApprovalRequest) => Promise.resolve(allow(request)))
  const identityNow = vi
    .fn<SerialSessionDependencies['identityNow']>()
    .mockResolvedValue(input.identity)
  // The adapter awaits the engine's spawn guard and invokes it synchronously
  // at spawn, exactly as production startSerialProcess does. An opener that
  // skips this never starts (maker-adapter-start-guard-missing).
  const open = vi.fn<SerialSessionDependencies['open']>(
    async (_input, _maxBytes, _signal, start) => {
      const guard = await start()
      guard()
      return transport
    },
  )
  const log = vi.fn<SerialSessionDependencies['log']>().mockResolvedValue(undefined)
  const deps: SerialSessionDependencies = {
    platform: process.platform,
    holder: 'conversation',
    lease: await makerLeaseDeps(directory),
    limits: { maxBytes: 4096, maxDurationMs: 1000, approvalTtlMs: 1000, maxIdentityChanges: 2 },
    canUseHardware: () => true,
    classify: (input) => Promise.resolve(input.operation === 'read' ? 'connect' : 'actuate'),
    confirm,
    identityNow,
    isPortBusy: () => Promise.resolve(false),
    open,
    log,
    signal: abort.signal,
  }
  return { deps, input, confirm, identityNow, open, log, write, close, abort, capture, transport }
}

describe('host-only serial approval', () => {
  it('refuses a different target echoed by the host UI before opening', async () => {
    const f = await fixture()
    f.confirm.mockImplementation((request) =>
      Promise.resolve({
        ...allow(request),
        target: { ...request.target, serialNumber: 'other-board' },
      }),
    )
    expect(await runSerialAction(f.input, f.deps)).toEqual({
      status: 'refused',
      reason: 'approval',
    })
    expect(f.open).not.toHaveBeenCalled()
  })
  it('fails explicitly when an adapter omits the required spawn guard', async () => {
    const f = await fixture()
    f.open.mockResolvedValue({
      pid: undefined,
      result: Promise.resolve(f.capture),
      write: f.write,
      close: f.close,
    })
    await expect(runSerialAction(f.input, f.deps)).rejects.toThrow(
      'maker-adapter-start-guard-missing',
    )
    expect(f.write).not.toHaveBeenCalled()
    expect(f.close).toHaveBeenCalled()
  })
  it.each([false, true])(
    "reports only the active holder's settled Stop while a contender prepares (failure: %s)",
    async (failsStop) => {
      const f = await fixture()
      const active = enteredSignal()
      const querying = enteredSignal()
      const closing = enteredSignal()
      const identityQuery = Promise.withResolvers<undefined>()
      const holderStop = Promise.withResolvers<undefined>()
      const captured = Promise.withResolvers<SerialCapture>()
      f.open.mockImplementation(async (_input, _maxBytes, _signal, start) => {
        const guard = await start()
        guard()
        return { ...f.transport, result: captured.promise }
      })
      f.write.mockImplementation(() => {
        active.entered.abort()
        return Promise.resolve()
      })
      f.close.mockImplementationOnce(async () => {
        closing.entered.abort()
        await holderStop.promise
        if (failsStop) throw new Error('test-holder-stop-failed')
        captured.resolve({ bytes: Buffer.alloc(0), reason: 'stopped' })
      })
      const running = runSerialAction(f.input, f.deps)
      await active.waiting
      let queries = 0
      const confirm = vi.fn((request: SerialApprovalRequest) => Promise.resolve(allow(request)))
      const open = vi
        .fn<SerialSessionDependencies['open']>()
        .mockRejectedValue(new Error('test-contender-open'))
      const contender = runSerialAction(f.input, {
        ...f.deps,
        holder: 'contender',
        confirm,
        open,
        lease: {
          ...f.deps.lease,
          processStartTime: async (pid) => {
            queries += 1
            if (queries === 2) {
              querying.entered.abort()
              await identityQuery.promise
            }
            return await f.deps.lease.processStartTime(pid)
          },
        },
      })
      let stopping: ReturnType<typeof stopHardwareLease> | undefined
      try {
        await querying.waiting
        let hasSettled = false
        stopping = stopHardwareLease(
          f.deps.lease,
          await serialLeaseResource(f.input.identity, process.platform),
        )
        void stopping.then(() => {
          hasSettled = true
        })
        await closing.waiting
        await delay(100)
        expect(hasSettled).toBe(false)
        holderStop.resolve(undefined)
        expect(await stopping).toMatchObject({
          stopped: !failsStop,
          sessions: expect.arrayContaining([
            {
              record: expect.objectContaining({ holder: 'conversation' }),
              party: 'holder',
              status: failsStop ? 'failed' : 'stopped',
              ...(failsStop && { reason: 'lease-stop-failed' }),
            },
            {
              record: expect.objectContaining({ holder: 'contender' }),
              party: 'contender',
              status: 'cancelled',
            },
          ]),
        })
        identityQuery.resolve(undefined)
        expect(await contender).toEqual({ status: 'refused', reason: 'context' })
        expect(confirm).not.toHaveBeenCalled()
        expect(open).not.toHaveBeenCalled()
      } finally {
        holderStop.resolve(undefined)
        identityQuery.resolve(undefined)
        captured.resolve({ bytes: Buffer.alloc(0), reason: 'ended' })
        await Promise.allSettled([running, contender, stopping])
      }
    },
  )

  it('stops the active process with a corrupt lease and keeps cleanup failure out of Stop', async () => {
    const f = await fixture()
    const { entered, waiting } = enteredSignal()
    const captured = Promise.withResolvers<SerialCapture>()
    f.open.mockImplementation(async (_input, _maxBytes, _signal, start) => {
      const guard = await start()
      guard()
      return {
        pid: undefined,
        result: captured.promise,
        close: f.close,
        write: f.write,
      }
    })
    f.write.mockImplementation(() => {
      entered.abort()
      return Promise.resolve()
    })
    f.close.mockImplementation(() => {
      captured.resolve({ bytes: Buffer.alloc(0), reason: 'stopped' })
      return Promise.resolve()
    })
    const resource = await serialLeaseResource(f.input.identity, process.platform)
    const slot = path.join(
      f.deps.lease.directory,
      `claim-v1.${createHash('sha256').update(resource).digest('hex')}.head.claim`,
    )
    const running = runSerialAction(f.input, f.deps)
    await waiting
    const saved = await readFile(slot)
    try {
      await writeFile(slot, '{')
      expect(await didStopHardwareLease(f.deps.lease, resource)).toBe(true)
      expect(await running).toEqual({
        status: 'complete',
        capture: { bytes: Buffer.alloc(0), reason: 'stopped' },
      })
      expect(f.close).toHaveBeenCalled()
      expect(f.log.mock.calls.at(-1)?.[0].outcome).toBe('stopped')
    } finally {
      captured.resolve({ bytes: Buffer.alloc(0), reason: 'stopped' })
      await writeFile(slot, saved)
      await running
    }
  })

  it.each(['Stop', 'turn cancellation'])(
    'waits for cancelled opening cleanup on %s',
    async (method) => {
      const f = await fixture()
      const { entered, waiting } = enteredSignal()
      const cleanup = Promise.withResolvers<undefined>()
      let openingSignal: AbortSignal | undefined
      let hasClosedPort = false
      f.open.mockImplementation(async (_input, _maxBytes, signal) => {
        openingSignal = signal
        entered.abort()
        await cleanup.promise
        hasClosedPort = true
        throw new Error('serial-open-stopped')
      })
      const running = runSerialAction(f.input, f.deps)
      let hasSettled = false
      let stopping: Promise<boolean> | undefined
      try {
        await waiting
        if (method === 'Stop') {
          stopping = didStopHardwareLease(
            f.deps.lease,
            await serialLeaseResource(f.input.identity, process.platform),
          )
          void stopping.then(() => {
            hasSettled = true
          })
        } else {
          f.abort.abort()
        }
        await vi.waitFor(() => {
          expect(openingSignal?.aborted).toBe(true)
        })
        await delay(50)
        expect(hasSettled).toBe(false)
        expect(hasClosedPort).toBe(false)
        expect(f.write).not.toHaveBeenCalled()
        cleanup.resolve(undefined)
        if (stopping !== undefined) expect(await stopping).toBe(true)
        expect(await running).toEqual({ status: 'refused', reason: 'context' })
        expect(hasClosedPort).toBe(true)
        expect(f.log.mock.calls.at(-1)?.[0].outcome).toBe('stopped')
      } finally {
        cleanup.resolve(undefined)
        try {
          await running
        } catch {
          /* Preserve the assertion when a red drill rejects the action. */
        }
        await stopping
      }
    },
  )

  it('shows exact binary bytes, identity, settings and reset warning before opening', async () => {
    const f = await fixture()
    f.confirm.mockImplementation((request) => {
      expect(f.open).not.toHaveBeenCalled()
      expect(request.digest).toBe(
        createHash('sha256')
          .update(Buffer.from([0, 255, 65]))
          .digest('hex'),
      )
      expect(request).toMatchObject({
        action: 'actuate',
        target: f.input.identity,
        payload: { encoding: 'hex', value: '00ff41' },
        baud: 115_200,
        dtr: false,
        rts: false,
        warnsAboutReset: true,
        flashIdentity: { status: 'unknown' },
      })
      return Promise.resolve(allow(request))
    })
    expect(await runSerialAction(f.input, f.deps)).toEqual({
      status: 'complete',
      capture: f.capture,
    })
    expect(f.write).toHaveBeenCalledExactlyOnceWith(Buffer.from([0, 255, 65]))
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(f.log.mock.calls.map((args) => args[0].outcome)).toEqual(['attempt', 'sent'])
    expect(
      await didStopHardwareLease(
        f.deps.lease,
        await serialLeaseResource(f.input.identity, process.platform),
      ),
    ).toBe(false)
  })

  it('treats a read as connect and asks again for each action', async () => {
    const f = await fixture()
    const read = { ...f.input, operation: 'read', payloadHex: '' }
    await runSerialAction(read, f.deps)
    await runSerialAction(read, f.deps)
    expect(f.confirm).toHaveBeenCalledTimes(2)
    const first = f.confirm.mock.calls[0]![0]
    const second = f.confirm.mock.calls[1]![0]
    expect(first.action).toBe('connect')
    expect(first.id).not.toBe(second.id)
    expect(first.digest).toBe(second.digest)
    expect(f.write).not.toHaveBeenCalled()
  })

  it('rejects wrong digest, wrong request, standing choice and replayed answers', async () => {
    const f = await fixture()
    const answers = [
      (request: SerialApprovalRequest) => ({ ...allow(request), digest: 'wrong' }),
      (request: SerialApprovalRequest) => ({
        ...allow(request),
        id: '00000000-0000-4000-8000-000000000001',
      }),
      (request: SerialApprovalRequest) => ({ ...allow(request), decision: 'allow_always' }),
    ]
    for (const answer of answers) {
      expect(
        await runSerialAction(f.input, {
          ...f.deps,
          confirm: (request) => Promise.resolve(answer(request)),
        }),
      ).toEqual({ status: 'refused', reason: 'approval' })
    }
    let saved: ReturnType<typeof allow> | undefined
    await runSerialAction(f.input, {
      ...f.deps,
      confirm: (request) => {
        saved = allow(request)
        return Promise.resolve(saved)
      },
    })
    f.open.mockClear()
    expect(
      await runSerialAction(f.input, { ...f.deps, confirm: () => Promise.resolve(saved) }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.open).not.toHaveBeenCalled()
  })

  it('expires unanswered approvals and refuses late answers', async () => {
    const f = await fixture()
    const limits = { ...f.deps.limits, approvalTtlMs: 20 }
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        limits,
        confirm: () => new Promise(() => undefined),
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        limits,
        confirm: async (request) => {
          await delay(50)
          return allow(request)
        },
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.open).not.toHaveBeenCalled()
  })

  it('asks again when a different board appears on the same port', async () => {
    const f = await fixture()
    const changed = { ...f.input.identity, serialNumber: 'two' }
    f.identityNow.mockResolvedValueOnce(f.input.identity).mockResolvedValue(changed)
    await runSerialAction(f.input, f.deps)
    expect(f.confirm).toHaveBeenCalledTimes(2)
    expect(f.confirm.mock.calls[1]![0].target.serialNumber).toBe('two')
    expect(f.log.mock.calls.map((args) => args[0].outcome)).toEqual(['changed', 'attempt', 'sent'])
    expect(f.open.mock.calls[0]![0].identity.serialNumber).toBe('two')
  })

  it('refuses mismatch, stale initial identity, excessive bounds and unattended context before opening', async () => {
    const f = await fixture()
    const mismatch = { ...f.input, identity: { ...f.input.identity, vid: '2e8a', pid: '0003' } }
    f.identityNow.mockResolvedValue(mismatch.identity)
    expect(
      await runSerialAction(mismatch, { ...f.deps, flashTarget: { idfTarget: 'esp32' } }),
    ).toEqual({ status: 'refused', reason: 'mismatch' })
    expect(await runSerialAction(f.input, f.deps)).toEqual({
      status: 'refused',
      reason: 'identity',
    })
    expect(await runSerialAction({ ...f.input, durationMs: 2000 }, f.deps)).toEqual({
      status: 'refused',
      reason: 'bounds',
    })
    expect(await runSerialAction({ ...f.input, payloadHex: '00'.repeat(4097) }, f.deps)).toEqual({
      status: 'refused',
      reason: 'bounds',
    })
    expect(await runSerialAction(f.input, { ...f.deps, canUseHardware: () => false })).toEqual({
      status: 'refused',
      reason: 'context',
    })
    expect(f.open).not.toHaveBeenCalled()
    expect(f.confirm).not.toHaveBeenCalled()
  })

  it('refuses a busy external monitor or another lease without opening', async () => {
    const f = await fixture()
    expect(
      await runSerialAction(f.input, { ...f.deps, isPortBusy: () => Promise.resolve(true) }),
    ).toEqual({ status: 'busy' })
    const lease = await claimHardwareLease(
      f.deps.lease,
      await serialLeaseResource(f.input.identity, process.platform),
      'other conversation',
      () => Promise.resolve(),
    )
    if (lease.status !== 'acquired') throw new Error('test-claim')
    try {
      const result = await runSerialAction(f.input, f.deps)
      expect(result).toEqual({ status: 'busy', holder: lease.record })
      expect(f.open).not.toHaveBeenCalled()
      expect(f.confirm).not.toHaveBeenCalled()
    } finally {
      await lease.release()
    }
  })

  it('Stop from another client rejects a pending modal with no approval', async () => {
    const f = await fixture()
    const { entered, waiting } = enteredSignal()
    const running = runSerialAction(f.input, {
      ...f.deps,
      confirm: () => {
        entered.abort()
        return new Promise(() => undefined)
      },
    })
    await waiting
    const before = Date.now()
    expect(
      await didStopHardwareLease(
        f.deps.lease,
        await serialLeaseResource(f.input.identity, process.platform),
      ),
    ).toBe(true)
    expect(Date.now() - before).toBeLessThan(500)
    expect(await running).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.open).not.toHaveBeenCalled()
  })

  it('turn cancellation ends a pending modal and permission revocation invalidates its answer', async () => {
    const f = await fixture()
    const answer = (request: SerialApprovalRequest) => {
      f.abort.abort()
      return Promise.resolve(allow(request))
    }
    expect(await runSerialAction(f.input, { ...f.deps, confirm: answer })).toEqual({
      status: 'refused',
      reason: 'approval',
    })
    const next = await fixture()
    let isAllowed = true
    const confirm = (request: SerialApprovalRequest) => {
      isAllowed = false
      return Promise.resolve(allow(request))
    }
    expect(
      await runSerialAction(next.input, { ...next.deps, canUseHardware: () => isAllowed, confirm }),
    ).toEqual({ status: 'refused', reason: 'context' })
    expect(next.open).not.toHaveBeenCalled()
  })

  it('never accepts confirmation fields in tool input and never sends when logging fails', async () => {
    const f = await fixture()
    await expect(runSerialAction({ ...f.input, confirm: true }, f.deps)).rejects.toThrow()
    await expect(runSerialAction({ ...f.input, operation: 'read' }, f.deps)).rejects.toMatchObject({
      issues: [{ code: 'custom' }],
    })
    await expect(
      runSerialAction({ ...f.input, payloadHex: 'not hex' }, f.deps),
    ).rejects.toMatchObject({ issues: [{ code: 'invalid_format', path: ['payloadHex'] }] })
    await expect(runSerialAction({ ...f.input, baud: 0 }, f.deps)).rejects.toMatchObject({
      issues: [{ code: 'too_small', path: ['baud'] }],
    })
    f.log.mockRejectedValue(new Error('test-log-unavailable'))
    await expect(runSerialAction(f.input, f.deps)).rejects.toThrow('test-log-unavailable')
    expect(f.open).not.toHaveBeenCalled()
  })

  it('rechecks identity after asynchronous logging and refuses a newly mismatched board', async () => {
    const f = await fixture()
    const pico = { ...f.input.identity, vid: '2e8a', pid: '0003', serialNumber: 'pico' }
    f.identityNow
      .mockResolvedValueOnce(f.input.identity)
      .mockResolvedValueOnce(f.input.identity)
      .mockResolvedValue(pico)
    expect(
      await runSerialAction(f.input, { ...f.deps, flashTarget: { idfTarget: 'esp32' } }),
    ).toEqual({ status: 'refused', reason: 'mismatch' })
    expect(f.open).not.toHaveBeenCalled()
    expect(f.confirm).toHaveBeenCalledTimes(1)
  })

  it('ends active capture on turn cancellation and records stopped', async () => {
    const f = await fixture()
    const ended = new AbortController()
    const { entered, waiting } = enteredSignal()
    f.open.mockImplementation(async (_input, _maxBytes, _signal, start) => {
      const guard = await start()
      guard()
      const result = new Promise<SerialCapture>((resolve) => {
        const timer = setTimeout(() => {
          resolve({ bytes: Buffer.alloc(0), reason: 'ended' })
        }, 1000)
        ended.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer)
            resolve({ bytes: Buffer.alloc(0), reason: 'stopped' })
          },
          { once: true },
        )
      })
      return { pid: undefined, result, close: f.close, write: f.write }
    })
    f.close.mockImplementation(() => {
      ended.abort()
      return Promise.resolve()
    })
    f.write.mockImplementation(() => {
      entered.abort()
      return Promise.resolve()
    })
    const running = runSerialAction(f.input, {
      ...f.deps,
      limits: { ...f.deps.limits, approvalTtlMs: 5000 },
      confirm: async (request) => {
        await delay(1100)
        return allow(request)
      },
    })
    await waiting
    f.abort.abort()
    const complete = await running
    expect(complete.status).toBe('complete')
    expect(f.write).toHaveBeenCalledTimes(1)
    expect(f.close).toHaveBeenCalled()
    expect(f.log.mock.calls.at(-1)?.[0].outcome).toBe('stopped')
  })

  it('bounds identity churn, declines denied answers, and reports exclusive-open busy', async () => {
    const f = await fixture()
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        confirm: (request) => Promise.resolve({ ...allow(request), decision: 'reject_once' }),
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    f.identityNow.mockImplementation(() =>
      Promise.resolve({
        ...f.input.identity,
        serialNumber: String(f.identityNow.mock.calls.length),
      }),
    )
    const input = {
      ...f.input,
      identity: { ...f.input.identity, serialNumber: String(f.identityNow.mock.calls.length + 1) },
    }
    expect(
      await runSerialAction(input, {
        ...f.deps,
        limits: { ...f.deps.limits, maxIdentityChanges: 1 },
      }),
    ).toEqual({ status: 'refused', reason: 'changed' })
    f.identityNow.mockResolvedValue(f.input.identity)
    f.open.mockRejectedValue(new Error('serial-helper-busy'))
    expect(await runSerialAction(f.input, f.deps)).toEqual({ status: 'busy' })
    expect(f.log.mock.calls.at(-1)?.[0].outcome).toBe('failed')
  })

  it('sends nothing if approval expires or the board changes while opening', async () => {
    const f = await fixture()
    f.open.mockImplementation(async (_input, _maxBytes, _signal, start) => {
      await delay(50)
      const guard = await start()
      guard()
      return { pid: undefined, result: Promise.resolve(f.capture), write: f.write, close: f.close }
    })
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        limits: { ...f.deps.limits, approvalTtlMs: 20 },
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.write).not.toHaveBeenCalled()
    const next = await fixture()
    next.identityNow
      .mockResolvedValueOnce(next.input.identity)
      .mockResolvedValueOnce(next.input.identity)
      .mockResolvedValueOnce(next.input.identity)
      .mockResolvedValue({ ...next.input.identity, vid: '2e8a', pid: '0003' })
    expect(
      await runSerialAction(next.input, { ...next.deps, flashTarget: { idfTarget: 'esp32' } }),
    ).toEqual({ status: 'refused', reason: 'mismatch' })
    expect(next.write).not.toHaveBeenCalled()
    // Final target verification now refuses before any opener creates a port.
    expect(next.close).not.toHaveBeenCalled()
  })

  it('logs an already-expired answer as rejected and rejects extra answer fields', async () => {
    const f = await fixture()
    expect(
      await runSerialAction(f.input, { ...f.deps, limits: { ...f.deps.limits, approvalTtlMs: 0 } }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.log.mock.calls.at(-1)?.[0].outcome).toBe('rejected')
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        confirm: (request) => Promise.resolve({ ...allow(request), token: 'invented' }),
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.open).not.toHaveBeenCalled()
  })

  it('refuses a guarded irreversible action and never downgrades a write to connect', async () => {
    const f = await fixture()
    for (const action of ['refused', 'connect']) {
      const classify: SerialSessionDependencies['classify'] = () =>
        Promise.resolve(action === 'refused' ? 'refused' : 'connect')
      expect(await runSerialAction(f.input, { ...f.deps, classify })).toEqual({
        status: 'refused',
        reason: 'classification',
      })
    }
    expect(f.open).not.toHaveBeenCalled()
    expect(f.confirm).not.toHaveBeenCalled()
    await runSerialAction(f.input, {
      ...f.deps,
      classify: () => Promise.resolve('program'),
      flashTarget: { idfTarget: 'esp32' },
    })
    expect(f.confirm.mock.calls[0]?.[0].action).toBe('program')
    expect(f.confirm.mock.calls[0]?.[0].projectTarget).toEqual({ idfTarget: 'esp32' })
    expect(f.confirm.mock.calls[0]?.[0].flashIdentity.status).toBe('match')
  })

  it('classifies a replacement board again before offering another approval', async () => {
    const f = await fixture()
    f.identityNow
      .mockResolvedValueOnce(f.input.identity)
      .mockResolvedValue({ ...f.input.identity, vid: '2e8a', pid: '0003' })

    expect(await runSerialAction(f.input, { ...f.deps, classify: classifyReplacement })).toEqual({
      status: 'refused',
      reason: 'classification',
    })
    expect(f.confirm).toHaveBeenCalledTimes(1)
    expect(f.open).not.toHaveBeenCalled()
  })
})
