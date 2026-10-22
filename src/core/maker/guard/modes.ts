import type { HardwareContext } from './httpCommands'
import type { GoalCommand } from '../../agent/agentBackend'
import { UI_TEXT } from '../../../shared/l10n/text'
import { hasHardwareEvidence as isHardwareWorkspace } from '../hardwareContext'

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
