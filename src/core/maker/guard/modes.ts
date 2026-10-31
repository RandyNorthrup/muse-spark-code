import type { HardwareContext } from './httpCommands'
import type { GoalCommand } from '../../agent/agentBackend'
import { UI_TEXT } from '../../../shared/l10n/text'
import { hasPositiveHardwareEvidence } from '../hardwareContext'

/**
Mode rewriting changes what every session sends, so like the resume fence it
needs positive hardware evidence. An unscannable workspace or an unknown
inventory keeps the person's chosen mode; every shell command is still
classified by the guard table and asked through the fail-safe latch.
*/
export function isPositivelyHardwareWorkspace(context: HardwareContext): boolean {
  return context.hardwareOwner === undefined
    ? hasPositiveHardwareEvidence(context)
    : context.hardwareOwner.isPositivelyHardware()
}

/** Muse Code must ask instead of applying its simple-command Auto shortcut. */
export function hardwareApprovalMode(mode: string, context: HardwareContext): string {
  if (!isPositivelyHardwareWorkspace(context)) return mode
  if (mode === 'allowAll') throw new Error(UI_TEXT.hardwareBypassNotice)
  return context.isUnattended ? 'denyUnmatched' : 'promptUnmatched'
}

export async function prepareHardwareTurn(
  context: HardwareContext,
  action: ((mode: string) => Promise<void>) | GoalCommand['verb'],
): Promise<void> {
  if (!isPositivelyHardwareWorkspace(context)) return
  if (typeof action === 'function') await action(hardwareApprovalMode('promptUnmatched', context))
  else if (action !== 'pause' && action !== 'clear') throw new Error(UI_TEXT.hardwareUnattended)
}
