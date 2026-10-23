// RLF-DEVICES: D83.16's answer check. The engine mints each request
// and accepts only an answer that echoes the id and digest before the
// expiry; a stale, mismatched or replayed answer is refused, and a
// verified approval is single-use.
import { describe, expect, it } from 'vitest'
import type { MakerApprovalAnswer, MakerApprovalPrompt, MakerTarget } from '../../src/shared/maker'
import {
  makerPayloadDigest,
  MakerApprovals,
  MakerPresencePort,
  renderMakerPreview,
  requestMakerApproval,
} from '../../src/core/maker/approval'
import { analyzeMakerPayload } from '../../src/core/maker/analysis'
import type { DeviceLocalAction } from '../../src/core/devices/actionGrants'

const TARGET: MakerTarget = {
  kind: 'printer',
  name: 'Ender (simulator)',
  endpoint: 'sim://printer/0',
  simulated: true,
}

function answerFor(prompt: MakerApprovalPrompt, decision: 'send' | 'reject'): MakerApprovalAnswer {
  return { requestId: prompt.requestId, decision, digest: prompt.digest }
}

describe('maker approval engine', () => {
  it('mints the id, digest, target and caller expiry', () => {
    const approvals = new MakerApprovals({ randomId: () => 'a'.repeat(32), now: () => 1000 })
    const pending = approvals.mint({
      target: TARGET,
      operation: 'actuate',
      payload: new TextEncoder().encode('G1 X10\n'),
      stateAtMint: 'state-1',
      expiresAt: 2000,
    })
    expect(pending.prompt.requestId).toBe('a'.repeat(32))
    expect(pending.prompt.digest).toBe(makerPayloadDigest(new TextEncoder().encode('G1 X10\n')))
    expect(pending.prompt.target).toEqual(TARGET)
    expect(pending.prompt.expiresAt).toBe(2000)
    const verdict = pending.answer(answerFor(pending.prompt, 'send'))
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) return
    expect(verdict.approval.stateAtMint).toBe('state-1')
    expect(verdict.approval.verifiedAt).toBe(1000)
    expect(Object.isFrozen(verdict.approval)).toBe(true)
  })

  it('renders printable bytes as text and the rest as hex, all of it', () => {
    const payload = new Uint8Array([0x47, 0x31, 0x0a, 0x00, 0xff, 0x0a])
    expect(renderMakerPreview(payload)).toEqual([
      { kind: 'text', text: 'G1' },
      { kind: 'hex', hex: '00ff' },
    ])
    expect(renderMakerPreview(new Uint8Array(0))).toEqual([])
  })

  it('refuses a stale answer past the caller expiry', () => {
    let at = 1000
    const approvals = new MakerApprovals({ randomId: () => 'b'.repeat(32), now: () => at })
    const pending = approvals.mint({
      target: TARGET,
      operation: 'actuate',
      payload: new TextEncoder().encode('G1 X10\n'),
      stateAtMint: 'state-1',
      expiresAt: 2000,
    })
    at = 2000
    expect(pending.answer(answerFor(pending.prompt, 'send'))).toEqual({
      ok: false,
      reason: 'approval-expired',
    })
  })

  it('refuses mismatched, rejected and replayed answers', () => {
    const approvals = new MakerApprovals({ randomId: () => 'c'.repeat(32), now: () => 1000 })
    const payload = new TextEncoder().encode('G1 X10\n')
    const input = { target: TARGET, operation: 'actuate' as const, payload, stateAtMint: 's' }
    const wrongId = approvals.mint(input)
    expect(
      wrongId.answer({
        requestId: 'd'.repeat(32),
        decision: 'send',
        digest: wrongId.prompt.digest,
      }),
    ).toEqual({ ok: false, reason: 'approval-rejected' })
    const wrongDigest = approvals.mint(input)
    expect(
      wrongDigest.answer({
        requestId: wrongDigest.prompt.requestId,
        decision: 'send',
        digest: 'e'.repeat(64),
      }),
    ).toEqual({ ok: false, reason: 'approval-rejected' })
    const rejected = approvals.mint(input)
    expect(rejected.answer(answerFor(rejected.prompt, 'reject'))).toEqual({
      ok: false,
      reason: 'approval-rejected',
    })
    const closed = approvals.mint(input)
    expect(closed.answer(null)).toEqual({ ok: false, reason: 'approval-rejected' })
    const replayed = approvals.mint(input)
    expect(replayed.answer(answerFor(replayed.prompt, 'send')).ok).toBe(true)
    expect(replayed.answer(answerFor(replayed.prompt, 'send'))).toEqual({
      ok: false,
      reason: 'approval-rejected',
    })
  })

  it('asks through a surface and verifies one gesture', async () => {
    const approvals = new MakerApprovals({ randomId: () => 'f'.repeat(32), now: () => 1000 })
    const seen: MakerApprovalPrompt[] = []
    const approval = await requestMakerApproval(
      approvals,
      (prompt) => {
        seen.push(prompt)
        return Promise.resolve(answerFor(prompt, 'send'))
      },
      {
        target: TARGET,
        operation: 'connect',
        payload: new Uint8Array(0),
        warning: 'portReset',
        stateAtMint: 'closed',
      },
      new AbortController().signal,
    )
    expect(approval.ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.warning).toBe('portReset')
    expect(seen[0]?.preview).toEqual([])
  })

  it('never asks on an aborted wait', async () => {
    const approvals = new MakerApprovals({ now: () => 1000 })
    const control = new AbortController()
    control.abort()
    let didAsk = false
    const verdict = await requestMakerApproval(
      approvals,
      () => {
        didAsk = true
        return Promise.resolve(null)
      },
      { target: TARGET, operation: 'actuate', payload: new Uint8Array([0x47]), stateAtMint: 's' },
      control.signal,
    )
    expect(didAsk).toBe(false)
    expect(verdict).toEqual({ ok: false, reason: 'approval-rejected' })
  })
})

function presenceAction(operation: DeviceLocalAction['operation']): DeviceLocalAction {
  return {
    operation,
    tool: 'printer-send',
    paths: [],
    payload: new TextEncoder().encode('G1 X10\n'),
  }
}

describe('maker presence port', () => {
  it('holds one verified approval per gesture for the executor', async () => {
    const approvals = new MakerApprovals({ randomId: () => 'a'.repeat(32), now: () => 1000 })
    const seen: MakerApprovalPrompt[] = []
    const port = new MakerPresencePort(
      approvals,
      (prompt) => {
        seen.push(prompt)
        return Promise.resolve(answerFor(prompt, 'send'))
      },
      {
        target: TARGET,
        readState: () => 'state-1',
        analyze: (payload) => analyzeMakerPayload('printer', payload, { x: 0, y: 0, z: 0 }),
      },
      () => 1000,
    )
    const isConfirmed = await port.confirm({
      actionDigest: 'digest-1',
      action: presenceAction('actuate'),
      method: 'local-confirm',
      signal: new AbortController().signal,
    })
    expect(isConfirmed).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.preview).toEqual([{ kind: 'text', text: 'G1 X10' }])
    const approval = port.takeApproval('digest-1')
    expect(approval?.stateAtMint).toBe('state-1')
    expect(port.takeApproval('digest-1')).toBeUndefined()
  })

  it('never prompts for a non-physical operation', async () => {
    const approvals = new MakerApprovals({ now: () => 1000 })
    let didAsk = false
    const port = new MakerPresencePort(
      approvals,
      () => {
        didAsk = true
        return Promise.resolve(null)
      },
      { target: TARGET, readState: () => 'state-1' },
    )
    const isConfirmed = await port.confirm({
      actionDigest: 'digest-2',
      action: presenceAction('read'),
      method: 'local-confirm',
      signal: new AbortController().signal,
    })
    expect(isConfirmed).toBe(false)
    expect(didAsk).toBe(false)
  })

  it('holds nothing when the person rejects', async () => {
    const approvals = new MakerApprovals({ randomId: () => 'b'.repeat(32), now: () => 1000 })
    const port = new MakerPresencePort(
      approvals,
      (prompt) => Promise.resolve(answerFor(prompt, 'reject')),
      { target: TARGET, readState: () => 'state-1' },
    )
    const isConfirmed = await port.confirm({
      actionDigest: 'digest-3',
      action: presenceAction('program'),
      method: 'local-confirm',
      signal: new AbortController().signal,
    })
    expect(isConfirmed).toBe(false)
    expect(port.takeApproval('digest-3')).toBeUndefined()
  })

  it('refuses to prompt an actuation it cannot analyse', async () => {
    const approvals = new MakerApprovals({ now: () => 1000 })
    let didAsk = false
    const port = new MakerPresencePort(
      approvals,
      () => {
        didAsk = true
        return Promise.resolve(null)
      },
      { target: TARGET, readState: () => 'state-1' },
    )
    const isConfirmed = await port.confirm({
      actionDigest: 'digest-5',
      action: presenceAction('actuate'),
      method: 'local-confirm',
      signal: new AbortController().signal,
    })
    expect(isConfirmed).toBe(false)
    expect(didAsk).toBe(false)
  })

  it('prunes a held approval past the granting authority expiry', async () => {
    let at = 1000
    const approvals = new MakerApprovals({ randomId: () => 'c'.repeat(32), now: () => at })
    const port = new MakerPresencePort(
      approvals,
      (prompt) => Promise.resolve(answerFor(prompt, 'send')),
      {
        target: TARGET,
        readState: () => 'state-1',
        expiresAt: 2000,
        analyze: (payload) => analyzeMakerPayload('printer', payload, { x: 0, y: 0, z: 0 }),
      },
      () => at,
    )
    const isConfirmed = await port.confirm({
      actionDigest: 'digest-4',
      action: presenceAction('actuate'),
      method: 'local-confirm',
      signal: new AbortController().signal,
    })
    expect(isConfirmed).toBe(true)
    at = 2000
    expect(port.takeApproval('digest-4')).toBeUndefined()
  })
})
