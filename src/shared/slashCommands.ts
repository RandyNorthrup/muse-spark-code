// The prompt's "/" list (M38). Typing `/` on an empty prompt shows the
// whole palette; one more character turns it into this flat list of slash
// commands, narrowed and ranked as the name is typed, as Claude Code does.
// The entries are the palette's own rows that have a slash name (their
// label is `/name`, or they carry `slashName`) and the session's skills.
// Pure: the composer renders the list and the webview runs the action.
// Help's syntax and descriptions join them in reference/slashReference.ts.

import type { ReferenceText } from './featureCatalog'
import type { PaletteAction, PaletteGroup, PaletteItem } from './palette'

export interface SlashCommand {
  /** Without the slash: `compact`, `engineering:standup`. */
  readonly name: string
  readonly detail: string | undefined
  readonly tip?: string | undefined
  readonly action: PaletteAction
  /** Help's facts, set by the reference generator's join only. */
  readonly syntax?: readonly string[] | undefined
  readonly reference?: Readonly<Record<string, ReferenceText>> | undefined
}

const SLASH = '/'

function commandOf(item: PaletteItem): SlashCommand | undefined {
  if (item.isDisabled === true) {
    return undefined
  }
  if (item.slashName !== undefined) {
    // The label is then the better description ("Switch model…").
    return {
      name: item.slashName,
      detail: item.detail ?? item.label,
      tip: item.tip,
      action: item.action,
    }
  }
  return item.label.startsWith(SLASH)
    ? {
        name: item.label.slice(SLASH.length),
        detail: item.detail,
        tip: item.tip,
        action: item.action,
      }
    : undefined
}

/** Every slash command the palette offers, each name once, in palette order. */
export function slashCommandsOf(groups: readonly PaletteGroup[]): readonly SlashCommand[] {
  const names = new Set<string>()
  const commands: SlashCommand[] = []
  for (const group of groups) {
    for (const item of group.items) {
      const command = commandOf(item)
      if (command === undefined || names.has(command.name)) {
        continue
      }
      names.add(command.name)
      commands.push(command)
    }
  }
  return commands
}

export { rankSlashCommands } from './slashRank'
