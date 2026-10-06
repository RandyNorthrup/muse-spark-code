import { lstatSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import type { HardwareContext } from './httpCommands'
import { parseShell, type GuardDialect } from './shellParse'
import { fill, UI_TEXT } from '../../../shared/l10n/text'
import type { ActionClass } from './actionClass'
import type { GoalCommand } from '../../agent/agentBackend'

/** Classification only labels the exact-command question; it never permits execution. */
export function hardwareShellNote(action: ActionClass | undefined): string {
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
  }
  return fill(UI_TEXT.hardwareShellNote, { warning }).trim()
}

/** Host observations only: the model cannot declare its workspace ordinary. */
export function isHardwareWorkspace(context: HardwareContext = {}): boolean {
  return (
    context.isHardwareWorkspace === true ||
    context.isMakerEnabled === true ||
    context.isHardwareProject === true ||
    context.hasConnectedBoard === true ||
    (context.targets?.length ?? 0) > 0 ||
    (context.boardRoots?.length ?? 0) > 0
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

interface ReadOnlyCommand {
  readonly argv: readonly string[]
  readonly dialects: readonly GuardDialect[]
  readonly workspaceFile?: boolean
}

const ALL_SHELLS: readonly GuardDialect[] = ['bash', 'powershell', 'cmd']

/** No prefix grants: each row describes the complete argv, plus one verified file where stated. */
export const READ_ONLY_HARDWARE_COMMANDS: readonly ReadOnlyCommand[] = [
  // status/diff can execute repository fsmonitor/textconv helpers. A log row
  // suppresses pagers and signature programs; no repository helper runs.
  {
    argv: ['git', '--no-pager', 'log', '--no-show-signature', '--no-decorate', '-1'],
    dialects: ALL_SHELLS,
  },
  { argv: ['ls'], dialects: ['bash'] },
  { argv: ['Get-ChildItem'], dialects: ['powershell'] },
  { argv: ['dir'], dialects: ['cmd'] },
  { argv: ['cat'], dialects: ['bash'], workspaceFile: true },
  { argv: ['Get-Content', '-LiteralPath'], dialects: ['powershell'], workspaceFile: true },
  { argv: ['type'], dialects: ['cmd'], workspaceFile: true },
  { argv: ['pio', '--version'], dialects: ALL_SHELLS },
  { argv: ['esptool', 'version'], dialects: ALL_SHELLS },
  { argv: ['esptool', '--help'], dialects: ALL_SHELLS },
  { argv: ['espefuse', '--help'], dialects: ALL_SHELLS },
  { argv: ['picotool', '--help'], dialects: ALL_SHELLS },
  { argv: ['picotool', 'help'], dialects: ALL_SHELLS },
]

function isWorkspaceFile(file: string, context: HardwareContext): boolean {
  if (
    context.workspaceRoot === undefined ||
    file.startsWith('-') ||
    /[:*?]/.test(file) ||
    /(?:^|[\\/])(?:con|prn|aux|nul|com\d+|lpt\d+)(?:\.|:|$)/i.test(file)
  )
    return false
  try {
    const lexical = path.relative(context.workspaceRoot, path.resolve(context.workspaceRoot, file))
    if (lexical === '' || lexical.startsWith('..') || path.isAbsolute(lexical)) return false
    let componentPath = context.workspaceRoot
    const components = lexical.split(path.sep)
    for (const component of components) {
      componentPath = path.join(componentPath, component)
      if (lstatSync(componentPath).isSymbolicLink()) return false
    }
    const root = realpathSync(context.workspaceRoot)
    const resolved = realpathSync(path.resolve(context.workspaceRoot, file))
    const relative = path.relative(root, resolved)
    return (
      relative !== '' &&
      !relative.startsWith('..') &&
      !path.isAbsolute(relative) &&
      statSync(resolved).isFile() &&
      !context.boardRoots?.some((board) => resolved.toLowerCase().startsWith(board.toLowerCase()))
    )
  } catch {
    return false
  }
}

export function isReadOnlyHardwareArgv(
  argv: readonly string[],
  dialect: GuardDialect,
  context: HardwareContext = {},
): boolean {
  return READ_ONLY_HARDWARE_COMMANDS.some(
    (row) =>
      row.dialects.includes(dialect) &&
      argv.length === row.argv.length + (row.workspaceFile ? 1 : 0) &&
      row.argv.every((word, index) => word === argv[index]) &&
      (!row.workspaceFile || isWorkspaceFile(argv.at(-1) ?? '', context)),
  )
}

/** Fully parsed, no composition or evaluation, no redirect and no ambient shell alias. */
export function isReadOnlyHardwareCommand(
  command: string,
  dialect: GuardDialect = 'bash',
  context: HardwareContext = {},
): boolean {
  if (/[;|&<>#\r\n$`%!]/.test(command)) return false
  const parsed = parseShell(command, dialect)
  const item = parsed.commands[0]
  return (
    !parsed.isUnknown &&
    parsed.commands.length === 1 &&
    item?.redirects.length === 0 &&
    !item.isPipeline &&
    isReadOnlyHardwareArgv(item.argv, dialect, context)
  )
}
