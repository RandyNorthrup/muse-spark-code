import type { JudgeStatus } from '../../shared/judge'
import { UI_TEXT } from '../../shared/constants'

export function JudgeStatusLine({ status }: { readonly status: JudgeStatus | undefined }) {
  if (status === undefined) return null
  const reasons: Readonly<Record<JudgeStatus['reason'], string>> = {
    'explicit-off': UI_TEXT.judgeStatusOff,
    'unknown-setting': UI_TEXT.judgeStatusUnavailable,
    'consent-needed': UI_TEXT.judgeStatusConsent,
    'consent-declined': UI_TEXT.judgeStatusDeclined,
    'source-unavailable': UI_TEXT.judgeStatusUnavailable,
    'ready-rate-low': UI_TEXT.judgeStatusSlow,
    'auto-same': UI_TEXT.judgeStatusSame,
    'explicit-same': UI_TEXT.judgeStatusSame,
  }
  return (
    <p className="judge-status" role="status">
      {UI_TEXT.paidJudgeName}: {reasons[status.reason]}
      {status.mode === 'same' ? (
        <>
          {' '}
          · <span dir="auto">{status.modelId}</span> ·{' '}
          {status.billing === 'subscription'
            ? UI_TEXT.judgeStatusSubscription
            : UI_TEXT.judgeStatusPaid}
        </>
      ) : null}
    </p>
  )
}
