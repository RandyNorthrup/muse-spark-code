// Help's slash command facts (M38, HELPREF): each built-in command's syntax
// and per-backend description. Only the reference generator reads them; the
// prompt's "/" list never does, so the palette's lazy chunk does not carry
// them (PLAN.md D6).

import type { ReferenceText } from '../featureCatalog'
import type { PaletteGroup } from '../palette'
import { type SlashCommand, slashCommandsOf as paletteSlashCommands } from '../slashCommands'

export const SLASH_REFERENCE = {
  'usage page': {
    syntax: ['/usage page'],
    descriptions: { museCode: { ui: 'paletteUsagePage' }, modelApi: { ui: 'paletteUsagePage' } },
  },
  legal: {
    syntax: ['/legal [workspace-relative path ...]'],
    descriptions: {
      museCode: { ui: 'legalScanItemDetail' },
      modelApi: { ui: 'legalScanItemDetail' },
    },
  },
  report: {
    syntax: ['/report', '/report <kind> [args]', '/report history'],
    descriptions: {
      museCode: { ui: 'reportSlashDescription' },
      modelApi: { ui: 'reportSlashDescription' },
    },
  },
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

const builtinSlash: Readonly<
  Record<
    string,
    {
      readonly syntax: readonly string[]
      readonly descriptions: Readonly<Record<string, ReferenceText>>
    }
  >
> = SLASH_REFERENCE

/** The palette's slash commands, each with its Help syntax and descriptions. */
export function slashCommandsOf(groups: readonly PaletteGroup[]): readonly SlashCommand[] {
  return paletteSlashCommands(groups).map((command) => ({
    ...command,
    syntax: builtinSlash[command.name]?.syntax,
    reference: builtinSlash[command.name]?.descriptions,
  }))
}
