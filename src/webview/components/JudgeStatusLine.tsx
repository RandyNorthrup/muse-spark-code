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
    'source-untested': UI_TEXT.judgeStatusUntested,
    'profile-missing': UI_TEXT.judgeStatusProfiles,
    'auto-both': UI_TEXT.judgeStatusBoth,
    'explicit-both': UI_TEXT.judgeStatusBoth,
    'explicit-separate': UI_TEXT.judgeStatusSeparate,
  }
  const fallback = {
    'source-unavailable': UI_TEXT.judgeAutoNoSource,
    'source-untested': UI_TEXT.judgeAutoUntested,
    'profile-missing': UI_TEXT.judgeAutoNoProfiles,
    'evidence-missing': UI_TEXT.judgeAutoNoEvidence,
  }
  return (
    <p className="judge-status" role="status">
      {UI_TEXT.paidJudgeName}:{' '}
      {status.autoSameReason === undefined
        ? reasons[status.reason]
        : fallback[status.autoSameReason]}
      {status.mode === 'off' ? null : (
        <>
          {' '}
          · <span dir="auto">{status.modelId}</span> ·{' '}
          {status.billing === 'subscription'
            ? UI_TEXT.judgeStatusSubscription
            : UI_TEXT.judgeStatusPaid}
        </>
      )}
    </p>
  )
}
