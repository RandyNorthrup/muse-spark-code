// RLF-DEVICES: the paired path. A physical action on a paired device
// admits only after the receiver's person approves the exact payload:
// actuation forces step-up, the step-up prompt IS the exact-payload
// dialog, and the executor takes the gesture's approval once. Refusal
// anywhere sends nothing to the machine.
import { describe, expect, it } from 'vitest'
import type { MakerApprovalAnswer, MakerApprovalPrompt } from '../../src/shared/maker'
import {
  DeviceActionGrants,
  deviceActionDigest,
  type DeviceLocalAction,
} from '../../src/core/devices/actionGrants'
import { MakerApprovals, MakerPresencePort } from '../../src/core/maker/approval'
import { analyzeMakerPayload } from '../../src/core/maker/analysis'
import { PrinterExecutor } from '../../src/core/maker/executors'
import { PrinterSimulator, printerSimRecord } from '../../src/core/maker/simulators'
import { deviceCaps, deviceCheck, deviceGrant } from './helpers/deviceFixtures'
import {
  GRANT_HARNESS_IDS,
  harnessGrantRequest,
  harnessReceiverState,
} from './helpers/deviceGrants'

const { pairId: PAIR_ID } = GRANT_HARNESS_IDS
// False on purpose: actuation forces step-up by operation alone.
const PAIRED_GRANT = { requiresStepUp: false, checks: true, grantRevision: 1 }
const approvals = new MakerApprovals()

function answer(prompt: MakerApprovalPrompt, decision: 'send' | 'reject'): MakerApprovalAnswer {
  return { requestId: prompt.requestId, decision, digest: prompt.digest }
}

function request() {
  return harnessGrantRequest()
}

function actionFor(payload: Uint8Array): DeviceLocalAction {
  return { operation: 'actuate', tool: 'printer-send', paths: [], payload }
}

function stateFor(action: DeviceLocalAction) {
  return harnessReceiverState(action, ['printer-send'], PAIRED_GRANT)
}

function pairedHarness(
  decision: 'send' | 'reject',
  payloadText: string,
): {
  sim: PrinterSimulator
  executor: PrinterExecutor
  asker: (prompt: MakerApprovalPrompt) => Promise<MakerApprovalAnswer>
  seen: MakerApprovalPrompt[]
  presence: MakerPresencePort
  grants: DeviceActionGrants
  local: DeviceLocalAction
} {
  const sim = new PrinterSimulator(printerSimRecord())
  const executor = new PrinterExecutor({ approvals })
  const seen: MakerApprovalPrompt[] = []
  const asker = (prompt: MakerApprovalPrompt) => {
    seen.push(prompt)
    return Promise.resolve(answer(prompt, decision))
  }
  const position = sim.readState().position
  if (position === undefined) throw new Error('sim reports no position')
  const presence = new MakerPresencePort(
    approvals,
    asker,
    {
      target: sim.target,
      readState: () => sim.readState().fingerprint,
      analyze: (payload) => analyzeMakerPayload('printer', payload, position),
    },
    () => Date.now(),
  )
  const local = actionFor(new TextEncoder().encode(payloadText))
  const grants = new DeviceActionGrants({
    senderCeiling: () => ({ mode: 'manual', quota: deviceCaps }),
    current: () => stateFor(local),
    presence,
    now: () => Date.now(),
  })
  return { sim, executor, asker, seen, presence, grants, local }
}

describe('paired maker approval', () => {
  it('admits and sends after the exact-payload gesture', async () => {
    const { sim, executor, asker, seen, presence, grants, local } = pairedHarness(
      'send',
      'G1 X10 Y10\n',
    )
    // Connect and home through the local path first: the paired send
    // needs an open, homed machine.
    const signal = new AbortController().signal
    const connected = await executor.connect(sim, asker, {}, signal)
    expect(connected.ok).toBe(true)
    const homed = await executor.send(sim, asker, new TextEncoder().encode('G28\n'), {}, signal)
    expect(homed.ok).toBe(true)
    const dispatch = deviceCheck(deviceGrant(PAIR_ID))
    const attempt = {
      identity: dispatch.identity,
      payloadDigest: deviceActionDigest(request(), local),
    }
    // Actuation forces step-up: no gesture, no admission.
    expect(await grants.admitAttempt(request(), attempt)).toMatchObject({
      reason: 'step-up-required',
    })
    const stepUp = await grants.requestStepUp(request(), 'local-confirm')
    expect(stepUp).not.toHaveProperty('reason')
    // The step-up prompt carried the exact bytes and their analysis.
    const prompt = seen.at(-1)
    expect(prompt?.preview).toEqual([{ kind: 'text', text: 'G1 X10 Y10' }])
    expect(prompt?.analysis?.bounds).toEqual({
      min: { x: 0, y: 0, z: 0 },
      max: { x: 10, y: 10, z: 0 },
    })
    expect(prompt?.target).toEqual(sim.target)
    const admitted = await grants.admitAttempt(request(), attempt)
    expect(admitted).not.toHaveProperty('reason')
    const approval = presence.takeApproval(deviceActionDigest(request(), local))
    expect(approval?.digest).toBe(prompt?.digest)
    if (approval === undefined) throw new Error('missing held approval')
    const result = await executor.sendApproved(sim, approval, local.payload, undefined)
    expect(result.ok).toBe(true)
    expect(sim.readState().position).toMatchObject({ x: 10, y: 10 })
    expect(presence.takeApproval(deviceActionDigest(request(), local))).toBeUndefined()
    grants.finishAttempt(attempt)
  })

  it('sends nothing when the person rejects the step-up', async () => {
    const { sim, seen, presence, grants, local } = pairedHarness('reject', 'G1 X10\n')
    const dispatch = deviceCheck(deviceGrant(PAIR_ID))
    const attempt = {
      identity: dispatch.identity,
      payloadDigest: deviceActionDigest(request(), local),
    }
    const before = sim.receipts().length
    const stepUp = await grants.requestStepUp(request(), 'local-confirm')
    expect(stepUp).toMatchObject({ reason: 'presence-unverified' })
    expect(await grants.admitAttempt(request(), attempt)).toMatchObject({
      reason: 'step-up-required',
    })
    expect(presence.takeApproval(deviceActionDigest(request(), local))).toBeUndefined()
    expect(presence.takeApproval('0'.repeat(64))).toBeUndefined()
    expect(seen).toHaveLength(1)
    expect(sim.receipts()).toHaveLength(before)
  })
})
