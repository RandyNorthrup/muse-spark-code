import type { ReactNode } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { formatDateTime } from '../../shared/l10n/text'
import type { MakerHostMessage } from '../../shared/makerProtocol'
import { Modal } from '../components/Modal'

export function DeviceLog({
  log,
  onClose,
  stop,
}: {
  readonly stop: ReactNode
  readonly log: Extract<MakerHostMessage, { type: 'makerDeviceLog' }> | undefined
  readonly onClose: () => void
}) {
  return (
    <Modal
      title={UI_TEXT.makerOpenDeviceLog}
      titleId="maker-log-title"
      onClose={onClose}
      fixedControls={stop}
    >
      <p>{UI_TEXT.makerDeviceLogPrivacy}</p>
      <LogEntries log={log} />
    </Modal>
  )
}

function LogEntries({
  log,
}: {
  readonly log: Extract<MakerHostMessage, { type: 'makerDeviceLog' }> | undefined
}) {
  if (log === undefined) return <p role="status">{UI_TEXT.loadingOutput}</p>
  if (log.entries.length === 0) return <p>{UI_TEXT.makerEmptyLog}</p>
  return (
    <ol className="maker-log">
      {log.entries.map((entry, index) => (
        <li key={`${String(entry.time)}:${String(index)}`}>
          <time dateTime={new Date(entry.time).toISOString()}>{formatDateTime(entry.time)}</time>
          <p>
            {entry.machine} · <code>{entry.action}</code> · <code>{entry.outcome}</code>
          </p>
          {entry.outcome === 'sentOutcomeUnknown' && (
            <p role="alert">{UI_TEXT.makerSentOutcomeUnknown}</p>
          )}
          <pre tabIndex={0}>{entry.payload}</pre>
          <details>
            <summary>{UI_TEXT.makerAnalysisLabel}</summary>
            <pre>{JSON.stringify({ digest: entry.digest, approval: entry.approval }, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ol>
  )
}
