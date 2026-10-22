import { hasHardwareEvidence } from '../hardwareContext'
import type { HardwareContext } from './httpCommands'
import { fill, UI_TEXT } from '../../../shared/l10n/text'
import type { ActionClass } from './actionClass'
import type { TargetIdentity } from '../ports'

/** Classification only labels the exact-command question; it never permits execution. */
export function hardwareShellNote(
  action: ActionClass | undefined,
  targets: readonly TargetIdentity[] = [],
): string {
  let warning = ''
  switch (action) {
    case 'program': {
      warning = UI_TEXT.hardwareProgramWarning
      break
    }
    case 'connect': {
      warning = UI_TEXT.hardwareConnectWarning
      break
    }
    case 'actuate': {
      warning = UI_TEXT.hardwareActuateWarning
      break
    }
    case 'refused': {
      warning = UI_TEXT.hardwareIrreversibleWarning
      break
    }
  }
  const note = fill(UI_TEXT.hardwareShellNote, { warning }).trim()
  return targets.length === 0
    ? note
    : `${note} ${fill(UI_TEXT.hardwareTargetNote, {
        targets: targets
          .map(
            (target) => `${target.address} (${target.vidPid ?? '?'}, ${target.usbSerial ?? '?'})`,
          )
          .join('; '),
      })}`
}

/** Host observations only: the model cannot declare its workspace ordinary. */
export function isHardwareWorkspace(context: HardwareContext = {}): boolean {
  return hasHardwareEvidence(context)
}

export { hardwareApprovalMode, prepareHardwareTurn } from './modes'
