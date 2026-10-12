import { ESTIMATE_OPTIONS } from './estimator/options'
import type { UiText } from '../shared/l10n/en'
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
  return [
    fill(table.acpUsage, { command }),
    fill(table.acpChatGpt.usage, { command }),
    sharingCliHelp(table, command),
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

const PROVIDER_OPTIONS = {
  preset: { type: 'string' },
  as: { type: 'string' },
  address: { type: 'string' },
  format: { type: 'string' },
  model: { type: 'string', multiple: true },
  privacy: { type: 'string' },
  'private-ok': { type: 'boolean' },
  'key-stdin': { type: 'boolean' },
} as const satisfies CliParserOptions

const COMMON_OPTIONS = {
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
  [ACP_PAID_FLAGS.webSearch]: { type: 'boolean' },
  [ACP_PAID_FLAGS.imageGeneration]: { type: 'boolean' },
  verbose: { type: 'boolean' },
  'questions-defer-after': { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
} as const satisfies CliParserOptions

// Serve accepts X's paid-schedule admission flags; no other route does.
const SERVE_OPTIONS = {
  ...COMMON_OPTIONS,
  'scheduled-prompts': { type: 'boolean' },
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
  effort: { type: 'string' },
  output: { type: 'string' },
  'max-budget-usd': { type: 'string' },
  'max-requests': { type: 'string' },
  'max-output-tokens': { type: 'string' },
  timeout: { type: 'string' },
  'muse-binary': { type: 'string' },
  'shell-sandbox': { type: 'string' },
  'allow-contributor-models': { type: 'boolean' },
  'image-generation': { type: 'boolean' },
  'fail-on-denial': { type: 'boolean' },
  ephemeral: { type: 'boolean' },
  'key-stdin': { type: 'boolean' },
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

export const CLI_OPTION_REGISTRY = {
  providersAdd: { options: PROVIDER_OPTIONS },
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
  authSet: {
    options: {
      provider: COMMON_OPTIONS.provider,
      account: COMMON_OPTIONS.account,
      help: COMMON_OPTIONS.help,
    },
  },
  authStatus: {
    options: {
      provider: COMMON_OPTIONS.provider,
      account: COMMON_OPTIONS.account,
      help: COMMON_OPTIONS.help,
    },
  },
  authClear: {
    options: {
      provider: COMMON_OPTIONS.provider,
      account: COMMON_OPTIONS.account,
      help: COMMON_OPTIONS.help,
    },
  },
  exec: { options: EXEC_OPTIONS },
  'scan-secrets': { options: SCAN_OPTIONS },
  report: { options: REPORT_OPTIONS },
  resources: { options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } },
  fontsInstall: { options: FONTS_OPTIONS },
  estimate: { options: ESTIMATE_OPTIONS, text: { by: 'estimate-by', format: 'estimate-format' } },
} as const

// The description map is exhaustive over the parser's option names. It never
// chooses an English usage line or a failure message by matching its contents.
export const CLI_OPTION_TEXT = {
  'usage-history': 'usage-history',
  preset: 'preset',
  as: 'as',
  address: 'address',
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
  'no-auto-compaction': 'no-auto-compaction',
  'trust-workspace': 'trust-workspace',
  maintenance: 'maintenance',
  'muse-binary': 'muse-binary',
  'shell-sandbox': 'shell-sandbox',
  'allow-dangerously-skip-permissions': 'allow-dangerously-skip-permissions',
  'allow-contributor-models': 'allow-contributor-models',
  'web-search': 'web-search',
  'image-generation': 'image-generation',
  'scheduled-prompts': 'scheduled-prompts',
  verbose: 'verbose',
  'questions-defer-after': 'questions-defer-after',
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
  provider: 'provider',
  account: 'account',
  'account-pool': 'account-pool',
  effort: 'effort',
  output: 'output',
  'max-budget-usd': 'max-budget-usd',
  'max-requests': 'max-requests',
  'max-output-tokens': 'max-output-tokens',
  timeout: 'timeout',
  'fail-on-denial': 'fail-on-denial',
  ephemeral: 'ephemeral',
  'key-stdin': 'key-stdin',
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
} as const satisfies Readonly<
  Record<
    | keyof typeof COMMON_OPTIONS
    | keyof typeof SERVE_OPTIONS
    | keyof typeof EXEC_OPTIONS
    | keyof typeof SCAN_OPTIONS
    | keyof typeof REPORT_OPTIONS
    | keyof typeof CLI_OPTION_REGISTRY.usage.options
    | keyof typeof CLI_OPTION_REGISTRY.legal.options
    | keyof typeof FONTS_OPTIONS
    | keyof typeof ESTIMATE_OPTIONS,
    keyof UiText['referenceCliOptions']
  >
>

/** Command-local flags without activating the full editor reference catalogue. */
export function formatCommandHelp(table: UiText, command: string, route: string): string {
  const definition = Object.entries(CLI_OPTION_REGISTRY).find(
    ([key]) => key === route || key === route.split(' ', 1)[0],
  )?.[1]
  const name = route
    .replace(/^reports /, 'report ')
    .replace(/^chatGptProvider (.*)$/, 'providers $1 chatgpt')
    .replace(
      /^(providers|auth|fonts)([A-Z])/,
      (_match, prefix: string, letter: string) => `${prefix} ${letter.toLowerCase()}`,
    )
  const localUsage: Readonly<Record<string, string>> = {
    'providers list': 'providers list',
    providersList: 'providers list',
    providersTest: 'providers test <provider>',
    providersRemove: 'providers remove <provider>',
  }
  const lines = [`${command} ${localUsage[route] ?? name}`]
  if (definition === undefined) {
    const usage: Readonly<Record<string, string>> = {
      providersList: table.referenceProviders,
      providersTest: table.referenceProviders,
      providersRemove: table.referenceProviders,
      schedule: table.scheduleV2.runtime.usage,
      playbook: table.playbookCommandUsage,
      developer: table.developer.commandUsage,
      'providers accounts': table.accounts.cliUsage,
      chatGptProvider: table.acpChatGpt.usage,
      reports: table.reportCliUsage,
      help: table.referenceBriefHelp,
      share: sharingCliHelp(table, command),
      prompts: sharingCliHelp(table, command),
    }
    const description = Object.entries(usage).find(
      ([prefix]) => route === prefix || route.startsWith(`${prefix} `),
    )?.[1]
    if (description !== undefined) lines.push(fill(description, { command }))
  }
  if (definition !== undefined) {
    for (const [flag, option] of Object.entries(definition.options)) {
      const key = Object.entries(CLI_OPTION_TEXT).find(([option]) => option === flag)?.[1]
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
