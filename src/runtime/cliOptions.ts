import { isAutoCompactionEvaluated } from '../shared/constants'
import { ESTIMATE_OPTIONS } from './estimator/options'
import type { UiText } from '../shared/l10n/en'
import { sharingHelp } from '../shared/featureCatalog'
import { fill } from '../shared/l10n/text'

/** One screen for `scan-secrets --help`: its own usage, options and exit codes. */
export function formatScanSecretsHelp(table: UiText, command: string): string {
  return [
    `${command} ${table.execScanUsage}`,
    table.referenceScanSecrets,
    table.referenceCliOptions['key-stdin'],
    table.scanSecretsExits,
  ].join('\n')
}

/** One screen for `exec --help`: its own usage, contract and exit codes. */
export function formatExecHelp(table: UiText, command: string): string {
  return [`${command} ${table.execUsage}`, table.referenceExecContract, table.execExits].join('\n')
}

/** One screen for `report --help`: its own usage, options and exit codes. */
export function formatReportHelp(table: UiText, command: string): string {
  return [fill(table.reportUsage, { command }), table.reportExits].join('\n')
}

/** One screen for `share --help` / `prompts --help`: the sharing commands' own syntax lines. */
export function formatSharingHelp(table: UiText): string {
  return sharingHelp(table)
}

/** Compact CLI help, also checked against the installed package's tables. */
export function formatAcpUsage(table: UiText, command: string): string {
  const options = {
    [ACP_PAID_FLAGS.autoCompaction]: table.referenceCliOptions[ACP_PAID_FLAGS.autoCompaction],
    'no-auto-compaction': table.referenceCliOptions['no-auto-compaction'],
  }
  return [
    fill(table.acpUsage, { command }),
    fill(table.acpChatGpt.usage, { command }),
    sharingHelp(table),
    // CM108ACC: account metadata and per-account keys are served. The exec
    // line (`accounts.execHelp`) offers pooling, which is still refused, and
    // stays out until its owner is bound.
    fill(table.accounts.cliUsage, { command }),
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
  [ACP_PAID_FLAGS.autoCompaction]: { type: 'boolean' },
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

// The sharing commands' flags, mirroring the owner parser in sharing/args.ts
// (parseCommandLine hands sharing argv to the owner before its own strict
// parse, so this route only drives help, the reference and the guard). The
// per-action shapes differ inside the owner (prompts save takes a repeated
// --tag, list a single one; share takes a confirmation value, use a bare
// --confirm): the registry keeps the widest shape the screen can render.
const SHARE_OPTIONS = {
  cwd: { type: 'string' },
  json: { type: 'boolean' },
  mode: { type: 'string' },
  format: { type: 'string' },
  destination: { type: 'string' },
  out: { type: 'string' },
  from: { type: 'string' },
  to: { type: 'string' },
  'no-code-blocks': { type: 'boolean' },
  'no-attachment-names': { type: 'boolean' },
  diffs: { type: 'boolean' },
  'attachment-content': { type: 'string', multiple: true },
  'exported-at': { type: 'string' },
  confirm: { type: 'string' },
} as const satisfies CliParserOptions

const PROMPTS_OPTIONS = {
  cwd: { type: 'string' },
  json: { type: 'boolean' },
  scope: { type: 'string' },
  search: { type: 'string' },
  tag: { type: 'string', multiple: true },
  title: { type: 'string' },
  chat: { type: 'string' },
  var: { type: 'string', multiple: true },
  confirm: { type: 'boolean' },
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
  exec: { options: EXEC_OPTIONS },
  'scan-secrets': { options: SCAN_OPTIONS },
  report: { options: REPORT_OPTIONS },
  resources: { options: { json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } },
  fontsInstall: { options: FONTS_OPTIONS },
  estimate: { options: ESTIMATE_OPTIONS, text: { by: 'estimate-by', format: 'estimate-format' } },
  share: {
    options: SHARE_OPTIONS,
    text: { from: 'share-from', to: 'share-to', out: 'share-out', json: 'sharing-json' },
  },
  prompts: { options: PROMPTS_OPTIONS, text: { json: 'sharing-json' } },
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
    | keyof typeof ESTIMATE_OPTIONS
    | keyof typeof SHARE_OPTIONS
    | keyof typeof PROMPTS_OPTIONS,
    keyof UiText['referenceCliOptions']
  >
>
