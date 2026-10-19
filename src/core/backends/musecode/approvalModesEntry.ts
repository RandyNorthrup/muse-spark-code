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
 * The ack arrived but a turn ended while a forward mode command was in
 * flight, so the adoption tore: the host runs the named mode with a reviewer
 * that was never confirmed. The caller quarantines with this sentence, which
 * says the named mode is running and its reviewer was not installed, so the
 * surface shows the acknowledgement's mode instead of calling it unconfirmed.
 */
export function tornForwardError(appliedMode: string): PermissionReviewerError {
  return new PermissionReviewerError(
    fill(UI_TEXT.permissionReviewerNotInstalled, { reason: UI_TEXT.permissionReviewerTornReason }),
    appliedMode,
  )
}

/**
 * The ack arrived but a turn ended while the rollback was in flight, so the
 * rollback's adoption tore: the host runs the previous mode again, and the
 * profile never changed, so that mode's reviewer is still installed. The
 * adoption itself could not be confirmed, so turns stay refused until the
 * mode is set again; this sentence says exactly that, and the later refusal
 * repeats it instead of saying the reviewer is missing.
 */
export function tornRollbackError(previousMode: string, cause: unknown): PermissionReviewerError {
  return new PermissionReviewerError(
    fill(UI_TEXT.permissionReviewerRollbackTorn, { mode: previousMode }),
    previousMode,
    { cause },
  )
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
 * `scheduleBusy`, a torn adoption quarantines with the running mode's
 * reviewer error (a forward tear names the applied mode; a rollback's tear is
 * replaced by its caller, which knows the previous mode is restored), and a
 * refused command propagates for the caller to name the kept mode.
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
  if (torn === undefined) return
  const error = tornForwardError(torn)
  ops.owner.quarantineWith(error.message, torn)
  throw error
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
      ops.owner.quarantineWith(UI_TEXT.permissionReviewerUnknown)
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
        // A torn rollback adoption put the previous mode back with the
        // reviewer that was already installed for it: say the previous mode
        // is restored and its reviewer is still installed, and keep turns
        // refused until the mode is set again. Any other rollback failure
        // leaves the new mode running without its reviewer.
        if (isPermissionReviewerError(rollbackError)) {
          const torn = tornRollbackError(previous, rollbackError)
          ops.owner.quarantineWith(torn.message, previous)
          throw torn
        }
        const failed = new PermissionReviewerError(
          fill(UI_TEXT.permissionReviewerNotInstalled, { reason: refusalReason(error) }),
          mode,
          { cause: rollbackError },
        )
        ops.owner.quarantineWith(failed.message, mode)
        ops.log(
          'warn',
          `Approval mode ${wireWordForLog(mode)} lost its permission profile (${failureForLog(error)}), and the previous mode is not restored (${failureForLog(rollbackError)}); new turns are refused`,
        )
        throw failed
      }
    } else {
      const failed = new PermissionReviewerError(
        fill(UI_TEXT.permissionReviewerNotInstalled, { reason: refusalReason(error) }),
        mode,
        { cause: error },
      )
      ops.owner.quarantineWith(failed.message, mode)
      throw failed
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
  try {
    const torn = await ops.applyEffect(effect)
    if (torn !== undefined) {
      const error = tornForwardError(torn)
      ops.owner.quarantineWith(error.message, torn)
      throw error
    }
  } catch (error: unknown) {
    // A torn adoption already quarantined with the conversation's mode named.
    if (isPermissionReviewerError(error)) throw error
    // A refused restore command changed nothing on the host: it still runs
    // the admission's mode with the admission's reviewer, while the panel
    // still shows the conversation's mode. Quarantine, so no turn runs under
    // the wrong reviewer, with a sentence naming the mode the host runs.
    const running = ops.owner.currentMode
    if (running === undefined) {
      ops.owner.quarantineWith(UI_TEXT.permissionReviewerUnknown)
      throw new PermissionReviewerError(UI_TEXT.permissionReviewerUnknown, '', { cause: error })
    }
    const refused = new PermissionReviewerError(
      fill(UI_TEXT.permissionRestoreRefused, { reason: refusalReason(error), mode: running }),
      running,
      { cause: error },
    )
    ops.owner.quarantineWith(refused.message, running)
    throw refused
  }
  try {
    await setSessionProfile(ops, mspPermissionProfile(effect.mode), effect.mode)
  } catch (error: unknown) {
    ops.owner.quarantine()
    throw error
  }
}
