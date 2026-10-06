// Pure M80 argument validation. Files, catalogue and TTY checks belong to B.
import {
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  type AcpBackendKind,
  EFFORT_LEVELS,
  type EffortLevel,
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
  EXEC_PROMPT_MAX_BYTES,
  EXEC_UNTRUSTED_FILES_MAX,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  MILLISECONDS_PER_SECOND,
  SETTING_DEFAULTS,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
  UI_TEXT,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { ServeOptions } from '../cliArgs'

export type ExecMode = 'plan' | 'acceptEdits'
export type ExecOutput = 'text' | 'json' | 'jsonl'
export type ExecPaidFeature = 'imageGeneration'
export type PromptSource =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'stdin' }
export interface ExecOptions {
  readonly backend: AcpBackendKind
  readonly cwd: string | undefined
  readonly prompt: PromptSource
  readonly untrustedFiles: readonly string[]
  readonly mode: ExecMode
  readonly model: string | undefined
  readonly effort: EffortLevel | undefined
  readonly allowsContributorModels: boolean
  readonly output: ExecOutput
  readonly outputSchema?: string
  readonly outputSchemaOutside?: boolean
  /** Display conversion only; admission retains budgetMicroUsd (F1). */
  readonly budgetUsd: number | undefined
  readonly budgetMicroUsd: number | undefined
  readonly maxRequests: number | undefined
  readonly timeoutMs: number
  readonly paidFeatures: readonly ExecPaidFeature[]
  readonly failOnDenial: boolean
  readonly ephemeral: boolean
  readonly keyFromStdin: boolean
  readonly museBinary: string
  readonly shellSandbox: ShellSandboxMode
  readonly isVerbose: boolean
  readonly autoCompaction?: boolean
}

const BOOLEAN_OPTIONS = new Set([
  'allow-contributor-models',
  'image-generation',
  'no-auto-compaction',
  'fail-on-denial',
  'ephemeral',
  'key-stdin',
  'verbose',
  'trust-workspace',
  'allow-dangerously-skip-permissions',
  'web-search',
  'output-schema-outside',
])
const STRING_OPTIONS = new Set([
  'backend',
  'cwd',
  'prompt-file',
  'permission-mode',
  'model',
  'effort',
  'output',
  'output-schema',
  'max-budget-usd',
  'max-requests',
  'timeout',
  'muse-binary',
  'shell-sandbox',
])
const DECIMAL_BUDGET = /^[0-9]+(?:\.[0-9]{1,6})?$/
const INTEGER = /^[0-9]+$/

function enumValue<T extends string>(allowed: readonly T[], value: unknown): T | undefined {
  return allowed.find((candidate) => candidate === value)
}

function integer(value: unknown, fallback: number, min: number, max: number): number | undefined {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !INTEGER.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : undefined
}

/** Parse decimal digits directly; Number is used only after the integer range check. */
function budgetUnits(value: unknown): number | undefined {
  if (typeof value !== 'string' || !DECIMAL_BUDGET.test(value)) return undefined
  const [whole = '', fraction = ''] = value.split('.', 2)
  const units =
    BigInt(whole) * BigInt(EXEC_USD_UNITS) + BigInt(fraction.padEnd(EXEC_USD_DECIMALS, '0'))
  const ZERO_UNITS = 0n
  return units > ZERO_UNITS && units <= BigInt(EXEC_MAX_BUDGET_USD * EXEC_USD_UNITS)
    ? Number(units)
    : undefined
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason }
}

export function parseExec(
  values: Readonly<Record<string, unknown>>,
  positionals: readonly string[],
):
  | { readonly ok: true; readonly options: ExecOptions }
  | { readonly ok: false; readonly reason: string } {
  for (const [name, value] of Object.entries(values)) {
    const isKnown =
      BOOLEAN_OPTIONS.has(name) || STRING_OPTIONS.has(name) || name === 'untrusted-file'
    const isValid =
      value === undefined ||
      (BOOLEAN_OPTIONS.has(name) && typeof value === 'boolean') ||
      (STRING_OPTIONS.has(name) && typeof value === 'string') ||
      (name === 'untrusted-file' &&
        Array.isArray(value) &&
        value.every((item: unknown) => typeof item === 'string'))
    if (!isKnown || !isValid)
      return invalid(fill(UI_TEXT.acpUnknownArgument, { argument: `--${name}` }))
  }
  if (values['trust-workspace'] === true || values['allow-dangerously-skip-permissions'] === true)
    return invalid(UI_TEXT.execTrustRefused)
  if (values['web-search'] === true) return invalid(UI_TEXT.execWebSearchUnbounded)
  const mode = enumValue(EXEC_MODES, values['permission-mode'] ?? EXEC_DEFAULT_MODE)
  if (mode === undefined) return invalid(UI_TEXT.execModeRefused)
  const backend = enumValue(ACP_BACKENDS, values['backend'] ?? ACP_DEFAULT_BACKEND)
  const output = enumValue(EXEC_OUTPUTS, values['output'] ?? EXEC_DEFAULT_OUTPUT)
  const shellSandbox = enumValue(
    SHELL_SANDBOX_MODES,
    values['shell-sandbox'] ?? SETTING_DEFAULTS.shellSandbox,
  )
  const effort = enumValue(EFFORT_LEVELS, values['effort'])
  if (
    backend === undefined ||
    output === undefined ||
    shellSandbox === undefined ||
    (effort === undefined && values['effort'] !== undefined)
  )
    return invalid(UI_TEXT.execUsage)
  const timeout = integer(
    values['timeout'],
    EXEC_DEFAULT_TIMEOUT_SECONDS,
    EXEC_MIN_TIMEOUT_SECONDS,
    EXEC_MAX_TIMEOUT_SECONDS,
  )
  const maxRequests = integer(
    values['max-requests'],
    EXEC_DEFAULT_MAX_REQUESTS,
    1,
    EXEC_MAX_REQUESTS,
  )
  const budgetMicroUsd = budgetUnits(values['max-budget-usd'])
  if (
    timeout === undefined ||
    maxRequests === undefined ||
    (budgetMicroUsd === undefined && values['max-budget-usd'] !== undefined)
  )
    return invalid(UI_TEXT.execNumberInvalid)
  if (backend === 'modelApi' && budgetMicroUsd === undefined)
    return invalid(UI_TEXT.execBudgetRequired)
  if (
    values['output-schema'] === '' ||
    (values['output-schema-outside'] === true && values['output-schema'] === undefined)
  )
    return invalid(UI_TEXT.execUsage)
  if (
    backend === 'museCode' &&
    [
      'max-budget-usd',
      'max-requests',
      'ephemeral',
      'key-stdin',
      'image-generation',
      'output-schema',
      'output-schema-outside',
    ].some((key) => values[key] !== undefined && values[key] !== false)
  )
    return invalid(UI_TEXT.execModelApiOnly)
  if (
    backend === 'modelApi' &&
    ['muse-binary', 'shell-sandbox'].some((key) => values[key] !== undefined)
  )
    return invalid(UI_TEXT.execMuseCodeOnly)
  if (mode !== 'acceptEdits' && values['image-generation'] === true)
    return invalid(UI_TEXT.execPaidNeedsEdits)
  const files = values['untrusted-file']
  const untrustedFiles = Array.isArray(files)
    ? files.filter((file: unknown): file is string => typeof file === 'string')
    : []
  if (untrustedFiles.length > EXEC_UNTRUSTED_FILES_MAX)
    return invalid(plural(UI_TEXT.execTooManyFiles, EXEC_UNTRUSTED_FILES_MAX))
  const promptFile = values['prompt-file']
  if (positionals.length > 1 || (promptFile !== undefined && positionals.length > 0))
    return invalid(UI_TEXT.execPromptTwice)
  let prompt: PromptSource
  if (typeof promptFile === 'string' && promptFile !== '')
    prompt = { kind: 'file', path: promptFile }
  else if (positionals[0] === '-') prompt = { kind: 'stdin' }
  else if (positionals[0] !== undefined && positionals[0] !== '')
    prompt = { kind: 'text', text: positionals[0] }
  else return invalid(UI_TEXT.execPromptMissing)
  if (prompt.kind === 'stdin' && values['key-stdin'] === true)
    return invalid(UI_TEXT.execStdinTwice)
  if (prompt.kind === 'text' && Buffer.byteLength(prompt.text) > EXEC_PROMPT_MAX_BYTES)
    return invalid(UI_TEXT.execFileTooLarge)
  const stringValue = (key: string) => (typeof values[key] === 'string' ? values[key] : undefined)
  const outputSchema = stringValue('output-schema')
  return {
    ok: true,
    options: {
      backend,
      cwd: stringValue('cwd'),
      prompt,
      untrustedFiles,
      mode,
      model: stringValue('model'),
      effort,
      allowsContributorModels: values['allow-contributor-models'] === true,
      output,
      ...(outputSchema !== undefined && { outputSchema }),
      ...(values['output-schema-outside'] === true && { outputSchemaOutside: true }),
      budgetMicroUsd,
      budgetUsd: budgetMicroUsd === undefined ? undefined : budgetMicroUsd / EXEC_USD_UNITS,
      maxRequests: backend === 'modelApi' ? maxRequests : undefined,
      timeoutMs: timeout * MILLISECONDS_PER_SECOND,
      paidFeatures: values['image-generation'] === true ? ['imageGeneration'] : [],
      failOnDenial: values['fail-on-denial'] === true,
      ephemeral: values['ephemeral'] === true,
      keyFromStdin: values['key-stdin'] === true,
      museBinary: stringValue('muse-binary') ?? SETTING_DEFAULTS.museBinaryPath,
      shellSandbox,
      isVerbose: values['verbose'] === true,
      autoCompaction: values['no-auto-compaction'] !== true,
    },
  }
}

export function serveOptionsFor(options: ExecOptions): ServeOptions {
  return {
    backend: options.backend,
    trustWorkspace: false,
    canBypass: false,
    museBinary: options.museBinary,
    shellSandbox: options.shellSandbox,
    allowsContributorModels: options.allowsContributorModels,
    paidFeatures: options.paidFeatures,
    isVerbose: options.isVerbose,
    autoCompaction: options.autoCompaction,
  }
}
