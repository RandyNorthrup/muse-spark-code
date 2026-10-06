import { type ReactNode, useLayoutEffect, useState } from 'react'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import { formatNumber, formatUnit } from '../../shared/l10n/text'
import type { ApprovalRequest, MakerMachineSummary } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'
import { PayloadReview } from './PayloadReview'

export function ApprovalDialog({
  request,
  onAnswer,
  stop,
  onRendered,
  onReview,
  limits,
}: {
  readonly stop: ReactNode
  readonly request: ApprovalRequest
  readonly onAnswer: (decision: 'allow_once' | 'reject_once') => void
  readonly onRendered: (digest: string) => void
  readonly onReview?: (digest: string | undefined) => void
  readonly limits?: MakerMachineSummary['limits'] | undefined
}) {
  const [reviewed, setReviewed] = useState(false)
  const [digest, setDigest] = useState<string>()
  useLayoutEffect(() => {
    onReview?.(reviewed && digest === request.digest ? digest : undefined)
  }, [reviewed, digest, request.digest, onReview])
  const json = (value: unknown) => (
    <pre tabIndex={0}>
      {JSON.stringify(
        value,
        (_key, item: unknown) => (typeof item === 'number' ? formatNumber(item) : item),
        2,
      )}
    </pre>
  )
  return (
    <Modal
      title={UI_TEXT.makerApprovalTitle}
      titleId="maker-approval-title"
      onClose={() => {
        onAnswer('reject_once')
      }}
      fixedControls={stop}
    >
      <p>{UI_TEXT.makerSoftwareStopWarning}</p>
      <h3>{UI_TEXT.makerTargetLabel}</h3>
      {json(request.target)}
      <p>
        <code>{request.action}</code>
      </p>
      {request.kind === 'serial' && (
        <>
          <p role="note">{UI_TEXT.makerResetWarning}</p>
          <p>
            {UI_TEXT.makerBaud}: {formatNumber(request.baud)} ·{' '}
            {formatUnit(request.durationMs / MILLISECONDS_PER_SECOND, 'second')}
          </p>
          {json({
            dtr: request.dtr,
            rts: request.rts,
            projectTarget: request.projectTarget,
            flashIdentity: request.flashIdentity,
          })}
          {request.flashIdentity.status === 'unknown' && <p>{UI_TEXT.makerIdentityUnknown}</p>}
        </>
      )}
      <h3>{UI_TEXT.makerPayloadLabel}</h3>
      <PayloadReview
        content={request.kind === 'serial' ? request.payload.value : request.payload}
        encoding={request.kind === 'serial' ? request.payload.encoding : 'text'}
        request={request}
        limits={limits}
        onReviewed={setReviewed}
        onRendered={(value) => {
          setDigest(value)
          onRendered(value)
        }}
      />
      <details>
        <summary>{UI_TEXT.makerAnalysisLabel}</summary>
        <code>{request.digest}</code>
      </details>
      <div className="maker-actions maker-approval-actions">
        <button
          type="button"
          onClick={() => {
            onAnswer('reject_once')
          }}
        >
          {UI_TEXT.makerReject}
        </button>
        <button
          type="button"
          disabled={!reviewed || digest !== request.digest}
          onClick={() => {
            if (reviewed && digest === request.digest) onAnswer('allow_once')
          }}
        >
          {UI_TEXT.makerSendOnce}
        </button>
      </div>
    </Modal>
  )
}
