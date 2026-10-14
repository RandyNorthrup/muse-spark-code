// The terminal agent's command table (PLAN.md D108): one topic per
// command with its positional syntax, its parser routes, and two real
// examples. The option rows render from CLI_OPTION_REGISTRY (the exact
// tables parseArgs receives) with their referenceCliOptions meaning and
// bounds from shared constants, so help cannot drift from what runs: an
// option parsed but missing here fails the guard test. Reads UI_TEXT only
// when rendering, never at module load.

import {
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  EFFORT_LEVELS,
  EXEC_DEFAULT_MAX_REQUESTS,
  EXEC_DEFAULT_MODE,
  EXEC_DEFAULT_OUTPUT,
  EXEC_DEFAULT_TIMEOUT_SECONDS,
  EXEC_MAX_BUDGET_USD,
  EXEC_MAX_REQUESTS,
  EXEC_MAX_TIMEOUT_SECONDS,
  EXEC_MIN_TIMEOUT_SECONDS,
  EXEC_MODES,
  EXEC_OUTPUTS,
  SETTING_DEFAULTS,
  SHELL_SANDBOX_MODES,
} from '../shared/constants'
import type { UiText } from '../shared/l10n/en'
import { fill } from '../shared/l10n/text'
import { CLI_OPTION_REGISTRY, formatAcpUsage } from './cliOptions'
import { nearestOptionName } from './editDistance'

export type CliHelpRoute = keyof typeof CLI_OPTION_REGISTRY

/** A bound or default a topic option carries, from shared constants. */
export type CliOptionFact =
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly default?: string }
  | {
      readonly kind: 'range'
      readonly min: number
      readonly max: number
      readonly default: number
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
}

/** Bounds and defaults from shared constants; the parser owns the values. */
const FACTS: Readonly<Record<string, CliOptionFact>> = {
  backend: { kind: 'enum', values: ACP_BACKENDS, default: ACP_DEFAULT_BACKEND },
  'shell-sandbox': {
    kind: 'enum',
    values: SHELL_SANDBOX_MODES,
    default: SETTING_DEFAULTS.shellSandbox,
  },
  'permission-mode': { kind: 'enum', values: EXEC_MODES, default: EXEC_DEFAULT_MODE },
  output: { kind: 'enum', values: EXEC_OUTPUTS, default: EXEC_DEFAULT_OUTPUT },
  effort: { kind: 'enum', values: EFFORT_LEVELS },
  'max-requests': {
    kind: 'range',
    min: 1,
    max: EXEC_MAX_REQUESTS,
    default: EXEC_DEFAULT_MAX_REQUESTS,
  },
  timeout: {
    kind: 'range',
    min: EXEC_MIN_TIMEOUT_SECONDS,
    max: EXEC_MAX_TIMEOUT_SECONDS,
    default: EXEC_DEFAULT_TIMEOUT_SECONDS,
    unit: 'seconds',
  },
  'max-budget-usd': { kind: 'maximum', max: EXEC_MAX_BUDGET_USD, unit: 'USD' },
  'usage-history': { kind: 'enum', values: ['on', 'off'], default: 'on' },
  range: { kind: 'enum', values: ['today', '7d', '30d', '90d', 'custom'], default: '30d' },
  by: { kind: 'enum', values: ['provider', 'model', 'kind', 'client'] },
  'resource-governor': { kind: 'enum', values: ['on', 'off'], default: 'on' },
  'providersAdd:format': { kind: 'enum', values: ['chat', 'responses', 'anthropic'] },
  'legal:format': { kind: 'enum', values: ['text', 'json'] },
  'providersAdd:privacy': { kind: 'enum', values: ['zdr', 'no-training', 'any'] },
}

/** The options serve and login take the same way. */
const SERVE_FAMILY_OPTIONS: readonly CliHelpOption[] = [
  { name: 'backend', shape: '', fact: FACTS['backend'] },
  { name: 'trust-workspace', shape: '' },
  { name: 'muse-binary', shape: '<path>' },
  { name: 'shell-sandbox', shape: '', fact: FACTS['shell-sandbox'] },
  { name: 'allow-dangerously-skip-permissions', shape: '' },
  { name: 'allow-contributor-models', shape: '' },
  { name: 'verbose', shape: '' },
  { name: 'questions-defer-after', shape: '<seconds>' },
  { name: 'web-search', shape: '' },
  { name: 'image-generation', shape: '' },
  { name: 'auto-compaction', shape: '' },
  { name: 'no-auto-compaction', shape: '' },
  { name: 'usage-history', shape: '', fact: FACTS['usage-history'] },
]

/** The one table behind parsing and help: topic names, in help order. */
export const CLI_HELP_TOPICS: readonly CliHelpTopic[] = [
  {
    name: 'serve',
    purpose: (table) => table.cliHelp.purposeServe,
    usage: [(command) => `${command} [options]`],
    routes: ['serve'],
    options: [
      ...SERVE_FAMILY_OPTIONS,
      { name: 'max-budget-usd', shape: '<amount>', fact: FACTS['max-budget-usd'] },
      { name: 'scheduled-prompts', shape: '' },
      { name: 'help', shape: '' },
      { name: 'version', shape: '' },
    ],
    examples: [
      (command) => command,
      (command) => `${command} --backend modelApi --trust-workspace`,
    ],
  },
  {
    name: 'login',
    purpose: (table) => table.cliHelp.purposeLogin,
    usage: [(command) => `${command} [options] login`],
    routes: ['login'],
    options: [...SERVE_FAMILY_OPTIONS, { name: 'help', shape: '' }, { name: 'version', shape: '' }],
    examples: [(command) => `${command} login`, (command) => `${command} --backend modelApi login`],
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
      { name: 'help', shape: '' },
      { name: 'version', shape: '' },
    ],
    examples: [
      (command) => `${command} auth status`,
      (command) => `${command} auth status --provider openrouter`,
    ],
  },
  {
    name: 'providers',
    purpose: (table) => table.cliHelp.purposeProviders,
    usage: [
      (command) => `${command} providers list|add|test|remove`,
      (command) => `${command} providers models <entry> [--add <model>] [--remove <model>]`,
    ],
    routes: ['providersAdd', 'providersModels'],
    options: [
      { name: 'preset', shape: '<preset>' },
      { name: 'as', shape: '<id>' },
      { name: 'address', shape: '<url>' },
      {
        name: 'format',
        shape: '<format>',
        fact: FACTS['providersAdd:format'],
      },
      { name: 'model', shape: '<model>' },
      {
        name: 'privacy',
        shape: '<policy>',
        fact: FACTS['providersAdd:privacy'],
      },
      { name: 'private-ok', shape: '' },
      { name: 'key-stdin', shape: '' },
      { name: 'add', shape: '<model>' },
      { name: 'remove', shape: '<model>' },
      { name: 'force', shape: '<reason>' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} providers list`,
      (command) => `${command} providers models openrouter`,
    ],
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
      { name: 'backend', shape: '', fact: FACTS['backend'] },
      { name: 'provider', shape: '<id>' },
      { name: 'model', shape: '<model>' },
      { name: 'effort', shape: '', fact: FACTS['effort'] },
      { name: 'permission-mode', shape: '', fact: FACTS['permission-mode'] },
      { name: 'output', shape: '', fact: FACTS['output'] },
      { name: 'max-budget-usd', shape: '<amount>', fact: FACTS['max-budget-usd'] },
      { name: 'max-requests', shape: '<count>', fact: FACTS['max-requests'] },
      { name: 'timeout', shape: '<seconds>', fact: FACTS['timeout'] },
      { name: 'cwd', shape: '<directory>' },
      { name: 'prompt-file', shape: '<file>' },
      { name: 'output-schema', shape: '<file>' },
      { name: 'output-schema-outside', shape: '' },
      { name: 'untrusted-file', shape: '<file>' },
      { name: 'attach', shape: '<file>' },
      { name: 'account', shape: '<id>' },
      { name: 'account-pool', shape: '' },
      { name: 'allow-contributor-models', shape: '' },
      { name: 'muse-binary', shape: '<path>' },
      { name: 'shell-sandbox', shape: '', fact: FACTS['shell-sandbox'] },
      { name: 'image-generation', shape: '' },
      { name: 'fail-on-denial', shape: '' },
      { name: 'ephemeral', shape: '' },
      { name: 'key-stdin', shape: '' },
      { name: 'vault', shape: '' },
      { name: 'verbose', shape: '' },
      { name: 'no-auto-compaction', shape: '' },
      { name: 'resource-governor', shape: '', fact: FACTS['resource-governor'] },
      { name: 'cpu-max', shape: '<percent>' },
      { name: 'memory-max', shape: '<percent>' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} exec --backend modelApi --max-budget-usd 1 'Summarise this repo'`,
      (command) => `${command} exec --permission-mode plan --output json 'List the risks'`,
    ],
  },
  {
    name: 'scan-secrets',
    purpose: (table) => table.cliHelp.purposeScanSecrets,
    usage: [(command) => `${command} scan-secrets <file> [--key-stdin]`],
    routes: ['scan-secrets'],
    options: [
      { name: 'key-stdin', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} scan-secrets patch.diff`,
      (command) => `${command} scan-secrets patch.diff --key-stdin < key.txt`,
    ],
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
  },
  {
    name: 'legal',
    purpose: (table) => table.cliHelp.purposeLegal,
    usage: [(command) => `${command} legal [options]`],
    routes: ['legal'],
    options: [
      { name: 'json', shape: '' },
      { name: 'format', shape: '<format>', fact: FACTS['legal:format'] },
      { name: 'out', shape: '<file>' },
      { name: 'registry', shape: '' },
      { name: 'help', shape: '' },
    ],
    examples: [
      (command) => `${command} legal`,
      (command) => `${command} legal --format json --out legal.json`,
    ],
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
  },
  {
    name: 'playbook',
    purpose: (table) => table.cliHelp.purposePlaybook,
    usage: [(command) => `${command} playbook <status|record|settings ...>`],
    routes: [],
    options: [],
    examples: [
      (command) => `${command} playbook status`,
      (command) => `${command} playbook settings`,
    ],
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
  },
  {
    name: 'usage',
    purpose: (table) => table.cliHelp.purposeUsage,
    usage: [(command) => `${command} usage [summary|daily|models|limits|export|open] [options]`],
    routes: ['usage'],
    options: [
      { name: 'range', shape: '', fact: FACTS['range'] },
      { name: 'by', shape: '', fact: FACTS['by'] },
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

/** The option names one topic's help shows: what error messages may name. */
export function topicShownOptionNames(topic: CliHelpTopic): string[] {
  return topic.options.map((option) => option.name)
}

/** Option descriptions come from the installed language's table. */
function optionMeaning(table: UiText, name: string): string {
  const meanings: Readonly<Record<string, string>> = table.referenceCliOptions
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
      return `${fill(table.cliHelp.defaultIs, { value: String(fact.default) })}; ${accepts}`
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
  const isRepeatable =
    definition !== undefined && 'multiple' in definition && definition.multiple === true
  const meaning = optionMeaning(table, option.name)
  const notes: string[] = []
  const note = option.fact === undefined ? undefined : factNote(table, option.fact)
  if (note !== undefined) notes.push(note)
  if (isRepeatable) notes.push(table.cliHelp.repeatable)
  const suffix = notes.length === 0 ? '' : ` (${notes.join('; ')})`
  // Reference meanings that already name the option (and its shape) stand
  // as written; the row only adds bounds, the default and repeatability.
  if (meaning.startsWith(`--${option.name}`)) return `  ${meaning}${suffix}`
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
  if (topic.options.length > 0) {
    lines.push(table.cliHelp.options)
    for (const option of topic.options) {
      const route = topic.routes.find((candidate) =>
        Object.keys(CLI_OPTION_REGISTRY[candidate].options).includes(option.name),
      )
      lines.push(
        route === undefined
          ? `  --${option.name}  ${optionMeaning(table, option.name)}`
          : renderOptionRow(table, route, option),
      )
    }
  }
  lines.push(table.cliHelp.examples)
  for (const example of topic.examples) lines.push(`  ${example(command)}`)
  return lines.join('\n')
}

/** The top-level help: the compact usage plus every command's purpose. */
export function renderTopHelp(table: UiText, command: string): string {
  const lines: string[] = [formatAcpUsage(table, command), table.cliHelp.commands]
  for (const topic of CLI_HELP_TOPICS) lines.push(`  ${topic.name}  ${topic.purpose(table)}`)
  // Serve-only options the global list does not name (D108: --max-budget-usd).
  const serveOnly = Object.keys(CLI_OPTION_REGISTRY.serve.options).filter(
    (name) => !Object.keys(CLI_OPTION_REGISTRY.login.options).includes(name),
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
 * Words that mark an unknown option as a possible credential route: such a
 * name is never repeated in the refusal, so a mistyped secret flag cannot
 * reach the terminal output, logs or reports.
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
 * A wrong option or value: one sentence naming the option and the accepted
 * values, the nearest valid option when the name is close, and the command's
 * own help. Nothing is run; the caller exits 2. A secret-looking name is
 * refused without repeating it.
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
 * Parsed but not shown in the topic's help: refused outright on that route
 * or accepted and ignored there (the reference contract's `refused` and
 * `acceptedUnused`). The guard test requires every registry option to be
 * either in its topic or in this map, so a parsed option cannot hide.
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
  'verbose',
  'questions-defer-after',
  'account',
  'preset',
  'as',
  'address',
  'format',
  'model',
  'privacy',
  'private-ok',
  'key-stdin',
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
    'maintenance',
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
    'maintenance',
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
    'verbose',
    'questions-defer-after',
    'preset',
    'as',
    'address',
    'format',
    'model',
    'privacy',
    'private-ok',
    'key-stdin',
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
    'questions-defer-after',
  ],
  exec: ['trust-workspace', 'allow-dangerously-skip-permissions', 'web-search', 'record'],
  providersAdd: [],
  providersModels: [],
  usage: [],
  legal: [],
  report: [],
  resources: [],
  fontsInstall: [],
  'scan-secrets': [],
}
