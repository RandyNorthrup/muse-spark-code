import type { UiText } from '../shared/l10n/en'
import { fill } from '../shared/l10n/text'

/** Compact CLI help, also checked against the installed package's tables. */
export function formatAcpUsage(
  table: Pick<UiText, 'acpUsage' | 'helpReferenceTitle'>,
  command: string,
): string {
  return `${fill(table.acpUsage, { command })}\n${table.helpReferenceTitle}: ${command} help --all`
}

// One parseArgs definition per runtime route, also read by the lazy reference.
interface CliParserOption {
  readonly type: 'string' | 'boolean'
  readonly short?: string
  readonly multiple?: boolean
}
type CliParserOptions = Readonly<Record<string, CliParserOption>>
import { ACP_PAID_FLAGS } from '../shared/constants'

const COMMON_OPTIONS = {
  backend: { type: 'string' },
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

const EXEC_OPTIONS = {
  backend: { type: 'string' },
  cwd: { type: 'string' },
  'prompt-file': { type: 'string' },
  'untrusted-file': { type: 'string', multiple: true },
  attach: { type: 'string', multiple: true },
  record: { type: 'boolean' },
  'permission-mode': { type: 'string' },
  model: { type: 'string' },
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
  verbose: { type: 'boolean' },
  'trust-workspace': { type: 'boolean' },
  'allow-dangerously-skip-permissions': { type: 'boolean' },
  'web-search': { type: 'boolean' },
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

export const CLI_OPTION_REGISTRY = {
  serve: { options: COMMON_OPTIONS },
  login: { options: COMMON_OPTIONS },
  setup: { options: COMMON_OPTIONS },
  authSet: { options: COMMON_OPTIONS },
  authStatus: { options: COMMON_OPTIONS },
  authClear: { options: COMMON_OPTIONS },
  exec: { options: EXEC_OPTIONS },
  'scan-secrets': { options: SCAN_OPTIONS },
  report: { options: REPORT_OPTIONS },
} as const

// The description map is exhaustive over the parser's option names. It never
// chooses an English usage line or a failure message by matching its contents.
export const CLI_OPTION_TEXT = {
  backend: 'backend',
  'trust-workspace': 'trust-workspace',
  maintenance: 'maintenance',
  'muse-binary': 'muse-binary',
  'shell-sandbox': 'shell-sandbox',
  'allow-dangerously-skip-permissions': 'allow-dangerously-skip-permissions',
  'allow-contributor-models': 'allow-contributor-models',
  'web-search': 'web-search',
  'image-generation': 'image-generation',
  verbose: 'verbose',
  'questions-defer-after': 'questions-defer-after',
  help: 'help',
  version: 'version',
  cwd: 'cwd',
  'prompt-file': 'prompt-file',
  'untrusted-file': 'untrusted-file',
  attach: 'attach',
  record: 'record',
  'permission-mode': 'permission-mode',
  model: 'model',
  effort: 'effort',
  output: 'output',
  'max-budget-usd': 'max-budget-usd',
  'max-requests': 'max-requests',
  timeout: 'timeout',
  'fail-on-denial': 'fail-on-denial',
  ephemeral: 'ephemeral',
  'key-stdin': 'key-stdin',
  out: 'out',
  description: 'description',
  'no-facts': 'no-facts',
  'no-events': 'no-events',
} as const satisfies Readonly<
  Record<
    | keyof typeof COMMON_OPTIONS
    | keyof typeof EXEC_OPTIONS
    | keyof typeof SCAN_OPTIONS
    | keyof typeof REPORT_OPTIONS,
    keyof UiText['referenceCliOptions']
  >
>
