import type { ReactNode } from 'react'
import { MILLIMETERS_PER_METER, MILLISECONDS_PER_SECOND, UI_TEXT } from '../../shared/constants'
import { fill, formatNumber, formatUnit } from '../../shared/l10n/text'
import type { ApprovalRequest } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'

export function ApprovalDialog({
  request,
  onAnswer,
  stop,
}: {
  readonly stop: ReactNode
  readonly request: ApprovalRequest
  readonly onAnswer: (decision: 'allow_once' | 'reject_once') => void
}) {
  return (
    <Modal
      title={UI_TEXT.makerApprovalTitle}
      titleId="maker-approval-title"
      onClose={() => {
        onAnswer('reject_once')
      }}
    >
      {stop}
      <p>{UI_TEXT.makerSoftwareStopWarning}</p>
      <h3>{UI_TEXT.makerTargetLabel}</h3>
      <pre tabIndex={0}>{JSON.stringify(request.target, null, 2)}</pre>
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
          <pre>
            {JSON.stringify(
              {
                dtr: request.dtr,
                rts: request.rts,
                projectTarget: request.projectTarget,
                flashIdentity: request.flashIdentity,
              },
              null,
              2,
            )}
          </pre>
          {request.flashIdentity.status === 'unknown' && <p>{UI_TEXT.makerIdentityUnknown}</p>}
        </>
      )}
      <h3>{UI_TEXT.makerPayloadLabel}</h3>
      <pre tabIndex={0}>{request.kind === 'serial' ? request.payload.value : request.payload}</pre>
      {request.kind === 'machine' && (
        <>
          <h3>{UI_TEXT.makerAnalysisLabel}</h3>
          <pre tabIndex={0}>
            {JSON.stringify(
              request.analysis,
              (_key, value: unknown) => (typeof value === 'number' ? formatNumber(value) : value),
              2,
            )}
          </pre>
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
      <div className="maker-actions">
        <button
          className="button-secondary"
          type="button"
          onClick={() => {
            onAnswer('reject_once')
          }}
        >
          {UI_TEXT.makerReject}
        </button>
        <button
          className="button-primary"
          type="button"
          onClick={() => {
            onAnswer('allow_once')
          }}
        >
          {UI_TEXT.makerSendOnce}
        </button>
      </div>
    </Modal>
  )
}
