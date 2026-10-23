// M100 lane A: the presence relay over the real action grants. A step-up
// request verifies its action digest, answers waiting, prompts the person
// on this device, and relays the attestation or the refusal. Confirmed
// approvals admit the attempt; wrong digests, pairs, scopes and expired
// grants refuse without prompting.
import { describe, expect, it } from 'vitest'
import { DEVICE_LIMITS } from '../../src/shared/constants'
import {
  deviceActionDigest,
  DeviceActionGrants,
  DevicePresenceRelay,
  type DeviceLocalAction,
  type DeviceReceiverActionState,
  type devicePresenceRelaySchema,
} from '../../src/core/devices/actionGrants'
import { type DeviceGrant, type DeviceGrantRequest } from '../../src/shared/devices'
import type * as z from 'zod/mini'
import { deviceCaps, deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import {
  GRANT_HARNESS_IDS,
  harnessAdmissionGrant,
  harnessGrantRequest,
  harnessReceiverState,
} from './helpers/deviceGrants'

type PresenceMessage = z.infer<typeof devicePresenceRelaySchema>

const {
  pairId: PAIR_ID,
  ownerId: OWNER_ID,
  grantId: GRANT_ID,
  requestId: REQUEST_ID,
} = GRANT_HARNESS_IDS
const PRESENCE_GRANT = { requiresStepUp: true, checks: true, grantRevision: 1 }

function action(): DeviceLocalAction {
  return {
    operation: 'read',
    tool: 'read-file',
    paths: ['src/index.ts'],
    payload: new TextEncoder().encode('read src/index.ts'),
  }
}

function request(): DeviceGrantRequest {
  return harnessGrantRequest()
}

function admissionGrant(): DeviceGrant {
  return harnessAdmissionGrant(PRESENCE_GRANT)
}

function stateFor(local: DeviceLocalAction): DeviceReceiverActionState {
  return harnessReceiverState(local, ['read-file'], PRESENCE_GRANT)
}

function setupRelay(options: {
  confirm: boolean
  ceilingMode?: DeviceGrant['mode']
  state?: DeviceReceiverActionState
}): {
  relay: DevicePresenceRelay
  sent: PresenceMessage[]
  prompts: string[]
  grantRequest: DeviceGrantRequest
  grants: DeviceActionGrants
  local: DeviceLocalAction
} {
  const prompts: string[] = []
  const local = options.state?.action ?? action()
  const grants = new DeviceActionGrants({
    senderCeiling: () => ({ mode: options.ceilingMode ?? 'manual', quota: deviceCaps }),
    current: () => options.state ?? stateFor(local),
    presence: {
      confirm: (input) => {
        prompts.push(input.actionDigest)
        return Promise.resolve(options.confirm)
      },
    },
    now: () => Date.now(),
  })
  const relay = new DevicePresenceRelay(grants, (entry) => deviceActionDigest(entry, local))
  return { relay, sent: [], prompts, grantRequest: request(), grants, local }
}

function collect(sent: PresenceMessage[]): (message: PresenceMessage) => void {
  return (message) => {
    sent.push(message)
  }
}

function stepUpRequest(
  grantRequest: DeviceGrantRequest,
  local: DeviceLocalAction,
): PresenceMessage {
  return {
    version: DEVICE_LIMITS.protocolVersion,
    requestId: REQUEST_ID,
    pairId: PAIR_ID,
    ownerId: OWNER_ID,
    kind: 'request',
    request: grantRequest,
    actionDigest: deviceActionDigest(grantRequest, local),
    method: 'local-confirm',
  }
}

describe('M100 presence relay', () => {
  it('relays waiting then attested, and the approval admits the attempt', async () => {
    const { relay, sent, prompts, grantRequest, grants, local } = setupRelay({ confirm: true })
    await relay.receive(stepUpRequest(grantRequest, local), PAIR_ID, collect(sent))
    expect(prompts).toHaveLength(1)
    expect(sent.map((message) => message.kind)).toEqual(['waiting', 'attested'])
    const attested = sent[1]
    if (attested?.kind !== 'attested') throw new Error('missing attestation')
    expect(attested.approval.grantId).toBe(GRANT_ID)
    expect(attested.approval.presence).toBe('local-confirm')
    const dispatch = deviceCheck(deviceGrant(PAIR_ID))
    const admitted = await grants.admitAttempt(grantRequest, {
      identity: dispatch.identity,
      payloadDigest: dispatch.payloadDigest,
    })
    if ('reason' in admitted) throw new Error(`attempt refused: ${admitted.reason}`)
    expect(admitted.grantId).toBe(GRANT_ID)
  })

  it('relays waiting then refused when the person declines', async () => {
    const { relay, sent, prompts, grantRequest, local } = setupRelay({ confirm: false })
    await relay.receive(stepUpRequest(grantRequest, local), PAIR_ID, collect(sent))
    expect(prompts).toHaveLength(1)
    expect(sent.map((message) => message.kind)).toEqual(['waiting', 'refused'])
    const refused = sent[1]
    if (refused?.kind !== 'refused') throw new Error('missing refusal')
    expect(refused.refusal.reason).toBe('presence-unverified')
  })

  it('throws on a wrong digest or pair without prompting or sending', async () => {
    const { relay, sent, prompts, grantRequest, local } = setupRelay({ confirm: true })
    const tampered = stepUpRequest(grantRequest, local)
    const wrongDigest = { ...tampered, actionDigest: '0'.repeat(64) }
    await expect(relay.receive(wrongDigest, PAIR_ID, collect(sent))).rejects.toThrow(
      'presence-unverified',
    )
    await expect(
      relay.receive(stepUpRequest(grantRequest, local), '1'.repeat(32), collect(sent)),
    ).rejects.toThrow('presence-unverified')
    expect(prompts).toEqual([])
    expect(sent).toEqual([])
  })

  it('refuses a scope the sender ceiling denies, without prompting', async () => {
    const { relay, sent, prompts, grantRequest, local } = setupRelay({
      confirm: true,
      ceilingMode: 'plan',
    })
    await relay.receive(stepUpRequest(grantRequest, local), PAIR_ID, collect(sent))
    expect(prompts).toEqual([])
    expect(sent.map((message) => message.kind)).toEqual(['waiting', 'refused'])
    const refused = sent[1]
    if (refused?.kind !== 'refused') throw new Error('missing refusal')
    expect(refused.refusal.reason).toBe('scope-denied')
  })

  it('admits directly when no step-up is required', async () => {
    const local = action()
    const grant = admissionGrant()
    const state: DeviceReceiverActionState = {
      ...stateFor(local),
      grant: { ...grant, requiresStepUp: false },
    }
    const { grants, prompts } = setupRelay({ confirm: false, state })
    const admitted = await grants.admit(request())
    if ('reason' in admitted) throw new Error(`admission refused: ${admitted.reason}`)
    expect(admitted.grantId).toBe(GRANT_ID)
    expect(prompts).toEqual([])
  })
})
