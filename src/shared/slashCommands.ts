// The prompt's "/" list (M38). Typing `/` on an empty prompt shows the
// whole palette; one more character turns it into this flat list of slash
// commands, narrowed and ranked as the name is typed, as Claude Code does.
// The entries are the palette's own rows that have a slash name (their
// label is `/name`, or they carry `slashName`) and the session's skills.
// Pure: the composer renders the list and the webview runs the action.

import type { ReferenceText } from './featureCatalog'
import type { PaletteAction, PaletteGroup, PaletteItem } from './palette'

export const SLASH_REFERENCE = {
  resume: {
    syntax: ['/resume'],
    descriptions: { museCode: { ui: 'resumeDetail' }, modelApi: { ui: 'resumeDetail' } },
  },
  commit: {
    syntax: ['/commit'],
    descriptions: {
      museCode: { ui: 'gitCommitItemDetail' },
      modelApi: { ui: 'gitCommitItemDetail' },
    },
  },
  push: {
    syntax: ['/push'],
    descriptions: { museCode: { ui: 'gitPushItemDetail' }, modelApi: { ui: 'gitPushItemDetail' } },
  },
  pr: {
    syntax: ['/pr'],
    descriptions: {
      museCode: { ui: 'gitPullRequestItemDetail' },
      modelApi: { ui: 'gitPullRequestItemDetail' },
    },
  },
  'checkout-pr': {
    syntax: ['/checkout-pr'],
    descriptions: {
      museCode: { ui: 'gitCheckoutItemDetail' },
      modelApi: { ui: 'gitCheckoutItemDetail' },
    },
  },
  model: {
    syntax: ['/model'],
    descriptions: { museCode: { ui: 'switchModel' }, modelApi: { ui: 'switchModel' } },
  },
  permissions: {
    syntax: ['/permissions'],
    descriptions: {
      museCode: { ui: 'permissionModeTitle' },
      modelApi: { ui: 'permissionModeTitle' },
    },
  },
  mcp: {
    syntax: ['/mcp'],
    descriptions: { museCode: { ui: 'mcpItemDetail' }, modelApi: { ui: 'mcpItemDetailModelApi' } },
  },
  hooks: {
    syntax: ['/hooks'],
    descriptions: { museCode: { ui: 'hooksItemDetail' }, modelApi: { ui: 'hooksItemDetail' } },
  },
  memory: {
    syntax: ['/memory'],
    descriptions: { museCode: { ui: 'memoryItemDetail' }, modelApi: { ui: 'memoryItemDetail' } },
  },
  config: {
    syntax: ['/config'],
    descriptions: { museCode: { ui: 'openSettings' }, modelApi: { ui: 'openSettings' } },
  },
  'hook run': {
    syntax: ['/hook run <name>'],
    descriptions: {
      museCode: { ui: 'manualHookSlashDetail' },
      modelApi: { ui: 'manualHookSlashDetail' },
    },
  },
  agents: {
    syntax: ['/agents'],
    descriptions: {
      museCode: { ui: 'agentsCommandDetail' },
      modelApi: { ui: 'agentsCommandDetail' },
    },
  },
  compact: {
    syntax: ['/compact'],
    descriptions: { museCode: { ui: 'compactDetail' }, modelApi: { ui: 'compactDetail' } },
  },
  handoff: {
    syntax: ['/handoff [goal]'],
    descriptions: { museCode: { ui: 'handoffDetail' }, modelApi: { ui: 'handoffDetail' } },
  },
  goal: {
    syntax: [
      '/goal <objective>',
      '/goal edit <objective>',
      '/goal pause',
      '/goal resume',
      '/goal clear',
    ],
    descriptions: { museCode: { ui: 'goalItemDetail' }, modelApi: { ui: 'goalItemDetail' } },
  },
  export: {
    syntax: ['/export'],
    descriptions: { museCode: { ui: 'exportDetail' }, modelApi: { ui: 'exportDetail' } },
  },
  clear: {
    syntax: ['/clear'],
    descriptions: { museCode: { ui: 'clearConversation' }, modelApi: { ui: 'clearConversation' } },
  },
  logout: {
    syntax: ['/logout'],
    descriptions: { museCode: { ui: 'signOutItem' }, modelApi: { ui: 'signOutItem' } },
  },
  usage: {
    syntax: ['/usage'],
    descriptions: {
      museCode: { ui: 'usageCommandDetail' },
      modelApi: { ui: 'usageCommandDetail' },
    },
  },
  cost: {
    syntax: ['/cost'],
    descriptions: { museCode: { ui: 'costCommandDetail' }, modelApi: { ui: 'costCommandDetail' } },
  },
  review: {
    syntax: [
      '/review',
      '/review branch [base]',
      '/review commit [revision]',
      '/review <instructions>',
      '/review security …',
    ],
    descriptions: { museCode: { ui: 'reviewItemDetail' }, modelApi: { ui: 'reviewItemDetail' } },
  },
  'security-review': {
    syntax: ['/security-review'],
    descriptions: {
      museCode: { ui: 'reviewSecurityDetail' },
      modelApi: { ui: 'reviewSecurityDetail' },
    },
  },
  changes: {
    syntax: ['/changes'],
    descriptions: {
      museCode: { ui: 'reviewChangesDetail' },
      modelApi: { ui: 'reviewChangesDetail' },
    },
  },
  help: {
    syntax: ['/help'],
    descriptions: { museCode: { ui: 'referenceIntro' }, modelApi: { ui: 'referenceIntro' } },
  },
  loop: {
    syntax: [
      '/loop <prompt>',
      '/loop <interval: 5m|1h|1d> <prompt>',
      '/loop "<cron>" <prompt>',
      '/loop list',
      '/loop cancel <id>',
    ],
    descriptions: { modelApi: { ui: 'loopItemDetail' } },
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly syntax: readonly string[]
      readonly descriptions: Readonly<Record<string, ReferenceText>>
    }
  >
>

export interface SlashCommand {
  /** Without the slash: `compact`, `engineering:standup`. */
  readonly name: string
  readonly detail: string | undefined
  readonly tip?: string | undefined
  readonly action: PaletteAction
  readonly syntax?: readonly string[] | undefined
  readonly reference?: Readonly<Record<string, ReferenceText>> | undefined
}

const SLASH = '/'
// Where a word starts inside a name: `engineering:standup`, `resume-claude`.
const NAME_SEPARATORS = /[-:_./]/
// How well a name matches, best first; a command matching none is left out.
const MATCH_RANK = { namePrefix: 0, wordPrefix: 1, inName: 2, inDetail: 3 } as const

const builtinSlash: Readonly<
  Record<
    string,
    {
      readonly syntax: readonly string[]
      readonly descriptions: Readonly<Record<string, ReferenceText>>
    }
  >
> = SLASH_REFERENCE

function commandOf(item: PaletteItem): SlashCommand | undefined {
  if (item.isDisabled === true) {
    return undefined
  }
  if (item.slashName !== undefined) {
    // The label is then the better description ("Switch model…").
    return {
      name: item.slashName,
      syntax: builtinSlash[item.slashName]?.syntax,
      reference: builtinSlash[item.slashName]?.descriptions,
      detail: item.detail ?? item.label,
      tip: item.tip,
      action: item.action,
    }
  }
  return item.label.startsWith(SLASH)
    ? {
        name: item.label.slice(SLASH.length),
        syntax: builtinSlash[item.label.slice(SLASH.length)]?.syntax,
        reference: builtinSlash[item.label.slice(SLASH.length)]?.descriptions,
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
