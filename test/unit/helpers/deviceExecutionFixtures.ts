import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi, beforeEach, afterEach } from 'vitest'
import {
  AttemptJournal,
  deviceDispatchDigest,
  type DeviceOutcome,
  type AttemptJournalProtection,
} from '../../../src/core/devices/attemptJournal'
import { DevicePairingError } from '../../../src/core/devices/pairing'
import {
  DeviceReceiver,
  type DeviceLocalAttempt,
  type DeviceExecutionBoundary,
} from '../../../src/host/devices/deviceReceiver'
import { deviceGrant, deviceCheck, deviceLane } from './deviceFixtures'
import type { DeviceDispatch, DeviceFrame } from '../../../src/shared/devices'

export function deferred<T>() {
  return Promise.withResolvers<T>()
}
export function signedDispatch(input: DeviceDispatch): DeviceDispatch {
  return { ...input, payloadDigest: deviceDispatchDigest(input) }
}
export const executionUsage: DeviceOutcome['usage'] = {
  settlementId: 'a'.repeat(32),
  payer: 'apiKey',
  certainty: 'uncertain',
  inputTokens: 0,
  outputTokens: 0,
  returnedUsd: 0,
  retainedLiabilityUsd: 1,
}
// Windows tests exercise the injected contract, not actual ACL/durability qualification.
export const executionProtection: AttemptJournalProtection | undefined =
  process.platform === 'win32'
    ? {
        assertPrivate: () => Promise.resolve(),
        assertSafeAncestor: () => Promise.resolve(),
        syncDirectory: () => Promise.resolve(),
      }
    : undefined

async function executionFixture(kind: 'check' | 'lane' = 'check') {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'm100-e-')))
  const directory = path.join(parent, 'durable')
  const owner = { assertOwner: vi.fn(() => Promise.resolve()) }
  const journal = await AttemptJournal.create(directory, owner, executionProtection)
  const grant = deviceGrant('b'.repeat(32))
  const request = signedDispatch(kind === 'check' ? deviceCheck(grant) : deviceLane(grant))
  const outcomeObservers = new Set<{
    attemptId: string
    state: DeviceOutcome['state']
    resolve: (outcome: DeviceOutcome) => void
  }>()
  const advance = journal.advance.bind(journal)
  let isObserving = false
  function observeOutcome(state: DeviceOutcome['state'], identity = request.identity) {
    const completion = deferred<DeviceOutcome>()
    outcomeObservers.add({ attemptId: identity.attemptId, state, resolve: completion.resolve })
    if (!isObserving) {
      isObserving = true
      vi.spyOn(journal, 'advance').mockImplementation(async (...args) => {
        // Observe this write's durable completion, even if an earlier row had the same state.
        const outcome = await advance(...args)
        for (const observer of outcomeObservers) {
          if (observer.attemptId !== outcome.identity.attemptId || observer.state !== outcome.state)
            continue
          outcomeObservers.delete(observer)
          observer.resolve(outcome)
        }
        return outcome
      })
    }
    return completion.promise
  }
  const retirement = deferred<Awaited<DeviceLocalAttempt['retirement']>>()
  const fixture: {
    boundary: DeviceExecutionBoundary | undefined
    launches: number
    occupied: number
  } = {
    boundary: undefined,
    launches: 0,
    occupied: 0,
  }
  const lease = {
    usage: executionUsage,
    start: vi.fn(async (boundary: DeviceExecutionBoundary) => {
      fixture.boundary = boundary
      await boundary.beforeAction()
      fixture.launches += 1
    }),
    pause: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(() => Promise.resolve()),
    retirement: retirement.promise,
    release: vi.fn(() => {
      fixture.occupied -= 1
      return Promise.resolve()
    }),
  }
  const execution = {
    retain: vi.fn(() => Promise.resolve()),
    admit: vi.fn(() => {
      if (fixture.occupied > 0) return Promise.reject(new DevicePairingError('capacity'))
      fixture.occupied += 1
      return Promise.resolve(lease)
    }),
  }
  const policy = {
    currentGrant: vi.fn(() => Promise.resolve(grant)),
    assertAllowed: vi.fn(() => Promise.resolve()),
    approve: vi.fn(() => Promise.resolve(true)),
    paidGate: { isOn: vi.fn(() => true) },
    paidConsent: { allows: vi.fn(() => Promise.resolve(true)) },
    assertPaidBinding: vi.fn(() => Promise.resolve()),
  }
  const receiver = await DeviceReceiver.open(
    grant.offer.receiverIncarnationId,
    journal,
    execution,
    policy,
  )
  receiver.resumeQueue()
  return {
    parent,
    directory,
    owner,
    journal,
    observeOutcome,
    request,
    grant,
    lease,
    execution,
    policy,
    receiver,
    retirement,
    fixture,
  }
}

export async function responseBody(response: Promise<DeviceFrame>): Promise<DeviceFrame['body']> {
  const frame = await response
  return frame.body
}
export async function reconciledBody(
  response: Promise<readonly DeviceFrame[]>,
): Promise<DeviceFrame['body'] | undefined> {
  const frames = await response
  return frames[0]?.body
}

export function useExecutionFixture(kind: 'check' | 'lane', prepare?: () => Promise<void>) {
  let current: Awaited<ReturnType<typeof executionFixture>> | undefined
  beforeEach(async () => {
    await prepare?.()
    current = await executionFixture(kind)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (current !== undefined) await rm(current.parent, { recursive: true, force: true })
  })
  return () => {
    if (current === undefined) throw new Error('missing test fixture')
    return current
  }
}
