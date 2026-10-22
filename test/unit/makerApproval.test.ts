import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import {
  MakerApproval,
  isSameMakerTarget,
  type ApprovalRequest,
  type MakerHost,
} from '../../src/core/maker/ports'
import type { ApprovalAnswer, MakerTarget } from '../../src/shared/makerProtocol'

function target(): MakerTarget {
  return {
    kind: 'serial',
    port: '/dev/ttyACM0',
    vid: '303a',
    pid: '1001',
    serialNumber: 'board-one',
    stablePath: '/dev/serial/by-id/board-one',
  }
}
function request(
  selected: MakerTarget = target(),
  now = Date.now(),
): Extract<ApprovalRequest, { kind: 'command' }> {
  const payload = 'approved firmware bytes'
  return {
    kind: 'command',
    id: randomUUID(),
    digest: createHash('sha256').update(payload).digest('hex'),
    target: selected,
    expiresAt: now + 10_000,
    action: 'program',
    payload,
  }
}
function answer(input: ApprovalRequest): ApprovalAnswer {
  return { id: input.id, digest: input.digest, target: input.target, decision: 'allow_once' }
}

function reviewedApproval(...args: ConstructorParameters<typeof MakerApproval>) {
  const approval = new MakerApproval(...args)
  approval.review({
    v: 1,
    type: 'makerPayloadReviewed',
    id: approval.request.id,
    digest: approval.request.digest,
    isComplete: true,
  })
  return approval
}

it('native first-paint receipts cannot make the host approval ready', () => {
  const approval = new MakerApproval(request(), () => true)
  expect(
    approval.review({
      v: 1,
      type: 'makerPreviewRendered',
      id: approval.request.id,
      digest: approval.request.digest,
    }),
  ).toBe(false)
  expect(approval.answer(answer(approval.request))).toBeUndefined()
  expect(approval.start(target())).toBe(false)
})
it('host replay preserves exact large bytes and revokes readiness from the previous document', () => {
  const input = request()
  const payload = '\0'.repeat(400_000)
  const approval = reviewedApproval(
    { ...input, payload, digest: createHash('sha256').update(payload).digest('hex') },
    () => true,
  )
  const replay = approval.reopen({ v: 1, type: 'makerReady' })
  expect(replay?.request).toBe(approval.request)
  expect(replay?.request).toMatchObject({
    payload,
    digest: createHash('sha256').update(payload).digest('hex'),
  })
  expect(approval.answer(answer(approval.request))).toBeUndefined()
})
it('host replay requires a validated ready message and a current unanswered approval', () => {
  const input = request()
  const approval = reviewedApproval(input, () => true)
  expect(approval.reopen({ v: 2, type: 'makerReady' })).toBeUndefined()
  expect(approval.reopen({ v: 1, type: 'makerStop' })).toBeUndefined()
  expect(approval.answer(answer(input))).toBeDefined()
  expect(approval.reopen({ v: 1, type: 'makerReady' })).toBeUndefined()
  const expired = new MakerApproval({ ...input, expiresAt: Date.now() - 1 }, () => true)
  expect(expired.reopen({ v: 1, type: 'makerReady' })).toBeUndefined()
  const forged = new MakerApproval({ ...input, digest: 'a'.repeat(64) }, () => true)
  expect(forged.reopen({ v: 1, type: 'makerReady' })).toBeUndefined()
})
it('completed review recomputes outgoing bytes and resets on a mismatched digest', () => {
  const input = request()
  const approval = new MakerApproval({ ...input, digest: 'a'.repeat(64) }, () => true)
  expect(
    approval.review({
      v: 1,
      type: 'makerPayloadReviewed',
      id: input.id,
      digest: 'a'.repeat(64),
      isComplete: true,
    }),
  ).toBe(false)
  expect(approval.answer(answer(approval.request))).toBeUndefined()
  const valid = reviewedApproval(input, () => true)
  expect(
    valid.review({
      v: 1,
      type: 'makerPayloadReviewed',
      id: input.id,
      digest: 'b'.repeat(64),
      isComplete: true,
    }),
  ).toBe(false)
  expect(valid.answer(answer(input))).toBeUndefined()
})

const unavailable = () => Promise.reject(new Error('not used in this fake'))

describe('one target-bound maker approval', () => {
  it.each(['id', 'digest', 'expiresAt', 'confirm'])(
    'rejects malformed engine request %s',
    (field) => {
      const input = request()
      const values: Record<string, unknown> = {
        id: 'model-chosen-id',
        digest: 'not-a-digest',
        expiresAt: NaN,
        confirm: true,
      }
      Reflect.set(input, field, values[field])
      expect(() => reviewedApproval(input, () => true)).toThrow()
    },
  )
  it('accepts only once and consumes only once at the live target', () => {
    const approval = reviewedApproval(request(), () => true)
    const binding = approval.answer(answer(approval.request))
    expect(binding).toBeDefined()
    if (binding === undefined) throw new Error('missing test binding')
    expect(approval.answer(answer(approval.request))).toBeUndefined()
    expect(approval.consume(binding, target())).toBe(true)
    expect(approval.consume(binding, target())).toBe(false)
    expect(approval.hasStarted).toBe(true)
  })
  it.each(['id', 'digest', 'target', 'decision', 'expiry', 'confirm', 'token'])(
    'rejects mismatched or extra %s and burns the answer slot',
    (field) => {
      const approval = reviewedApproval(request(), () => true)
      const values: Record<string, unknown> = {
        id: randomUUID(),
        digest: 'b'.repeat(64),
        target: { ...target(), port: '/dev/ttyACM1' },
        decision: 'allow_always',
        expiry: approval.request.expiresAt + 1,
        confirm: true,
        token: 'tool-field',
      }
      expect(
        approval.answer({ ...answer(approval.request), [field]: values[field] }),
      ).toBeUndefined()
      expect(approval.answer(answer(approval.request))).toBeUndefined()
      expect(approval.start(target())).toBe(false)
    },
  )
  it.each([undefined, null, {}, { decision: 'allow_once' }])(
    'rejects malformed answer %j',
    (raw) => {
      const approval = reviewedApproval(request(), () => true)
      expect(approval.answer(raw)).toBeUndefined()
      expect(approval.start(target())).toBe(false)
    },
  )
  it('rejects closing or denying the card', () => {
    const approval = reviewedApproval(request(), () => true)
    expect(
      approval.answer({ ...answer(approval.request), decision: 'reject_once' }),
    ).toBeUndefined()
    expect(approval.start(target())).toBe(false)
  })
  it('rejects an answer from another request and a copied binding', () => {
    const first = reviewedApproval(request(), () => true)
    const second = reviewedApproval(request(), () => true)
    expect(second.answer(answer(first.request))).toBeUndefined()
    const binding = first.answer(answer(first.request))
    if (binding === undefined) throw new Error('missing test binding')
    expect(first.consume({ ...binding }, target())).toBe(false)
    expect(first.hasStarted).toBe(false)
    expect(first.consume(binding, target())).toBe(false)
  })
  it('rejects the other engine instance’s token even with identical request bytes', () => {
    const input = request()
    const first = reviewedApproval(input, () => true)
    const second = reviewedApproval(input, () => true)
    const binding = first.answer(answer(input))
    expect(second.answer(answer(input))).toBeDefined()
    if (binding === undefined) throw new Error('missing test binding')
    expect(second.consume(binding, target())).toBe(false)
  })
  it.each(['port', 'vid', 'pid', 'serialNumber', 'stablePath'])(
    'refuses a live serial %s swap at start',
    (field) => {
      const approval = reviewedApproval(request(), () => true)
      expect(approval.answer(answer(approval.request))).toBeDefined()
      const values: Record<string, string> = {
        port: '/dev/ttyACM1',
        vid: '2e8a',
        pid: '0003',
        serialNumber: 'board-two',
        stablePath: '/dev/serial/by-id/board-two',
      }
      expect(approval.start({ ...target(), [field]: values[field] })).toBe(false)
    },
  )
  it.each(['registrationId', 'id', 'name', 'endpoint', 'identity'])(
    'refuses a live machine %s swap at start',
    (field) => {
      const machine = {
        kind: 'machine',
        registrationId: randomUUID(),
        id: 'printer',
        name: 'Printer',
        endpoint: 'http://192.168.1.5',
        identity: 'virtual-printer',
      } as const
      const approval = reviewedApproval(request(machine), () => true)
      expect(approval.answer(answer(approval.request))).toBeDefined()
      const value = field === 'registrationId' ? randomUUID() : 'different'
      expect(approval.start({ ...machine, [field]: value })).toBe(false)
    },
  )
  it('rejects a target kind change and keeps workspace identity exact', () => {
    const workspace = { kind: 'workspace', workspace: '/work/maker' } as const
    expect(isSameMakerTarget(workspace, { ...workspace, workspace: '/work/other' })).toBe(false)
    expect(isSameMakerTarget(workspace, target())).toBe(false)
    const approval = reviewedApproval(request(workspace), () => true)
    expect(approval.answer(answer(approval.request))).toBeDefined()
    expect(approval.start(workspace)).toBe(true)
  })
  it('freezes a detached request and binding including nested target identity', () => {
    const selected = target()
    const input = request(selected)
    const approval = reviewedApproval(input, () => true)
    expect(Reflect.set(selected, 'port', '/dev/ttyACM9')).toBe(true)
    expect(approval.request.target).toMatchObject({ port: '/dev/ttyACM0' })
    expect(Object.isFrozen(approval.request)).toBe(true)
    expect(Object.isFrozen(approval.request.target)).toBe(true)
    expect(Reflect.set(approval.request.target, 'serialNumber', 'replacement')).toBe(false)
    const binding = approval.answer(answer(approval.request))
    expect(Object.isFrozen(binding)).toBe(true)
    expect(approval.start(approval.request.target)).toBe(true)
  })
  it.each(['answer', 'start'])('rechecks expiry at %s including the exact boundary', (stage) => {
    let now = 1000
    const input = request(target(), now)
    const approval = reviewedApproval(
      input,
      () => true,
      () => now,
    )
    if (stage === 'start') expect(approval.answer(answer(input))).toBeDefined()
    now = input.expiresAt
    if (stage === 'answer') expect(approval.answer(answer(input))).toBeUndefined()
    else expect(approval.start(target())).toBe(false)
  })
  it('does not extend expiry when the wall clock moves backwards', async () => {
    let now = 1000
    const input = { ...request(target(), now), expiresAt: now + 10 }
    const approval = reviewedApproval(
      input,
      () => true,
      () => now,
    )
    await delay(20)
    now = 0
    expect(approval.answer(answer(input))).toBeUndefined()
  })
  it.each(['request', 'answer', 'start'])('refuses inadmissible hardware at %s', (stage) => {
    let isAdmitted = stage !== 'request'
    const input = request()
    const approval = reviewedApproval(input, () => isAdmitted)
    if (stage === 'request') isAdmitted = true
    else if (stage === 'start') expect(approval.answer(answer(input))).toBeDefined()
    if (stage !== 'request') isAdmitted = false
    if (stage === 'start') expect(approval.start(target())).toBe(false)
    else expect(approval.answer(answer(input))).toBeUndefined()
  })
  it('implements the full host port without allowing permission to gate Stop controls', async () => {
    let stopCalls = 0
    const stopControls = () => {
      stopCalls += 1
      return Promise.resolve()
    }
    let confirmCalls = 0
    const storage = {
      directory: '/outside/workspace',
      get: unavailable,
      update: unavailable,
      delete: unavailable,
    }
    const host: MakerHost = {
      confirm: () => {
        confirmCalls += 1
        return Promise.reject(new Error('not used in this fake'))
      },
      notify: () => undefined,
      stopControls,
      openPreview: unavailable,
      storage: { workspace: storage, machine: storage },
      secrets: { get: unavailable, store: unavailable, delete: unavailable },
      isTrusted: () => false,
      hardwareEnabled: () => false,
      isInteractive: () => false,
    }
    await host.stopControls([])
    expect(stopCalls).toBe(1)
    expect(confirmCalls).toBe(0)
  })
})
