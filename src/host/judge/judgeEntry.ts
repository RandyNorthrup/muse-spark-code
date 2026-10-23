import { projectJudgePanel, type JudgePanelFacts } from '../../shared/judgePanel'
import type { JudgeStatus } from '../../shared/judge'
import { mkdtemp } from 'node:fs/promises'
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
  JUDGE_SCOPE_LOG,
  JUDGE_SCOPE_SKIPPED_LOG,
  JUDGE_TEMP_PREFIX,
  MODEL_API_MAX_OUTPUT_TOKENS,
} from '../../shared/constants'
import type { TokenUsage } from '../../shared/agentEvents'
import type { UiText } from '../../shared/l10n/en'
import { compareUsdAmounts, Usd } from '../../shared/usd'
import { setUiText } from '../../shared/l10n/text'
import { removeJudgeTempRoot } from './tempRoot'
import { createHostPhase2 } from './judgeBinding'
import { createJudgeUse, type JudgeUseHostDeps } from './judgeUse'
import { JudgeUsageRows } from './judgeUsage'
import { MuseCodeSameJudge } from './museCodeSameJudge'
import { ModelApiSameJudge } from './modelApiSameJudge'
import { admittedModelApiJudge } from './judgeTransport'
import type { JudgeWindowDeps, JudgeWindowPort } from './judgeBundle'
import type { Logger } from '../logger'
import type { Phase2BindingContext } from '../../core/judge/binding'
import type { SeparateRouteFacts, SeparateSourcePorts } from '../../core/judge/sides'
import { isSeparateInWorkspace, readWorkspaceSettings } from './workspaceScope'

/**
Whether the standing allow-rules admit a Muse Code judgment. A settings
text the reader cannot hand over (a refused file, not a missing one:
missing reads as undefined before this) fails closed: approval is
unchanged, and the log names only the failure's kind, never its text.
*/
export function isStandingAllowed(
  readSettingsText: () => string | undefined,
  log: Logger,
): boolean {
  try {
    return checkStandingAllowRules(readSettingsText()).allowed
  } catch (error: unknown) {
    log.warn(`Judge standing allow-rules unreadable: ${failureForLog(error)}; approval unchanged`)
    return false
  }
}

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
            readStoredCredential: deps.readStoredCredential,
            // A key discovered after the first action refreshes the status
            // line, so a named gap appears or clears without another action.
            onKeyChange: () => {
              refreshPanelGap()
            },
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
                  ? isStandingAllowed(deps.readSettingsText, deps.log)
                  : deps.ledger !== undefined &&
                    current.contextLimit !== undefined &&
                    deps.modelApi(action) !== undefined,
              // The action's own consent, Allow once included, reaches the
              // plan: a configured missing side never suppresses phase 1.
              paidConsent: actionPaidConsent(action, backend),
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
  // C's own availability (multi-vendor rule): an explicit `separate` or
  // `both` engine, read from user settings like every paid setting. Never
  // the Meta judge's gate, price acceptance or the window's backend.
  function isSeparateSelected(): boolean {
    const engine = deps.engine()
    return engine === 'separate' || engine === 'both'
  }
  // An explicit `separate` run on a buildable route dispatches only C, which
  // bills the route's own provider and asks its own popup at its own price:
  // the Meta judge's consent is never asked for it.
  function routeOnly(): SeparateRouteFacts | undefined {
    return deps.engine() === 'separate' ? phase2?.readySeparateRoute?.() : undefined
  }
  function isRouteOnly(): boolean {
    return routeOnly() !== undefined
  }
  // Paid settings are read from user settings only (D15, D30): a separate
  // judge selected only in workspace settings is not honoured, and the
  // status line and the log say so instead of staying silent.
  let isScopeLogged = false
  let isSkipLogged = false
  function scopeGap(): 'scope' | undefined {
    const separateId = deps.separateId?.().trim() ?? ''
    if (separateId !== '' && isSeparateSelected()) return undefined
    // Bounded reads of repository-controlled files; a skipped file is logged
    // without its path, never read in full.
    const read = readWorkspaceSettings(deps.workspaceSettingsFiles?.() ?? [])
    if (!isSkipLogged && read.skipped > 0) deps.log.warn(JUDGE_SCOPE_SKIPPED_LOG)
    isSkipLogged = read.skipped > 0
    const isWorkspaceOnly = isSeparateInWorkspace(read.texts)
    if (isWorkspaceOnly && !isScopeLogged) deps.log.warn(JUDGE_SCOPE_LOG)
    isScopeLogged = isWorkspaceOnly
    return isWorkspaceOnly ? 'scope' : undefined
  }
  function gapOf(action: JudgeEntryParts): JudgeStatus['gap'] {
    return phase2?.binding(action)?.separateGap ?? scopeGap()
  }
  function refreshPanelGap(): void {
    if (panel === undefined) return
    const gap = gapOf(panel.action)
    if (gap === panel.status.gap) return
    const { gap: _previous, ...rest } = panel.status
    const next = gap === undefined ? rest : { ...rest, gap }
    panel = { ...panel, status: next }
    deps.status(panel.action, next)
  }
  // Each action's own judge consent (Allow once included), read by the
  // plan and the trigger identity alike so they never disagree.
  const actionConsent = new WeakMap<JudgeEntryParts, 'granted' | 'declined'>()
  function actionPaidConsent(
    action: JudgeEntryParts,
    backend: 'museCode' | 'modelApi',
  ): 'granted' | 'declined' | 'unasked' | 'not-required' {
    if (isRouteOnly()) return 'not-required'
    const given = actionConsent.get(action)
    return given !== undefined && backend === 'modelApi' && deps.ledger !== undefined
      ? given
      : windowPaidConsent(
          backend,
          deps.ledger !== undefined,
          deps.paid.consent.remembered().includes('judge'),
        )
  }
  // Each action's trigger generation: it moves whenever the action's live
  // trigger identity (owner, chat model, engine, separate source, turn)
  // differs from the last one seen, and lane C fences its admission, key
  // read and POST on it.
  const triggerGenerations = new WeakMap<JudgeEntryParts, { key: string; generation: number }>()
  function triggerGenerationOf(action: JudgeEntryParts): number {
    const key = JSON.stringify(windowTriggers(action))
    const seen = triggerGenerations.get(action)
    if (seen === undefined) {
      triggerGenerations.set(action, { key, generation: 0 })
      return 0
    }
    if (seen.key !== key) triggerGenerations.set(action, { key, generation: seen.generation + 1 })
    return triggerGenerations.get(action)?.generation ?? 0
  }
  function systemOnePorts(
    action: JudgeEntryParts,
    readStoredCredential: (providerId: string) => Promise<string | undefined>,
  ): Omit<SeparateSourcePorts, 'hasStoredKey'> {
    // The loud tally: each sent call is its own paid judge row, settled at
    // the route's own rates into Account & usage.
    const rows = new JudgeUsageRows({
      billing: 'modelApi',
      usage: deps.paid.usage,
      emit: (event) => {
        deps.emit(action, event)
      },
    })
    return {
      ...(deps.separateTransport !== undefined && { transport: deps.separateTransport }),
      onCall: (model) => {
        const id = randomUUID()
        rows.started(id, action.turnId, model, 'separate')
        return {
          failed: () => {
            rows.failed(id)
          },
          settled: (usage, costUsd) => {
            // The leg settles in quoted floats; the row records an exact
            // amount. A quote that cannot canonicalize leaves the row to
            // the estimated-cost path.
            const settledCostUsd =
              Number.isFinite(costUsd) && costUsd >= 0 ? Usd.from(costUsd).toAmount() : undefined
            rows.finished(
              id,
              usage === undefined ? undefined : { ...usage, cachedTokens: 0, reasoningTokens: 0 },
              settledCostUsd,
            )
          },
        }
      },
      systemOne: {
        readStoredCredential,
        reserve: async (usd) => {
          const ledger = deps.ledger
          if (ledger === undefined) return { reserved: false, reason: 'ledger-unavailable' }
          // The leg quotes in floats; the quote canonicalizes to an exact
          // amount at this seam. A quote that is not finite and nonnegative
          // cannot price the leg.
          if (!Number.isFinite(usd) || usd < 0) return { reserved: false, reason: 'unpriced' }
          const exact = Usd.from(usd).toAmount()
          const remaining = await ledger.remainingUsd()
          if (remaining !== undefined && compareUsdAmounts(exact, remaining) > 0)
            return { reserved: false, reason: 'over-budget' }
          const claim = await ledger.reserve(exact)
          // No daily limit set: the ledger records nothing and the leg rides
          // unbilled. The claim still guards single settlement, like a free
          // local claim.
          if (claim === undefined) {
            let isClosed = false
            return {
              reserved: true,
              claim: {
                reservedUsd: usd,
                check: () => {
                  if (isClosed) throw new Error('judge claim is closed')
                },
                settle: () => {
                  isClosed = true
                  return Promise.resolve()
                },
                refund: () => {
                  isClosed = true
                  return Promise.resolve()
                },
              },
            }
          }
          claim.check()
          return {
            reserved: true,
            claim: {
              reservedUsd: usd,
              // D78's live admission (Stop, day change, reduced cap), which
              // lane C reads again right before dispatch.
              check: () => {
                claim.check()
              },
              settle: (actualUsd) => claim.settle(Usd.from(actualUsd).toAmount()),
              refund: () => claim.settle(Usd.from(0).toAmount()),
            },
          }
        },
        // Consent is bound to exactly this route's recipient and tariff and
        // to the current revocation generation; an ordinary judge grant
        // never covers it, and "Ask again" asks again. C is gated by its own
        // availability only (multi-vendor rule): never the Meta judge's
        // gate, price acceptance or the window's backend.
        consent: (route) => {
          if (!isSeparateSelected()) return 'declined'
          return deps.paid.consent.isRouteAllowed(route.consentKey) ? 'granted' : 'needed'
        },
        generation: () => triggerGenerationOf(action),
        revocation: () => deps.paid.consent.routeRevocation(),
        confidential: () => deps.context(action)?.confidential ?? true,
        isExplicit: isSeparateSelected,
        // D48: the price and recipient are named before the first charge;
        // the user's own provider key pays, never the subscription.
        askConsent: (route) =>
          deps.paid.consent.allowsRoute(
            {
              feature: 'judge',
              modelId: route.model,
              dailyBudgetUsd: deps.dailyBudgetUsd?.() ?? Usd.from(0).toAmount(),
              systemOne: {
                worstCaseUsd: Usd.from(route.worstCaseUsd).toAmount(),
                recipient: route.recipient,
              },
            },
            route.consentKey,
            isSeparateSelected,
          ),
      },
    }
  }
  const sideSessions = new Set<string>()
  const uses = new Map<string, { action: JudgeEntryParts; use: JudgeUse }>()
  let panel: { action: JudgeEntryParts; status: JudgeStatus; identity: string } | undefined
  // A C-only run's Account & usage facts come from C's own route: its source
  // and model, its captured tariff, a paid source billed to the user's own
  // provider key, experimental, and its own window grant (RVM98P2R2 9).
  const routePanelFacts = (route: SeparateRouteFacts, action: JudgeEntryParts): JudgePanelFacts => {
    const current = deps.context(action)
    const isBound = JSON.stringify(current) === panel?.identity
    return {
      engine: deps.engine(),
      effectiveSource: isBound ? 'separate' : 'none',
      providerId: route.providerId,
      modelId: route.model,
      ...(!isBound && { reason: 'source-unavailable' as const }),
      locality: 'not-local',
      experimental: true,
      confidential: current?.confidential ?? true,
      billing: current?.backend === 'modelApi' ? 'modelApi' : 'subscription',
      paidSourceSelected: true,
      consent: deps.paid.consent.isRouteAllowed(route.consentKey) ? 'granted' : 'needed',
      inputPerMillion: route.inputUsdPerMillion,
      outputPerMillion: route.outputUsdPerMillion,
      ...(deps.dailyBudgetUsd !== undefined && { dailyBudgetUsd: deps.dailyBudgetUsd() }),
    }
  }
  const readPanelFacts = (): JudgePanelFacts | undefined => {
    if (panel === undefined) return
    const route = routeOnly()
    if (route !== undefined) return routePanelFacts(route, panel.action)
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
      // The panel reports display dollars; the tariff behind them stays exact.
      ...(price !== undefined && {
        inputPerMillion: Number(price.input),
        cachedPerMillion: Number(price.cachedInput),
        outputPerMillion: Number(price.output),
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
          paidConsent: actionPaidConsent(action, current.backend),
          confidential: current.confidential,
          // The selected separate source is part of the run's identity: a
          // changed `museSpark.judge.separate` cancels, never re-plans.
          separateId: deps.separateId?.().trim() ?? '',
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
            ? isStandingAllowed(deps.readSettingsText, deps.log)
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
            initial.backend === 'museCode' || deps.ledger === undefined || isRouteOnly()
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
              ? isStandingAllowed(deps.readSettingsText, deps.log)
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
              sideCallFormats: connection.sideCallFormats,
              forceSideCallTool: connection.forceSideCallTool,
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
            removeTempRoot: (root) => removeJudgeTempRoot(root),
            onSideSession: (id) => sideSessions.add(id),
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
          // A C-only run asks C's own popup at C's price, never the Meta one.
          asksOwnConsent: isRouteOnly,
          allowsPaidJudge: async (model) => {
            const isAllowed = await deps.paid.allowsJudgeUse(model)
            consent = isAllowed ? 'granted' : 'declined'
            actionConsent.set(action, consent)
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
            // A configured id whose side cannot be built names its gap, as
            // does a separate judge set only in workspace settings.
            const gap = gapOf(action)
            // A C-only run names C's own route and bills its provider key.
            const route = routeOnly()
            const own: JudgeStatus =
              route === undefined
                ? resolved
                : { ...resolved, modelId: route.model, billing: 'modelApi' }
            const status = gap === undefined ? own : { ...own, gap }
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
