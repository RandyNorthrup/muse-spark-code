import {
  ACCOUNT_REQUEST_CERTIFICATION,
  isAutoCompactionEvaluated,
  SCHEDULE_EDITOR_DELIVERY_CERTIFICATION,
} from '../shared/constants'
import { ESTIMATE_OPTIONS } from './estimator/options'
import {
  PROMPTS_LIST_FLAGS,
  PROMPTS_SAVE_FLAGS,
  PROMPTS_SCOPE_FLAG,
  PROMPTS_USE_FLAGS,
  SHARE_FLAGS,
  SHARING_BASE_FLAGS,
} from '../shared/sharingFlags'
import type { UiText } from '../shared/l10n/en'
import { sharingHelp } from '../shared/featureCatalog'
import { fill } from '../shared/l10n/text'

function sharingCliHelp(table: UiText, command: string): string {
  return [
    `${command} share chat SESSION_ID [--mode full|conversation] [--format md|html|json] [--destination copy|file|browser] [--out FILE]`,
    `${command} prompts save --title TITLE [--scope user|workspace] [--cwd FOLDER] < prompt.txt`,
    `${command} prompts list [--search TEXT] [--tag TAG] [--cwd FOLDER]`,
    `${command} prompts use ID [--scope user|workspace] [--chat active|new] [--cwd FOLDER]`,
    `${command} prompts share ID [--scope user|workspace] [--format md|html|json] [--destination copy|file|browser] [--out FILE]`,
    table.promptSecretsNote,
  ].join('\n')
}

/** Compact CLI help, also checked against the installed package's tables. */
export function formatAcpUsage(table: UiText, command: string): string {
  const options = {
    [ACP_PAID_FLAGS.autoCompaction]: table.referenceCliOptions[ACP_PAID_FLAGS.autoCompaction],
    'no-auto-compaction': table.referenceCliOptions['no-auto-compaction'],
  }
  return [
    fill(table.acpUsage, { command }),
    ...(SCHEDULE_EDITOR_DELIVERY_CERTIFICATION.isReady
      ? [table.scheduleV2.runtime.usage, table.referenceCliOptions['scheduled-prompts']]
      : []),
    fill(table.acpChatGpt.usage, { command }),
    fill(table.acpGrok.usage, { command }),
    sharingCliHelp(table, command),
    table.referenceCliOptions['context-window'],
    sharingHelp(table),
    // CM108ACC: account metadata and per-account keys are served. The exec
    // line (`accounts.execHelp`) offers pooling, which is still refused, and
    // stays out until its owner is bound.
    fill(table.accounts.cliUsage, { command }),
    ACCOUNT_REQUEST_CERTIFICATION.isComplete
      ? fill(table.accounts.execHelp, { command })
      : fill(table.accounts.execHelp, { command }).replace(' [--account-pool]', ''),
    ...Object.entries(options)
      .filter(
        ([option]) =>
          isAutoCompactionEvaluated() ||
          (option !== ACP_PAID_FLAGS.autoCompaction && option !== 'no-auto-compaction'),
      )
      .map(([option, description]) => `  --${option} ${description}`),
    `${command} resources [status|history|resume] [--json]`,
    `${command} usage resources [--json]`,
    ...(['resource-governor', 'cpu-max', 'memory-max'] as const).map(
      (flag) => table.referenceCliOptions[flag],
    ),
    `${table.helpReferenceTitle}: ${command} help --all`,
  ].join('\n')
}

// One parseArgs definition per runtime route, also read by the lazy reference.
interface CliParserOption {
  readonly type: 'string' | 'boolean'
  readonly short?: string
  readonly multiple?: boolean
}
type CliParserOptions = Readonly<Record<string, CliParserOption>>
import { ACP_PAID_FLAGS } from '../shared/constants'
import { COMPANION_VOICE_RELEASE } from '../shared/companionVoice'

const PROVIDER_OPTIONS = {
  preset: { type: 'string' },
  as: { type: 'string' },
  address: { type: 'string' },
  format: { type: 'string' },
  model: { type: 'string', multiple: true },
  'context-window': { type: 'string' },
  privacy: { type: 'string' },
  'private-ok': { type: 'boolean' },
  'key-stdin': { type: 'boolean' },
  // PROVSPEND: `providers usage <id> [--days n] [--output json]` and
  // `auth set|clear --provider <id> --admin`. Serve and login still refuse
  // these through NON_SERVE_OPTIONS in cliArgs; the auth route refuses
  // everything but `admin` beside its own targeting.
  days: { type: 'string' },
  admin: { type: 'boolean' },
  output: { type: 'string' },
} as const satisfies CliParserOptions

const COMMON_OPTIONS = {
  ...(COMPANION_VOICE_RELEASE.isReady && { 'muse-voice': { type: 'boolean' as const } }),
  ...PROVIDER_OPTIONS,
  'usage-history': { type: 'string' },

  provider: { type: 'string' },
  backend: { type: 'string' },
  'no-auto-compaction': { type: 'boolean' },
  account: { type: 'string' },
  'trust-workspace': { type: 'boolean' },
  maintenance: { type: 'boolean' },
  'muse-binary': { type: 'string' },
  'shell-sandbox': { type: 'string' },
  'allow-dangerously-skip-permissions': { type: 'boolean' },
  'allow-contributor-models': { type: 'boolean' },
  [ACP_PAID_FLAGS.autoCompaction]: { type: 'boolean' },
  [ACP_PAID_FLAGS.webSearch]: { type: 'boolean' },
  [ACP_PAID_FLAGS.imageGeneration]: { type: 'boolean' },
  [ACP_PAID_FLAGS.voice]: { type: 'boolean' },
  verbose: { type: 'boolean' },
  'questions-defer-after': { type: 'string' },
  hardware: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const satisfies CliParserOptions

// Serve accepts X's paid-schedule admission flags; no other route does.
// C-M95-SUB: serve and exec accept the subscription opt-in; auth and login
// refuse it as unknown instead of silently ignoring it.
const SERVE_OPTIONS = {
  ...COMMON_OPTIONS,
  'scheduled-prompts': { type: 'boolean' },
  subscription: { type: 'boolean' },
  'max-budget-usd': { type: 'string' },
} as const satisfies CliParserOptions

const EXEC_OPTIONS = {
  provider: { type: 'string' },

  backend: { type: 'string' },
  'no-auto-compaction': { type: 'boolean' },
  cwd: { type: 'string' },
  'prompt-file': { type: 'string' },
  'output-schema': { type: 'string' },
  'output-schema-outside': { type: 'boolean' },
  'untrusted-file': { type: 'string', multiple: true },
  attach: { type: 'string', multiple: true },
  record: { type: 'boolean' },
  'permission-mode': { type: 'string' },
  model: { type: 'string' },
  account: { type: 'string' },
  'account-pool': { type: 'boolean' },
  team: { type: 'boolean' },
  effort: { type: 'string' },
  fast: { type: 'boolean' },
  output: { type: 'string' },
  'max-budget-usd': { type: 'string' },
  'max-requests': { type: 'string' },
  'max-tool-output-bytes': { type: 'string' },
  'max-output-tokens': { type: 'string' },
  timeout: { type: 'string' },
  'muse-binary': { type: 'string' },
  'shell-sandbox': { type: 'string' },
  'allow-contributor-models': { type: 'boolean' },
  'image-generation': { type: 'boolean' },
  'auto-compaction': { type: 'boolean' },
  'fail-on-denial': { type: 'boolean' },
  ephemeral: { type: 'boolean' },
  'key-stdin': { type: 'boolean' },
  subscription: { type: 'boolean' },
  vault: { type: 'boolean' },
  verbose: { type: 'boolean' },
  'trust-workspace': { type: 'boolean' },
  'allow-dangerously-skip-permissions': { type: 'boolean' },
  'web-search': { type: 'boolean' },
  'resource-governor': { type: 'string' },
  'cpu-max': { type: 'string' },
  'memory-max': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies CliParserOptions

const SCAN_OPTIONS = {
  'key-stdin': { type: 'boolean' },
  // D121: the CI-set deadline in seconds; absent runs until the scan finishes.
  timeout: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies CliParserOptions

const REPORT_OPTIONS = {
  out: { type: 'string' },
  description: { type: 'string' },
  'no-facts': { type: 'boolean' },
  'no-events': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies CliParserOptions

const FONTS_OPTIONS = {
  from: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies CliParserOptions

// M104 lane H: the language server's own flags, none shared with serve, so
// no paid feature turns on through another command's flag.
const LSP_OPTIONS = {
  workspace: { type: 'string' },
  tab: { type: 'boolean' },
  'tab-model': { type: 'string' },
  'tab-daily-budget-usd': { type: 'string' },
  'tab-max-output-tokens': { type: 'string' },
  'tab-trigger': { type: 'string' },
  'trust-workspace': { type: 'boolean' },
  'allow-contributor-models': { type: 'boolean' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies CliParserOptions

// M104 lane B: the runtime panel's own flags. Standard I/O is the one
// transport so far; the workspace is named as exec names it.
const PANEL_OPTIONS = {
  stdio: { type: 'boolean' },
  workspace: { type: 'string' },
  verbose: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const satisfies CliParserOptions

export const CLI_OPTION_REGISTRY = {
  providersAdd: { options: PROVIDER_OPTIONS },
  providersModels: {
    options: {
      add: { type: 'string', multiple: true },
      remove: { type: 'string', multiple: true },
      force: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  // M95c part 6: `providers headers <id> [set|unset <name>]` (positional,
  // so no value can ride a flag; a value is read from standard input).
  providersHeaders: {
    options: {
      help: { type: 'boolean', short: 'h' },
    },
  },
  providersUsage: {
    options: {
      days: { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  usage: {
    options: {
      range: { type: 'string' },
      by: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      json: { type: 'boolean' },
      csv: { type: 'boolean' },
      out: { type: 'string' },
      stdio: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  legal: {
    options: {
      json: { type: 'boolean' },
      format: { type: 'string' },
      out: { type: 'string' },
      registry: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  serve: { options: SERVE_OPTIONS },
  login: { options: COMMON_OPTIONS },
  setup: { options: COMMON_OPTIONS },
  authSet: { options: COMMON_OPTIONS },
  authStatus: { options: COMMON_OPTIONS },
  authClear: { options: COMMON_OPTIONS },
  exec: { options: EXEC_OPTIONS, text: { provider: 'exec-provider' } },
  'scan-secrets': { options: SCAN_OPTIONS, text: { timeout: 'scan-timeout' } },
  report: { options: REPORT_OPTIONS },
  resources: { options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } },
  fontsInstall: { options: FONTS_OPTIONS },
  // M104 lane H: the workspace as exec names it; trust as the server applies it.
  lsp: {
    options: LSP_OPTIONS,
    text: { workspace: 'cwd', 'trust-workspace': 'lsp-trust-workspace' },
  },
  stop: { options: { help: { type: 'boolean', short: 'h' } } },
  panel: { options: PANEL_OPTIONS, text: { workspace: 'cwd', stdio: 'panel-stdio' } },
  estimate: { options: ESTIMATE_OPTIONS, text: { by: 'estimate-by', format: 'estimate-format' } },
  // The judge's one help screen: the ask-family flags its strict parser
  // accepts (serve and lint take their own surface flags instead).
  judge: {
    options: {
      engine: { type: 'string' },
      model: { type: 'string' },
      separate: { type: 'string' },
      'budget-usd': { type: 'string' },
      'timeout-ms': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  },
  // Help-only routes: parseCommandLine hands sharing argv to the owner
  // parser before its own strict parse, so these entries drive help, the
  // reference and the guard. The flags are the owner's own tables, spread
  // in the same order the parser composes them.
  share: {
    options: { ...SHARING_BASE_FLAGS, ...SHARE_FLAGS },
    text: { from: 'share-from', to: 'share-to', out: 'share-out', json: 'sharing-json' },
  },
  prompts: {
    options: {
      ...SHARING_BASE_FLAGS,
      ...PROMPTS_SCOPE_FLAG,
      ...PROMPTS_LIST_FLAGS,
      ...PROMPTS_SAVE_FLAGS,
      ...PROMPTS_USE_FLAGS,
    },
    text: { json: 'sharing-json' },
  },
} as const

// The description map is exhaustive over the parser's option names. It never
// chooses an English usage line or a failure message by matching its contents.
export const CLI_OPTION_TEXT = {
  'context-window': 'context-window',
  'usage-history': 'usage-history',
  preset: 'preset',
  as: 'as',
  address: 'address',
  days: 'days',
  admin: 'admin',
  format: 'format',
  privacy: 'privacy',
  'private-ok': 'private-ok',
  range: 'range',
  by: 'by',
  from: 'from',
  to: 'to',

  csv: 'csv',
  stdio: 'stdio',
  registry: 'registry',
  backend: 'backend',
  'auto-compaction': 'auto-compaction',
  'no-auto-compaction': 'no-auto-compaction',
  'trust-workspace': 'trust-workspace',
  maintenance: 'maintenance',
  'muse-binary': 'muse-binary',
  'shell-sandbox': 'shell-sandbox',
  'allow-dangerously-skip-permissions': 'allow-dangerously-skip-permissions',
  'allow-contributor-models': 'allow-contributor-models',
  'web-search': 'web-search',
  'image-generation': 'image-generation',
  'muse-voice': 'muse-voice',
  'scheduled-prompts': 'scheduled-prompts',
  verbose: 'verbose',
  'questions-defer-after': 'questions-defer-after',
  hardware: 'hardware',
  help: 'help',
  version: 'version',
  cwd: 'cwd',
  'prompt-file': 'prompt-file',
  'output-schema': 'output-schema',
  'output-schema-outside': 'output-schema-outside',
  'untrusted-file': 'untrusted-file',
  attach: 'attach',
  record: 'record',
  'permission-mode': 'permission-mode',
  model: 'model',
  engine: 'engine',
  separate: 'separate',
  'budget-usd': 'budget-usd',
  'timeout-ms': 'timeout-ms',
  provider: 'provider',
  account: 'account',
  'account-pool': 'account-pool',
  team: 'team',
  effort: 'effort',
  fast: 'fast',
  output: 'output',
  'max-budget-usd': 'max-budget-usd',
  'max-requests': 'max-requests',
  'max-tool-output-bytes': 'max-tool-output-bytes',
  'max-output-tokens': 'max-output-tokens',
  timeout: 'timeout',
  'fail-on-denial': 'fail-on-denial',
  ephemeral: 'ephemeral',
  'key-stdin': 'key-stdin',
  subscription: 'subscription',
  'resource-governor': 'resource-governor',
  'cpu-max': 'cpu-max',
  'memory-max': 'memory-max',
  json: 'json',
  vault: 'vault',
  out: 'out',
  description: 'description',
  'no-facts': 'no-facts',
  'no-events': 'no-events',
  fleet: 'fleet',
  seed: 'seed',
  add: 'add',
  remove: 'remove',
  force: 'force',
  mode: 'mode',
  destination: 'destination',
  scope: 'scope',
  search: 'search',
  tag: 'tag',
  title: 'title',
  var: 'var',
  chat: 'chat',
  confirm: 'confirm',
  diffs: 'diffs',
  'no-code-blocks': 'no-code-blocks',
  'no-attachment-names': 'no-attachment-names',
  'attachment-content': 'attachment-content',
  'exported-at': 'exported-at',
  'check-plan': 'estimate-check-plan',
  // `lsp --workspace` names the workspace as exec's `--cwd` does.
  workspace: 'cwd',
  tab: 'tab',
  'tab-model': 'tab-model',
  'tab-daily-budget-usd': 'tab-daily-budget-usd',
  'tab-max-output-tokens': 'tab-max-output-tokens',
  'tab-trigger': 'tab-trigger',
} as const satisfies Readonly<
  Record<
    | keyof typeof COMMON_OPTIONS
    | keyof typeof SERVE_OPTIONS
    | keyof typeof EXEC_OPTIONS
    | keyof typeof SCAN_OPTIONS
    | keyof typeof REPORT_OPTIONS
    | keyof typeof CLI_OPTION_REGISTRY.usage.options
    | keyof typeof CLI_OPTION_REGISTRY.legal.options
    | keyof typeof CLI_OPTION_REGISTRY.providersModels.options
    | keyof typeof FONTS_OPTIONS
    | keyof typeof LSP_OPTIONS
    | keyof typeof PANEL_OPTIONS
    | keyof typeof ESTIMATE_OPTIONS
    | keyof typeof CLI_OPTION_REGISTRY.judge.options
    | keyof typeof CLI_OPTION_REGISTRY.share.options
    | keyof typeof CLI_OPTION_REGISTRY.prompts.options,
    keyof UiText['referenceCliOptions']
  >
>

/** Command-local flags without activating the full editor reference catalogue. */
export function formatCommandHelp(table: UiText, command: string, route: string): string {
  // No route names no command: answer with the general help, as the help
  // command does for an undefined route (bare --help names the machine flags).
  if (route === '') return formatAcpUsage(table, command)
  const definition = Object.entries(CLI_OPTION_REGISTRY).find(
    ([key]) => key === route || key === route.split(' ', 1)[0],
  )?.[1]
  const name = route
    .replace(/^reports /, 'report ')
    .replace(/^chatGptProvider (.*)$/, 'providers $1 chatgpt')
    .replace(/^grokProvider (.*)$/, 'providers $1 grok')
    .replace(
      /^(providers|auth|fonts)([A-Z])/,
      (_match, prefix: string, letter: string) => `${prefix} ${letter.toLowerCase()}`,
    )
  const localUsage: Readonly<Record<string, string>> = {
    'providers list': 'providers list',
    providersList: 'providers list',
    providersTest: 'providers test <provider>',
    providersRefresh: 'providers refresh <provider>',
    providersRemove: 'providers remove <provider>',
    providersUsage: 'providers usage <id> [--days <n>] [--output json]',
    openRouterConnect: 'providers connect openrouter',
    helpTopic: 'help <command>',
    authGitHub: 'auth github login|logout|status',
    hardware: 'hardware enable|disable|status',
    machines: 'machines list|add|remove',
    'stop-machine': 'stop-machine [id|--all]',
    panel: 'panel',
  }
  const lines = [`${command} ${localUsage[route] ?? name}`]
  // A route whose options table holds only --help (its grammar is positional)
  // lists nothing below its first line, so the table's usage sentence says it.
  const isHelpOnly =
    definition !== undefined && Object.keys(definition.options).every((flag) => flag === 'help')
  if (definition === undefined || isHelpOnly) {
    const usage: Readonly<Record<string, string>> = {
      providersList: table.referenceProviders,
      providersTest: table.referenceProviders,
      providersRefresh: table.referenceProviders,
      providersRemove: table.referenceProviders,
      providersUsage: table.referenceProvidersUsage,
      providersHeaders: table.providerHeaders.usage,
      openRouterConnect: table.providerOpenRouterServices,
      helpTopic: table.referenceBriefHelp,
      authGitHub: table.referenceAuthGitHub,
      schedule: table.scheduleV2.runtime.usage,
      playbook: table.playbookCommandUsage,
      watchdog: table.watchdog.cli.usage,
      developer: table.developer.commandUsage,
      'providers accounts': table.accounts.cliUsage,
      chatGptProvider: table.acpChatGpt.usage,
      grokProvider: table.acpGrok.usage,
      reports: table.reportCliUsage,
      judge: table.referenceJudgeUsage,
      help: table.referenceBriefHelp,
      share: sharingCliHelp(table, command),
      prompts: sharingCliHelp(table, command),
      hardware: table.makerCliUsage,
      machines: table.makerCliUsage,
      'stop-machine': table.makerCliUsage,
      panel: table.makerCliUsage,
    }
    const description = Object.entries(usage).find(
      ([prefix]) => route === prefix || route.startsWith(`${prefix} `),
    )?.[1]
    if (description !== undefined) lines.push(fill(description, { command }))
  }
  if (definition !== undefined) {
    for (const [flag, option] of Object.entries(definition.options)) {
      // A route's own option words (estimate's deadline and export formats)
      // win over the shared flag text, matching the generated reference.
      const key =
        ('text' in definition
          ? Object.entries(definition.text).find(([name]) => name === flag)?.[1]
          : undefined) ?? Object.entries(CLI_OPTION_TEXT).find(([option]) => option === flag)?.[1]
      if (key === undefined) {
        lines.push(`--${flag}`)
      } else {
        lines.push(
          `--${flag}${option.type === 'string' ? ' <value>' : ''}: ${fill(table.referenceCliOptions[key], { command, origin: '<address>' })}`,
        )
      }
    }
  }
  if (definition === undefined || !('help' in definition.options))
    lines.push(`--help: ${table.referenceCliOptions.help}`)
  return lines.join('\n')
}
