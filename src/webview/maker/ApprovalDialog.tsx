import { type ReactNode, useLayoutEffect, useState } from 'react'
import { MILLIMETERS_PER_METER, MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, formatUnit } from '../../shared/l10n/text'
import type { ApprovalRequest } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'
import { PayloadReview } from './PayloadReview'

export function ApprovalDialog({
  request,
  onAnswer,
  stop,
  onRendered,
  onReview,
}: {
  readonly stop: ReactNode
  readonly request: ApprovalRequest
  readonly onAnswer: (decision: 'allow_once' | 'reject_once') => void
  readonly onRendered: (digest: string) => void
  readonly onReview?: (digest: string | undefined) => void
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
        onReviewed={setReviewed}
        onRendered={(value) => {
          setDigest(value)
          onRendered(value)
        }}
      />
      {request.kind === 'machine' && (
        <>
          <h3>{UI_TEXT.makerAnalysisLabel}</h3>
          {json(request.analysis)}
          <p>
            {fill(UI_TEXT.makerMaximumFeed, {
              feed: formatUnit(
                request.analysis.maxFeedMmMin / MILLIMETERS_PER_METER,
                'meter-per-minute',
              ),
            })}
          </p>
          {Object.entries(request.analysis.temperatures).map(([heater, temperature]) =>
            temperature === undefined ? null : (
              <p key={heater}>
                {heater}:{' '}
                {fill(UI_TEXT.makerMaximumTemperature, {
                  temperature: formatUnit(temperature, 'celsius'),
                })}
              </p>
            ),
          )}
        </>
      )}
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
