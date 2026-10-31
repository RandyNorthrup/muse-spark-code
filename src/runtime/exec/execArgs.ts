import { Usd, type UsdAmount } from '../../shared/usd'
// Pure M80 argument validation. Files, catalogue and TTY checks belong to B.
import {
  ACP_BACKENDS,
  ACP_DEFAULT_BACKEND,
  type AcpBackendKind,
  EFFORT_LEVELS,
  type EffortLevel,
  THINKING_OFF_EFFORT,
  EXEC_DEFAULT_MODE,
  EXEC_DEFAULT_OUTPUT,
  MODEL_API_MAX_OUTPUT_TOKENS,
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
import { listModelsRemedy, unknownProviderModelText } from '../../core/unknownModel'
import { modelRef } from '../../host/backend/providerPolicyEntry'
const { isProviderId, parseModelRef } = modelRef
import type { ServeOptions } from '../cliArgs'
import { accountIdSchema } from '../../shared/accounts'
import { ACCOUNT_DEFAULT_ID } from '../../shared/constants'
import type { PaidUseRequest } from '../../shared/paid'

/** No remaining run budget in the ledger's units: headless compaction needs some. */
const NO_REMAINING_UNITS = 0n
import { teamExecAdmission } from '../../acp/teamAdmission'

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
  The BYO provider to run on (M95, PLAN.md D74): resolved only from the
  runner's own user file or a built-in preset's fixed origin, never a
  repository file. `model` is then the qualified `<provider>/<model>` ref.
  */
  readonly provider: string | undefined
  readonly model: string | undefined
  /** M96b: explicit opt-in to bounded, in-process headless engine teams. */
  readonly team: boolean
  /**
  The requested tier, or `none` for Thinking off (lane REASONSHAPESR2:
  the terminal agent can be told to send none; the record decides what
  the wire carries). `EffortLevel` excludes `none`, so it is widened
  here, never in the shared union.
  */
  readonly effort: EffortLevel | typeof THINKING_OFF_EFFORT | undefined
  /** The plan route's Fast tier while on; off by default, refused where unoffered. */
  readonly fast: boolean
  readonly allowsContributorModels: boolean
  readonly output: ExecOutput
  readonly outputSchema?: string
  readonly outputSchemaOutside?: boolean
  /** Exact canonical budget; admission uses integer micro-units internally (F1). */
  readonly budgetUsd: UsdAmount | undefined
  readonly maxRequests: number | undefined
  /** TOOLCAP: raise the per-tool-result byte guard for this run only. */
  readonly maxToolOutputBytes: number | undefined
  /**
  Optional lowering limit for the run's output cap (round 5): absent is
  the policy cap; present never exceeds it (larger values are refused at
  parsing). Carried into the request's output limit and its reservation.
  */
  readonly maxOutputTokens?: number | undefined
  /** No deadline of ours without `--timeout`: the run ends with the turn, the person, or the provider. */
  readonly timeoutMs: number | undefined
  readonly paidFeatures: readonly ExecPaidFeature[]
  readonly failOnDenial: boolean
  readonly ephemeral: boolean
  readonly keyFromStdin: boolean
  /** C-M95-SUB: the Muse Code subscription pays for this run. Model API only. */
  readonly subscription: boolean
  /** Local unattended vault grants only; CI's stdin-key lane remains vault-free. */
  readonly vault: boolean
  readonly museBinary: string
  readonly shellSandbox: ShellSandboxMode
  readonly isVerbose: boolean
  readonly autoCompaction?: boolean
}

const BOOLEAN_OPTIONS = new Set([
  'allow-contributor-models',
  'fast',
  'team',
  'image-generation',
  'auto-compaction',
  'no-auto-compaction',
  'fail-on-denial',
  'ephemeral',
  'key-stdin',
  'subscription',
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
  'max-output-tokens',
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
  // D208: the person's budget has no ceiling of ours; only zero refuses.
  return units > ZERO_UNITS ? Usd.fromUnits(units, EXEC_USD_DECIMALS).toAmount() : undefined
}

function invalid(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason }
}

/** The refused flag in words, with its value when one was given. */
function flagArgument(key: string, value: unknown): string {
  return typeof value === 'string' && value !== '' ? `--${key} ${value}` : `--${key}`
}

/** A refused flag value owns the usage refusal and names the flag. */
function invalidFlagValue(
  key: string,
  value: unknown,
): { readonly ok: false; readonly reason: string } {
  return invalid(fill(UI_TEXT.acpUnknownArgument, { argument: flagArgument(key, value) }))
}

/**
Bare single-segment IDs qualify immediately. Slash-containing IDs remain
intact until assembly can distinguish a configured native ID from a qualified
reference. Without a provider the model passes through untouched.
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
  const parsed = parseModelRef(`${provider}/${model}`)
  if (parsed === undefined) {
    return undefined
  }
  return model.includes('/') ? model : `${provider}/${model}`
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
  if (mode === undefined)
    return invalid(
      `${fill(UI_TEXT.acpUnknownArgument, { argument: flagArgument('permission-mode', values['permission-mode']) })}: ${UI_TEXT.execModeRefused}`,
    )
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
  if (backend === undefined) return invalidFlagValue('backend', values['backend'])
  if (output === undefined) return invalidFlagValue('output', values['output'])
  if (shellSandbox === undefined) return invalidFlagValue('shell-sandbox', values['shell-sandbox'])
  if (effort === undefined && values['effort'] !== undefined)
    return invalidFlagValue('effort', values['effort'])
  // No default: without `--timeout` the run has no deadline of ours. A set
  // deadline is any positive safe integer of seconds: no provider publishes a
  // run deadline, so the product sets no maximum (the deadline timer re-arms
  // past Node's setTimeout ceiling instead of overflowing). Zero, negatives
  // and non-numbers are refused as not a time.
  const timeout =
    values['timeout'] === undefined
      ? undefined
      : integer(values['timeout'], 0, 1, Number.MAX_SAFE_INTEGER)
  // No default: without `--max-requests` the run has no request limit. A set
  // value is any positive safe integer; no provider publishes a maximum.
  const maxRequests =
    values['max-requests'] === undefined
      ? undefined
      : integer(values['max-requests'], 0, 1, Number.MAX_SAFE_INTEGER)
  // TOOLCAP: absent keeps the setting default (D121: 0, no guard of ours);
  // an explicit 0 keeps no guard either, while any other present value
  // stays at or above the readable floor. The window fit is refused at
  // runtime with its reason, where the model's window is known.
  const maxToolOutputBytes =
    values['max-tool-output-bytes'] === '0'
      ? 0
      : integer(
          values['max-tool-output-bytes'],
          SETTING_DEFAULTS.modelApiMaxToolOutputBytes,
          TOOL_RESULT_MIN_BYTES,
          Number.MAX_SAFE_INTEGER,
        )
  // An absent flag keeps the policy cap; a present one only lowers it. The
  // parse-time ceiling is the absolute cap every policy cap sits at or
  // below; a larger value is refused here with its own sentence. The floor
  // stays 1 here: the selected model's own provider minimum applies later,
  // at admission and at the send (a configured provider's minimum with its
  // sentence, Meta's 16 through its own path), so a provider that permits
  // fewer than 16 output tokens can be capped at 1 through 15.
  const rawMaxOutput = values['max-output-tokens']
  const maxOutputTokens =
    rawMaxOutput === undefined
      ? undefined
      : integer(rawMaxOutput, MODEL_API_MAX_OUTPUT_TOKENS, 1, Number.MAX_SAFE_INTEGER)
  if (rawMaxOutput !== undefined && maxOutputTokens === undefined)
    return invalid(fill(UI_TEXT.execLimitInvalid, { flag: '--max-output-tokens' }))
  if (maxOutputTokens !== undefined && maxOutputTokens > MODEL_API_MAX_OUTPUT_TOKENS)
    return invalid(
      fill(UI_TEXT.execOutputCapExceeded, { cap: String(MODEL_API_MAX_OUTPUT_TOKENS) }),
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
  if (maxToolOutputBytes === undefined) return invalid(UI_TEXT.execNumberInvalid)
  if (timeout === undefined && values['timeout'] !== undefined)
    return invalid(fill(UI_TEXT.execLimitInvalid, { flag: '--timeout' }))
  if (maxRequests === undefined && values['max-requests'] !== undefined)
    return invalid(fill(UI_TEXT.execLimitInvalid, { flag: '--max-requests' }))
  if (budgetUsd === undefined && values['max-budget-usd'] !== undefined)
    return invalid(
      `${fill(UI_TEXT.acpUnknownArgument, { argument: flagArgument('max-budget-usd', values['max-budget-usd']) })}: ${UI_TEXT.execNumberInvalid}`,
    )
  if (backend === 'modelApi' && budgetUsd === undefined) return invalid(UI_TEXT.execBudgetRequired)
  if (values['output-schema'] === '')
    return invalidFlagValue('output-schema', values['output-schema'])
  if (values['output-schema-outside'] === true && values['output-schema'] === undefined)
    return invalidFlagValue('output-schema-outside', values['output-schema-outside'])
  // The refusal names the options the person gave, as typed.
  const given = (keys: readonly string[]): string =>
    keys
      .filter((key) => values[key] !== undefined && values[key] !== false)
      .map((key) => `--${key}`)
      .join(', ')
  const modelApiOnly = given([
    'max-budget-usd',
    'max-requests',
    'max-tool-output-bytes',
    'max-output-tokens',
    'ephemeral',
    'key-stdin',
    'subscription',
    'image-generation',
    'auto-compaction',
    'output-schema',
    'output-schema-outside',
    'team',
  ])
  if (backend === 'museCode' && modelApiOnly !== '')
    return invalid(fill(UI_TEXT.execModelApiOnly, { options: modelApiOnly }))
  const museCodeOnly = given(['muse-binary', 'shell-sandbox'])
  if (backend === 'modelApi' && museCodeOnly !== '')
    return invalid(fill(UI_TEXT.execMuseCodeOnly, { options: museCodeOnly }))
  if (values['key-stdin'] === true && values['subscription'] === true)
    return invalid(UI_TEXT.execSubscriptionStdin)
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
  if (provider !== undefined && rawModel !== undefined && model === undefined) {
    // --model names no model on --provider: unparsable, or naming another
    // provider. The sentence names both, and the command listing the entry.
    return invalid(unknownProviderModelText(rawModel, provider, listModelsRemedy()))
  }
  // Team admission follows the prompt, provider and hard-budget checks.
  // D227: no availability switch stands before it; the two-model rule at
  // run start refuses a team run without a second runnable model.
  if (values['team'] === true) {
    const admission = teamExecAdmission({ mode, backend })
    if (!admission.ok) return invalid(admission.reason)
  }
  return {
    ok: true,
    options: {
      ...(typeof values['account'] === 'string' && { account: values['account'] }),
      ...(values['account-pool'] === true && { accountPool: true }),
      backend,
      team: values['team'] === true,
      cwd: stringValue('cwd'),
      prompt,
      untrustedFiles,
      mode,
      provider,
      model,
      effort,
      fast: values['fast'] === true,
      allowsContributorModels: values['allow-contributor-models'] === true,
      output,
      ...(outputSchema !== undefined && { outputSchema }),
      ...(values['output-schema-outside'] === true && { outputSchemaOutside: true }),
      budgetUsd,
      maxRequests: backend === 'modelApi' ? maxRequests : undefined,
      maxToolOutputBytes: backend === 'modelApi' ? maxToolOutputBytes : undefined,
      ...(backend === 'modelApi' && maxOutputTokens !== undefined && { maxOutputTokens }),
      timeoutMs: timeout === undefined ? undefined : timeout * MILLISECONDS_PER_SECOND,
      paidFeatures: [
        ...(values['image-generation'] === true ? (['imageGeneration'] as const) : []),
        ...(values['auto-compaction'] === true ? (['autoCompaction'] as const) : []),
      ],
      failOnDenial: values['fail-on-denial'] === true,
      ephemeral: values['ephemeral'] === true,
      keyFromStdin: values['key-stdin'] === true,
      subscription: values['subscription'] === true,
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
Headless paid-use admission for one feature: nobody can be asked, so
image generation needs its flag, acceptEdits and an affordable hard run
budget, and automatic compaction needs its flag and any remaining run
budget (no `--max-budget-usd` means no ledger, so no compaction). Pure,
so the run and its tests decide identically.
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
    ...(options.subscription && { subscription: true }),
  }
}
