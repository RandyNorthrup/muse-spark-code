import type { HardwareContext } from './httpCommands'
import { fill, UI_TEXT } from '../../../shared/l10n/text'
import type { ActionClass } from './actionClass'
import type { GoalCommand } from '../../agent/agentBackend'
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
  return (
    context.hardwareSessionLatched ??
    (context.isHardwareWorkspace === true ||
      context.isMakerEnabled === true ||
      context.isHardwareProject === true ||
      context.hasConnectedBoard === true ||
      (context.targets?.length ?? 0) > 0 ||
      (context.boardRoots?.length ?? 0) > 0)
  )
}

/** Muse Code must ask instead of applying its simple-command Auto shortcut. */
export function hardwareApprovalMode(mode: string, context: HardwareContext): string {
  if (!isHardwareWorkspace(context)) return mode
  if (mode === 'allowAll') throw new Error(UI_TEXT.hardwareBypassNotice)
  return context.isUnattended ? 'denyUnmatched' : 'promptUnmatched'
}

export async function prepareHardwareTurn(
  context: HardwareContext,
  action: ((mode: string) => Promise<void>) | GoalCommand['verb'],
): Promise<void> {
  if (!isHardwareWorkspace(context)) return
  if (typeof action === 'function') await action(hardwareApprovalMode('promptUnmatched', context))
  else if (action !== 'pause' && action !== 'clear') throw new Error(UI_TEXT.hardwareUnattended)
}
