import type { JudgeStatus } from '../../shared/judge'
import { fill } from '../../shared/l10n/text'
import { UI_TEXT } from '../../shared/constants'

export function JudgeStatusLine({ status }: { readonly status: JudgeStatus | undefined }) {
  if (status === undefined) return null
  const reasons: Readonly<Partial<Record<JudgeStatus['reason'], string>>> = {
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
  // Why a configured separate source has no side in this build.
  const gaps = {
    'needs-key': UI_TEXT.judgeSeparateNeedsKey,
    'needs-capability-capture': UI_TEXT.judgeSeparateNeedsCapture,
    'needs-local-install': UI_TEXT.judgeSeparateNeedsInstall,
    'unknown-source': UI_TEXT.judgeSeparateUnknown,
  }
  const billing = {
    subscription: UI_TEXT.judgeStatusSubscription,
    modelApi: UI_TEXT.judgeStatusPaid,
    free: UI_TEXT.judgePanel.freeLocal,
  }
  return (
    <p className="judge-status" role="status">
      {UI_TEXT.paidJudgeName}:{' '}
      {status.autoSameReason === undefined
        ? (reasons[status.reason] ?? fill(UI_TEXT.judgeNoAnswer, { reason: status.reason }))
        : fallback[status.autoSameReason]}
      {status.separateGap === undefined ? null : <> · {gaps[status.separateGap]}</>}
      {status.mode === 'off' ? null : (
        <>
          {' '}
          · <span dir="auto">{status.modelId}</span> · {billing[status.billing]}
        </>
      )}
      {status.embeddingReason === undefined ? null : (
        <>
          {' '}
          · {UI_TEXT.judgePanel.techniques.embedding}:{' '}
          {status.embeddingReason === 'labels-missing'
            ? UI_TEXT.judgeEmbedNoLabels
            : fill(UI_TEXT.judgeNoAnswer, { reason: status.embeddingReason })}
        </>
      )}
    </p>
  )
}
