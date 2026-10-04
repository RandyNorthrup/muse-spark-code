import * as acp from '@agentclientprotocol/sdk'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { createAcpAgent } from '../../acp/agent'
import { isValidModelApiKey, type SecretStore } from '../../host/auth/credentialStore'
import type { Logger } from '../../host/logger'
import type { AgentEvent } from '../../shared/agentEvents'
import {
  ACP_AGENT_NAME,
  ACP_CONFIG_IDS,
  EXEC_EXIT,
  EXEC_ENDPOINTS,
  EXEC_PROMPT_MAX_BYTES,
  EXEC_PROTOCOL_VERSION,
  EXEC_MAX_BUDGET_USD,
  EXEC_STOP_GRACE_MS,
  EXEC_STREAM_IDLE_MS,
  EXEC_USD_DECIMALS,
  EXEC_USD_UNITS,
  HTTP_STATUS,
  HTTP_UNAUTHORIZED,
  MILLISECONDS_PER_SECOND,
  MODEL_API_MAX_OUTPUT_TOKENS,
  MODEL_API_PRICES_PER_MILLION,
  PAID_PRICES_USD,
  SECRET_KEYS,
  UI_TEXT,
  type EnvironmentVariable,
} from '../../shared/constants'
import { effortLevelsFor } from '../../shared/effort'
import { fill, formatUsd, plural } from '../../shared/l10n/text'
import { modelApiPaidTier } from '../../shared/paid'
import { createRuntimeBackend, type RuntimeBackend } from '../backends'
import { type ExecOptions, serveOptionsFor } from './execArgs'
import { createExecClient } from './execClient'
import { execFetch, type ExecTransport } from './execFetch'
import { statusForStop, type Lifecycle, type StopCause } from './execLimits'
import { createExecLogger, createExecSink, type ExecSink } from './execOutput'
import {
  exitCodeFor,
  type ExecDenial,
  type ExecInputRecord,
  type ExecResult,
  type ExecStatus,
  type TokenTotals,
} from './execProtocol'
import type { FdWriter } from './fdWriter'
import { memorySecretStore, type MemorySecretStore, readKeyLine, readPromptStdin } from './keyInput'
import { createRunLedger } from './runLedger'
import { observeBackend, type SessionTap } from './sessionTap'
import { readUntrustedInputs } from './untrustedInput'

export interface ExecDeps {
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
  museCodeCredentials: readonly EnvironmentVariable[]
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  readFile: (path: string, maxBytes: number, signal: AbortSignal) => Promise<Uint8Array>
  randomHex: (bytes: number) => string
  log: Logger
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
      return UI_TEXT.execModelUnpriced
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

function microUsd(value: number): bigint {
  return BigInt(value.toFixed(EXEC_USD_DECIMALS).replace('.', ''))
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
          ? [relative]
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
  const limits = {
    budgetUsd: options.budgetUsd ?? null,
    maxRequests: options.maxRequests ?? null,
    timeoutSeconds: options.timeoutMs / MILLISECONDS_PER_SECOND,
  }
  const ledger =
    options.backend === 'modelApi' &&
    options.budgetMicroUsd !== undefined &&
    options.maxRequests !== undefined
      ? createRunLedger({
          capUsd: options.budgetMicroUsd / EXEC_USD_UNITS,
          maxRequests: options.maxRequests,
        })
      : undefined
  let memory: MemorySecretStore | undefined
  let runtime: RuntimeBackend | undefined
  let tap: SessionTap | undefined
  let transport: ExecTransport | undefined
  const setup: { sessionId: string | null; isUsageError: boolean } = {
    sessionId: null,
    isUsageError: true,
  }
  let model: string | null = null
  let effort: string | null = null
  let stopReason: string | null = null
  let terminal: string | null = null
  let incompleteReason: string | null = null
  let backendErrorKind: string | undefined
  let catalogueHttpStatus: number | undefined
  let status: ExecStatus = 'failed'
  let error = UI_TEXT.execIncomplete
  let questionsDeclined = 0
  let inputs: ExecInputRecord[] = []
  const filesChanged = new Set<string>()
  const denials: ExecDenial[] = []
  let unsubscribe: (() => void) | undefined
  let closeSession: (() => Promise<unknown>) | undefined
  let cancelSession: (() => void) | undefined
  let latestTokens: Partial<TokenTotals> | undefined
  const emitted = new Set<string>()
  const sink = createExecSink({
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
  })
  const drain = (target: ExecSink) => {
    const messages = tap?.releasedMessages() ?? []
    for (const item of messages) {
      if (emitted.has(item.itemId)) {
        continue
      }

      target.message(item)
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
  const observe = (event: AgentEvent) => {
    if (event.type === 'turnCompleted') {
      terminal = event.terminal
      incompleteReason = event.reason ?? null
      backendErrorKind = event.errorKind
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
    drain(sink)
  }
  void (async () => {
    try {
      await lifecycle.stopped
      transport?.close()
      cancelSession?.()
    } catch (error_: unknown) {
      log.error(error_ instanceof Error ? error_.message : String(error_))
    }
  })()
  const cleanupStart = { value: 0 }
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
    const folder = await lifecycle.race(stat(cwd))
    if (!folder.isDirectory()) throw new Error(UI_TEXT.execFileUnreadable)
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
      ]
      let secrets = deps.storeSecrets
      if (options.keyFromStdin) {
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
          return value
        },
        store: secrets.store.bind(secrets),
        delete: secrets.delete.bind(secrets),
      }
      if (ledger !== undefined)
        transport = execFetch({
          fetch: async (url, init) => {
            const response = await deps.fetch(url, init)
            if (typeof url === 'string' && new URL(url).pathname === EXEC_ENDPOINTS.models)
              catalogueHttpStatus = response.status
            return response
          },
          ledger,
          get selectedModel() {
            return model ?? ''
          },
          imageGeneration: options.paidFeatures.includes('imageGeneration'),
          lifecycle,
          onLatch: latch,
          emit: (event) => {
            if (!isFinishing) sink.emit(event)
          },
          onResponseStart: (n) => {
            tap?.beginResponse(n)
          },
          onResponseSettled: (outcome) => {
            tap?.settleResponse(outcome)
            if (!isFinishing) drain(sink)
          },
        })
      runtime = createRuntimeBackend({
        options: serveOptionsFor(options),
        version: deps.version,
        distDir: deps.distDir,
        platform: deps.platform,
        env: deps.env,
        homeDir: deps.homeDir,
        secrets: watchedSecrets,
        runGit: deps.runGit,
        museCodeCredentials: deps.museCodeCredentials,
        fetch: transport?.fetch ?? deps.fetch,
        sleep: (ms) => lifecycle.race(deps.sleep(ms)),
        log,
        exec: {
          isEphemeral: options.ephemeral,
          streamIdleMs: EXEC_STREAM_IDLE_MS,
          headlessPaid: (request, requiresAsking) => {
            const isAllowed =
              request.feature === 'imageGeneration' &&
              options.paidFeatures.includes('imageGeneration') &&
              options.mode === 'acceptEdits' &&
              !requiresAsking &&
              !lifecycle.signal.aborted &&
              microUsd(ledger?.totals().remainingUsd ?? 0) >=
                microUsd(PAID_PRICES_USD.imageGeneration)
            if (!isAllowed && !isFinishing && request.feature === 'imageGeneration')
              sink.emit({
                type: 'paid_use',
                feature: 'imageGeneration',
                n: null,
                phase: 'refused',
                units: 1,
                usd: 0,
                reason: requiresAsking ? 'requires_asking' : 'policy',
              })
            return Promise.resolve(isAllowed)
          },
        },
      })
      setup.isUsageError = false
      const readiness = await lifecycle.race(runtime.backend.readiness(false))
      if (readiness.state !== 'ready') {
        status = readiness.state === 'signedOut' ? 'auth_required' : 'backend_unavailable'
        error = readiness.message
        return await finish()
      }
      tap = observeBackend(runtime.backend)
      const agent = createAcpAgent({
        backend: tap.backend,
        version: deps.version,
        options: {
          canBypass: false,
          allowsContributorModels: options.allowsContributorModels,
          initialMode: options.mode,
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
        log,
      })
      const client = createExecClient({
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
                protocolVersion: acp.PROTOCOL_VERSION,
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
            const modelConfig = created.configOptions?.find(
              (option) => option.id === ACP_CONFIG_IDS.model,
            )
            model = typeof modelConfig?.currentValue === 'string' ? modelConfig.currentValue : null
            if (options.model !== undefined) {
              if (
                modelConfig?.type !== 'select' ||
                modelConfig.options.every(
                  (entry) => !('value' in entry && entry.value === options.model),
                )
              ) {
                setup.isUsageError = true
                error = UI_TEXT.execUnknownModel
                return
              }
              await lifecycle.race(
                connection.request('session/set_config_option', {
                  sessionId: created.sessionId,
                  configId: ACP_CONFIG_IDS.model,
                  value: options.model,
                }),
              )
              model = options.model
            }
            if (options.effort === undefined) {
              const config = created.configOptions?.find(
                (option) => option.id === ACP_CONFIG_IDS.effort,
              )
              effort = typeof config?.currentValue === 'string' ? config.currentValue : null
            } else {
              if (!effortLevelsFor(model ?? undefined).includes(options.effort)) {
                setup.isUsageError = true
                error = UI_TEXT.execEffortUnavailable
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
            const tier = modelApiPaidTier(model ?? '')
            if (ledger !== undefined) {
              if (tier === undefined) {
                setup.isUsageError = true
                error = UI_TEXT.execModelUnpriced
                return
              }
              // Ask the ledger's exact arithmetic for the start reservation, in a
              // separate un-dispatched ledger. No request belongs to this run yet.
              const preview = createRunLedger({
                capUsd: EXEC_MAX_BUDGET_USD,
                maxRequests: 1,
              }).admitResponse({
                model: model ?? '',
                maxOutputTokens: MODEL_API_MAX_OUTPUT_TOKENS,
                price: MODEL_API_PRICES_PER_MILLION[tier],
              })
              if ('refused' in preview) throw new Error(UI_TEXT.execModelUnpriced)
              const minimum =
                microUsd(preview.reserveUsd) +
                (options.paidFeatures.includes('imageGeneration')
                  ? microUsd(PAID_PRICES_USD.imageGeneration)
                  : ZERO_MICRO_USD)
              if (BigInt(options.budgetMicroUsd ?? 0) < minimum) {
                error = fill(UI_TEXT.execBudgetMinimum, {
                  minimum: formatUsd(Number(minimum) / EXEC_USD_UNITS, EXEC_USD_DECIMALS),
                })
                latch({ kind: 'budget' })
                return
              }
            }
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
              const answer = await lifecycle.race(
                connection.request('session/prompt', {
                  sessionId: created.sessionId,
                  prompt: blocks,
                }),
              )
              stopReason = answer.stopReason
            } catch (error_: unknown) {
              error = error_ instanceof Error ? error_.message : String(error_)
            }
            await lifecycle.race(transport?.whenSettled() ?? Promise.resolve())
          } finally {
            const close = closeSession
            closeSession = undefined
            if (close !== undefined) {
              try {
                await lifecycle.race(close())
              } catch (error_: unknown) {
                if (lifecycle.cause === null) {
                  log.error(error_ instanceof Error ? error_.message : String(error_))
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
    if (lifecycle.cause !== null) {
      status = statusForStop(lifecycle.cause)
      if (lifecycle.cause.kind !== 'budget' || error === UI_TEXT.execIncomplete)
        error = stopMessage(lifecycle.cause, options.maxRequests ?? 0)
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
        incompleteReason ??= terminal === null ? 'no_completion' : null
      } else if (
        options.backend === 'modelApi' &&
        (last?.usage !== 'valid' || last.settlement !== 'priced')
      )
        status = 'accounting_unverified'
      else status = stopReason === 'end_turn' ? 'completed' : 'failed'
    }
    if (status === 'accounting_unverified') error = UI_TEXT.execAccountingUnverified
    const signal = lifecycle.cause?.kind === 'signal' ? lifecycle.cause.signal : null
    const cause = lifecycle.cause
    const tokens = totals?.tokens ?? latestTokens
    drain(sink)
    const hasCompleteResponse =
      options.backend === 'museCode'
        ? terminal === 'completed'
        : last?.terminal === 'completed' &&
          last.transportError === null &&
          !last.endedWithoutTerminal &&
          last.httpStatus === null &&
          last.usage !== 'invalid'
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
      finalMessage: hasCompleteResponse ? '' : UI_TEXT.execMessageWithheld,
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
                uncertain: totals.uncertainUsd,
                reserved: totals.reservedUsd,
                total:
                  Number(
                    microUsd(totals.settledUsd) +
                      microUsd(totals.uncertainUsd) +
                      microUsd(totals.reservedUsd),
                  ) / EXEC_USD_UNITS,
                isUpperBound: totals.uncertainUsd > 0 || totals.reservedUsd > 0 || cause !== null,
              },
        paid: totals?.paid ?? {
          imageAttempts: 0,
          imagesReturned: 0,
          imagesRefunded: 0,
          imagesUncertain: 0,
          settledUsd: 0,
          uncertainUsd: 0,
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
      limits,
      durationMs: Math.max(0, deps.now() - (lifecycle.deadlineMs - options.timeoutMs)),
      error: status === 'completed' ? null : { kind: status, message: error },
    }
    return result
  }

  async function finish(): Promise<number> {
    try {
      cleanupStart.value = deps.now()
      transport?.close()
      cancelSession?.()
      unsubscribe?.()
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
        await grace(Promise.all([closeSession?.(), runtime?.close()]))
      } catch (error_: unknown) {
        log.error(error_ instanceof Error ? error_.message : String(error_))
        lifecycle.latch({ kind: 'internal' })
      }
      await grace(transport?.whenSettled() ?? Promise.resolve())
      if (setup.isUsageError && lifecycle.cause === null) {
        log.error(error)
        await grace(deps.stderr.flush(lifecycle.remainingGraceMs()))
        return EXEC_EXIT.usage
      }
      const result = early ?? makeResult()
      if (early === undefined) await grace(sink.finish(result))
      await grace(
        Promise.all([
          deps.stdout.flush(lifecycle.remainingGraceMs()),
          deps.stderr.flush(lifecycle.remainingGraceMs()),
        ]),
      )
      const code =
        lifecycle.cause === null
          ? result.exitCode
          : exitCodeFor(
              statusForStop(lifecycle.cause),
              lifecycle.cause.kind === 'signal' ? lifecycle.cause.signal : null,
            )
      return code
    } finally {
      isFinished = true
      memory?.clear()
      literals.length = 0
    }
  }
}
