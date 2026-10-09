import { projectJudgePanel, type JudgePanelFacts } from '../../shared/judgePanel'
import type { JudgeStatus } from '../../shared/judge'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { failureForLog } from '../../core/backends/musecode/logText'
import { redactSecrets } from '../../core/redact'
import {
  judgePriceOf,
  admitJudgeCall,
  rebindJudgeClaim,
  verifyJudgeDispatch,
  type JudgeAdmissionBinding,
} from '../../core/judge/admission'
import { entryKey, type JudgeEntryParts } from '../../core/judge/entries'
import { checkStandingAllowRules } from '../../core/judge/same/allowRules'
import { JudgeResultCache } from '../../core/judge/same/resultCache'
import type { JudgeUse } from '../../core/judge/use'
import {
  JUDGE_ADVISORY_THRESHOLD,
  JUDGE_CALIBRATION_LIMITS,
  JUDGE_CRITERIA_VERSION,
  JUDGE_MIN_READY_RATE,
  JUDGE_MODEL_TEXT,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_PROMPT_VERSION,
  JUDGE_RISK_FAMILY,
  JUDGE_TEMP_PREFIX,
  MODEL_API_MAX_OUTPUT_TOKENS,
} from '../../shared/constants'
import type { TokenUsage } from '../../shared/agentEvents'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { createHostPhase2 } from './judgeBinding'
import { createJudgeUse, type JudgeUseHostDeps } from './judgeUse'
import { JudgeUsageRows } from './judgeUsage'
import { MuseCodeSameJudge } from './museCodeSameJudge'
import { ModelApiSameJudge } from './modelApiSameJudge'
import { admittedModelApiJudge } from './judgeTransport'
import type { JudgeWindowDeps, JudgeWindowPort } from './judgeBundle'
import type { Phase2BindingContext } from '../../core/judge/binding'
import type { SeparateSourcePorts } from '../../core/judge/sides'

function noStoredCredential(): Promise<string | undefined> {
  return Promise.resolve(undefined)
}

/** First-charge consent as the production binding sees it before any popup. */
function windowPaidConsent(
  backend: 'museCode' | 'modelApi',
  hasLedger: boolean,
  hasGrant: boolean,
): 'granted' | 'unasked' | 'not-required' {
  if (backend === 'museCode' || !hasLedger) return 'not-required'
  return hasGrant ? 'granted' : 'unasked'
}

/** Window-owned cache; each action gets its own current-policy reader and abort lifetime. */
export function createWindowJudge(
  deps: JudgeWindowDeps,
  table: UiText,
  locale: string,
): JudgeWindowPort {
  setUiText(table, locale)
  // Production phase-2 binding (M98 P2B): an explicitly injected `phase2`
  // (tests, future surfaces) wins; otherwise the window builds the
  // production binding from the new inputs when all three are present.
  // Anything else keeps exact phase-1 behaviour.
  const phase2 =
    deps.phase2 ??
    (deps.separateId === undefined ||
    deps.evidenceRoot === undefined ||
    deps.judgeP2BundlePath === undefined
      ? undefined
      : createHostPhase2({
          judgeP2BundlePath: deps.judgeP2BundlePath,
          log: deps.log,
          engine: deps.engine,
          separateId: deps.separateId,
          evidenceRoot: deps.evidenceRoot,
          limits: JUDGE_CALIBRATION_LIMITS,
          options: () => ({
            family: JUDGE_RISK_FAMILY,
            promptVersion: JUDGE_PROMPT_VERSION,
            criteriaVersion: JUDGE_CRITERIA_VERSION,
            highStakes: true,
          }),
          // The production side-factory port builds the configured side
          // (a SystemOne route on M95's stored key) or names its gap; the
          // window keeps its phase-1 same-model judge either way.
          separateConfigured: true,
          sources: () => ({}),
          ...(deps.readStoredCredential !== undefined && {
            separatePorts: (action: JudgeEntryParts) =>
              systemOnePorts(action, deps.readStoredCredential ?? noStoredCredential),
          }),
          context: (action): Phase2BindingContext | undefined => {
            const current = deps.context(action)
            if (current === undefined) return undefined
            const backend = current.backend
            return {
              providerId: current.providerId ?? backend,
              modelId: current.modelId,
              ...(current.endpoint !== undefined && { endpoint: current.endpoint }),
              ...(current.profileId !== undefined && { profileId: current.profileId }),
              ownerId: current.ownerId,
              turn: action.turnId,
              confidential: current.confidential,
              sourceAvailable:
                backend === 'museCode'
                  ? readSettings()
                  : deps.ledger !== undefined &&
                    current.contextLimit !== undefined &&
                    deps.modelApi(action) !== undefined,
              paidConsent: windowPaidConsent(
                backend,
                deps.ledger !== undefined,
                deps.paid.consent.remembered().includes('judge'),
              ),
              readyRate: deps.readyRate?.(backend),
              minReadyRate: JUDGE_MIN_READY_RATE,
            }
          },
          billing: (action) => {
            const current = deps.context(action)
            return current?.backend === 'modelApi' ? 'modelApi' : 'subscription'
          },
        }))
  const cache = new JudgeResultCache()
  const paidGrants = new Set<string>()
  // Key presence is read asynchronously from SecretStorage and cached; the
  // binding reads the cache synchronously, so a key added later is picked
  // up on a later action and a missing one names its gap meanwhile.
  const storedKeys = new Map<string, boolean>()
  let systemOneConsent: 'granted' | 'needed' | 'declined' = 'needed'
  function systemOnePorts(
    action: JudgeEntryParts,
    readStoredCredential: (providerId: string) => Promise<string | undefined>,
  ): SeparateSourcePorts {
    return {
      fetch: globalThis.fetch,
      hasStoredKey: (providerId) => {
        void readStoredCredential(providerId)
          .then((stored) => storedKeys.set(providerId, stored !== undefined && stored !== ''))
          .catch(() => storedKeys.set(providerId, false))
        return storedKeys.get(providerId) === true
      },
      systemOne: {
        readStoredCredential,
        reserve: async (usd) => {
          const ledger = deps.ledger
          if (ledger === undefined) return { reserved: false, reason: 'ledger-unavailable' }
          if (usd > (await ledger.remainingUsd())) return { reserved: false, reason: 'over-budget' }
          const claim = await ledger.reserve(usd)
          claim.check()
          return {
            reserved: true,
            claim: {
              reservedUsd: claim.reservedUsd,
              settle: (actualUsd) => claim.settle(actualUsd),
              refund: () => claim.settle(0),
            },
          }
        },
        consent: () => (deps.paid.gate.isOn('judge') ? systemOneConsent : 'declined'),
        confidential: () => deps.context(action)?.confidential ?? true,
        isExplicit: () => deps.engine() === 'separate' || deps.engine() === 'both',
        // D48: the price and recipient are named before the first charge;
        // the user's own provider key pays, never the subscription.
        askConsent: async (route) => {
          if (systemOneConsent === 'granted' && deps.paid.gate.isOn('judge')) return true
          const isAllowed = await deps.paid.consent.allows({
            feature: 'judge',
            modelId: route.model,
            dailyBudgetUsd: deps.dailyBudgetUsd?.() ?? 0,
            systemOne: { worstCaseUsd: route.worstCaseUsd, recipient: route.recipient },
          })
          systemOneConsent = isAllowed ? 'granted' : 'declined'
          return isAllowed
        },
      },
    }
  }
  const sideSessions = new Set<string>()
  const uses = new Map<string, { action: JudgeEntryParts; use: JudgeUse }>()
  let panel: { action: JudgeEntryParts; status: JudgeStatus; identity: string } | undefined
  const readPanelFacts = (): JudgePanelFacts | undefined => {
    if (panel === undefined) return
    const current = deps.context(panel.action)
    const status = panel.status
    const engine = deps.engine()
    const isBound = JSON.stringify(current) === panel.identity
    const price = status.billing === 'modelApi' ? judgePriceOf(status.modelId) : undefined
    const selected = selectedBinding(panel.action)
    const canUseMode =
      status.mode !== 'off' &&
      (engine === 'auto' || engine === status.mode) &&
      (status.mode === 'same' || selected !== undefined)
    let reason: JudgePanelFacts['reason']
    switch (status.reason) {
      case 'auto-same':
      case 'auto-both':
      case 'explicit-same':
      case 'explicit-separate':
      case 'explicit-both': {
        break
      }
      default: {
        reason = status.reason
      }
    }
    if (engine === 'off') reason = 'explicit-off'
    else if (!isBound || !canUseMode) reason = 'source-unavailable'
    let consent: JudgePanelFacts['consent'] = 'needed'
    if (status.billing !== 'modelApi') consent = 'not-required'
    else if (status.reason === 'consent-declined') consent = 'declined'
    else if (isBound && canUseMode) consent = 'granted'
    return {
      engine,
      effectiveSource: isBound && canUseMode && status.mode !== 'off' ? status.mode : 'none',
      modelId: status.modelId,
      reason,
      locality: 'not-local',
      experimental: false,
      confidential: current?.confidential ?? true,
      billing: status.billing,
      paidSourceSelected: status.billing === 'modelApi',
      consent,
      ...(price !== undefined && {
        inputPerMillion: price.input,
        cachedPerMillion: price.cachedInput,
        outputPerMillion: price.output,
      }),
      ...(deps.dailyBudgetUsd !== undefined && { dailyBudgetUsd: deps.dailyBudgetUsd() }),
    }
  }
  let sourceKey: string | undefined
  // A binding whose context turn is not the action's turn is refused,
  // never substituted: a stale turn's snapshot must not become this
  // action's verdict.
  const selectedBinding = (action: JudgeEntryParts) => {
    const selected = phase2?.binding(action)
    return selected !== undefined && selected.context.turn !== action.turnId ? undefined : selected
  }
  // The window's live trigger identity for one action: what it observes
  // itself (its context, engine and paid-consent grant), never a re-read of
  // the phase-2 binding. A change cancels a running plan; it never re-plans.
  const windowTriggers = (action: JudgeEntryParts) => {
    const current = deps.context(action)
    return current === undefined
      ? undefined
      : {
          engine: deps.engine(),
          providerId: current.providerId ?? current.backend,
          modelId: current.modelId,
          paidConsent: windowPaidConsent(
            current.backend,
            deps.ledger !== undefined,
            deps.paid.consent.remembered().includes('judge'),
          ),
          confidential: current.confidential,
          endpoint: current.endpoint,
          profileId: current.profileId,
          ownerId: current.ownerId,
          turn: action.turnId,
        }
  }
  let hasNotice = false
  const onError = () => {
    deps.log.warn('Judge batch failed; approval unchanged')
  }
  const readSettings = () => {
    try {
      return checkStandingAllowRules(deps.readSettingsText()).allowed
    } catch {
      return false
    }
  }
  const drop = (shouldDrop: (action: JudgeEntryParts) => boolean) => {
    for (const [key, active] of uses) {
      if (!shouldDrop(active.action)) {
        continue
      }

      active.use.discardSession(active.action.sessionId)
      uses.delete(key)
    }
  }
  return {
    readPanelSnapshot: () => {
      const facts = readPanelFacts()
      return facts === undefined ? undefined : projectJudgePanel(facts)
    },
    start: (action, stateText) => {
      const initial = deps.context(action)
      if (initial?.backend !== action.backend) return
      const identity = JSON.stringify(initial)
      if (identity !== sourceKey) {
        drop(() => true)
        cache.clear()
        sourceKey = identity
      }
      const key = entryKey(action)
      let active = uses.get(key)
      if (active === undefined) {
        let consent: 'unasked' | 'granted' | 'declined' = 'unasked'
        let isRemembered = false
        const isCurrent = () => JSON.stringify(deps.context(action)) === identity
        const isPhase1SourceAvailable = () =>
          initial.backend === 'museCode'
            ? readSettings()
            : deps.ledger !== undefined &&
              initial.contextLimit !== undefined &&
              deps.modelApi(action) !== undefined
        const context = () => ({
          ...selectedBinding(action)?.context,
          engine: deps.engine(),
          modelId: initial.modelId,
          providerId:
            selectedBinding(action)?.context.providerId ?? initial.providerId ?? initial.backend,
          endpoint: selectedBinding(action)?.context.endpoint ?? initial.endpoint,
          profileId: selectedBinding(action)?.context.profileId ?? initial.profileId,
          ownerId: selectedBinding(action)?.context.ownerId ?? initial.ownerId,
          // The action's own turn, never the binding's: a mismatched
          // binding is refused above instead of becoming this snapshot.
          turn: action.turnId,
          confidential: initial.confidential,
          readyRate: deps.readyRate?.(initial.backend),
          paidConsent:
            initial.backend === 'museCode' || deps.ledger === undefined
              ? ('not-required' as const)
              : consent,
          sourceAvailable:
            isCurrent() &&
            (selectedBinding(action) === undefined
              ? isPhase1SourceAvailable()
              : selectedBinding(action)?.context.sourceAvailable === true),
        })
        const binding = (signal: AbortSignal): JudgeAdmissionBinding => {
          const current = deps.context(action)
          const isValid =
            !signal.aborted &&
            isCurrent() &&
            (initial.backend === 'museCode'
              ? readSettings()
              : deps.paid.gate.isOn('judge') &&
                (!isRemembered || deps.paid.consent.remembered().includes('judge')))
          return {
            ownerId: current?.ownerId ?? '',
            modelId: current?.modelId ?? '',
            engine: deps.engine(),
            confidential: current?.confidential ?? initial.confidential,
            ...(initial.backend === 'museCode'
              ? { backend: 'museCode', consent: isValid ? 'not-required' : 'declined' }
              : {
                  backend: 'modelApi',
                  consent: isValid && consent === 'granted' ? 'granted' : 'declined',
                }),
          }
        }
        // The working phase-1 same-model judge: the Model API or Muse Code
        // side request, admitted per call on the shared D78 ledger.
        const phase1Runner = (
          entries: Parameters<JudgeUseHostDeps['createRunner']>[0],
          lifetime: AbortSignal,
        ) => {
          const rows = new JudgeUsageRows({
            billing: initial.backend === 'museCode' ? 'subscription' : 'modelApi',
            usage: deps.paid.usage,
            emit: (event) => {
              deps.emit(action, event)
            },
          })
          const limit = initial.contextLimit ?? JUDGE_MAX_STATE_TOKENS
          // MSP has no tokenizer endpoint. UTF-8 bytes are a conservative input bound;
          // refusal leaves the complete state intact rather than estimating it low.
          const runner = {
            entries,
            cache,
            modelId: initial.modelId,
            signal: lifetime,
            measureTokens: (text: string) => Buffer.byteLength(text),
            contextTokenLimit: Math.min(
              JUDGE_MAX_STATE_TOKENS,
              initial.backend === 'modelApi' ? limit - MODEL_API_MAX_OUTPUT_TOKENS : limit,
            ),
            onError,
          }
          if (initial.backend === 'modelApi') {
            const connection = deps.modelApi(action)
            if (connection === undefined || deps.ledger === undefined)
              throw new Error('Judge daily ledger or source unavailable')
            return new ModelApiSameJudge({
              ...runner,
              source: connection.source,
              transport: admittedModelApiJudge({
                connection,
                ledger: deps.ledger,
                binding: () => binding(lifetime),
                rows,
                turnId: action.turnId,
                signal: lifetime,
                contextLimit: limit,
              }),
              redact: redactSecrets,
            })
          }
          const calls = new Map<string, { id: string; usage: TokenUsage | undefined }>()
          return new MuseCodeSameJudge({
            ...runner,
            readSettingsText: deps.readSettingsText,
            startSession: deps.startSession,
            makeTempRoot: () => mkdtemp(path.join(tmpdir(), JUDGE_TEMP_PREFIX)),
            removeTempRoot: (root) => rm(root, { recursive: true, force: true }),
            onSideSession: (id) => sideSessions.add(id),
            describeFailure: failureForLog,
            logInfo: (text) => {
              deps.log.info(text)
            },
            logWarn: (text) => {
              deps.log.warn(text)
            },
            sendTurn: async (session, parts, timeout) => {
              const signal = AbortSignal.any([lifetime, timeout])
              signal.throwIfAborted()
              if (Buffer.byteLength(JSON.stringify(parts)) > limit)
                throw new Error('Judge request exceeds the loaded context limit')
              const admitted = await admitJudgeCall({
                binding: binding(signal),
                currentBinding: () => binding(signal),
                billing: { kind: 'subscription' },
                estimatedInputTokens: Buffer.byteLength(JSON.stringify(parts)),
                maxOutputTokens: MODEL_API_MAX_OUTPUT_TOKENS,
              })
              if (!admitted.admitted)
                throw new Error(`Judge admission refused: ${admitted.refusal}`)
              const verified = await verifyJudgeDispatch(admitted.claim, () => binding(signal))
              signal.throwIfAborted()
              if (!verified.proceed || !rebindJudgeClaim(admitted.claim, binding(signal)).rebound)
                throw new Error('Judge dispatch binding expired')
              admitted.claim.check()
              const id = randomUUID()
              calls.set(session.sessionId, { id, usage: undefined })
              rows.started(id, action.turnId, initial.modelId)
              return await session.sendTurn(parts)
            },
            onUsage: (id, usage) => {
              const call = calls.get(id)
              if (call !== undefined) call.usage = usage
            },
            onFinished: (id, failed) => {
              const call = calls.get(id)
              if (call === undefined) return
              calls.delete(id)
              if (failed) rows.failed(call.id)
              else rows.finished(call.id, call.usage)
            },
          })
        }
        const use = createJudgeUse({
          backend: initial.backend,
          billing: () =>
            selectedBinding(action)?.billing ??
            (initial.backend === 'museCode' ? 'subscription' : 'modelApi'),
          context,
          allowsPaidJudge: async (model) => {
            const isAllowed = await deps.paid.allowsJudgeUse(model)
            consent = isAllowed ? 'granted' : 'declined'
            isRemembered = deps.paid.consent.remembered().includes('judge')
            return isAllowed
          },
          question: () => ({
            id: 'risk.destructive',
            kind: 'noul',
            text: JUDGE_MODEL_TEXT.judgeDestructiveQuestion,
          }),
          onError,
          onFence: deps.onFence,
          onStatus: (resolved) => {
            // A configured id whose side cannot be built names its gap.
            const gap = phase2?.binding(action)?.separateGap
            const status = gap === undefined ? resolved : { ...resolved, separateGap: gap }
            panel = { action, status, identity }
            deps.status(action, status)
          },
          notice: (text) => {
            if (hasNotice) {
              return
            }

            hasNotice = true
            deps.notice(text)
          },
          createRunner: (entries, _action, lifetime) => {
            const phase1 = () => phase1Runner(entries, lifetime)
            if (phase2 === undefined || selectedBinding(action) === undefined) return phase1()
            const embeddingId = randomUUID()
            const embeddingRows = new JudgeUsageRows({
              billing:
                selectedBinding(action)?.embedding?.source.locality === 'same-provider'
                  ? 'modelApi'
                  : 'subscription',
              usage: deps.paid.usage,
              emit: (event) => {
                deps.emit(action, event)
              },
            })
            return {
              judge: (job) => {
                void phase2
                  .createRuntime({
                    binding: () => selectedBinding(action),
                    // The window's own trigger identity: a change cancels
                    // the run; it never re-reads the binding.
                    triggers: () => windowTriggers(action),
                    paidGrants,
                    embeddingStatus: (status) => {
                      if (panel?.action !== action) return
                      // A configured transport with no recorded head names
                      // its missing labels in plain words (L98P2-EMBED).
                      const note = selectedBinding(action)?.embeddingNote
                      const next = {
                        ...panel.status,
                        embeddingReason: status.available ? undefined : (note ?? status.reason),
                      }
                      panel = { ...panel, status: next }
                      deps.status(action, next)
                    },
                    embeddingAttempt: (phase, source) => {
                      if (phase === 'started')
                        embeddingRows.started(embeddingId, action.turnId, source.model)
                      else if (phase === 'failed') embeddingRows.failed(embeddingId)
                      else embeddingRows.finished(embeddingId, undefined)
                    },
                  })
                  .then(async (runtime) => {
                    // The run's one binding read: its plan decides everything.
                    const plan = runtime.plan({
                      state: job.stateText,
                      model: initial.modelId,
                      questions: Object.fromEntries(
                        job.questions.map((question) => [
                          question.id,
                          { type: 'noul' as const, instructions: question.text },
                        ]),
                      ),
                    })
                    // No request-level side for a `same` plan: the working
                    // phase-1 same-model judge answers, never a side-less
                    // runtime that sends nothing.
                    if (!('resolution' in plan) || plan.dispatch === 'phase1') {
                      if ('resolution' in plan) {
                        phase1().judge(job)
                        return
                      }
                      entries.settle(job.entryKey, 'failed')
                      return
                    }
                    const outcome = await runtime.run(plan, lifetime)
                    const isCaution =
                      outcome.outcome === 'answered' &&
                      Object.values(outcome.result.answers).some(
                        (answer) =>
                          answer.type === 'noul' && answer.noul >= JUDGE_ADVISORY_THRESHOLD,
                      )
                    let settlement: 'failed' | 'caution' | 'none' = 'none'
                    if (outcome.outcome === 'no-answer') settlement = 'failed'
                    else if (isCaution) settlement = 'caution'
                    entries.settle(job.entryKey, settlement)
                  })
                  .catch(onError)
              },
            }
          },
        })
        active = { action, use }
        uses.set(key, active)
      }
      return active.use.start(action, redactSecrets(stateText))
    },
    discardTurn: (session, turn) => {
      drop((action) => action.sessionId === session && action.turnId === turn)
    },
    discardSession: (session) => {
      drop((action) => action.sessionId === session)
    },
    isSideSession: (id) => sideSessions.has(id),
    dispose: () => {
      panel = undefined
      drop(() => true)
      cache.clear()
      sideSessions.clear()
    },
  }
}
