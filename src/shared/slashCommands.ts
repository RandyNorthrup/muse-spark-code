// The prompt's "/" list (M38). Typing `/` on an empty prompt shows the
// whole palette; one more character turns it into this flat list of slash
// commands, narrowed and ranked as the name is typed, as Claude Code does.
// The entries are the palette's own rows that have a slash name (their
// label is `/name`, or they carry `slashName`) and the session's skills.
// Pure: the composer renders the list and the webview runs the action.

import type { PaletteAction, PaletteGroup, PaletteItem } from './palette'

export interface SlashCommand {
  /** Without the slash: `compact`, `engineering:standup`. */
  readonly name: string
  readonly detail: string | undefined
  readonly action: PaletteAction
}

const SLASH = '/'
// Where a word starts inside a name: `engineering:standup`, `resume-claude`.
const NAME_SEPARATORS = /[-:_./]/
// How well a name matches, best first; a command matching none is left out.
const MATCH_RANK = { namePrefix: 0, wordPrefix: 1, inName: 2, inDetail: 3 } as const

function commandOf(item: PaletteItem): SlashCommand | undefined {
  if (item.isDisabled === true) {
    return undefined
  }
  if (item.slashName !== undefined) {
    // The label is then the better description ("Switch model…").
    return { name: item.slashName, detail: item.detail ?? item.label, action: item.action }
  }
  return item.label.startsWith(SLASH)
    ? { name: item.label.slice(SLASH.length), detail: item.detail, action: item.action }
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

function rankOf(command: SlashCommand, needle: string): number | undefined {
  const name = command.name.toLowerCase()
  if (name.startsWith(needle)) {
    return MATCH_RANK.namePrefix
  }
  if (name.split(NAME_SEPARATORS).some((word) => word.startsWith(needle))) {
    return MATCH_RANK.wordPrefix
  }
  if (name.includes(needle)) {
    return MATCH_RANK.inName
  }
  return command.detail?.toLowerCase().includes(needle) === true ? MATCH_RANK.inDetail : undefined
}

/**
 * The commands `query` (what follows the slash) matches, case-insensitively:
 * names that start with it, then names with a word that does, then names
 * holding it anywhere, then descriptions holding it. Alphabetical within
 * each.
 */
export function rankSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.toLowerCase()
  return commands
    .flatMap((command) => {
      const rank = rankOf(command, needle)
      return rank === undefined ? [] : [{ command, rank }]
    })
    .toSorted(
      (left, right) =>
        left.rank - right.rank || left.command.name.localeCompare(right.command.name),
    )
    .map((entry) => entry.command)
}
