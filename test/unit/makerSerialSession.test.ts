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
import type { SerialIdentity } from '../../src/core/maker/serial/identity'
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
  const capture: SerialCapture = { bytes: Buffer.from('reply'), reason: 'ended' }
  const calls = {
    writes: [] as Buffer[],
    closes: 0,
    confirms: [] as SerialApprovalRequest[],
    opens: [] as SerialActionInput[],
    logs: [] as { outcome: string }[],
    identities: 0,
  }
  const impls: {
    write: SerialProcess['write']
    close: SerialProcess['close']
    closeOnce: SerialProcess['close'] | undefined
    confirm: SerialSessionDependencies['confirm']
    identity: SerialIdentity
    identityQueue: SerialIdentity[]
    identityNow: SerialSessionDependencies['identityNow'] | undefined
    open: SerialSessionDependencies['open']
    log: SerialSessionDependencies['log']
  } = {
    write: () => Promise.resolve(),
    close: () => Promise.resolve(),
    closeOnce: undefined,
    confirm: (request) => Promise.resolve(allow(request)),
    identity: input.identity,
    identityQueue: [],
    identityNow: undefined,
    // The adapter awaits the engine's spawn guard and invokes it synchronously
    // at spawn, exactly as production startSerialProcess does. An opener that
    // skips this never starts (maker-adapter-start-guard-missing).
    open: async (_input, _maxBytes, _signal, start) => {
      const guard = await start()
      guard()
      return transport
    },
    log: () => Promise.resolve(),
  }
  const write: SerialProcess['write'] = (bytes) => {
    calls.writes.push(Buffer.from(bytes))
    return impls.write(bytes)
  }
  const close: SerialProcess['close'] = () => {
    calls.closes += 1
    const once = impls.closeOnce
    impls.closeOnce = undefined
    return (once ?? impls.close)()
  }
  const transport: SerialProcess = {
    pid: undefined,
    write,
    close,
    result: Promise.resolve(capture),
  }
  const confirm: SerialSessionDependencies['confirm'] = (request, review) => {
    calls.confirms.push(request)
    return impls.confirm(request, review)
  }
  const identityNow: SerialSessionDependencies['identityNow'] = (port) => {
    calls.identities += 1
    return impls.identityNow === undefined
      ? Promise.resolve(impls.identityQueue.shift() ?? impls.identity)
      : impls.identityNow(port)
  }
  const open: SerialSessionDependencies['open'] = (openInput, maxBytes, signal, start) => {
    calls.opens.push(openInput)
    return impls.open(openInput, maxBytes, signal, start)
  }
  const log: SerialSessionDependencies['log'] = (event) => {
    calls.logs.push(event)
    return impls.log(event)
  }
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
  return { deps, input, impls, calls, write, close, abort, capture, transport }
}

describe('host-only serial approval', () => {
  it('refuses a different target echoed by the host UI before opening', async () => {
    const f = await fixture()
    f.impls.confirm = (request) =>
      Promise.resolve({
        ...allow(request),
        target: { ...request.target, serialNumber: 'other-board' },
      })
    expect(await runSerialAction(f.input, f.deps)).toEqual({
      status: 'refused',
      reason: 'approval',
    })
    expect(f.calls.opens).toEqual([])
  })
  it('fails explicitly when an adapter omits the required spawn guard', async () => {
    const f = await fixture()
    f.impls.open = () =>
      Promise.resolve({
        pid: undefined,
        result: Promise.resolve(f.capture),
        write: f.write,
        close: f.close,
      })
    await expect(runSerialAction(f.input, f.deps)).rejects.toThrow(
      'maker-adapter-start-guard-missing',
    )
    expect(f.calls.writes).toEqual([])
    expect(f.calls.closes).toBeGreaterThan(0)
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
      f.impls.open = async (_input, _maxBytes, _signal, start) => {
        const guard = await start()
        guard()
        return { ...f.transport, result: captured.promise }
      }
      f.impls.write = () => {
        active.entered.abort()
        return Promise.resolve()
      }
      f.impls.closeOnce = async () => {
        closing.entered.abort()
        await holderStop.promise
        if (failsStop) throw new Error('test-holder-stop-failed')
        captured.resolve({ bytes: Buffer.alloc(0), reason: 'stopped' })
      }
      const running = runSerialAction(f.input, f.deps)
      await active.waiting
      let queries = 0
      const contenderConfirms: SerialApprovalRequest[] = []
      const confirm = (request: SerialApprovalRequest) => {
        contenderConfirms.push(request)
        return Promise.resolve(allow(request))
      }
      const contenderOpens: unknown[] = []
      const open: SerialSessionDependencies['open'] = (openInput) => {
        contenderOpens.push(openInput)
        return Promise.reject(new Error('test-contender-open'))
      }
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
        expect(contenderConfirms).toEqual([])
        expect(contenderOpens).toEqual([])
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
    f.impls.open = async (_input, _maxBytes, _signal, start) => {
      const guard = await start()
      guard()
      return {
        pid: undefined,
        result: captured.promise,
        close: f.close,
        write: f.write,
      }
    }
    f.impls.write = () => {
      entered.abort()
      return Promise.resolve()
    }
    f.impls.close = () => {
      captured.resolve({ bytes: Buffer.alloc(0), reason: 'stopped' })
      return Promise.resolve()
    }
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
      expect(f.calls.closes).toBeGreaterThan(0)
      expect(f.calls.logs.at(-1)?.outcome).toBe('stopped')
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
      f.impls.open = async (_input, _maxBytes, signal) => {
        openingSignal = signal
        entered.abort()
        await cleanup.promise
        hasClosedPort = true
        throw new Error('serial-open-stopped')
      }
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
        expect(f.calls.writes).toEqual([])
        cleanup.resolve(undefined)
        if (stopping !== undefined) expect(await stopping).toBe(true)
        expect(await running).toEqual({ status: 'refused', reason: 'context' })
        expect(hasClosedPort).toBe(true)
        expect(f.calls.logs.at(-1)?.outcome).toBe('stopped')
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
    f.impls.confirm = (request) => {
      expect(f.calls.opens).toEqual([])
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
    }
    expect(await runSerialAction(f.input, f.deps)).toEqual({
      status: 'complete',
      capture: f.capture,
    })
    expect(f.calls.writes).toEqual([Buffer.from([0, 255, 65])])
    expect(f.calls.closes).toBe(1)
    expect(f.calls.logs.map((entry) => entry.outcome)).toEqual(['attempt', 'sent'])
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
    expect(f.calls.confirms).toHaveLength(2)
    const first = f.calls.confirms[0]!
    const second = f.calls.confirms[1]!
    expect(first.action).toBe('connect')
    expect(first.id).not.toBe(second.id)
    expect(first.digest).toBe(second.digest)
    expect(f.calls.writes).toEqual([])
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
    f.calls.opens.length = 0
    expect(
      await runSerialAction(f.input, { ...f.deps, confirm: () => Promise.resolve(saved) }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.calls.opens).toEqual([])
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
    expect(f.calls.opens).toEqual([])
  })

  it('asks again when a different board appears on the same port', async () => {
    const f = await fixture()
    const changed = { ...f.input.identity, serialNumber: 'two' }
    f.impls.identityQueue = [f.input.identity]
    f.impls.identity = changed
    await runSerialAction(f.input, f.deps)
    expect(f.calls.confirms).toHaveLength(2)
    expect(f.calls.confirms[1]!.target.serialNumber).toBe('two')
    expect(f.calls.logs.map((entry) => entry.outcome)).toEqual(['changed', 'attempt', 'sent'])
    expect(f.calls.opens[0]!.identity.serialNumber).toBe('two')
  })

  it('refuses mismatch, stale initial identity, excessive bounds and unattended context before opening', async () => {
    const f = await fixture()
    const mismatch = { ...f.input, identity: { ...f.input.identity, vid: '2e8a', pid: '0003' } }
    f.impls.identity = mismatch.identity
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
    expect(f.calls.opens).toEqual([])
    expect(f.calls.confirms).toEqual([])
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
      expect(f.calls.opens).toEqual([])
      expect(f.calls.confirms).toEqual([])
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
    expect(f.calls.opens).toEqual([])
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
    expect(next.calls.opens).toEqual([])
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
    f.impls.log = () => Promise.reject(new Error('test-log-unavailable'))
    await expect(runSerialAction(f.input, f.deps)).rejects.toThrow('test-log-unavailable')
    expect(f.calls.opens).toEqual([])
  })

  it('rechecks identity after asynchronous logging and refuses a newly mismatched board', async () => {
    const f = await fixture()
    const pico = { ...f.input.identity, vid: '2e8a', pid: '0003', serialNumber: 'pico' }
    f.impls.identityQueue = [f.input.identity, f.input.identity]
    f.impls.identity = pico
    expect(
      await runSerialAction(f.input, { ...f.deps, flashTarget: { idfTarget: 'esp32' } }),
    ).toEqual({ status: 'refused', reason: 'mismatch' })
    expect(f.calls.opens).toEqual([])
    expect(f.calls.confirms).toHaveLength(1)
  })

  it('ends active capture on turn cancellation and records stopped', async () => {
    const f = await fixture()
    const ended = new AbortController()
    const { entered, waiting } = enteredSignal()
    f.impls.open = async (_input, _maxBytes, _signal, start) => {
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
    }
    f.impls.close = () => {
      ended.abort()
      return Promise.resolve()
    }
    f.impls.write = () => {
      entered.abort()
      return Promise.resolve()
    }
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
    expect(f.calls.writes).toHaveLength(1)
    expect(f.calls.closes).toBeGreaterThan(0)
    expect(f.calls.logs.at(-1)?.outcome).toBe('stopped')
  })

  it('bounds identity churn, declines denied answers, and reports exclusive-open busy', async () => {
    const f = await fixture()
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        confirm: (request) => Promise.resolve({ ...allow(request), decision: 'reject_once' }),
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    f.impls.identityNow = () =>
      Promise.resolve({
        ...f.input.identity,
        serialNumber: String(f.calls.identities),
      })
    const input = {
      ...f.input,
      identity: { ...f.input.identity, serialNumber: String(f.calls.identities + 1) },
    }
    expect(
      await runSerialAction(input, {
        ...f.deps,
        limits: { ...f.deps.limits, maxIdentityChanges: 1 },
      }),
    ).toEqual({ status: 'refused', reason: 'changed' })
    f.impls.identityNow = undefined
    f.impls.identity = f.input.identity
    f.impls.open = () => Promise.reject(new Error('serial-helper-busy'))
    expect(await runSerialAction(f.input, f.deps)).toEqual({ status: 'busy' })
    expect(f.calls.logs.at(-1)?.outcome).toBe('failed')
  })

  it('sends nothing if approval expires or the board changes while opening', async () => {
    const f = await fixture()
    f.impls.open = async (_input, _maxBytes, _signal, start) => {
      await delay(50)
      const guard = await start()
      guard()
      return { pid: undefined, result: Promise.resolve(f.capture), write: f.write, close: f.close }
    }
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        limits: { ...f.deps.limits, approvalTtlMs: 20 },
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.calls.writes).toEqual([])
    const next = await fixture()
    next.impls.identityQueue = [next.input.identity, next.input.identity, next.input.identity]
    next.impls.identity = { ...next.input.identity, vid: '2e8a', pid: '0003' }
    expect(
      await runSerialAction(next.input, { ...next.deps, flashTarget: { idfTarget: 'esp32' } }),
    ).toEqual({ status: 'refused', reason: 'mismatch' })
    expect(next.calls.writes).toEqual([])
    // Final target verification now refuses before any opener creates a port.
    expect(next.calls.closes).toBe(0)
  })

  it('logs an already-expired answer as rejected and rejects extra answer fields', async () => {
    const f = await fixture()
    expect(
      await runSerialAction(f.input, { ...f.deps, limits: { ...f.deps.limits, approvalTtlMs: 0 } }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.calls.logs.at(-1)?.outcome).toBe('rejected')
    expect(
      await runSerialAction(f.input, {
        ...f.deps,
        confirm: (request) => Promise.resolve({ ...allow(request), token: 'invented' }),
      }),
    ).toEqual({ status: 'refused', reason: 'approval' })
    expect(f.calls.opens).toEqual([])
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
    expect(f.calls.opens).toEqual([])
    expect(f.calls.confirms).toEqual([])
    await runSerialAction(f.input, {
      ...f.deps,
      classify: () => Promise.resolve('program'),
      flashTarget: { idfTarget: 'esp32' },
    })
    expect(f.calls.confirms[0]?.action).toBe('program')
    expect(f.calls.confirms[0]?.projectTarget).toEqual({ idfTarget: 'esp32' })
    expect(f.calls.confirms[0]?.flashIdentity.status).toBe('match')
  })

  it('classifies a replacement board again before offering another approval', async () => {
    const f = await fixture()
    f.impls.identityQueue = [f.input.identity]
    f.impls.identity = { ...f.input.identity, vid: '2e8a', pid: '0003' }

    expect(await runSerialAction(f.input, { ...f.deps, classify: classifyReplacement })).toEqual({
      status: 'refused',
      reason: 'classification',
    })
    expect(f.calls.confirms).toHaveLength(1)
    expect(f.calls.opens).toEqual([])
  })
})
