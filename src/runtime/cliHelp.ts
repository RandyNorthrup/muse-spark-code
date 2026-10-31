// The terminal agent's command table (PLAN.md D120): one topic per
// command with its positional syntax, its parser routes, two real examples
// and its exit codes. The option rows render from CLI_OPTION_REGISTRY (the
// exact tables parseArgs receives) with their referenceCliOptions meaning
// and bounds from shared constants, and the exit codes come from the
// command's own exit table, so help cannot drift from what runs: an option
// parsed but missing here, or an exit code the table does not hold, fails
// the guard test. Reads UI_TEXT only when rendering, never at module load.

import {
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  CLI_EXIT,
  EFFORT_LEVELS,
  EXEC_DEFAULT_MODE,
  EXEC_DEFAULT_OUTPUT,
  EXEC_MODES,
  EXEC_OUTPUTS,
  EXEC_SCAN_EXIT_FOUND,
  EXEC_EXIT,
  isAutoCompactionEvaluated,
  LEGAL_EXIT,
  MILLISECONDS_PER_SECOND,
  REPORT_EXIT_CODES,
  SETTING_DEFAULTS,
  SHELL_SANDBOX_MODES,
  TAB_MODELS,
  TAB_TRIGGER_MODES,
  THINKING_OFF_EFFORT,
  TIMER_MAX_DELAY_MS,
} from '../shared/constants'
import type { UiText } from '../shared/l10n/en'
import { fill } from '../shared/l10n/text'
import { CLI_OPTION_REGISTRY, formatAcpUsage } from './cliOptions'
import { nearestOptionName } from './editDistance'
import {
  PROMPT_CHATS,
  PROMPT_SCOPES,
  SHARE_DESTINATIONS,
  SHARE_FORMATS,
  SHARE_MODES,
  SHARING_DEFAULTS,
} from './sharing/args'

export type CliHelpRoute = keyof typeof CLI_OPTION_REGISTRY

/** A bound or default a topic option carries, from shared constants. */
export type CliOptionFact =
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly default?: string }
  | {
      readonly kind: 'range'
      readonly min: number
      readonly max: number
      readonly default?: number | undefined
      readonly unit?: string
    }
  | { readonly kind: 'maximum'; readonly max: number; readonly unit?: string }

/** One option row: the parser's name, its value shape, and its bounds. */
export interface CliHelpOption {
  readonly name: string
  /** The value shape as typed (`<path>`, `<seconds>`); empty for flags. */
  readonly shape: string
  readonly fact?: CliOptionFact | undefined
}

export interface CliHelpTopic {
  /** The command as typed (`exec`, `scan-secrets`, …). */
  readonly name: string
  readonly purpose: (table: UiText) => string
  /** One fact a person needs that usage, options and examples cannot show. */
  readonly note?: ((table: UiText) => string) | undefined
  /** Positional syntax lines, with the executable's name filled in. */
  readonly usage: readonly ((command: string) => string)[]
  /** Parser routes whose options this topic documents. */
  readonly routes: readonly CliHelpRoute[]
  readonly options: readonly CliHelpOption[]
  /** Two real, runnable examples, with the executable's name filled in. */
  readonly examples: readonly ((command: string) => string)[]
  /**
  The command's exit sentence, with its codes. The codes come from the
  command's own exit table (EXEC_EXIT, REPORT_EXIT_CODES, LEGAL_EXIT, or
  the CLI-wide CLI_EXIT), never typed by hand; the guard test fails when
  the sentence names a code the table does not hold, or misses one.
  */
  readonly exits: (table: UiText) => string
  readonly exitCodes: readonly number[]
}

/**
Bounds and defaults from shared constants; the parser owns the values. A
lookup function rather than a keyed record: the keys would be the option
names, and `max-budget-usd` as a declared key holding a number is exactly
what the M121 exact-money guard refuses (a CLI display bound is none of
its sanctioned kinds). The values stay the shared constants.
*/
function factFor(name: string): CliOptionFact | undefined {
  switch (name) {
    case 'backend': {
      return { kind: 'enum', values: ACP_BACKENDS, default: ACP_DEFAULT_BACKEND }
    }
    case 'shell-sandbox': {
      return {
        kind: 'enum',
        values: SHELL_SANDBOX_MODES,
        default: SETTING_DEFAULTS.shellSandbox,
      }
    }
    case 'permission-mode': {
      return { kind: 'enum', values: EXEC_MODES, default: EXEC_DEFAULT_MODE }
    }
    case 'output': {
      return { kind: 'enum', values: EXEC_OUTPUTS, default: EXEC_DEFAULT_OUTPUT }
    }
    case 'effort': {
      // `none` (Thinking off) rides beside the tiers: parseExec takes it and
      // the record decides what the wire carries (lane REASONSHAPESR2).
      return { kind: 'enum', values: [...EFFORT_LEVELS, THINKING_OFF_EFFORT] }
    }
    case 'max-requests': {
      // No default of ours: unset, a run has no request limit. No maximum
      // of ours either: a set value is any positive safe integer.
      return {
        kind: 'range',
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }
    }
    case 'timeout': {
      // No default of ours: unset, a run has no deadline. No maximum
      // of ours either: a set value is any positive safe integer.
      return {
        kind: 'range',
        min: 1,
        max: Number.MAX_SAFE_INTEGER,
      }
    }
    case 'scan-timeout': {
      // D121: no default and no maximum of ours — absent runs until the
      // scan finishes; a set value is whole seconds the platform timer can
      // hold, so the range ends where setTimeout overflows.
      return {
        kind: 'range',
        min: 1,
        max: Math.floor(TIMER_MAX_DELAY_MS / MILLISECONDS_PER_SECOND),
        unit: 'seconds',
      }
    }
    case 'max-budget-usd': {
      // D208: the person's budget has no ceiling of ours, so no bound fact;
      // the meaning sentence carries the exact decimal grammar.
      return undefined
    }
    case 'usage-history': {
      return { kind: 'enum', values: ['on', 'off'], default: 'on' }
    }
    case 'range': {
      return { kind: 'enum', values: ['today', '7d', '30d', '90d', 'custom'], default: '30d' }
    }
    case 'by': {
      return { kind: 'enum', values: ['provider', 'model', 'kind', 'client'] }
    }
    case 'resource-governor': {
      return { kind: 'enum', values: ['on', 'off'], default: 'on' }
    }
    case 'providersAdd:format': {
      return { kind: 'enum', values: ['chat', 'responses', 'anthropic'] }
    }
    case 'legal:format': {
      return { kind: 'enum', values: ['text', 'json'] }
    }
    case 'providersAdd:privacy': {
      return { kind: 'enum', values: ['zdr', 'no-training', 'any'] }
    }
    case 'share:mode': {
      return { kind: 'enum', values: SHARE_MODES, default: SHARING_DEFAULTS.mode }
    }
    case 'share:format': {
      return { kind: 'enum', values: SHARE_FORMATS, default: SHARING_DEFAULTS.format }
    }
    case 'share:destination': {
      // No default: without --out it is copy, with --out it is file.
      return { kind: 'enum', values: SHARE_DESTINATIONS }
    }
    case 'prompts:scope': {
      return { kind: 'enum', values: PROMPT_SCOPES, default: SHARING_DEFAULTS.scope }
    }
    case 'prompts:chat': {
      return { kind: 'enum', values: PROMPT_CHATS, default: SHARING_DEFAULTS.chat }
    }
    default: {
      return undefined
    }
  }
}

/** The options serve and login take the same way. */
const SERVE_FAMILY_OPTIONS: readonly CliHelpOption[] = [
  { name: 'backend', shape: '', fact: factFor('backend') },
  { name: 'trust-workspace', shape: '' },
  { name: 'muse-binary', shape: '<path>' },
  { name: 'shell-sandbox', shape: '', fact: factFor('shell-sandbox') },
  { name: 'allow-dangerously-skip-permissions', shape: '' },
  { name: 'allow-contributor-models', shape: '' },
  { name: 'verbose', shape: '' },
  { name: 'questions-defer-after', shape: '<seconds>' },
  { name: 'web-search', shape: '' },
  { name: 'image-generation', shape: '' },
  { name: 'muse-voice', shape: '' },
  { name: 'auto-compaction', shape: '' },
  { name: 'no-auto-compaction', shape: '' },
  { name: 'usage-history', shape: '', fact: factFor('usage-history') },
]

/** The exit row for commands with no exit table of their own (CLI_EXIT). */
const GENERIC_EXITS = {
  exits: (table: UiText) => table.genericExits,
  exitCodes: [CLI_EXIT.ok, CLI_EXIT.failure, CLI_EXIT.usage],
} as const

/**
share/prompts exit on their handler's own codes: the CLI-wide row plus
EXEC_EXIT.denied for a cancelled or refused share (sharing/commands.ts).
*/
const SHARING_EXITS = {
  exits: (table: UiText) => table.sharingExits,
  exitCodes: [CLI_EXIT.ok, EXEC_EXIT.denied, CLI_EXIT.usage, CLI_EXIT.failure],
} as const

/** The one table behind parsing and help: topic names, in help order. */
export const CLI_HELP_TOPICS: readonly CliHelpTopic[] = [
  {
    name: 'serve',
    purpose: (table) => table.cliHelp.purposeServe,
    usage: [(command) => `${command} [options]`],
    routes: ['serve'],
    options: [
      ...SERVE_FAMILY_OPTIONS,
      { name: 'max-budget-usd', shape: '<amount>', fact: factFor('max-budget-usd') },
      { name: 'subscription', shape: '' },
      { name: 'scheduled-prompts', shape: '' },
      { name: 'hardware', shape: '' },
      { name: 'help', shape: '' },
      { name: 'version', shape: '' },
    ],
    examples: [
      (command) => command,
      (command) => `${command} --backend modelApi --trust-workspace`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'login',
    purpose: (table) => table.cliHelp.purposeLogin,
    usage: [(command) => `${command} [options] login`],
    routes: ['login'],
    options: [...SERVE_FAMILY_OPTIONS, { name: 'help', shape: '' }, { name: 'version', shape: '' }],
    examples: [(command) => `${command} login`, (command) => `${command} --backend modelApi login`],
    ...GENERIC_EXITS,
  },
  {
    name: 'auth',
    purpose: (table) => table.cliHelp.purposeAuth,
    note: (table) => table.cliHelp.authSetNote,
    usage: [
      (command) => `${command} auth set|status|clear`,
      (command) => `${command} auth set|status|clear --provider <id>`,
    ],
    routes: ['authSet', 'authStatus', 'authClear'],
    options: [
      { name: 'provider', shape: '<id>' },
      { name: 'account', shape: '<id>' },
      { name: 'admin', shape: '' },
      { name: 'help', shape: '' },
      { name: 'version', shape: '' },
    ],
    examples: [
      (command) => `${command} auth status`,
      (command) => `${command} auth status --provider openrouter`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'providers',
    purpose: (table) => table.cliHelp.purposeProviders,
    note: (table) => table.cliHelp.modelsCustomReadOnly,
    usage: [
      (command) => `${command} providers list|add|test|refresh|remove`,
      (command) => `${command} providers models <entry> [--add <model>] [--remove <model>]`,
      (command) => `${command} providers headers <id> [set|unset <name>]`,
      (command) => `${command} providers usage <id> [--days <n>] [--output json]`,
    ],
    routes: ['providersAdd', 'providersModels', 'providersHeaders', 'providersUsage'],
    options: [
      { name: 'preset', shape: '<preset>' },
      { name: 'as', shape: '<id>' },
      { name: 'address', shape: '<url>' },
      {
        name: 'format',
        shape: '<format>',
        fact: factFor('providersAdd:format'),
      },
      { name: 'model', shape: '<model>' },
      {
        name: 'privacy',
        shape: '<policy>',
        fact: factFor('providersAdd:privacy'),
      },
      { name: 'private-ok', shape: '' },
      { name: 'key-stdin', shape: '' },
      { name: 'context-window', shape: '<tokens>' },
      { name: 'add', shape: '<model>' },
      { name: 'remove', shape: '<model>' },
      { name: 'force', shape: '<reason>' },
      { name: 'days', shape: '<n>' },
      { name: 'output', shape: '<format>' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} providers list`,
      (command) => `${command} providers models openrouter`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'exec',
    purpose: (table) => table.cliHelp.purposeExec,
    usage: [
      (command) => `${command} exec [options] <prompt>`,
      (command) => `${command} exec [options] --prompt-file <path>`,
      (command) => `${command} exec [options] -`,
    ],
    routes: ['exec'],
    options: [
      { name: 'backend', shape: '', fact: factFor('backend') },
      { name: 'provider', shape: '<id>' },
      { name: 'model', shape: '<model>' },
      { name: 'effort', shape: '', fact: factFor('effort') },
      { name: 'fast', shape: '' },
      { name: 'permission-mode', shape: '', fact: factFor('permission-mode') },
      { name: 'output', shape: '', fact: factFor('output') },
      { name: 'max-budget-usd', shape: '<amount>', fact: factFor('max-budget-usd') },
      { name: 'max-requests', shape: '<count>', fact: factFor('max-requests') },
      { name: 'max-output-tokens', shape: '<tokens>' },
      { name: 'timeout', shape: '<seconds>', fact: factFor('timeout') },
      { name: 'cwd', shape: '<directory>' },
      { name: 'prompt-file', shape: '<file>' },
      { name: 'output-schema', shape: '<file>' },
      { name: 'output-schema-outside', shape: '' },
      { name: 'untrusted-file', shape: '<file>' },
      { name: 'attach', shape: '<file>' },
      { name: 'account', shape: '<id>' },
      { name: 'account-pool', shape: '' },
      { name: 'team', shape: '' },
      { name: 'allow-contributor-models', shape: '' },
      { name: 'muse-binary', shape: '<path>' },
      { name: 'shell-sandbox', shape: '', fact: factFor('shell-sandbox') },
      { name: 'image-generation', shape: '' },
      { name: 'fail-on-denial', shape: '' },
      { name: 'ephemeral', shape: '' },
      { name: 'key-stdin', shape: '' },
      { name: 'subscription', shape: '' },
      { name: 'vault', shape: '' },
      { name: 'verbose', shape: '' },
      { name: 'auto-compaction', shape: '' },
      { name: 'no-auto-compaction', shape: '' },
      { name: 'resource-governor', shape: '', fact: factFor('resource-governor') },
      { name: 'cpu-max', shape: '<percent>' },
      { name: 'memory-max', shape: '<percent>' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} exec --backend modelApi --max-budget-usd 1 'Summarise this repo'`,
      (command) => `${command} exec --permission-mode plan --output json 'List the risks'`,
    ],
    exits: (table) => table.execExits,
    exitCodes: Object.values(EXEC_EXIT),
  },
  {
    name: 'scan-secrets',
    purpose: (table) => table.cliHelp.purposeScanSecrets,
    usage: [(command) => `${command} scan-secrets <file> [--key-stdin] [--timeout <seconds>]`],
    routes: ['scan-secrets'],
    options: [
      { name: 'key-stdin', shape: '' },
      { name: 'timeout', shape: '<seconds>', fact: factFor('scan-timeout') },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} scan-secrets patch.diff`,
      (command) => `${command} scan-secrets patch.diff --key-stdin < key.txt`,
    ],
    exits: (table) => table.scanSecretsExits,
    exitCodes: [CLI_EXIT.ok, EXEC_SCAN_EXIT_FOUND, CLI_EXIT.usage],
  },
  {
    name: 'report',
    purpose: (table) => table.cliHelp.purposeReport,
    usage: [(command) => `${command} report [options]`],
    routes: ['report'],
    options: [
      { name: 'out', shape: '<file>' },
      { name: 'description', shape: '<text>' },
      { name: 'no-facts', shape: '' },
      { name: 'no-events', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} report`,
      (command) => `${command} report --out report.md --description 'Panel froze on startup'`,
    ],
    exits: (table) => table.reportExits,
    exitCodes: [REPORT_EXIT_CODES.generated, REPORT_EXIT_CODES.failed, REPORT_EXIT_CODES.usage],
  },
  {
    name: 'legal',
    purpose: (table) => table.cliHelp.purposeLegal,
    usage: [(command) => `${command} legal [options]`],
    routes: ['legal'],
    options: [
      { name: 'json', shape: '' },
      { name: 'format', shape: '<format>', fact: factFor('legal:format') },
      { name: 'out', shape: '<file>' },
      { name: 'registry', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} legal`,
      (command) => `${command} legal --format json --out legal.json`,
    ],
    exits: (table) => table.legalExits,
    exitCodes: Object.values(LEGAL_EXIT),
  },
  {
    name: 'fonts',
    purpose: (table) => table.cliHelp.purposeFonts,
    usage: [(command) => `${command} fonts install [--from <directory>]`],
    routes: ['fontsInstall'],
    options: [
      { name: 'from', shape: '<directory>' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} fonts install`,
      (command) => `${command} fonts install --from ~/fonts`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'lsp',
    purpose: (table) => table.cliHelp.purposeLsp,
    note: (table) => table.cliHelp.noteLsp,
    usage: [(command) => `${command} lsp [--trust-workspace] [--tab] [options]`],
    routes: ['lsp'],
    options: [
      { name: 'workspace', shape: '<directory>' },
      { name: 'trust-workspace', shape: '' },
      { name: 'tab', shape: '' },
      {
        name: 'tab-model',
        shape: '<model>',
        fact: { kind: 'enum', values: TAB_MODELS, default: SETTING_DEFAULTS.tabModel },
      },
      { name: 'allow-contributor-models', shape: '' },
      { name: 'tab-daily-budget-usd', shape: '<usd>' },
      { name: 'tab-max-output-tokens', shape: '<tokens>' },
      {
        name: 'tab-trigger',
        shape: '',
        fact: { kind: 'enum', values: TAB_TRIGGER_MODES, default: SETTING_DEFAULTS.tabTrigger },
      },
      { name: 'verbose', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} lsp --trust-workspace --tab`,
      (command) => `${command} supervise lsp --trust-workspace --tab --tab-daily-budget-usd 2`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'supervise',
    purpose: (table) => table.cliHelp.purposeSupervise,
    usage: [(command) => `${command} supervise [<command> [options]]`],
    routes: [],
    // Everything after the word is the supervised command's own.
    options: [],
    examples: [
      (command) => `${command} supervise lsp --trust-workspace --tab`,
      (command) => `${command} supervise --backend modelApi`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'stop',
    purpose: (table) => table.cliHelp.purposeStop,
    usage: [(command) => `${command} stop`],
    routes: ['stop'],
    options: [{ name: 'help', shape: '' }],
    examples: [(command) => `${command} stop`, (command) => `${command} stop --help`],
    ...GENERIC_EXITS,
  },
  {
    name: 'panel',
    purpose: (table) => table.cliHelp.purposePanel,
    note: (table) => table.cliHelp.notePanel,
    usage: [(command) => `${command} panel --stdio [--workspace <directory>]`],
    routes: ['panel'],
    options: [
      { name: 'stdio', shape: '' },
      { name: 'workspace', shape: '<directory>' },
      { name: 'verbose', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} panel --stdio`,
      (command) => `${command} supervise panel --stdio --workspace .`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'playbook',
    purpose: (table) => table.cliHelp.purposePlaybook,
    usage: [
      (command) => `${command} playbook <status|record|settings ...>`,
      (command) => `${command} playbook run <name> [--heavy] [--full-gate]`,
    ],
    routes: [],
    // The run flags parse downstream with the rest of the playbook
    // grammar, so the usage line carries them, not the option rows.
    options: [],
    examples: [
      (command) => `${command} playbook status`,
      (command) => `${command} playbook run checks`,
    ],
    exits: (table) => table.playbookExits,
    exitCodes: [CLI_EXIT.ok, CLI_EXIT.failure, CLI_EXIT.usage],
  },
  {
    name: 'watchdog',
    purpose: (table) => table.cliHelp.purposeWatchdog,
    usage: [
      (command) =>
        `${command} watchdog <list|status|pause|resume|poll|policy|evidence|apply|decide|resolve ...>`,
    ],
    routes: [],
    options: [],
    examples: [
      (command) => `${command} watchdog list`,
      (command) => `${command} watchdog poll owner/name`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'setup',
    purpose: (table) => table.cliHelp.purposeSetup,
    usage: [(command) => `${command} --trust-workspace setup [--maintenance]`],
    routes: ['setup'],
    options: [
      { name: 'trust-workspace', shape: '' },
      { name: 'maintenance', shape: '' },
      { name: 'verbose', shape: '' },
      { name: 'help', shape: '' },
      { name: 'version', shape: '' },
    ],
    examples: [
      (command) => `${command} --trust-workspace setup`,
      (command) => `${command} --trust-workspace setup --maintenance`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'usage',
    purpose: (table) => table.cliHelp.purposeUsage,
    usage: [(command) => `${command} usage [summary|daily|models|limits|export|open] [options]`],
    routes: ['usage'],
    options: [
      { name: 'range', shape: '', fact: factFor('range') },
      { name: 'by', shape: '', fact: factFor('by') },
      { name: 'from', shape: '<date>' },
      { name: 'to', shape: '<date>' },
      { name: 'json', shape: '' },
      { name: 'csv', shape: '' },
      { name: 'out', shape: '<file>' },
      { name: 'stdio', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} usage`,
      (command) => `${command} usage models --range 7d --json`,
    ],
    ...GENERIC_EXITS,
  },
  {
    name: 'resources',
    purpose: (table) => table.cliHelp.purposeResources,
    usage: [(command) => `${command} resources [status|history|resume] [--json]`],
    routes: ['resources'],
    options: [
      { name: 'json', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} resources`,
      (command) => `${command} resources history --json`,
    ],
    ...GENERIC_EXITS,
  },
  // The sharing commands are parsed by the owner parser in sharing/args.ts;
  // the registry mirrors its flags (help-only routes: the strict table never
  // sees them) so the screens render their options from the same table.
  {
    name: 'share',
    purpose: (table) => table.cliHelp.purposeShare,
    usage: [
      (command) =>
        `${command} share chat [--mode full|conversation] [--format md|html|json] [--destination copy|file|browser] [--out <file>]`,
    ],
    routes: ['share'],
    options: [
      { name: 'mode', shape: '', fact: factFor('share:mode') },
      { name: 'format', shape: '', fact: factFor('share:format') },
      { name: 'destination', shape: '', fact: factFor('share:destination') },
      { name: 'out', shape: '<file>' },
      { name: 'from', shape: '<message>' },
      { name: 'to', shape: '<message>' },
      { name: 'no-code-blocks', shape: '' },
      { name: 'no-attachment-names', shape: '' },
      { name: 'diffs', shape: '' },
      { name: 'attachment-content', shape: '<kind>' },
      { name: 'exported-at', shape: '<time>' },
      { name: 'confirm', shape: '<preview-id>' },
      { name: 'json', shape: '' },
      { name: 'cwd', shape: '<directory>' },
    ],
    examples: [
      (command) => `${command} share chat --mode conversation`,
      (command) => `${command} share chat --destination file --out chat.md`,
    ],
    ...SHARING_EXITS,
  },
  {
    name: 'prompts',
    purpose: (table) => table.cliHelp.purposePrompts,
    usage: [
      (command) => `${command} prompts list [--search <text>] [--tag <tag>]`,
      (command) => `${command} prompts save --title <text> [--scope user|workspace]`,
      (command) => `${command} prompts use <id> [--var <name=value>] [--confirm]`,
    ],
    routes: ['prompts'],
    options: [
      { name: 'scope', shape: '', fact: factFor('prompts:scope') },
      { name: 'search', shape: '<text>' },
      { name: 'tag', shape: '<tag>' },
      { name: 'title', shape: '<title>' },
      { name: 'chat', shape: '', fact: factFor('prompts:chat') },
      { name: 'var', shape: '<name=value>' },
      { name: 'confirm', shape: '' },
      { name: 'json', shape: '' },
      { name: 'cwd', shape: '<directory>' },
    ],
    examples: [
      (command) => `${command} prompts list --search deploy`,
      (command) => `${command} prompts use standup --var name=Ana --confirm`,
    ],
    ...SHARING_EXITS,
  },
  {
    name: 'judge',
    purpose: (table) => table.cliHelp.purposeJudge,
    note: (table) => table.cliHelp.judgeServeLintNote,
    usage: [
      (command) => `${command} judge ask|calibrate|report|mcp [options] < request.json`,
      (command) => `${command} judge serve|lint [options]`,
    ],
    routes: ['judge'],
    options: [
      { name: 'engine', shape: '<engine>' },
      { name: 'model', shape: '<model>' },
      { name: 'separate', shape: '<id>' },
      { name: 'budget-usd', shape: '<usd>' },
      { name: 'timeout-ms', shape: '<ms>' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} judge ask --engine separate --separate local:tev1 < request.json`,
      (command) => `${command} judge lint --changed`,
    ],
    ...GENERIC_EXITS,
  },
]

/** Every topic by its command name. */
export function helpTopicNamed(name: string): CliHelpTopic | undefined {
  return CLI_HELP_TOPICS.find((topic) => topic.name === name)
}

/** The parser's accepted option names behind one topic. */
export function topicOptionNames(topic: CliHelpTopic): string[] {
  return topic.routes.flatMap((route) => Object.keys(CLI_OPTION_REGISTRY[route].options))
}

/**
Accepted by the parser but not offered yet: automatic compaction until its
evaluation passes, and the dormant schedule-v2 admission flag. Help and
refusals never name them, as the compact usage never has.
*/
function isDormantOption(name: string): boolean {
  return (
    name === 'scheduled-prompts' ||
    ((name === 'auto-compaction' || name === 'no-auto-compaction') && !isAutoCompactionEvaluated())
  )
}

/** The option names one topic's help shows: what error messages may name. */
export function topicShownOptionNames(topic: CliHelpTopic): string[] {
  return topic.options.map((option) => option.name).filter((name) => !isDormantOption(name))
}

/**
Option descriptions come from the installed language's table. A route's
`text` map picks a route-specific description (share's message range, not
the generic from/to); otherwise the option name is the key.
*/
function optionMeaning(table: UiText, route: CliHelpRoute | undefined, name: string): string {
  const meanings: Readonly<Record<string, string>> = table.referenceCliOptions
  if (route !== undefined) {
    const entry = CLI_OPTION_REGISTRY[route]
    // Only share and prompts carry a text map today; the lookup keeps the
    // map's keys inside referenceCliOptions, so a wrong key fails typecheck.
    if ('text' in entry) {
      const hit = Object.entries(entry.text).find(([key]) => key === name)?.[1]
      if (hit !== undefined) return meanings[hit] ?? name
    }
  }
  return meanings[name] ?? name
}

function factNote(table: UiText, fact: CliOptionFact): string | undefined {
  switch (fact.kind) {
    case 'enum': {
      const accepts = fill(table.cliHelp.accepts, { values: fact.values.join('|') })
      return fact.default === undefined
        ? accepts
        : `${accepts}; ${fill(table.cliHelp.defaultIs, { value: fact.default })}`
    }
    case 'range': {
      const unit = fact.unit === undefined ? '' : ` ${fact.unit}`
      const accepts = fill(table.cliHelp.accepts, {
        values: `${String(fact.min)}–${String(fact.max)}${unit}`,
      })
      return fact.default === undefined
        ? accepts
        : `${fill(table.cliHelp.defaultIs, { value: String(fact.default) })}; ${accepts}`
    }
    case 'maximum': {
      const unit = fact.unit === undefined ? '' : ` ${fact.unit}`
      return fill(table.cliHelp.atMost, { value: `${String(fact.max)}${unit}` })
    }
  }
}

/** One rendered option row: name, shape, meaning, bounds, default, repeatable. */
export function renderOptionRow(table: UiText, route: CliHelpRoute, option: CliHelpOption): string {
  const definition = Object.entries(CLI_OPTION_REGISTRY[route].options).find(
    ([name]) => name === option.name,
  )?.[1]
  // The union's `multiple` is literal `true` today; the comparison stays so
  // a future table that writes `multiple: false` explicitly still renders
  // single. (PLAN.md §8.)
  /* eslint-disable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-boolean-literal-compare, unicorn/no-unnecessary-boolean-comparison */
  const isRepeatable =
    definition !== undefined && 'multiple' in definition && definition.multiple === true
  /* eslint-enable @typescript-eslint/no-unnecessary-condition, @typescript-eslint/no-unnecessary-boolean-literal-compare, unicorn/no-unnecessary-boolean-comparison */
  // Descriptions may contain a legacy rendered prefix. Keep its translated
  // prose, but the table alone owns the flag and required value syntax.
  const meaning = optionMeaning(table, route, option.name).replace(
    /^--[\w-]+(?::\s*|\s+(?:<[^>]+>|[\w-]+(?:\|[\w-]+)+|YYYY-MM-DD)(?::\s*|\s{2,})|\s{2,})/,
    '',
  )
  const notes: string[] = []
  const note = option.fact === undefined ? undefined : factNote(table, option.fact)
  if (note !== undefined) notes.push(note)
  if (isRepeatable) notes.push(table.cliHelp.repeatable)
  const suffix = notes.length === 0 ? '' : ` (${notes.join('; ')})`
  let shape = option.shape === '' ? '' : ` ${option.shape}`
  if (option.fact?.kind === 'enum' && option.shape === '') {
    shape = ` ${option.fact.values.join('|')}`
  }
  return `  --${option.name}${shape}  ${meaning}${suffix}`
}

/** A command's own usage, options with defaults and bounds, and two examples. */
export function renderTopicHelp(table: UiText, command: string, topic: CliHelpTopic): string {
  const lines: string[] = [table.cliHelp.usage]
  for (const usage of topic.usage) lines.push(`  ${usage(command)}`)
  lines.push(`  ${topic.purpose(table)}`)
  if (topic.note !== undefined) lines.push(`  ${topic.note(table)}`)
  const shown = topic.options.filter((option) => !isDormantOption(option.name))
  if (shown.length > 0) {
    lines.push(table.cliHelp.options)
    for (const option of shown) {
      const route = topic.routes.find((candidate) =>
        Object.keys(CLI_OPTION_REGISTRY[candidate].options).includes(option.name),
      )
      lines.push(
        route === undefined
          ? `  --${option.name}  ${optionMeaning(table, undefined, option.name)}`
          : renderOptionRow(table, route, option),
      )
    }
  }
  lines.push(table.cliHelp.examples)
  for (const example of topic.examples) lines.push(`  ${example(command)}`)
  lines.push(table.cliHelp.exits, `  ${topic.exits(table)}`)
  return lines.join('\n')
}

/** The top-level help: the compact usage plus every command's purpose. */
export function renderTopHelp(table: UiText, command: string): string {
  const lines: string[] = [formatAcpUsage(table, command), table.cliHelp.commands]
  for (const topic of CLI_HELP_TOPICS) lines.push(`  ${topic.name}  ${topic.purpose(table)}`)
  // Serve-only options the global list does not name (D120: --max-budget-usd).
  // Dormant flags (the schedule-v2 admission flag, automatic compaction until
  // its evaluation passes) stay out of every help and refusal.
  const serveOnly = Object.keys(CLI_OPTION_REGISTRY.serve.options).filter(
    (name) =>
      !isDormantOption(name) && !Object.keys(CLI_OPTION_REGISTRY.login.options).includes(name),
  )
  for (const name of serveOnly) {
    const option = CLI_HELP_TOPICS.find((topic) => topic.name === 'serve')?.options.find(
      (candidate) => candidate.name === name,
    )
    if (option === undefined) continue
    lines.push(renderOptionRow(table, 'serve', option).replace(/^ {2}--/, '  serve: --'))
  }
  lines.push(fill(table.cliHelp.topHint, { command }), fill(table.cliHelp.allHint, { command }))
  return lines.join('\n')
}

/**
Words that mark an unknown option as a possible credential route: such a
name is never repeated in the refusal, so a mistyped secret flag cannot
reach the terminal output, logs or reports.
*/
const SECRET_OPTION_WORDS: readonly string[] = [
  'secret',
  'token',
  'password',
  'passwd',
  'passphrase',
  'pwd',
  'credential',
  'bearer',
  // Any `*key*` spelling (`api-key`, `session-key`, `authkey`, …) names a
  // credential route; hiding a harmless typo costs less than echoing a key.
  'key',
]

/** An unknown option name that may carry a credential is never echoed. */
export function isSecretLookingOption(name: string): boolean {
  // `api-key`, `api_key` and `apikey` name the same credential route:
  // compare with the separators removed.
  const squashed = name.toLowerCase().replaceAll(/[-_]/g, '')
  return SECRET_OPTION_WORDS.some((word) => squashed.includes(word))
}

/**
A wrong option or value: one sentence naming the option and the accepted
values, the nearest valid option when the name is close, and the command's
own help. Nothing is run; the caller exits 2. A secret-looking name is
refused without repeating it.
*/
export function unknownOptionReason(
  table: UiText,
  command: string,
  topic: string,
  valid: readonly string[],
  raw: string,
): string {
  const match = /--([a-zA-Z][a-zA-Z0-9_-]*)/.exec(raw)
  const wanted = match?.[1]
  const accepted = valid.map((name) => `--${name}`).join(', ')
  // A name the parser message does not expose as a long option (a short
  // flag, an odd spelling) is refused without repeating anything at all.
  const first =
    wanted === undefined || isSecretLookingOption(wanted)
      ? fill(table.cliHelp.unknownOptionHidden, { cmd: topic, accepted })
      : fill(table.cliHelp.unknownOption, { option: `--${wanted}`, cmd: topic, accepted })
  const lines = [first]
  const nearest = wanted === undefined ? undefined : nearestOptionName(wanted, valid)
  if (nearest !== undefined)
    lines.push(fill(table.cliHelp.suggestOption, { nearest: `--${nearest}` }))
  lines.push(fill(table.cliHelp.seeHelp, { command, topic }))
  return lines.join(' ')
}

/**
Parsed but not shown in the topic's help: refused outright on that route
or accepted and ignored there (the reference contract's `refused` and
`acceptedUnused`). The guard test requires every registry option to be
either in its topic or in this map, so a parsed option cannot hide.
*/
/** `auth status` and `auth clear` refuse and ignore the same flags. */
const AUTH_STATUS_CLEAR_NON_TOPIC: readonly string[] = [
  'usage-history',
  'backend',
  'no-auto-compaction',
  'trust-workspace',
  'maintenance',
  'muse-binary',
  'shell-sandbox',
  'allow-dangerously-skip-permissions',
  'allow-contributor-models',
  'auto-compaction',
  'web-search',
  'image-generation',
  'muse-voice',
  'verbose',
  'questions-defer-after',
  'hardware',
  'account',
  'preset',
  'as',
  'address',
  'format',
  'model',
  'privacy',
  'private-ok',
  'key-stdin',
  'context-window',
  // PROVSPEND: parsed for the providers routes, refused on the auth route.
  'days',
  'output',
]

export const CLI_NON_TOPIC_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  serve: [
    'provider',
    'account',
    'preset',
    'as',
    'address',
    'format',
    'model',
    'privacy',
    'private-ok',
    'key-stdin',
    'context-window',
    'maintenance',
    // PROVSPEND: parsed for the providers routes, refused on serve.
    'days',
    'admin',
    'output',
  ],
  login: [
    'provider',
    'account',
    'preset',
    'as',
    'address',
    'format',
    'model',
    'privacy',
    'private-ok',
    'key-stdin',
    'context-window',
    'maintenance',
    // PROVSPEND: parsed for the providers routes, refused on login.
    'days',
    'admin',
    'output',
    'hardware',
  ],
  authSet: [
    'usage-history',
    'backend',
    'no-auto-compaction',
    'trust-workspace',
    'maintenance',
    'muse-binary',
    'shell-sandbox',
    'allow-dangerously-skip-permissions',
    'allow-contributor-models',
    'auto-compaction',
    'web-search',
    'image-generation',
    'muse-voice',
    'verbose',
    'questions-defer-after',
    'hardware',
    'preset',
    'as',
    'address',
    'format',
    'model',
    'privacy',
    'private-ok',
    'key-stdin',
    'context-window',
    // PROVSPEND: parsed for the providers routes, refused on the auth route.
    'days',
    'output',
  ],
  authStatus: AUTH_STATUS_CLEAR_NON_TOPIC,
  authClear: AUTH_STATUS_CLEAR_NON_TOPIC,
  setup: [
    'usage-history',
    'preset',
    'as',
    'address',
    'format',
    'model',
    'privacy',
    'private-ok',
    'key-stdin',
    'context-window',
    'provider',
    'backend',
    'no-auto-compaction',
    'account',
    'muse-binary',
    'shell-sandbox',
    'allow-dangerously-skip-permissions',
    'allow-contributor-models',
    'auto-compaction',
    'web-search',
    'image-generation',
    'muse-voice',
    'questions-defer-after',
    // PROVSPEND: parsed for the providers routes, refused on setup.
    'days',
    'admin',
    'output',
    'hardware',
  ],
  exec: [
    'trust-workspace',
    'allow-dangerously-skip-permissions',
    'web-search',
    'record',
    // Parsed and reference-documented, but off the one screen: the setting
    // text carries the guard/spill/removal description (lane TOOLCAP).
    'max-tool-output-bytes',
  ],
  // PROVSPEND: `auth set|clear --admin` is shown on the auth topic, not here.
  providersAdd: ['admin'],
  providersModels: [],
  providersHeaders: [],
  usage: [],
  legal: [],
  report: [],
  resources: [],
  fontsInstall: [],
  'scan-secrets': [],
  lsp: [],
  stop: [],
  panel: [],
}
