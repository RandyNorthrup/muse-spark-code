// The Muse Code session's approval-mode effect and reviewer-profile sync,
// deferred (dist/approvalModes.js, loaded on the first mode change, schedule
// admission or restore): nothing here runs at activation. `MuseSession` keeps
// thin shells that build the ops below and delegate here, so the branch adds
// no bytes to activation beyond main's figure.
import { MspError } from '@muse-code/sdk'
import {
  isPermissionReviewerError,
  ModeKeptError,
  PermissionReviewerError,
} from '../../agent/agentBackend'
import type { SessionEffect, SessionOwner, SessionToken } from '../../schedules/sessionOwner'
import type { UnattendedRun } from '../../schedules/unattended'
import { mspPermissionProfile } from '../../../shared/permissionModes'
import { UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import { failureForLog } from './logText'
import { wireWordForLog } from '../../logging'

/**
 * What the deferred mode sync needs from its session (built once per session
 * by its shells, never at activation).
 */
export interface ModeSyncOps {
  readonly owner: SessionOwner
  applyEffect(effect: SessionEffect): Promise<string | undefined>
  sendProfile(profileId: string): Promise<unknown>
  log(level: 'warn' | 'info', message: string): void
}

/** Sessions whose host predates `session/setPermissionProfile`: logged once, then left alone. */
const profilelessOwners = new WeakSet<SessionOwner>()

/** A refusal in the user's words: the message it carries, never its frame. */
function refusalReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Select a native permission profile on the session (Muse Code 1.4.7,
 * amendment 42624; needs `experimentalApi`). `undefined` leaves the host
 * default alone. A host without `session/setPermissionProfile` answers
 * `methodNotFound` and the mode change stands without the profile; any
 * other refusal surfaces, so a managed profile exclusion fails loudly
 * instead of silently judging.
 */
export async function setSessionProfile(
  ops: ModeSyncOps,
  profileId: string | undefined,
  mode: string,
): Promise<void> {
  if (profileId === undefined || profilelessOwners.has(ops.owner)) return
  try {
    await ops.sendProfile(profileId)
  } catch (error: unknown) {
    if (error instanceof MspError && error.kind === 'methodNotFound') {
      profilelessOwners.add(ops.owner)
      ops.log(
        'info',
        `Muse Code runs approval mode ${wireWordForLog(mode)} without a permission profile on this host; Manual asks only on Muse Code 1.4.7 and later`,
      )
      return
    }
    throw error
  }
}

/**
 * The ack arrived but a turn ended while the mode command was in flight, so
 * the adoption tore: the host runs the applied mode with a reviewer that was
 * never confirmed. The throw site already quarantined; this names the mode
 * the host runs so the surface shows it instead of the mode that tore.
 */
export function tornReviewerError(appliedMode: string): PermissionReviewerError {
  return new PermissionReviewerError(UI_TEXT.permissionReviewerTorn, appliedMode)
}

/**
 * Select one of the host's approval modes and keep the session's reviewer on
 * the mode's: the mode changes first, and when the profile step then fails
 * with anything but `methodNotFound`, the previous mode is put back before
 * the throw, so "the mode did not change" stays true. Every failure names
 * the wire mode the host runs: a refused mode command, or a clean rollback,
 * throws `ModeKeptError` with the running mode (turns stay live), while an
 * unknown previous mode, a failed rollback, or a torn adoption quarantines
 * with `PermissionReviewerError`.
 */
/**
 * Mint the effect and run the mode command for it: a refused effect mints
 * `scheduleBusy`, a torn adoption throws the running mode's reviewer error,
 * and a refused command propagates for the caller to name the kept mode.
 */
export async function applyModeChange(
  ops: ModeSyncOps,
  mode: string,
  token: SessionToken,
  run?: UnattendedRun,
): Promise<void> {
  const effect = ops.owner.modeEffect(token, mode, run)
  if (effect === undefined) throw new Error(UI_TEXT.scheduleBusy)
  const torn = await ops.applyEffect(effect)
  if (torn !== undefined) throw tornReviewerError(torn)
}

export async function runSetApprovalMode(
  ops: ModeSyncOps,
  token: SessionToken,
  mode: string,
): Promise<void> {
  const previous = ops.owner.currentMode
  try {
    await applyModeChange(ops, mode, token)
  } catch (error: unknown) {
    // A torn forward adoption already quarantined with the running mode
    // named: keep it, so the surface shows the host's mode.
    if (isPermissionReviewerError(error)) throw error
    const kept = ops.owner.currentMode
    if (kept === undefined) {
      ops.owner.quarantine()
      throw new PermissionReviewerError(UI_TEXT.permissionReviewerUnknown, '', { cause: error })
    }
    throw new ModeKeptError(
      fill(UI_TEXT.permissionModeKept, { reason: refusalReason(error) }),
      kept,
      {
        cause: error,
      },
    )
  }
  try {
    await setSessionProfile(ops, mspPermissionProfile(mode), mode)
  } catch (error: unknown) {
    if (previous !== undefined && previous !== mode) {
      try {
        // A foreground turn that ended during the profile call retires the
        // captured token, so the rollback mints a fresh one: rolling back
        // with the captured token would miss and report success-by-throw.
        await applyModeChange(ops, previous, ops.owner.token())
      } catch (rollbackError: unknown) {
        // A torn rollback adoption already quarantined with the true host
        // mode (the previous one): keep it, so the menu agrees with the
        // host. Any other rollback failure leaves the new mode running.
        if (isPermissionReviewerError(rollbackError)) throw rollbackError
        ops.owner.quarantine()
        ops.log(
          'warn',
          `Approval mode ${wireWordForLog(mode)} lost its permission profile (${failureForLog(error)}), and the previous mode is not restored (${failureForLog(rollbackError)}); new turns are refused`,
        )
        throw new PermissionReviewerError(
          fill(UI_TEXT.permissionReviewerNotInstalled, { reason: refusalReason(error) }),
          mode,
          { cause: rollbackError },
        )
      }
    } else {
      ops.owner.quarantine()
      throw new PermissionReviewerError(
        fill(UI_TEXT.permissionReviewerNotInstalled, { reason: refusalReason(error) }),
        mode,
        { cause: error },
      )
    }
    throw new ModeKeptError(
      fill(UI_TEXT.permissionModeKept, { reason: refusalReason(error) }),
      previous,
      { cause: error },
    )
  }
}

/**
 * Put a finished schedule's mode back, then the conversation's reviewer with
 * it, in the same place as the mode change: a Manual conversation resumes
 * asking the person instead of keeping the admission's judge. The two go
 * back as one unit: when the reviewer cannot be put back, the session is
 * quarantined rather than left running the conversation's mode with the
 * admission's reviewer.
 */
export async function restoreScheduleEffect(
  ops: ModeSyncOps,
  effect: SessionEffect,
): Promise<void> {
  const torn = await ops.applyEffect(effect)
  if (torn !== undefined) throw tornReviewerError(torn)
  try {
    await setSessionProfile(ops, mspPermissionProfile(effect.mode), effect.mode)
  } catch (error: unknown) {
    ops.owner.quarantine()
    throw error
  }
}
