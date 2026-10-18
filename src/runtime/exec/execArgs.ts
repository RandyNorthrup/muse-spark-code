import { Usd, type UsdAmount } from '../../shared/usd'
// Pure M80 argument validation. Files, catalogue and TTY checks belong to B.
import {
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  type AcpBackendKind,
  EFFORT_LEVELS,
  type EffortLevel,
  THINKING_OFF_EFFORT,
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
  PAID_PRICES_USD,
  EXEC_UNTRUSTED_FILES_MAX,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  MILLISECONDS_PER_SECOND,
  SETTING_DEFAULTS,
  SHELL_SANDBOX_MODES,
  type ShellSandboxMode,
  TOOL_RESULT_MIN_BYTES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatNumber, plural } from '../../shared/l10n/text'
import { modelRef } from '../../host/backend/providerPolicyEntry'
const { isProviderId, parseModelRef } = modelRef
import type { ServeOptions } from '../cliArgs'
import { accountIdSchema } from '../../shared/accounts'
import { ACCOUNT_DEFAULT_ID } from '../../shared/constants'
import type { PaidUseRequest } from '../../shared/paid'

/** No remaining run budget in the ledger's units: headless compaction needs some. */
const NO_REMAINING_UNITS = 0n

export type ExecMode = 'plan' | 'acceptEdits'
export type ExecOutput = 'text' | 'json' | 'jsonl'
export type ExecPaidFeature = 'imageGeneration' | 'autoCompaction'
export type PromptSource =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'stdin' }
export interface ExecOptions {
  readonly account?: string
  readonly accountPool?: boolean
  readonly backend: AcpBackendKind
  readonly cwd: string | undefined
  readonly prompt: PromptSource
  readonly untrustedFiles: readonly string[]
  readonly mode: ExecMode
  /**
   * The BYO provider to run on (M95, PLAN.md D74): resolved only from the
   * runner's own user file or a built-in preset's fixed origin, never a
   * repository file. `model` is then the qualified `<provider>/<model>` ref.
   */
  readonly provider: string | undefined
  readonly model: string | undefined
  /**
   * The requested tier, or `none` for Thinking off (lane REASONSHAPESR2:
   * the terminal agent can be told to send none; the record decides what
   * the wire carries). `EffortLevel` excludes `none`, so it is widened
   * here, never in the shared union.
   */
  readonly effort: EffortLevel | typeof THINKING_OFF_EFFORT | undefined
  readonly allowsContributorModels: boolean
  readonly output: ExecOutput
  readonly outputSchema?: string
  readonly outputSchemaOutside?: boolean
  /** Exact canonical budget; admission uses integer micro-units internally (F1). */
  readonly budgetUsd: UsdAmount | undefined
  readonly maxRequests: number | undefined
  /** TOOLCAP: raise the per-tool-result byte guard for this run only. */
  readonly maxToolOutputBytes: number | undefined
  readonly timeoutMs: number
  readonly paidFeatures: readonly ExecPaidFeature[]
  readonly failOnDenial: boolean
  readonly ephemeral: boolean
  readonly keyFromStdin: boolean
  /** Local unattended vault grants only; CI's stdin-key lane remains vault-free. */
  readonly vault: boolean
  readonly museBinary: string
  readonly shellSandbox: ShellSandboxMode
  readonly isVerbose: boolean
  readonly autoCompaction?: boolean
}

const BOOLEAN_OPTIONS = new Set([
  'allow-contributor-models',
  'image-generation',
  'auto-compaction',
  'no-auto-compaction',
  'fail-on-denial',
  'ephemeral',
  'key-stdin',
  'vault',
  'verbose',
  'trust-workspace',
  'allow-dangerously-skip-permissions',
  'web-search',
  'output-schema-outside',
  'account-pool',
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
  'max-tool-output-bytes',
  'timeout',
  'muse-binary',
  'shell-sandbox',
  'provider',
  'account',
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

/** Parse decimal digits directly and retain the exact canonical budget. */
function budgetUnits(value: unknown): UsdAmount | undefined {
  if (typeof value !== 'string' || !DECIMAL_BUDGET.test(value)) return undefined
  const [whole = '', fraction = ''] = value.split('.', 2)
  const units =
    BigInt(whole) * BigInt(EXEC_USD_UNITS) + BigInt(fraction.padEnd(EXEC_USD_DECIMALS, '0'))
  const ZERO_UNITS = 0n
  return units > ZERO_UNITS && units <= BigInt(EXEC_MAX_BUDGET_USD * EXEC_USD_UNITS)
    ? Usd.fromUnits(units, EXEC_USD_DECIMALS).toAmount()
    : undefined
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason }
}

/**
 * The model for a provider run: a bare id (no slash) qualifies to
 * `<provider>/<model>`; a ref must name this provider in full
 * (`openrouter/deepseek/…`, since a model id may itself hold a slash).
 * Without a provider the model passes through untouched. Undefined for a
 * ref aimed elsewhere.
 */
export function qualifyProviderModel(
  provider: string | undefined,
  model: string | undefined,
): string | undefined {
  if (provider === undefined) {
    return model
  }
  if (model === undefined || model === '') {
    return model
  }
  const parsed = parseModelRef(model)
  if (parsed === undefined) {
    return undefined
  }
  if (parsed.providerId === 'meta') {
    return `${provider}/${model}`
  }
  return parsed.providerId === provider ? model : undefined
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
  if (values['account'] !== undefined && !accountIdSchema.safeParse(values['account']).success)
    return invalid(UI_TEXT.accounts.invalidAccount)
  if (
    values['key-stdin'] === true &&
    (values['account-pool'] === true ||
      (values['account'] !== undefined && values['account'] !== ACCOUNT_DEFAULT_ID))
  )
    return invalid(UI_TEXT.accounts.credentialHelp)
  if (values['vault'] === true && values['key-stdin'] === true)
    return invalid(`${UI_TEXT.vault.noAccess}: --vault / --key-stdin`)
  const mode = enumValue(EXEC_MODES, values['permission-mode'] ?? EXEC_DEFAULT_MODE)
  if (mode === undefined) return invalid(UI_TEXT.execModeRefused)
  const backend = enumValue(ACP_BACKENDS, values['backend'] ?? ACP_DEFAULT_BACKEND)
  const output = enumValue(EXEC_OUTPUTS, values['output'] ?? EXEC_DEFAULT_OUTPUT)
  const shellSandbox = enumValue(
    SHELL_SANDBOX_MODES,
    values['shell-sandbox'] ?? SETTING_DEFAULTS.shellSandbox,
  )
  // `none` (Thinking off) rides beside the tiers; the record, not the
  // vendor, decides what the wire carries (lane REASONSHAPESR2).
  const effort =
    values['effort'] === THINKING_OFF_EFFORT
      ? THINKING_OFF_EFFORT
      : enumValue(EFFORT_LEVELS, values['effort'])
  if (
    backend === 'museCode' &&
    (values['account-pool'] === true ||
      (values['account'] !== undefined && values['account'] !== ACCOUNT_DEFAULT_ID))
  )
    return invalid(UI_TEXT.accounts.museCodeUnavailable)
  // A wrong value names its own option (D119), never a bare usage line.
  if (backend === undefined) return invalid(fill(UI_TEXT.execValueInvalid, { option: '--backend' }))
  if (output === undefined) return invalid(fill(UI_TEXT.execValueInvalid, { option: '--output' }))
  if (shellSandbox === undefined)
    return invalid(fill(UI_TEXT.execValueInvalid, { option: '--shell-sandbox' }))
  if (effort === undefined && values['effort'] !== undefined)
    return invalid(fill(UI_TEXT.execValueInvalid, { option: '--effort' }))
  const timeout = integer(
    values['timeout'],
    EXEC_DEFAULT_TIMEOUT_SECONDS,
    EXEC_MIN_TIMEOUT_SECONDS,
    EXEC_MAX_TIMEOUT_SECONDS,
  )
  // The six-decimal sentence is true only of the budget; a wrong timeout
  // or request count names its own option instead.
  if (timeout === undefined) return invalid(fill(UI_TEXT.execValueInvalid, { option: '--timeout' }))
  const maxRequests = integer(
    values['max-requests'],
    EXEC_DEFAULT_MAX_REQUESTS,
    1,
    EXEC_MAX_REQUESTS,
  )
  if (maxRequests === undefined)
    return invalid(fill(UI_TEXT.execValueInvalid, { option: '--max-requests' }))
  // TOOLCAP: absent keeps the setting default; the floor is the readable one
  // (no 0-disables: one tool result can never end a conversation); the window
  // fit is refused at runtime with its reason, where the model's window is known.
  const maxToolOutputBytes = integer(
    values['max-tool-output-bytes'],
    SETTING_DEFAULTS.modelApiMaxToolOutputBytes,
    TOOL_RESULT_MIN_BYTES,
    Number.MAX_SAFE_INTEGER,
  )
  const budgetUsd = budgetUnits(values['max-budget-usd'])
  // TOOLCAP: a present-but-below-floor guard is refused with its translated
  // sentence (the same words capRefusalReason renders where the window is
  // known; rendered here because the bound loads lazily with the backend and
  // must not ride in dist/acp.js). Anything else unparseable keeps the
  // generic number refusal below.
  const maxToolOutputBytesRaw = values['max-tool-output-bytes']
  if (
    maxToolOutputBytes === undefined &&
    typeof maxToolOutputBytesRaw === 'string' &&
    Number.isSafeInteger(Number(maxToolOutputBytesRaw)) &&
    Number(maxToolOutputBytesRaw) < TOOL_RESULT_MIN_BYTES
  )
    return invalid(
      fill(UI_TEXT.toolResultCapBelowFloor, { floor: formatNumber(TOOL_RESULT_MIN_BYTES) }),
    )
  if (
    maxToolOutputBytes === undefined ||
    (budgetUsd === undefined && values['max-budget-usd'] !== undefined)
  )
    return invalid(UI_TEXT.execNumberInvalid)
  if (backend === 'modelApi' && budgetUsd === undefined) return invalid(UI_TEXT.execBudgetRequired)
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
      'max-tool-output-bytes',
      'ephemeral',
      'key-stdin',
      'image-generation',
      'auto-compaction',
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
  const provider = stringValue('provider')
  if (provider !== undefined && !isProviderId(provider)) {
    return invalid(fill(UI_TEXT.providerUnknown, { provider }))
  }
  if (provider !== undefined && backend !== 'modelApi') {
    return invalid(UI_TEXT.execProviderNeedsModelApi)
  }
  const rawModel = stringValue('model')
  const model = qualifyProviderModel(provider, rawModel)
  if (rawModel !== undefined && model === undefined) {
    return invalid(UI_TEXT.execUnknownModel)
  }
  return {
    ok: true,
    options: {
      ...(typeof values['account'] === 'string' && { account: values['account'] }),
      ...(values['account-pool'] === true && { accountPool: true }),
      backend,
      cwd: stringValue('cwd'),
      prompt,
      untrustedFiles,
      mode,
      provider,
      model,
      effort,
      allowsContributorModels: values['allow-contributor-models'] === true,
      output,
      ...(outputSchema !== undefined && { outputSchema }),
      ...(values['output-schema-outside'] === true && { outputSchemaOutside: true }),
      budgetUsd,
      maxRequests: backend === 'modelApi' ? maxRequests : undefined,
      maxToolOutputBytes: backend === 'modelApi' ? maxToolOutputBytes : undefined,
      timeoutMs: timeout * MILLISECONDS_PER_SECOND,
      paidFeatures: [
        ...(values['image-generation'] === true ? (['imageGeneration'] as const) : []),
        ...(values['auto-compaction'] === true ? (['autoCompaction'] as const) : []),
      ],
      failOnDenial: values['fail-on-denial'] === true,
      ephemeral: values['ephemeral'] === true,
      keyFromStdin: values['key-stdin'] === true,
      vault: values['vault'] === true,
      museBinary: stringValue('muse-binary') ?? SETTING_DEFAULTS.museBinaryPath,
      shellSandbox,
      isVerbose: values['verbose'] === true,
      // Headless runs compact only with the explicit opt-in flag; nobody
      // can be asked, so the default stays off and --no-auto-compaction wins.
      autoCompaction: values['auto-compaction'] === true && values['no-auto-compaction'] !== true,
    },
  }
}

/**
 * Headless paid-use admission for one feature: nobody can be asked, so
 * image generation needs its flag, acceptEdits and an affordable hard run
 * budget, and automatic compaction needs its flag and any remaining run
 * budget (no `--max-budget-usd` means no ledger, so no compaction). Pure,
 * so the run and its tests decide identically.
 */
export function isHeadlessPaidUseAllowed(
  options: Pick<ExecOptions, 'paidFeatures' | 'mode'>,
  remainingUsd: UsdAmount,
  isAborted: boolean,
  request: PaidUseRequest,
  requiresAsking: boolean,
): boolean {
  if (requiresAsking || isAborted) return false
  const remaining = Usd.from(remainingUsd).units(EXEC_USD_DECIMALS)
  const isAdmitted =
    request.feature === 'autoCompaction'
      ? options.paidFeatures.includes('autoCompaction') && remaining > NO_REMAINING_UNITS
      : request.feature === 'imageGeneration' &&
        options.paidFeatures.includes('imageGeneration') &&
        options.mode === 'acceptEdits' &&
        remaining >= Usd.from(PAID_PRICES_USD.imageGeneration).units(EXEC_USD_DECIMALS)
  return isAdmitted
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
    maxToolOutputBytes: options.maxToolOutputBytes,
  }
}
