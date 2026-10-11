// One provider's scan state (M95 acceptance 17): a fresh scan cached with
// its time, diffed against the last one ("3 new models since the last
// scan"), cancellable while it runs. The host owns the scan — one at a
// time per provider, reused while fresh; this only shows it.

import { UI_TEXT } from '../../../shared/constants'
import { fill, plural } from '../../../shared/l10n/text'
import type { ScanState } from '../../../shared/modelsPanel'
import { InlineError } from './InlineError'

export interface ScanStatusProps {
  readonly scan: ScanState | undefined
  readonly onRefresh: () => void
  readonly onCancel: () => void
}

function DiffLines({ scan }: { readonly scan: ScanState }) {
  const lines: string[] = []
  if ((scan.newCount ?? 0) > 0) {
    lines.push(plural(UI_TEXT.scanNewModels, scan.newCount ?? 0))
  }
  if ((scan.removedCount ?? 0) > 0) {
    lines.push(plural(UI_TEXT.scanRemovedModels, scan.removedCount ?? 0))
  }
  if ((scan.repricedCount ?? 0) > 0) {
    lines.push(plural(UI_TEXT.scanRepricedModels, scan.repricedCount ?? 0))
  }
  if (scan.detail !== undefined && scan.detail !== '') {
    lines.push(scan.detail)
  }
  if (lines.length === 0) {
    return null
  }
  return (
    <ul className="models-scan-diff">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

export function ScanStatus({ scan, onRefresh, onCancel }: ScanStatusProps) {
  if (scan === undefined || scan.status === 'idle') {
    return (
      <div className="models-scan-status">
        <p>{UI_TEXT.modelsNotScanned}</p>
        <button type="button" className="models-button" onClick={onRefresh}>
          {UI_TEXT.refreshModels}
        </button>
      </div>
    )
  }
  if (scan.status === 'scanning') {
    return (
      <div className="models-scan-status" role="status">
        <p>{UI_TEXT.providersScanning}</p>
        <button type="button" className="models-button" onClick={onCancel}>
          {UI_TEXT.wizardCancel}
        </button>
      </div>
    )
  }
  if (scan.status === 'failed') {
    return (
      <div className="models-scan-status">
        <InlineError messages={[fill(UI_TEXT.scanFailed, { detail: scan.detail ?? '' })]} />
        <button type="button" className="models-button" onClick={onRefresh}>
          {UI_TEXT.refreshModels}
        </button>
      </div>
    )
  }
  return (
    <div className="models-scan-status">
      <DiffLines scan={scan} />
      <button type="button" className="models-button" onClick={onRefresh}>
        {UI_TEXT.refreshModels}
      </button>
    </div>
  )
}
