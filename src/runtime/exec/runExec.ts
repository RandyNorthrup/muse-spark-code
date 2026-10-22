import { Usd, sumUsd, type UsdAmount } from '../../shared/usd'
import type * as acp from '@agentclientprotocol/sdk'
import { constants as fileFlags, stat, realpath, open, type FileHandle } from 'node:fs/promises'
import {
  createUsageRecording,
  isUsageWriterBundle,
  type UsageRecording,
} from '../../core/usage/recording'
import { requireFile } from '../../host/lazyBundle'
import { agentDataFolder } from '../dataFolder'
import { randomUUID } from 'node:crypto'

import path from 'node:path'
import type { Readable } from 'node:stream'
import {
  handleIdentity,
  lstatIdentity,
  sameFile,
  type FileIdentity,
} from '../../core/fs/fileIdentity'
import type { AcpMediaFactory } from '../../acp/media'
import { isValidModelApiKey, type SecretStore } from '../../host/auth/credentialStore'
import type { Logger } from '../../host/logger'
import type { AgentEvent } from '../../shared/agentEvents'
import { uiLocale, fill, formatNumber, formatPercent, plural } from '../../shared/l10n/text'
import {
  ACP_AGENT_NAME,
  ACP_COMPACT_COMMAND,
  ACCOUNT_DEFAULT_ID,
  ACP_CONFIG_IDS,
  EXEC_EXIT,
  EXEC_ENDPOINTS,
  EXEC_PROMPT_MAX_BYTES,
  EXEC_MODEL_TEXT,
  EXEC_PROTOCOL_VERSION,
  EXEC_STOP_GRACE_MS,
  EXEC_STREAM_IDLE_MS,
  EXEC_USD_DECIMALS,
  SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT,
  HTTP_STATUS,
  HTTP_UNAUTHORIZED,
  JSON_RPC_ERRORS,
  MILLISECONDS_PER_SECOND,
  NO_COMPACTABLE_HISTORY,
  PAID_PRICES_USD,
  MODEL_API_IMAGE_MODEL,
  MODEL_API_PRICES_PER_MILLION,
  SECRET_KEYS,
  THINKING_OFF_EFFORT,
  PROVIDER_SECRET_PREFIX,
  UI_TEXT,
} from '../../shared/constants'
import { effortLevelsFor } from '../../shared/effort'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { formatUsd as exactUsd, parseUsd } from '../../shared/accountUsd'
import { modelApiPaidTier } from '../../shared/paid'
import type { RuntimeBackend, RuntimeBackendDeps } from '../backends'
import { isHeadlessPaidUseAllowed, serveOptionsFor } from './execArgs'
import { execAttachmentBlocks, type ExecAttachmentOptions as ExecOptions } from './attachArgs'
import { execAccountSelection, type ExecAccountsPort } from './execAccounts'
import type { AccountsSessionPort } from '../../acp/accounts'
import { accountStopText, accountUsageUrl } from '../../acp/accountText'
import { execFetch, type ExecTransport } from './execFetch'
import { statusForStop, type Lifecycle, type StopCause } from './execLimits'
import { createExecLogger, redactWhole } from './execOutput'
import { createResourceExecSink } from '../resources/execSink'
import type { RuntimeResources } from '../resources/port'
import type { ResourceSettings } from '../../shared/resources'
import {
  exitCodeFor,
  type ExecDenial,
  type ExecInputRecord,
  type ExecResult,
  type ExecStatus,
  type TokenTotals,
} from './execProtocol'
import type { FdWriter } from './fdWriter'
import {
  memorySecretStore,
  type MemorySecretStore,
  readKeyLine,
  readProviderKeyLine,
  readPromptStdin,
} from './keyInput'
import type { AssembledProviderRun } from './providerExec'
import {
  createExecOutputCap,
  createRunLedger,
  previewResponseReservation,
  type TierPrice,
} from './runLedger'
import { isPlanModelRef } from '../../shared/providerRouting'
import type { ExecBudgetRefusal } from './execProtocol'
import { observeBackend, type SessionTap } from './sessionTap'
import { readUntrustedInputs } from './untrustedInput'
import type { ExecVaultPort, ExecVaultSession } from '../vault/execVault'
import { failureForLog } from '../../core/backends/musecode/logText'
import { metaSideCallFormats } from '../../core/backends/modelapi/modelCapabilities'
import { compileOutputSchema, type OutputSchema } from './outputSchema'
import type { ExecTeam } from './execTeamEntry'
import { areHeadlessTeamsAvailable } from '../../acp/teamAdmission'

/** Bind to M95's selected output.formats and the backend's session-fixed encoder at integration. */
export interface ExecOutputSchemaPort {
  /** Only values from an evidence-bearing `state: 'yes'` capability record. */
  formatsFor(model: string): Promise<readonly ('strict_schema' | 'json_schema' | 'forced_tool')[]>
  /** Set the session's format only: no dispatch, permission change or cached-prefix mutation. */
  configure(input: {
    runtime: RuntimeBackend
    sessionId: string
    model: string
    mode: 'strict_schema' | 'json_schema' | 'forced_tool'
    schema: Readonly<Record<string, unknown>>
    signal: AbortSignal
  }): Promise<void>
}

/** Production binding: captured selected formats, or the documented local-validation arm. */
export const execOutputSchemaPort: ExecOutputSchemaPort = {
  formatsFor: (model) => {
    const formats = metaSideCallFormats(model)
    return Promise.resolve(
      formats.state === 'yes'
        ? (formats.value ?? []).filter(
            (format): format is 'strict_schema' | 'json_schema' | 'forced_tool' =>
              ['strict_schema', 'json_schema', 'forced_tool'].includes(format),
          )
        : [],
    )
  },
  configure: async ({ runtime, sessionId, model, mode, schema, signal }) => {
    signal.throwIfAborted()
    if (mode === 'forced_tool' || runtime.configureOutputSchema === undefined)
      throw new Error(UI_TEXT.execRequestShape)
    await runtime.configureOutputSchema(sessionId, model, mode, schema)
    signal.throwIfAborted()
  },
}
export { setUiText } from '../../shared/l10n/text'

/**
EXECPROV round 6: the final sentence of a run-cap budget stop, true for
what happened. Kept text is shown with the kept-work sentence; with
nothing produced yet the run was still reading and no answer exists. Both
remedies follow with numbers — the output limit only when it alone can
make the next request fit, the input note only when the input alone
already costs more than is left.
*/
export function budgetFinalMessage(input: {
  readonly kept: readonly string[]
  readonly requests: number
  readonly details: ExecBudgetRefusal | undefined
}): string {
  const remedies: string[] = []
  if (input.details !== undefined) {
    remedies.push(
      input.details.admitCapUsd === null
        ? UI_TEXT.execBudgetImpossible
        : fill(UI_TEXT.execBudgetRemedyCap, { admitCap: formatUsd(input.details.admitCapUsd, 2) }),
    )
    if (input.details.maxOutputTokens !== null)
      remedies.push(
        fill(UI_TEXT.execBudgetRemedyOutput, {
          maxTokens: String(input.details.maxOutputTokens),
        }),
      )
    else if (input.details.inputAloneExceeds)
      remedies.push(
        fill(UI_TEXT.execBudgetRemedyInput, {
          inputCost: formatUsd(input.details.inputCostUsd, EXEC_USD_DECIMALS),
          remaining: formatUsd(input.details.remainingUsd, EXEC_USD_DECIMALS),
        }),
      )
  }
  return [
    ...input.kept,
    input.kept.length > 0
      ? plural(UI_TEXT.execBudgetProgress, input.requests)
      : UI_TEXT.execBudgetStillReading,
    ...remedies,
  ].join(' ')
}

export interface ExecDeps {
  readonly usageRecording?: UsageRecording | undefined
  readonly isUsageHistoryEnabled?: (() => boolean) | undefined
  readonly accounts?: ExecAccountsPort
  readonly vault?: ExecVaultPort
  options: ExecOptions
  version: string
  distDir: string
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  homeDir: string
  processCwd: string
  stdin: Readable
  stdout: FdWriter
  stderr: FdWriter
  storeSecrets: SecretStore
  runGit: (args: readonly string[], cwd: string) => Promise<string>
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  readFile: (path: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  randomHex: (bytes: number) => string
  log: Logger
  /** Construction is lazy; W/C1 inject this same host into runtime spawn adapters. */
  createResources?: (overrides: Partial<ResourceSettings>) => RuntimeResources
  resourceOverrides?: Partial<ResourceSettings>
  runProvider?: ProviderExecRunner | undefined
  outputSchema?: ExecOutputSchemaPort
  /** Filesystem seam for races and Windows junctions; production uses the native filesystem. */
  schemaFileIo?: {
    open: (file: string, flags: number) => Promise<FileHandle>
    realpath: (file: string) => Promise<string>
    lstat: (file: string) => Promise<FileIdentity>
  }
  /** W binds headless-safe capability, upload/replay and exact budget admission. */
  media?: AcpMediaFactory
}

/** Open first, verify the held target, then read exclusively through that handle. */
async function readSchemaFile(
  deps: ExecDeps,
  cwd: string,
  signal: AbortSignal,
  log: Logger,
): Promise<Uint8Array> {
  signal.throwIfAborted()
  const io = deps.schemaFileIo ?? { open, realpath, lstat: lstatIdentity }
  const file = path.resolve(cwd, deps.options.outputSchema ?? '')
  // Windows has no O_NOFOLLOW; handle identity and realpath confinement still apply.
  const flags = fileFlags.O_RDONLY | (deps.platform === 'win32' ? 0 : fileFlags.O_NOFOLLOW)
  const handle = await io.open(file, flags)
  try {
    signal.throwIfAborted()
    const [info, target, workspace] = await Promise.all([
      handleIdentity(handle),
      io.realpath(file),
      io.realpath(cwd),
    ])
    const paths = deps.platform === 'win32' ? path.win32 : path
    const relative = paths.relative(workspace, target).replaceAll('\\', '/')
    const isOutside = relative === '..' || relative.startsWith('../') || paths.isAbsolute(relative)
    if (isOutside && deps.options.outputSchemaOutside !== true)
      throw new Error(UI_TEXT.outputSchemaOutsideRefused)
    const current = await io.lstat(target)
    if (!info.isFile() || !sameFile(info, current)) throw new Error(UI_TEXT.execFileUnreadable)
    if (isOutside) log.info(UI_TEXT.outputSchemaOutsideAllowed)
    if (info.size > BigInt(EXEC_PROMPT_MAX_BYTES)) throw new Error(UI_TEXT.execFileTooLarge)
    const bytes = new Uint8Array(EXEC_PROMPT_MAX_BYTES + 1)
    let offset = 0
    for (;;) {
      signal.throwIfAborted()
      const part = await handle.read(bytes, offset, bytes.length - offset, null)
      offset += part.bytesRead
      if (offset > EXEC_PROMPT_MAX_BYTES) throw new Error(UI_TEXT.execFileTooLarge)
      if (part.bytesRead === 0) return bytes.subarray(0, offset)
    }
  } finally {
    await handle.close()
  }
}

/** What the provider turn receives: the lifecycle, the run's deps and the assembly. */
export interface ProviderRunRequest {
  readonly lifecycle: Lifecycle
  readonly deps: ExecDeps
  readonly run: AssembledProviderRun
}

/** A test runner's provider turn on the same validated and pinned run. */
export type ProviderExecRunner = (request: ProviderRunRequest) => Promise<number>

/**
A missing price is not a budget stop (5a): the sentence states the reason
and the remedy. A provider run names the runner's own providers file,
where a price for the model is added; anything else names a priced model.
*/
function unpricedMessage(
  requestedModel: string | null | undefined,
  file: string | undefined,
): string {
  return file !== undefined &&
    requestedModel !== undefined &&
    requestedModel !== null &&
    requestedModel !== ''
    ? fill(UI_TEXT.execUnpricedProvider, { model: requestedModel, file })
    : UI_TEXT.execUnpricedModel
}

function stopMessage(cause: StopCause, maxRequests: number): string {
  switch (cause.kind) {
    case 'signal': {
      return UI_TEXT.execInterrupted
    }
    case 'timeout': {
      return UI_TEXT.execTimedOut
    }
    case 'denied': {
      return UI_TEXT.execDeniedStop
    }
    case 'requests': {
      return plural(UI_TEXT.execRequestCapReached, maxRequests)
    }
    case 'budget': {
      return UI_TEXT.execBudgetRefused
    }
    case 'unpriced': {
      return UI_TEXT.execUnpricedModel
    }
    case 'request_shape': {
      return UI_TEXT.execRequestShape
    }
    case 'breach': {
      return UI_TEXT.execBudgetBreach
    }
    case 'accounting_invalid': {
      return UI_TEXT.execAccountingInvalid
    }
    case 'output_closed':
    case 'output_stalled':
    case 'internal': {
      return UI_TEXT.execOutputStalled
    }
  }
}

const ZERO_MICRO_USD = 0n

function microUsd(value: UsdAmount): bigint {
  return Usd.from(value).units(EXEC_USD_DECIMALS)
}

function relativePaths(cwd: string, paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.flatMap((given) => {
        const relative = path.relative(cwd, path.resolve(cwd, given)).split(path.sep).join('/')
        return relative !== '' &&
          relative !== '..' &&
          !relative.startsWith('../') &&
          !path.isAbsolute(relative) &&
          !relative.includes(':')
          ? relative
          : []
      }),
    ),
  ]
}

export async function runExec(lifecycle: Lifecycle, deps: ExecDeps): Promise<number> {
  const { options } = deps
  const cwd = path.resolve(deps.processCwd, options.cwd ?? deps.processCwd)
  const literals: string[] = []
  let isFinished = false
  let isFinishing = false
  const rawLog = createExecLogger({
    stderr: deps.stderr,
    literals: () => literals,
    verbose: options.isVerbose,
  })
  const log: Logger = {
    trace(message) {
      if (!isFinished) rawLog.trace(message)
    },
    info(message) {
      if (!isFinished) rawLog.info(message)
    },
    warn(message) {
      if (!isFinished) rawLog.warn(message)
    },
    error(message) {
      if (!isFinished) rawLog.error(message)
    },
  }
  const usageRecording =
    deps.usageRecording ??
    createUsageRecording({
      client: 'cli',
      now: deps.now,
      newId: () => randomUUID(),
      isEnabled: () => !options.ephemeral && (deps.isUsageHistoryEnabled?.() ?? true),
      log,
      writer: async (onWriteError) => {
        const bundle = requireFile(path.join(deps.distDir, 'usageService.js'))
        if (!isUsageWriterBundle(bundle)) throw new Error('Usage writer factory unavailable')
        return await bundle.createUsageWriter({
          dataFolder: agentDataFolder(deps),
          writerId: randomUUID(),
          now: deps.now,
          isEnabled: () => !options.ephemeral && (deps.isUsageHistoryEnabled?.() ?? true),
          onWriteError,
          onInvalidSettings: () => {
            log.warn(
              'Usage history settings are invalid, so usage history is paused. Delete usage-settings.json in the agent data folder or turn usage history off and on again to record history again.',
            )
          },
        })
      },
    })
  let restoreUsageRecording: (() => void) | undefined
  const limits = {
    budgetUsd: options.budgetUsd ?? null,
    maxRequests: options.maxRequests ?? null,
    timeoutSeconds:
      options.timeoutMs === undefined ? null : options.timeoutMs / MILLISECONDS_PER_SECOND,
  }
  // The same closure feeds the request body (via modelOutputMaxTokens) and
  // the run ledger's admission, so what is reserved is what the provider may
  // produce. The model name resolves after setup; the closure reads it late.
  // A provider id is user-configurable, not proof of subscription billing.
  // The budget is always kept by reservation; the request cap only when the
  // person set one (without `--max-requests` there is no request limit).
  const outputCap = createExecOutputCap({
    model: () => model,
    maxOutputTokens: options.maxOutputTokens,
  })
  const ledger =
    options.backend === 'modelApi' && options.budgetUsd !== undefined
      ? createRunLedger({
          capUsd: options.budgetUsd,
          maxRequests: options.maxRequests,
          outputCap,
          concurrent: options.team,
        })
      : undefined
  // A plan model runs on its subscription sign-in, not the Meta key: it
  // bypasses the Meta-only transport below, and its attempts are admitted
  // through the shared accounting wrapper's zero-price tickets (the same
  // single-admission pattern as a configured-provider run), so the run's
  // request count still bounds it.
  // Re-decided from the session's resolved model below: without `--model`
  // the default may be a plan model the transport must not wrap (Codex on
  // PR #213).
  let isPlanRun = options.model !== undefined && isPlanModelRef(options.model)
  let providerRun: AssembledProviderRun | undefined
  /** The runner's own providers file, for the missing-price remedy (5a). */
  let providerFilePath: string | undefined
  let memory: MemorySecretStore | undefined
  let runtime: RuntimeBackend | undefined
  let team: ExecTeam | undefined
  let tap: SessionTap | undefined
  let transport: ExecTransport | undefined
  let vaultSession: ExecVaultSession | undefined
  let vaultDenial: string | undefined
  const setup: { sessionId: string | null; isUsageError: boolean } = {
    sessionId: null,
    isUsageError: true,
  }
  let model: string | null = null
  let effort: string | null = null
  let stopReason: string | null = null
  let isCompactionPrompt = false
  let terminal: string | null = null
  let incompleteReason: string | null = null
  let modelCallLimitReason: string | undefined
  let backendErrorKind: string | undefined
  let catalogueHttpStatus: number | undefined
  let status: ExecStatus = 'failed'
  let error = UI_TEXT.execIncomplete
  /** The latest run-cap budget refusal in typed numbers, for the final sentence and JSON. */
  let budgetRefusal: ExecBudgetRefusal | undefined
  let localRefusalKind: string | undefined
  let localRefusalFacts:
    { scope: string; file?: string | undefined; errno?: string | undefined } | undefined
  let questionsDeclined = 0
  let inputs: ExecInputRecord[] = []
  const filesChanged = new Set<string>()
  const denials: ExecDenial[] = []
  let unsubscribe: (() => void) | undefined
  let closeSession: (() => Promise<unknown>) | undefined
  let cancelSession: (() => void) | undefined
  let latestTokens: Partial<TokenTotals> | undefined
  let outputSchema: OutputSchema | undefined
  let outputValidation: 'provider' | 'local' = 'provider'
  const emitted = new Set<string>()
  const imageStarts = new Map<number, number>()
  const sink = createResourceExecSink({
    format: options.output,
    out: deps.stdout,
    now: deps.now,
    literals: () => literals,
    summary: (line) => {
      log.info(line)
    },
    onStalled: () => {
      lifecycle.latch({ kind: 'output_stalled' })
    },
    outputSchema: () => outputSchema,
    outputValidation: () => outputValidation,
  })
  const resources = deps.createResources?.({ ...deps.resourceOverrides, relocate: 'off' })
  const unsubscribeResources = resources?.subscribeEvents((event, _status, text) => {
    if (isFinishing || isFinished) return
    sink.resource(event)
    log.warn(text.replaceAll('\n', ' · '))
  })
  const drain = () => {
    const messages = tap?.releasedMessages() ?? []
    for (const item of messages) {
      if (emitted.has(item.itemId)) {
        continue
      }

      sink.message(item)
      emitted.add(item.itemId)
    }
  }
  const latch = (cause: StopCause) => {
    if (!lifecycle.latch(cause)) return
    if (cause.kind === 'signal') sink.emit({ type: 'signal', signal: cause.signal })
    else if (
      cause.kind !== 'denied' &&
      cause.kind !== 'internal' &&
      cause.kind !== 'output_closed' &&
      cause.kind !== 'output_stalled'
    )
      sink.emit({
        type: 'limit',
        limit: cause.kind === 'accounting_invalid' ? 'accounting' : cause.kind,
      })
  }
  const denyVault = (message: string) => {
    if (isFinishing) return
    vaultDenial = message
    setup.isUsageError = false
    latch({ kind: 'denied' })
  }
  const observe = (event: AgentEvent) => {
    if (event.type === 'turnCompleted') {
      terminal = event.terminal
      incompleteReason = event.reason ?? null
      backendErrorKind = event.errorKind
      if (event.errorKind === 'max_turn_requests') {
        modelCallLimitReason = event.reason
        sink.emit({ type: 'limit', limit: 'requests' })
      }
    } else if (event.type === 'tokenUsage' && options.backend === 'museCode') {
      latestTokens = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        ...(event.cachedTokens !== undefined && { cachedTokens: event.cachedTokens }),
        ...(event.reasoningTokens !== undefined && { reasoningTokens: event.reasoningTokens }),
      }
    } else if (event.type === 'questionRequested') {
      questionsDeclined += 1
      sink.emit({ type: 'question_declined', count: 1 })
    } else if (event.type === 'backendNotice') {
      // The app's own words, on stderr beside the run: never part of the
      // model's message. The backend emits each notice once per session.
      // The notice's own level names the log line, so an info status does
      // not read as a warning.
      if (event.level === 'error') log.error(event.text)
      else if (event.level === 'warning') log.warn(event.text)
      else log.info(event.text)
    } else if (
      event.type === 'itemCompleted' &&
      event.item.kind !== 'agentMessage' &&
      event.item.kind !== 'reasoning' &&
      event.item.kind !== 'userMessage'
    ) {
      sink.emit({
        type: 'tool',
        name: event.item.tool ?? event.item.kind,
        status: event.item.status,
        durationMs: event.item.durationMs ?? 0,
      })
    }
    drain()
  }
  /**
  A BYO provider run (M95, PLAN.md D74): everything is resolved and
  checked up front — the provider from the runner's own user file, a
  model naming it, a bound credential, a re-checked endpoint and the
  pinned fetch — then the ordinary ACP engine runs the turn.
  */
  async function runWithProvider(): Promise<number | undefined> {
    // Provider assembly rides the lazy engine bundle beside the packed
    // agent (never inlined here): dist/headless.js keeps its budget.
    const providerEngine = await import('../runtimeEngineEntry')
    providerEngine.setUiText(UI_TEXT, uiLocale())
    const { assembleProviderRun, providersFilePath, resolveEndpointHost } = providerEngine
    const providerId = options.provider ?? ''
    // Past argument parsing: failures from here are the run's, not usage,
    // unless assembly says otherwise.
    setup.isUsageError = false
    providerFilePath = providersFilePath({
      platform: deps.platform,
      homeDir: deps.homeDir,
      xdgConfigHome: deps.env['XDG_CONFIG_HOME'],
    })
    const assembled = await lifecycle.race(
      assembleProviderRun({
        filePath: providerFilePath,
        readFile: async (filePath) => {
          const bytes = await deps.readFile(filePath, EXEC_PROMPT_MAX_BYTES, lifecycle.signal)
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        },
        secrets: deps.storeSecrets,
        resolveHost: resolveEndpointHost,
        readKey: () => readProviderKeyLine(deps.stdin, lifecycle.signal),
        providerId,
        model: options.model,
        keyFromStdin: options.keyFromStdin,
      }),
    )
    if (!assembled.ok) {
      if (assembled.failure.kind === 'usage') {
        setup.isUsageError = true
      } else {
        status = 'auth_required'
      }
      error = assembled.failure.reason
      return await finish()
    }
    // A piped key that looks like the wrong thing is named, as on the
    // terminal surfaces; stdin cannot answer, so the run continues.
    if (assembled.notice !== undefined) log.warn(assembled.notice)
    memory = assembled.run.memory
    for (const literal of assembled.run.literals) {
      literals.push(literal)
    }
    providerRun = assembled.run
    return await deps.runProvider?.({ lifecycle, deps, run: assembled.run })
  }
  void (async () => {
    try {
      await lifecycle.stopped
      transport?.close()
      cancelSession?.()
    } catch (error_: unknown) {
      log.error(failureForLog(error_))
    }
  })()
  const cleanupStart = { value: 0 }
  // D4: a qualified model names its provider problem before the session
  // starts: an unconfigured provider, or a model missing from it. Anything
  // else (and an unreadable providers file) stays with the session's own
  // sentence at set-up time. Runs through --provider never reach here:
  // assembly validated them against the same file.
  const providerModelRefusal = async (): Promise<string | undefined> => {
    if (options.model === undefined) return undefined
    // D4: the providers bundle owns the ref parser and the file reader;
    // the headless entry reaches both through its externalized entries,
    // never a static edge (the split gate forbids carrying them).
    const { modelRef, providersFile } = await import('../../host/backend/providersEntry')
    const { providersFilePath } = await import('../../host/backend/configuredProvidersEntry')
    const parsed = modelRef.parseModelRef(options.model)
    if (parsed === undefined || parsed.providerId === modelRef.RESERVED_PROVIDER_ID)
      return undefined
    const read = await providersFile.readProvidersFile(
      providersFilePath({
        platform: deps.platform,
        homeDir: deps.homeDir,
        xdgConfigHome: deps.env['XDG_CONFIG_HOME'],
      }),
      async (filePath) =>
        new TextDecoder('utf-8', { fatal: true }).decode(
          await deps.readFile(filePath, EXEC_PROMPT_MAX_BYTES, lifecycle.signal),
        ),
    )
    if (!read.ok) return undefined
    const entry = read.file.providers.find((candidate) => candidate.id === parsed.providerId)
    if (entry === undefined)
      return fill(UI_TEXT.providerNotConfigured, { provider: parsed.providerId })
    if (entry.models.every((id) => options.model !== id && options.model !== `${entry.id}/${id}`)) {
      return fill(UI_TEXT.execModelNeedsProvider, {
        model: options.model,
        provider: parsed.providerId,
        available: entry.models.map((id) => `${entry.id}/${id}`).join(', '),
      })
    }
    return undefined
  }
  const grace = async <T>(waiting: Promise<T>): Promise<T | undefined> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        waiting,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(
            () => {
              resolve(undefined)
            },
            Math.min(
              lifecycle.remainingGraceMs(),
              Math.max(0, EXEC_STOP_GRACE_MS - (deps.now() - cleanupStart.value)),
            ),
          )
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    // RVCM96B2D P2-9: stale team runs are recovered at every headless
    // start, not only after a new team is admitted. Best effort: failures
    // stay on disk for the next sweep and never fail the run they precede.
    const { sweepStaleTeamRuns } = await import('./execTeamRecovery')
    await sweepStaleTeamRuns({
      git: async (args, folder) => new TextEncoder().encode(await deps.runGit(args, folder)),
    })
    // Behind the agent-teams availability switch `exec --team` does not
    // exist: refuse before any ledger, request or money path is reached.
    if (options.team && !areHeadlessTeamsAvailable())
      throw new Error(fill(UI_TEXT.acpUnknownArgument, { argument: '--team' }))
    if (
      options.vault &&
      (options.keyFromStdin ||
        (deps.env['CI'] !== undefined &&
          !['', '0', 'false'].includes(deps.env['CI'].toLowerCase())) ||
        deps.vault === undefined)
    ) {
      denyVault(UI_TEXT.vault.brokerBlocked)
      return await finish()
    }
    const selection = execAccountSelection(options)
    const requiresAccounts =
      options.accountPool === true || selection.account !== ACCOUNT_DEFAULT_ID
    if (requiresAccounts && options.backend === 'museCode')
      throw new Error(UI_TEXT.accounts.museCodeUnavailable)
    if (requiresAccounts && deps.accounts === undefined)
      throw new Error(UI_TEXT.accounts.unavailable)
    if (options.provider !== undefined) {
      const result = await runWithProvider()
      if (result !== undefined) return result
    }
    const folder = await lifecycle.race(stat(cwd))
    if (!folder.isDirectory()) throw new Error(UI_TEXT.execFileUnreadable)
    if (options.outputSchema !== undefined) {
      let bytes: Uint8Array
      try {
        bytes = await lifecycle.race(readSchemaFile(deps, cwd, lifecycle.signal, log))
      } catch (error: unknown) {
        if (error instanceof Error && error.message === UI_TEXT.outputSchemaOutsideRefused)
          throw error
        throw new Error(fill(UI_TEXT.outputSchemaReadFailed, { detail: 'file' }), { cause: error })
      }
      outputSchema = compileOutputSchema(bytes)
      if (deps.outputSchema === undefined)
        throw new Error(fill(UI_TEXT.outputSchemaInvalid, { detail: 'backend binding' }))
    }
    let prompt: string
    try {
      if (options.prompt.kind === 'text') prompt = options.prompt.text
      else if (options.prompt.kind === 'stdin')
        prompt = await lifecycle.race(
          readPromptStdin(deps.stdin, EXEC_PROMPT_MAX_BYTES, lifecycle.signal),
        )
      else
        prompt = new TextDecoder('utf-8', { fatal: true }).decode(
          await lifecycle.race(
            deps.readFile(
              path.resolve(cwd, options.prompt.path),
              EXEC_PROMPT_MAX_BYTES,
              lifecycle.signal,
            ),
          ),
        )
      if (prompt === '' || Buffer.byteLength(prompt) > EXEC_PROMPT_MAX_BYTES)
        throw new Error(UI_TEXT.execPromptMissing)
      const attachments = await lifecycle.race(
        readUntrustedInputs({
          files: options.untrustedFiles.map((file) => path.resolve(cwd, file)),
          signal: lifecycle.signal,
          readFile: deps.readFile,
          randomHex: deps.randomHex,
        }),
      )
      inputs = [...attachments.records]
      // A resource travels via ACP's existing resource conversion, with its
      // entire instruction envelope fitting before that converter's cap.
      isCompactionPrompt =
        attachments.resources.length === 0 && prompt.trim() === `/${ACP_COMPACT_COMMAND}`
      const blocks: acp.ContentBlock[] = [
        { type: 'text', text: prompt },
        ...attachments.resources.map((resource): acp.ContentBlock => ({
          type: 'resource',
          resource: {
            uri: `untrusted:${encodeURIComponent(resource.name)}`,
            mimeType: 'text/plain',
            text: resource.text,
          },
        })),
        ...(await lifecycle.race(
          execAttachmentBlocks(options.attachFiles ?? [], cwd, lifecycle.signal, deps.platform),
        )),
      ]
      let secrets = providerRun?.secrets ?? deps.storeSecrets
      if (providerRun === undefined && options.keyFromStdin) {
        const key = await lifecycle.race(readKeyLine(deps.stdin, lifecycle.signal))
        if (!key.ok) {
          status = 'auth_required'
          error = UI_TEXT.execKeyMissing
          if (key.reason === 'tooLong') error = UI_TEXT.execKeyTooLong
          else if (key.reason === 'tty') error = UI_TEXT.execKeyStdinTerminal
          return await finish()
        }
        memory = memorySecretStore(key.key)
        literals.push(key.key)
        secrets = memory
      }
      const watchedSecrets: SecretStore = {
        async get(name) {
          const value = await lifecycle.race(Promise.resolve(secrets.get(name)))
          if (value !== undefined && name === SECRET_KEYS.modelApiKey) {
            if (!isValidModelApiKey(value)) return
            if (!literals.includes(value)) literals.push(value)
          }
          if (value !== undefined && name.startsWith(PROVIDER_SECRET_PREFIX)) {
            const { parseStoredProviderSecret } = await import('../runtimeEngineEntry')
            let envelope: unknown
            try {
              envelope = JSON.parse(value)
            } catch (error: unknown) {
              // A stored secret that is not JSON is skipped; JSON.parse on
              // text throws only for malformed content.
              if (error instanceof SyntaxError) return
              throw error
            }
            const stored = parseStoredProviderSecret(envelope)
            if (stored !== undefined && !literals.includes(stored.key)) literals.push(stored.key)
          }
          return value
        },
        store: secrets.store.bind(secrets),
        delete: secrets.delete.bind(secrets),
      }
      if (ledger !== undefined && options.budgetUsd !== undefined && options.team) {
        const { createExecTeam } = await import('./execTeamEntry')
        team = await lifecycle.race(
          createExecTeam(
            {
              dataFolder: agentDataFolder(deps),
              cwd,
              platform: deps.platform,
              provider: options.provider,
              defaultPays: providerRun?.provider.entry.auth === 'none' ? 'local' : 'key',
              budgetUsd: options.budgetUsd,
              signal: lifecycle.signal,
              now: deps.now,
              log,
              readFile: deps.readFile,
              listModels: async () => {
                const host = await runtime?.backend.hostFor(cwd)
                if (host === undefined) throw new Error(UI_TEXT.teamBudgetUnavailable)
                const models = await host.listModels()
                return models.map((entry) => entry.modelId)
              },
              startWorker: async (input) => {
                if (runtime === undefined) throw new Error(UI_TEXT.teamBudgetUnavailable)
                return await runtime.startTeamWorker(cwd, input)
              },
              onWritten: (files) => {
                for (const file of files) filesChanged.add(file)
              },
              secretLiterals: () => literals,
              lowerWorkerCap: (cap) => {
                ledger.lowerWorkerCap(cap)
              },
            },
            UI_TEXT,
            uiLocale(),
          ),
        )
      }
      if (ledger !== undefined && providerRun === undefined && !isPlanRun)
        transport = execFetch({
          fetch: async (url, init) => {
            const response = await deps.fetch(url, init)
            if (typeof url === 'string' && new URL(url).pathname === EXEC_ENDPOINTS.models)
              catalogueHttpStatus = response.status
            return response
          },
          ledger,
          externalResponseAccounting: true,
          get selectedModel() {
            return model ?? ''
          },
          imageGeneration: options.paidFeatures.includes('imageGeneration'),
          responsesThroughEngine: options.team,
          lifecycle,
          onLatch: (cause, message) => {
            if (message !== undefined) {
              error = message
              if (cause.kind === 'breach') localRefusalKind = 'breach'
            }
            latch(cause)
          },
          emit: (event) => {
            if (event.type === 'paid_use' && event.n !== null) {
              if (event.phase === 'admitted') imageStarts.set(event.n, deps.now())
              else {
                const startedAt = imageStarts.get(event.n)
                if (startedAt !== undefined) {
                  imageStarts.delete(event.n)
                  usageRecording.note(undefined, {
                    backend: 'modelApi',
                    provider: 'meta',
                    model: MODEL_API_IMAGE_MODEL,
                    kind: 'image',
                    startedAt,
                    session: setup.sessionId ?? undefined,
                    durationMs: Math.max(0, deps.now() - startedAt),
                    units: { images: event.phase === 'refunded' ? 0 : event.units },
                    outcome: event.phase === 'returned' ? 'completed' : 'failed',
                    uncertain: event.phase === 'uncertain',
                    providerCostUsd: event.phase === 'uncertain' ? undefined : event.usd,
                    retainedLiabilityUsd: event.phase === 'uncertain' ? event.usd : undefined,
                  })
                }
              }
            }
            if (!isFinishing) sink.emit(event)
          },
          onResponseStart: (n) => {
            tap?.beginResponse(n)
          },
          onResponseSettled: (outcome) => {
            tap?.settleResponse(outcome)
            if (!isFinishing) drain()
          },
        })
      const engine = await import('../runtimeEngineEntry')
      engine.setUiText(UI_TEXT, uiLocale())
      restoreUsageRecording = engine.installUsageRecording(usageRecording)
      const { createRuntimeBackend } = engine
      const runtimeDeps: RuntimeBackendDeps = {
        ...(team !== undefined && { team }),
        options: serveOptionsFor(options),
        version: deps.version,
        distDir: deps.distDir,
        platform: deps.platform,
        env: deps.env,
        homeDir: deps.homeDir,
        secrets: watchedSecrets,
        runGit: deps.runGit,
        // Late-bound: a default plan model resolved after session creation
        // drops the Meta-only transport below, and later requests must ride
        // the plain fetch (Codex on PR #213).
        fetch: (url, init) => (transport?.fetch ?? deps.fetch)(url, init),
        sleep: (ms) => lifecycle.race(deps.sleep(ms)),
        log,
        usageRecording,
        exec: {
          secretLiterals: () => literals,
          isEphemeral: options.ephemeral,
          ...(ledger !== undefined &&
            options.maxRequests !== undefined && {
              remainingModelCalls: () => (options.maxRequests ?? 0) - ledger.totals().requests,
            }),
          outputCap,
          ...(providerRun !== undefined && { providerRun }),
          ...((providerRun !== undefined ||
            isPlanRun ||
            options.model === undefined ||
            options.team) &&
            ledger !== undefined && {
              responseAccounting: {
                ledger,
                // No `--model`: the session's default is unknown yet. The
                // wrapper admits plan requests only, so a resolved Meta
                // model is not counted twice (Codex on PR #213).
                ...(providerRun === undefined &&
                  options.model === undefined && { admitOnlyPlan: true }),
                refuse: (reason, message, details) => {
                  if (message !== undefined) error = message
                  // EXECPROV round 6: every run-cap budget refusal reaches the
                  // info line with its numbers sentence, in every output mode.
                  if (reason === 'budget') {
                    if (details !== undefined) budgetRefusal = details
                    if (message !== undefined) log.info(message)
                  }
                  if (reason === 'closed') latch({ kind: 'internal' })
                  else latch({ kind: reason })
                },
                localRefusal: (kind, message, facts) => {
                  localRefusalFacts = facts
                  localRefusalKind = kind
                  error = message
                  if (kind.startsWith('ledger_')) latch({ kind: 'internal' })
                },
                started: (n, ticket) => {
                  tap?.beginResponse(n)
                  // EXECPROV round 6: a byte bound after a failed exact count
                  // says so on the info line, with the fixed reason.
                  if (ticket.inputBound === 'estimate')
                    log.info(
                      fill(UI_TEXT.execEstimateBound, {
                        margin: formatPercent(SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT),
                      }),
                    )
                  else if (ticket.inputBound === 'bytes-after-failure')
                    log.info(UI_TEXT.execCountBytesFallback)
                  sink.emit({
                    type: 'attempt',
                    n,
                    endpoint: 'responses',
                    phase: 'admitted',
                    maxOutputTokens: ticket.maxOutputTokens,
                    reservedUsd: ticket.reserveUsd,
                    totals: ledger.totals(),
                  })
                },
                settled: (outcome, ticket, settlement) => {
                  if (
                    settlement.latch === 'breach' &&
                    Usd.from(settlement.chargedUsd).compare(Usd.from(ticket.reserveUsd)) > 0
                  ) {
                    localRefusalKind = 'breach'
                    error = fill(UI_TEXT.execBudgetOverage, {
                      overage: formatUsd(
                        Usd.from(settlement.chargedUsd).subtract(Usd.from(ticket.reserveUsd)),
                        EXEC_USD_DECIMALS,
                      ),
                      cost: formatUsd(settlement.chargedUsd, EXEC_USD_DECIMALS),
                      reserved: formatUsd(ticket.reserveUsd, EXEC_USD_DECIMALS),
                    })
                  }
                  sink.emit({
                    type: 'attempt',
                    n: ticket.n,
                    endpoint: 'responses',
                    phase: 'settled',
                    reservedUsd: ticket.reserveUsd,
                    outcome: outcome.settlement,
                    chargedUsd: settlement.chargedUsd,
                    terminal: outcome.terminal,
                    totals: ledger.totals(),
                  })
                  tap?.settleResponse(outcome)
                  if (!isFinishing) drain()
                },
              },
            }),
          streamIdleMs: EXEC_STREAM_IDLE_MS,
          headlessPaid: (request, requiresAsking) => {
            // The summary request rides the same ledger-bound transport as
            // any request; this gate only decides whether it may be asked.
            const isAllowed = isHeadlessPaidUseAllowed(
              options,
              ledger?.totals().remainingUsd ?? Usd.from(0).toAmount(),
              lifecycle.signal.aborted,
              request,
              requiresAsking,
            )
            if (!isAllowed && !isFinishing && request.feature === 'imageGeneration')
              sink.emit({
                type: 'paid_use',
                feature: 'imageGeneration',
                n: null,
                phase: 'refused',
                units: 1,
                usd: Usd.from(0).toAmount(),
                reason: requiresAsking ? 'requires_asking' : 'policy',
              })
            return Promise.resolve(isAllowed)
          },
        },
      }
      let accounts: AccountsSessionPort | undefined
      if (requiresAccounts) {
        const configured = deps.accounts?.create(runtimeDeps, selection, createRuntimeBackend)
        if (configured === undefined) throw new Error(UI_TEXT.accounts.unavailable)
        runtime = configured.runtime
        accounts = configured.accounts
      } else runtime = createRuntimeBackend(runtimeDeps)
      setup.isUsageError = false
      const readiness = await lifecycle.race(runtime.backend.readiness(false, options.model))
      if (readiness.state !== 'ready') {
        status = readiness.state === 'signedOut' ? 'auth_required' : 'backend_unavailable'
        error = readiness.message
        return await finish()
      }
      // D4: refuse a qualified model its provider cannot run before the
      // session starts, while the sentence can still name the provider.
      if (providerRun === undefined) {
        const refusal = await lifecycle.race(providerModelRefusal())
        if (refusal !== undefined) {
          setup.isUsageError = true
          error = refusal
          return await finish()
        }
      }
      tap = observeBackend(runtime.backend, options.model)
      // Lane V seam 5: the runtime's own media port when the caller gives none.
      const mediaFactory = deps.media ?? runtime.media
      if (mediaFactory === undefined && (options.attachFiles?.length ?? 0) > 0)
        throw new Error(UI_TEXT.media.uploadUnavailable)
      const { createAcpAgent, createExecClient } = engine
      const initialModelId = providerRun?.modelRef ?? options.model
      const agent = createAcpAgent({
        questions: 'decline',
        ...(accounts !== undefined && { accounts }),
        backend: tap.backend,
        version: deps.version,
        options: {
          canBypass: false,
          allowsContributorModels: options.allowsContributorModels,
          initialMode: options.mode,
          isHeadless: true,
          ...(initialModelId !== undefined && { initialModelId }),
        },
        signIn: {
          id: 'headless',
          name: ACP_AGENT_NAME,
          description: ACP_AGENT_NAME,
          args: [],
          command: ACP_AGENT_NAME,
        },
        defaultCwd: cwd,
        paid: runtime.paid,
        ...(resources !== undefined && { resources }),
        log,
        ...(mediaFactory !== undefined && {
          media: (context) =>
            mediaFactory({
              ...context,
              onAttachment: ({ name, info }) => {
                inputs.push({
                  name: name.replaceAll(/[\\/:]/gu, '_'),
                  bytes: info.sizeBytes,
                  chunks: 0,
                  complete: true,
                })
              },
            }),
        }),
        // M105 lane F: /uploads over the runtime's account ledger, as serve
        // forwards it. Without this the headless agent says so and deletes
        // nothing.
        ...(runtime.uploads !== undefined && { uploads: runtime.uploads }),
      })
      const client = createExecClient({
        onAccountNotice: (event) => {
          if (event.type === 'swap')
            log.info(
              `${UI_TEXT.accounts.swapEvent}: ${event.provider} · ${event.account}. ${fill(UI_TEXT.accounts.coldCache, { cost: exactUsd(parseUsd(event.coldCacheUsd)) })}`,
            )
          else if (event.type === 'spread')
            log.info(`${UI_TEXT.accounts.spreadEvent}: ${event.provider} · ${event.account}`)
          else {
            const text = accountStopText(event)
            let url = ''
            try {
              if (accounts !== undefined) url = accountUsageUrl(accounts, event.provider)
            } catch {
              /* The notice remains visible without reflecting an invalid URL. */
            }
            log.info(`${text} ${url}`)
          }
        },
        sink,
        lifecycle,
        onDenial: (denial) => {
          denial.paths = relativePaths(cwd, denial.paths)
          denials.push(denial)
          if (options.failOnDenial) latch({ kind: 'denied' })
        },
        onQuestion: (count) => {
          questionsDeclined += count
        },
        onFilesChanged: (paths) => {
          for (const file of relativePaths(cwd, paths)) filesChanged.add(file)
        },
      })
      await lifecycle.race(
        client.connectWith(agent, async (connection) => {
          try {
            await lifecycle.race(
              connection.request('initialize', {
                protocolVersion: engine.PROTOCOL_VERSION,
                clientCapabilities: {},
              }),
            )
            const created = await lifecycle.race(
              connection.request('session/new', { cwd, mcpServers: [] }),
            )
            setup.sessionId = created.sessionId
            closeSession = () =>
              connection.request('session/close', { sessionId: created.sessionId })
            cancelSession = () => {
              void connection
                .notify('session/cancel', { sessionId: created.sessionId })
                .catch(() => {
                  /* Session already stopped or closed; cancellation is best effort. */
                })
            }
            if (
              requiresAccounts &&
              created.configOptions?.find((option) => option.id === ACP_CONFIG_IDS.account)
                ?.currentValue !== selection.account
            ) {
              setup.isUsageError = true
              error = UI_TEXT.accounts.invalidAccount
              return
            }
            if (options.vault && deps.vault !== undefined) {
              try {
                const vault = deps.vault
                const opening = (async () => {
                  const session = await vault.open({
                    cwd,
                    sessionId: created.sessionId,
                    signal: lifecycle.signal,
                    source: 'headless',
                    unattended: true,
                    onDenied: denyVault,
                  })
                  if (isFinishing || lifecycle.signal.aborted) {
                    await session.close()
                    throw new Error(UI_TEXT.vault.noAccess)
                  }
                  return session
                })()
                vaultSession = await lifecycle.race(opening)
              } catch (error: unknown) {
                // The denial is recorded for the run; the redacted kind is
                // logged for the operator. Raw text can name keychain paths.
                log.warn(failureForLog(error))
                denyVault(UI_TEXT.vault.brokerBlocked)
                return
              }
            }
            const modelConfig = created.configOptions?.find(
              (option) => option.id === ACP_CONFIG_IDS.model,
            )
            model = typeof modelConfig?.currentValue === 'string' ? modelConfig.currentValue : null
            // The effort and Fast options belong to the model they were listed
            // for: after a model change the agent's answer replaces the first
            // listing, whose levels are the initial model's.
            let configOptions = created.configOptions
            const requestedModel = providerRun?.modelRef ?? options.model
            if (requestedModel !== undefined) {
              if (
                modelConfig?.type !== 'select' ||
                modelConfig.options.every(
                  (entry) => !('value' in entry && entry.value === requestedModel),
                )
              ) {
                setup.isUsageError = true
                error = UI_TEXT.execUnknownModel
                return
              }
              const changed = await lifecycle.race(
                connection.request('session/set_config_option', {
                  sessionId: created.sessionId,
                  configId: ACP_CONFIG_IDS.model,
                  value: requestedModel,
                }),
              )
              configOptions = changed.configOptions
              model = requestedModel
            }
            if (!isPlanRun && isPlanModelRef(model ?? '')) {
              // No `--model`: the session's default resolved to a plan
              // model after transport selection. Drop the Meta-only
              // transport so the subscription request rides the plain
              // fetch, like an explicit `--model` plan run; later
              // requests read the late-bound fetch above (Codex on PR
              // #213).
              isPlanRun = true
              transport = undefined
            }
            // A plan model offers its catalogue levels through the
            // option; the shared range only covers agents without one.
            const config = configOptions?.find((option) => option.id === ACP_CONFIG_IDS.effort)
            if (options.effort === undefined) {
              effort = typeof config?.currentValue === 'string' ? config.currentValue : null
            } else {
              // A configured-provider id carries no static tiers (lane
              // REASONSHAPESR2, XAI-G01): the record governs, so the value
              // rides and the wire omits or refuses from the record. The
              // static table (or the plan catalogue's own levels above)
              // still guards bare (Meta) ids, where `none` is not a tier
              // either; Thinking off always rides.
              const levels =
                config?.type === 'select'
                  ? config.options.flatMap((option) =>
                      'value' in option ? option.value : option.options.map((entry) => entry.value),
                    )
                  : [...effortLevelsFor(model ?? undefined)]
              if (
                !(model ?? '').includes('/') &&
                options.effort !== THINKING_OFF_EFFORT &&
                !levels.includes(options.effort)
              ) {
                setup.isUsageError = true
                error = `${UI_TEXT.execEffortUnavailable} --effort: ${levels.join(', ')}`
                return
              }
              await lifecycle.race(
                connection.request('session/set_config_option', {
                  sessionId: created.sessionId,
                  configId: ACP_CONFIG_IDS.effort,
                  value: options.effort,
                }),
              )
              effort = options.effort
            }
            if (options.fast) {
              // The switch rides only where the model lists a priority
              // tier; off by default, refused anywhere else.
              const fastConfig = configOptions?.find((option) => option.id === ACP_CONFIG_IDS.fast)
              if (fastConfig?.type !== 'boolean') {
                setup.isUsageError = true
                error = UI_TEXT.execFastUnavailable
                return
              }
              await lifecycle.race(
                connection.request('session/set_config_option', {
                  sessionId: created.sessionId,
                  configId: ACP_CONFIG_IDS.fast,
                  value: true,
                }),
              )
            }
            const tier = modelApiPaidTier(model ?? '')
            if (outputSchema !== undefined) {
              setup.isUsageError = true
              const port = deps.outputSchema
              if (port === undefined || runtime === undefined || model === null)
                throw new Error(fill(UI_TEXT.outputSchemaInvalid, { detail: 'backend binding' }))
              const formats = await lifecycle.race(port.formatsFor(model))
              const mode = (['strict_schema', 'json_schema', 'forced_tool'] as const).find(
                (candidate) => formats.includes(candidate),
              )
              if (mode === undefined) {
                outputValidation = 'local'
                blocks.push({
                  type: 'text',
                  text: fill(EXEC_MODEL_TEXT.execOutputSchema, {
                    schema: JSON.stringify(outputSchema.schema),
                  }),
                })
              } else
                await lifecycle.race(
                  port.configure({
                    runtime,
                    sessionId: created.sessionId,
                    model,
                    mode,
                    schema: outputSchema.schema,
                    signal: lifecycle.signal,
                  }),
                )
              setup.isUsageError = false
            }
            if (ledger !== undefined) {
              const totals = ledger.totals()
              if (providerRun === undefined) {
                // A plan model reserves nothing: its zero-price preview still
                // consumes the preview ledger's one request, so an exhausted
                // run is refused before dispatch like a priced one.
                let price: TierPrice | undefined
                if (tier !== undefined) price = MODEL_API_PRICES_PER_MILLION[tier]
                else if (isPlanModelRef(model ?? '')) {
                  const zero = Usd.from(0).toAmount()
                  price = { input: zero, cachedInput: zero, output: zero }
                }
                if (price === undefined) {
                  setup.isUsageError = true
                  error = UI_TEXT.execModelUnpriced
                  return
                }
                // Ask the ledger's exact arithmetic for the start reservation, in a
                // separate un-dispatched ledger. No request belongs to this run yet.
                const preview = previewResponseReservation(ledger, model ?? '', price)
                const minimum =
                  microUsd(preview.reserveUsd) +
                  (options.paidFeatures.includes('imageGeneration')
                    ? microUsd(Usd.from(PAID_PRICES_USD.imageGeneration).toAmount())
                    : ZERO_MICRO_USD)
                if (microUsd(options.budgetUsd ?? Usd.from(0).toAmount()) < minimum) {
                  error = fill(UI_TEXT.execBudgetMinimum, {
                    minimum: formatUsd(
                      Usd.fromUnits(minimum, EXEC_USD_DECIMALS),
                      EXEC_USD_DECIMALS,
                    ),
                  })
                  latch({ kind: 'budget' })
                  return
                }
                // The actual body is not available yet. Admission prices that body,
                // including the output cap it sends, before any provider request.
                log.info(
                  fill(UI_TEXT.execBudgetStartBytes, {
                    cap: formatUsd(totals.capUsd, EXEC_USD_DECIMALS),
                    remaining: formatUsd(totals.remainingUsd, EXEC_USD_DECIMALS),
                    output: formatNumber(outputCap()),
                  }),
                )
              } else {
                // A provider run's first body is not built yet, so the start
                // line states the reservation rule with the numbers known: the
                // cap, what is left, and the output cap every request reserves.
                // EXECPROV round 7 (R2): a wire with no counter reserves the
                // byte bound, and the start line says so — never "counted".
                // Through the externalized providers entry (never a static
                // edge: the split gate forbids carrying provider modules).
                const { tokenCount } = await import('../../host/backend/providersEntry')
                const inputCountKind = tokenCount.exactCountKindFor(
                  providerRun.provider.entry,
                  providerRun.provider.preset,
                )
                log.info(
                  fill(
                    inputCountKind === 'responses-input-tokens'
                      ? UI_TEXT.execBudgetStartRule
                      : UI_TEXT.execBudgetStartBytes,
                    {
                      cap: formatUsd(totals.capUsd, EXEC_USD_DECIMALS),
                      remaining: formatUsd(totals.remainingUsd, EXEC_USD_DECIMALS),
                      output: formatNumber(outputCap()),
                    },
                  ),
                )
                if (inputCountKind === 'anthropic-count-tokens')
                  log.info(
                    fill(UI_TEXT.execEstimateBound, {
                      margin: formatPercent(SPEND_LEDGER_ESTIMATE_MARGIN_PERCENT),
                    }),
                  )
              }
            }
            if (model !== null) await lifecycle.race(team?.prepare(model) ?? Promise.resolve())
            tap?.beginResponse(1)
            unsubscribe = tap?.subscribe(created.sessionId, observe)
            sink.emit({
              type: 'start',
              agent: { name: ACP_AGENT_NAME, version: deps.version },
              backend: options.backend,
              mode: options.mode,
              model,
              effort,
              sessionId: created.sessionId,
              ephemeral: options.ephemeral,
              paidFeatures: options.paidFeatures,
              limits,
            })
            try {
              // ACP dispatches an exact /compact through AgentSession.compact,
              // sharing editor guards and the same bounded exec transport ledger.
              const answer = await lifecycle.race(
                connection.request('session/prompt', {
                  sessionId: created.sessionId,
                  prompt: blocks,
                }),
              )
              stopReason = answer.stopReason
            } catch (error_: unknown) {
              // The run error carries the raw text for the operator's own
              // output; the log records only the redacted kind.
              log.warn(failureForLog(error_))
              error = error_ instanceof Error ? error_.message : String(error_)
              if (
                error_ instanceof engine.RequestError &&
                error_.code === JSON_RPC_ERRORS.invalidParams &&
                ((options.attachFiles?.length ?? 0) > 0 ||
                  prompt.trim() === '/record' ||
                  /^\/attach(?:\s|$)/u.test(prompt.trim()))
              )
                setup.isUsageError = true
            }
            await lifecycle.race(transport?.whenSettled() ?? Promise.resolve())
          } finally {
            const close = closeSession
            closeSession = undefined
            if (close !== undefined) {
              try {
                await lifecycle.race(close())
              } catch (error_: unknown) {
                // A close failure is recorded even when the run already
                // latched its cause; only the latch stays first-cause-wins.
                log.error(failureForLog(error_))
                if (lifecycle.cause === null) {
                  lifecycle.latch({ kind: 'internal' })
                }
              }
            }
          }
        }),
      )
    } catch (error_: unknown) {
      if (runtime === undefined && status === 'failed' && lifecycle.cause === null)
        setup.isUsageError = true
      throw error_
    }
  } catch (error_: unknown) {
    // The run error carries the raw text for the operator's own output;
    // the log records only the redacted kind.
    log.warn(failureForLog(error_))
    if (
      error_ instanceof Error &&
      'code' in error_ &&
      error_.code === JSON_RPC_ERRORS.invalidParams
    )
      setup.isUsageError = true
    if (lifecycle.cause === null) error = error_ instanceof Error ? error_.message : String(error_)
    if (!setup.isUsageError && setup.sessionId === null && lifecycle.cause === null)
      status =
        catalogueHttpStatus === HTTP_STATUS.unauthorized ||
        catalogueHttpStatus === HTTP_STATUS.forbidden
          ? 'auth_required'
          : 'backend_unavailable'
  }
  return await finish()

  function makeResult(): ExecResult {
    const totals = ledger?.totals()
    const last = totals?.lastResponse
    if (last !== undefined && last !== null) {
      terminal = last.terminal
      incompleteReason = last.incompleteReason
    }
    // A successful command NOOP has no model response or turn terminal to
    // verify. Keep those fields null and account for exactly zero requests.
    const isEmptyCompaction =
      isCompactionPrompt &&
      stopReason === 'end_turn' &&
      terminal === null &&
      (last === null || last === undefined) &&
      totals?.requests === 0
    if (lifecycle.cause !== null) {
      status = statusForStop(lifecycle.cause)
      if (lifecycle.cause.kind === 'unpriced')
        error = unpricedMessage(model ?? options.model, providerFilePath)
      else if (
        localRefusalKind === undefined &&
        (lifecycle.cause.kind !== 'budget' || error === UI_TEXT.execIncomplete)
      )
        error =
          vaultDenial !== undefined && lifecycle.cause.kind === 'denied'
            ? vaultDenial
            : stopMessage(lifecycle.cause, options.maxRequests ?? 0)
    } else if (status !== 'auth_required' && status !== 'backend_unavailable') {
      if (
        backendErrorKind === 'authRequired' ||
        last?.httpStatus === HTTP_UNAUTHORIZED ||
        last?.httpStatus === HTTP_STATUS.forbidden
      )
        status = 'auth_required'
      else if (
        terminal === 'failed' ||
        last?.transportError != null ||
        (last?.httpStatus != null && last.httpStatus >= HTTP_STATUS.badRequest)
      )
        status = 'failed'
      else if (terminal !== 'completed' || last?.endedWithoutTerminal === true) {
        status = 'incomplete'
        const reason = terminal === null ? 'no_completion' : null
        incompleteReason ??= isEmptyCompaction ? NO_COMPACTABLE_HISTORY : reason
        if (isEmptyCompaction) error = UI_TEXT.nothingToCompact
      } else if (
        options.backend === 'modelApi' &&
        (last?.usage !== 'valid' || last.settlement !== 'priced')
      )
        status = 'accounting_unverified'
      else if (stopReason === 'max_turn_requests') {
        status = 'request_cap'
        error = modelCallLimitReason ?? plural(UI_TEXT.modelApiTurnLimit, totals?.requests ?? 0)
      } else status = stopReason === 'end_turn' ? 'completed' : 'failed'
    }
    if (status === 'accounting_unverified') error = UI_TEXT.execAccountingUnverified
    const signal = lifecycle.cause?.kind === 'signal' ? lifecycle.cause.signal : null
    const cause = lifecycle.cause
    const tokens = totals?.tokens ?? latestTokens
    drain()
    const hasCompleteResponse =
      options.backend === 'museCode'
        ? terminal === 'completed'
        : last?.terminal === 'completed' &&
          last.transportError === null &&
          !last.endedWithoutTerminal &&
          last.httpStatus === null &&
          last.usage !== 'invalid'
    const partial =
      status === 'completed'
        ? undefined
        : tap?.releasedMessages(true).findLast((item) => item.kind === 'agentMessage')
    // D3: a budget stop keeps everything produced so far, and the final
    // message says what was reached instead of withholding the turn.
    // A pre-first-request refusal never produced work: its final message is
    // its own sentence (5a), never another kind's words.
    const partialText = partial?.text
    const kept = partialText === undefined || partialText === '' ? [] : [partialText]
    let finalMessage: string
    if (status === 'budget_exceeded' && cause?.kind !== 'budget') {
      // A breach stops as budget_exceeded without a refused request: its
      // final message stays the kept-work sentence it has always been.
      finalMessage = [
        ...kept,
        error,
        plural(UI_TEXT.execBudgetProgress, totals?.requests ?? 0),
      ].join(' ')
    } else if (
      status === 'budget_exceeded' &&
      (localRefusalKind === 'daily_budget' || localRefusalKind === 'midnight')
    ) {
      finalMessage = [...kept, error].join(' ')
    } else if (status === 'budget_exceeded') {
      finalMessage = budgetFinalMessage({
        kept,
        requests: totals?.requests ?? 0,
        details: budgetRefusal,
      })
    } else if (status === 'unpriced' || cause?.kind === 'request_shape')
      finalMessage = [...kept, error].join(' ')
    else finalMessage = partialText ?? (hasCompleteResponse ? '' : UI_TEXT.execMessageWithheld)
    const result: ExecResult = {
      v: EXEC_PROTOCOL_VERSION,
      status,
      exitCode: exitCodeFor(status, signal),
      signal,
      stopReason,
      terminal,
      incompleteReason,
      backend: options.backend,
      mode: options.mode,
      model,
      sessionId: setup.sessionId,
      ephemeral: options.ephemeral,
      ...(options.ephemeral && { usageHistory: 'omitted_ephemeral' as const }),
      finalMessage,
      finalMessageComplete: status === 'completed',
      filesChanged: [...filesChanged],
      denials,
      questionsDeclined,
      inputs,
      usage: {
        requests: totals?.requests ?? null,
        inputTokens: tokens?.inputTokens ?? null,
        outputTokens: tokens?.outputTokens ?? null,
        cachedTokens: tokens?.cachedTokens ?? null,
        reasoningTokens: tokens?.reasoningTokens ?? null,
        costUsd:
          totals === undefined
            ? null
            : {
                settled: totals.settledUsd,
                uncertain:
                  cause === null
                    ? totals.uncertainUsd
                    : sumUsd(totals.uncertainUsd, totals.reservedUsd),
                reserved: cause === null ? totals.reservedUsd : Usd.from(0).toAmount(),
                total: sumUsd(totals.settledUsd, totals.uncertainUsd, totals.reservedUsd),
                isUpperBound:
                  totals.uncertainUsd !== '0' || totals.reservedUsd !== '0' || cause !== null,
              },
        paid: totals?.paid ?? {
          imageAttempts: 0,
          imagesReturned: 0,
          imagesRefunded: 0,
          imagesUncertain: 0,
          settledUsd: Usd.from(0).toAmount(),
          uncertainUsd: Usd.from(0).toAmount(),
        },
      },
      ledger:
        totals === undefined
          ? null
          : {
              capUsd: totals.capUsd,
              breach: totals.breach,
              refusal: totals.refusal,
              lastResponse: totals.lastResponse,
            },
      // EXECPROV round 6: the refused request's numbers in typed fields, so
      // a harness can act without parsing a sentence.
      ...(budgetRefusal !== undefined &&
        status === 'budget_exceeded' &&
        lifecycle.cause?.kind === 'budget' && {
          budget: {
            neededUsd: budgetRefusal.neededUsd,
            remainingUsd: budgetRefusal.remainingUsd,
            admitCapUsd: budgetRefusal.admitCapUsd,
            maxOutputTokens: budgetRefusal.maxOutputTokens,
            inputAloneExceeds: budgetRefusal.inputAloneExceeds,
            inputCostUsd: budgetRefusal.inputCostUsd,
          },
        }),
      limits,
      durationMs: Math.max(0, deps.now() - lifecycle.startMs),
      error:
        status === 'completed'
          ? null
          : {
              kind: localRefusalKind ?? (cause?.kind === 'unpriced' ? 'unpriced' : status),
              message: error,
              ...(localRefusalFacts !== undefined && { facts: localRefusalFacts }),
            },
    }
    return result
  }

  async function finish(): Promise<number> {
    try {
      cleanupStart.value = deps.now()
      transport?.close()
      cancelSession?.()
      unsubscribe?.()
      unsubscribeResources?.()
      resources?.dispose()
      isFinishing = true
      if (options.backend === 'museCode' && lifecycle.cause !== null)
        tap?.settleResponse({
          n: 1,
          terminal,
          incompleteReason,
          endedWithoutTerminal: terminal === null,
          httpStatus: null,
          transportError: 'aborted',
          usage: 'missing',
          settlement: 'full-reservation',
        })
      const early = lifecycle.cause === null ? undefined : makeResult()
      if (early !== undefined) {
        sink.forceFinish(early)
        // The result and summary already passed egress. A force exit may
        // pre-empt cleanup, so stop late diagnostics and drop owned key refs now.
        isFinished = true
        memory?.clear()
        literals.length = 0
      }
      try {
        const closingVault = vaultSession
        await grace(
          Promise.all([
            closeSession?.(),
            team?.close(),
            runtime?.close(),
            closingVault === undefined
              ? undefined
              : (async () => {
                  try {
                    await closingVault.close()
                  } catch (vaultError: unknown) {
                    throw new Error(UI_TEXT.vault.noAccess, { cause: vaultError })
                  }
                })(),
          ]),
        )
      } catch (error_: unknown) {
        log.error(failureForLog(error_))
        lifecycle.latch({ kind: 'internal' })
      }
      await grace(transport?.whenSettled() ?? Promise.resolve())
      if (setup.isUsageError && lifecycle.cause === null) {
        log.error('Exec request refused: usage_error')
        deps.stderr.write(`${redactWhole(error, literals)}\n`)
        await grace(deps.stderr.flush(lifecycle.remainingGraceMs()))
        return EXEC_EXIT.usage
      }
      const result = early ?? makeResult()
      if (early === undefined) await grace(sink.finish(result))
      // A refusal before any session names what is missing on stderr.
      // Usage errors already printed above; turns speak through their own
      // messages. The text is redacted like every other log line.
      if (
        early === undefined &&
        !setup.isUsageError &&
        setup.sessionId === null &&
        (result.status === 'auth_required' || result.status === 'backend_unavailable') &&
        result.error !== null
      ) {
        log.error(result.error.message)
      }
      await grace(
        Promise.all([
          deps.stdout.flush(lifecycle.remainingGraceMs()),
          deps.stderr.flush(lifecycle.remainingGraceMs()),
        ]),
      )
      const code =
        lifecycle.cause === null
          ? (sink.resultExitCode ?? result.exitCode)
          : exitCodeFor(
              statusForStop(lifecycle.cause),
              lifecycle.cause.kind === 'signal' ? lifecycle.cause.signal : null,
            )
      return code
    } finally {
      await grace(usageRecording.flush())
      restoreUsageRecording?.()
      isFinished = true
      memory?.clear()
      literals.length = 0
    }
  }
}
