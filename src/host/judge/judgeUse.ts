// M98-U's policy and first-use wiring. D supplies S's lazily loaded runner,
// with each paid transport dispatch admitted by A over the shared D78 ledger.
import type { JudgeEntryParts } from '../../core/judge/entries'
import { isJudgeEngineOn } from '../../core/judge/engine'
import {
  resolveJudgeMode,
  shouldReResolve,
  type JudgeModeContext,
  type JudgeModeResolution,
} from '../../core/judge/resolve'
import { JudgeUse, type JudgeUseDeps } from '../../core/judge/use'
import { JUDGE_MIN_READY_RATE, UI_TEXT } from '../../shared/constants'
import type { JudgeStatus } from '../../shared/judge'

export interface JudgeUseHostDeps extends Pick<
  JudgeUseDeps,
  'createRunner' | 'question' | 'onError' | 'onFence'
> {
  readonly backend: 'modelApi' | 'museCode'
  readonly context: () => Omit<JudgeModeContext, 'minReadyRate'>
  /** U's paidHost hook, then A re-binds and reserves per actual transport call. */
  readonly allowsPaidJudge: (modelId: string) => Promise<boolean>
  readonly onStatus: (status: JudgeStatus) => void
  readonly notice: (text: string) => void
}

/** Resolves at decision time, never activation; no source is created while off. */
export function createJudgeUse(deps: JudgeUseHostDeps): JudgeUse {
  let previous: JudgeModeContext | undefined
  let resolution: JudgeModeResolution | undefined
  let hasSubscriptionNote = false
  const context = (): JudgeModeContext => ({
    ...deps.context(),
    minReadyRate: JUDGE_MIN_READY_RATE,
  })
  const isOn = (action: JudgeEntryParts) => {
    if (action.backend !== deps.backend) return false
    const current = context()
    // Unasked paid consent is acquired in the background, not a startup modal.
    const resolvable = {
      ...current,
      paidConsent:
        current.paidConsent === 'unasked' ? ('not-required' as const) : current.paidConsent,
    }
    if (previous === undefined || resolution === undefined || shouldReResolve(previous, current)) {
      resolution = resolveJudgeMode(resolvable)
      previous = current
      deps.onStatus({
        ...resolveJudgeMode(current),
        modelId: current.modelId,
        billing: deps.backend === 'museCode' ? 'subscription' : 'modelApi',
      })
    }
    return (
      resolution.mode === 'same' &&
      (current.engine === 'auto' || current.engine === 'same') &&
      isJudgeEngineOn(current.engine)
    )
  }
  return new JudgeUse({
    isOn,
    createRunner: deps.createRunner,
    question: deps.question,
    onError: deps.onError,
    onFence: deps.onFence,
    prepare: async (_action, signal) => {
      if (deps.backend === 'museCode') {
        if (!hasSubscriptionNote) {
          hasSubscriptionNote = true
          deps.notice(UI_TEXT.judgeSubscriptionNotice)
        }
        return !signal.aborted
      }
      const before = context()
      const isAllowed = await deps.allowsPaidJudge(before.modelId)
      const after = context()
      return (
        isAllowed &&
        !signal.aborted &&
        !shouldReResolve({ ...before, paidConsent: after.paidConsent }, after)
      )
    },
  })
}
