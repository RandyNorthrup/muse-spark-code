// The two GRV251E failure paths (lane PR251FIX4, PLAN.md D123): a torn
// adoption says the acknowledgement's mode, and a refused schedule restore
// quarantines naming the mode the host still runs. Drives the real
// SessionOwner and the real deferred mode sync (approvalModesEntry); the wire
// side replays exchanges recorded live on the pinned 1.4.7 host
// (`serve --provider echo`, zero model calls, 2026-10-19,
// docs/certification/manualmode.md): an unknown approval mode is refused
// `invalidParams`, and `session/setPermissionProfile` without
// `experimentalApi` is refused `experimentalRequired` (the numeric code is
// the generic server-error slot; the code under test never reads it). A torn
// adoption is the real owner refusing the ack because a turn started while
// the command was in flight (SessionOwner.observedStart, the same call the
// host makes for a real `turnStarted` event); the ack naming the applied mode
// is the recorded wire outcome.
import { describe, expect, it } from 'vitest'
import { MspError } from '@muse-code/sdk'
import { isModeKeptError, isPermissionReviewerError } from '../../src/core/agent/agentBackend'
import {
  restoreScheduleEffect,
  runSetApprovalMode,
  type ModeSyncOps,
} from '../../src/core/backends/musecode/approvalModesEntry'
import { SessionOwner, type SessionEffect } from '../../src/core/schedules/sessionOwner'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'

const RECORDED_MODE_REFUSAL = 'Invalid params: session/setApprovalMode params'
const RECORDED_PROFILE_REFUSAL = 'session/setPermissionProfile requires experimentalApi capability'

function recordedRefusal(
  kind: 'invalidParams' | 'experimentalRequired',
  message: string,
): MspError {
  return new MspError({ code: -32_000, message, data: { kind } })
}

function opsFor(
  owner: SessionOwner,
  applyEffect: (effect: SessionEffect) => Promise<string | undefined>,
  sendProfile: (profileId: string) => Promise<unknown>,
): ModeSyncOps {
  return {
    owner,
    applyEffect,
    sendProfile,
    log: () => undefined,
  }
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (error: unknown) {
    return error
  }
  return undefined
}

describe('approval-mode failure paths tell the truth (GRV251E)', () => {
  it('a torn forward change says the named mode runs without its reviewer', async () => {
    const owner = new SessionOwner('onRequest')
    const wire = opsFor(
      owner,
      // A turn started while the mode command was in flight: the real owner
      // refuses the adoption, and the recorded ack names the applied mode.
      (effect) => {
        owner.observedStart('turn-1')
        return Promise.resolve(owner.modeApplied(effect, true) ? undefined : 'promptUnmatched')
      },
      () => Promise.resolve(undefined),
    )
    const thrown = await caught(runSetApprovalMode(wire, owner.token(), 'promptUnmatched'))
    expect(isPermissionReviewerError(thrown)).toBe(true)
    if (!isPermissionReviewerError(thrown)) expect.unreachable('a torn change must quarantine')
    expect(thrown.actualMode).toBe('promptUnmatched')
    expect(thrown.message).toBe(
      fill(UI_TEXT.permissionReviewerNotInstalled, {
        reason: UI_TEXT.permissionReviewerTornReason,
      }),
    )
    expect(thrown.message).not.toContain('unconfirmed')
    expect(owner.quarantined).toBe(true)
    expect(owner.currentMode).toBe('promptUnmatched')
    // The later refusal repeats the quarantine's sentence, not the generic one.
    expect(owner.quarantineCause).toBe(thrown.message)
    expect(owner.start(owner.token())).toBe(false)
  })

  it('a torn rollback says the previous mode is back with its reviewer', async () => {
    const owner = new SessionOwner('onRequest')
    const wire = opsFor(
      owner,
      (effect) => {
        if (effect.mode !== 'onRequest') {
          if (!owner.modeApplied(effect, true))
            throw new Error('the forward change must apply while no turn runs')
          return Promise.resolve(undefined)
        }
        // The rollback ack names the previous mode, but a turn started while
        // it was in flight, so the real owner refuses the adoption. The
        // profile step already failed, so the profile never changed.
        owner.observedStart('turn-2')
        return Promise.resolve(owner.modeApplied(effect, true) ? undefined : 'onRequest')
      },
      () => Promise.reject(recordedRefusal('experimentalRequired', RECORDED_PROFILE_REFUSAL)),
    )
    const thrown = await caught(runSetApprovalMode(wire, owner.token(), 'promptUnmatched'))
    expect(isPermissionReviewerError(thrown)).toBe(true)
    if (!isPermissionReviewerError(thrown)) expect.unreachable('a torn rollback must quarantine')
    expect(thrown.actualMode).toBe('onRequest')
    expect(thrown.message).toBe(fill(UI_TEXT.permissionReviewerRollbackTorn, { mode: 'onRequest' }))
    expect(thrown.message).toContain('still installed')
    expect(thrown.message).not.toContain('could not be installed')
    expect(owner.quarantined).toBe(true)
    expect(owner.currentMode).toBe('onRequest')
    // The later refusal repeats that sentence instead of saying the reviewer
    // is missing: the reviewer is still installed.
    expect(owner.quarantineCause).toBe(thrown.message)
    expect(owner.start(owner.token())).toBe(false)
  })

  it('a refused schedule restore quarantines naming the mode the host runs', async () => {
    // The host still runs the admission's mode; the conversation's mode never
    // came back, and its admission reviewer is still installed.
    const owner = new SessionOwner('promptUnmatched')
    const effect: SessionEffect = { type: 'restore', token: owner.token(), mode: 'onRequest' }
    const wire = opsFor(
      owner,
      (restore) => {
        // The refused command changes nothing: the effect releases and the
        // recorded refusal propagates, as the host reports it.
        owner.modeApplied(restore, false)
        return Promise.reject(recordedRefusal('invalidParams', RECORDED_MODE_REFUSAL))
      },
      () => Promise.resolve(undefined),
    )
    const thrown = await caught(restoreScheduleEffect(wire, effect))
    expect(isPermissionReviewerError(thrown)).toBe(true)
    if (!isPermissionReviewerError(thrown)) expect.unreachable('a refused restore must quarantine')
    expect(thrown.actualMode).toBe('promptUnmatched')
    expect(thrown.message).toBe(
      fill(UI_TEXT.permissionRestoreRefused, {
        reason: RECORDED_MODE_REFUSAL,
        mode: 'promptUnmatched',
      }),
    )
    expect(owner.quarantined).toBe(true)
    expect(owner.start(owner.token())).toBe(false)
    expect(owner.quarantineCause).toBe(thrown.message)
  })

  it('a profile failure with a clean rollback keeps turns live', async () => {
    const owner = new SessionOwner('onRequest')
    const wire = opsFor(
      owner,
      (effect) => {
        if (!owner.modeApplied(effect, true))
          throw new Error('the change must apply while no turn runs')
        return Promise.resolve(undefined)
      },
      () => Promise.reject(recordedRefusal('experimentalRequired', RECORDED_PROFILE_REFUSAL)),
    )
    const thrown = await caught(runSetApprovalMode(wire, owner.token(), 'promptUnmatched'))
    expect(isModeKeptError(thrown)).toBe(true)
    if (!isModeKeptError(thrown)) expect.unreachable('a clean rollback must keep the mode')
    expect(thrown.actualMode).toBe('onRequest')
    expect(thrown.message).toBe(
      fill(UI_TEXT.permissionModeKept, { reason: RECORDED_PROFILE_REFUSAL }),
    )
    expect(owner.quarantined).toBe(false)
    expect(owner.quarantineCause).toBeUndefined()
    expect(owner.start(owner.token())).toBe(true)
  })
})
