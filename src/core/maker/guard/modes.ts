import type { HardwareContext } from './httpCommands'
import type { GoalCommand } from '../../agent/agentBackend'
import { UI_TEXT } from '../../../shared/l10n/text'
import { hasPositiveHardwareEvidence } from '../hardwareContext'

/**
Mode rewriting changes what every session sends, so it needs positive
hardware evidence. An unscannable workspace or an unknown inventory
keeps the person's chosen mode; every shell command is still classified
by the guard table and asked through the fail-safe latch.
*/
export function isPositivelyHardwareWorkspace(context: HardwareContext = {}): boolean {
  return context.hardwareOwner === undefined
    ? hasPositiveHardwareEvidence(context)
    : context.hardwareOwner.isPositivelyHardware()
}

/**
The one workspace shape the per-command guard cannot catch on an adapter
whose file tools edit without asking: the workspace root is a mounted
board volume itself, where writing `code.py` already programs the board
and no approval event exists to scrub. A turn there stays refused at its
start on such an adapter; everywhere else the guard holds per command.
*/
export function isBoardVolumeWorkspace(context: HardwareContext): boolean {
  const root = context.workspaceRoot?.replaceAll('\\', '/').replace(/\/$/, '')
  return (
    root !== undefined &&
    root !== '' &&
    (/(?:^|\/)(?:CIRCUITPY|RPI-RP2)$/i.test(root) ||
      (context.boardRoots ?? []).some(
        (board) => board.replaceAll('\\', '/').replace(/\/$/, '') === root,
      ))
  )
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
