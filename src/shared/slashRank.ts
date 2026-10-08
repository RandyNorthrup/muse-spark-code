// Composer ranking stays small while the registry loads on first use.
import type { SlashCommand } from './slashCommands'

const NAME_SEPARATORS = /[-:_./]/
const MATCH_RANK = { namePrefix: 0, wordPrefix: 1, inName: 2, inDetail: 3 } as const

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
