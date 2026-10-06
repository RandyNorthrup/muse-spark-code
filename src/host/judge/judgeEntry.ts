import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { failureForLog } from '../../core/backends/musecode/logText'
import { redactSecrets } from '../../core/redact'
import {
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
  JUDGE_MODEL_TEXT,
  JUDGE_MAX_STATE_TOKENS,
  JUDGE_TEMP_PREFIX,
  MODEL_API_MAX_OUTPUT_TOKENS,
} from '../../shared/constants'
import type { TokenUsage } from '../../shared/agentEvents'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { createJudgeUse } from './judgeUse'
import { JudgeUsageRows } from './judgeUsage'
import { MuseCodeSameJudge } from './museCodeSameJudge'
import { ModelApiSameJudge } from './modelApiSameJudge'
import { admittedModelApiJudge } from './judgeTransport'
import type { JudgeWindowDeps, JudgeWindowPort } from './judgeBundle'

/** Window-owned cache; each action gets its own current-policy reader and abort lifetime. */
export function createWindowJudge(
  deps: JudgeWindowDeps,
  table: UiText,
  locale: string,
): JudgeWindowPort {
  setUiText(table, locale)
  const cache = new JudgeResultCache()
  const sideSessions = new Set<string>()
  const uses = new Map<string, { action: JudgeEntryParts; use: JudgeUse }>()
  let sourceKey: string | undefined
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
        const context = () => ({
          engine: deps.engine(),
          modelId: initial.modelId,
          providerId: initial.backend,
          confidential: initial.confidential,
          readyRate: deps.readyRate?.(initial.backend),
          paidConsent:
            initial.backend === 'museCode' || deps.ledger === undefined
              ? ('not-required' as const)
              : consent,
          sourceAvailable:
            isCurrent() &&
            (initial.backend === 'museCode'
              ? readSettings()
              : deps.ledger !== undefined &&
                initial.contextLimit !== undefined &&
                deps.modelApi(action) !== undefined),
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
        const use = createJudgeUse({
          backend: initial.backend,
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
          onStatus: (status) => {
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
      drop(() => true)
      cache.clear()
      sideSessions.clear()
    },
  }
}
