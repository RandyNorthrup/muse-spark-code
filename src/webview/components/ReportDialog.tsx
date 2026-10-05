// The report-a-problem preview dialog (M93 lane W, PLAN.md D72). The host
// builds lane P's sealed draft and posts it; the dialog shows that text
// byte-identical and sends back only the user's choices — a description
// within its cap, section switches, which journal entries to drop — plus the
// draft's seal on export. It never builds report content itself, and the
// export buttons stay disabled while a preview update is still on its way,
// so every export carries the seal of the draft on screen.

import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { REPORT_DESCRIPTION_MAX_CHARS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type {
  ReportDraftItem,
  ReportExportChannel,
  WebviewToHostMessage,
} from '../../shared/protocol'
import type { ReportDialogState, ReportExportStatus } from '../state/uiState'
import { Modal } from './Modal'

const DESCRIPTION_ROWS = 3
const PREVIEW_ROWS = 12

function itemKey(item: ReportDraftItem): string {
  return item.kind === 'facts' ? 'facts' : `event:${String(item.eventIndex ?? -1)}:${item.label}`
}

/**
 * What the dialog's status line reads: the updating state while a rebuilt
 * preview is on its way, otherwise the last export's answer in fixed words.
 * Nothing to say (no answer yet, a quiet cancellation) reads as silence.
 */
export function reportDialogStatusText(
  exportStatus: ReportExportStatus | undefined,
  isUpdating: boolean,
): string | undefined {
  if (isUpdating) {
    return UI_TEXT.reportUpdating
  }
  if (exportStatus === undefined) {
    return undefined
  }
  if (exportStatus.ok) {
    switch (exportStatus.via) {
      case 'copy': {
        return UI_TEXT.reportCopied
      }
      case 'save': {
        return UI_TEXT.reportSaved
      }
      case 'issue': {
        return exportStatus.issueFallback === true
          ? UI_TEXT.reportUrlTooLong
          : UI_TEXT.reportIssueOpened
      }
      case 'vscodeReporter': {
        return UI_TEXT.reportVscodeReporterOpened
      }
    }
  }
  switch (exportStatus.reason) {
    case 'stale': {
      return UI_TEXT.reportStaleDraft
    }
    case 'copyFailed': {
      return UI_TEXT.reportCopyFailed
    }
    case 'saveFailed': {
      return UI_TEXT.reportSaveFailed
    }
    case 'reporterFailed': {
      return UI_TEXT.reportVscodeReporterFailed
    }
    case 'cancelled':
    case undefined: {
      return undefined
    }
  }
}

export interface ReportDialogProps {
  readonly description: string
  readonly includeFacts: boolean
  readonly includeEvents: boolean
  readonly items: readonly ReportDraftItem[]
  /** Lane P's exact final draft, shown byte-identical. */
  readonly draftText: string
  readonly canUseVscodeReporter: boolean
  readonly recordingUnavailable: boolean
  readonly statusText: string | undefined
  readonly isUpdating: boolean
  readonly onDescriptionChange: (description: string) => void
  readonly onToggleFacts: (isIncluded: boolean) => void
  readonly onToggleEvents: (isIncluded: boolean) => void
  readonly onRemoveItem: (item: ReportDraftItem) => void
  readonly onExport: (via: ReportExportChannel) => void
  readonly onClose: () => void
}

export function ReportDialog({
  description,
  includeFacts,
  includeEvents,
  items,
  draftText,
  canUseVscodeReporter,
  recordingUnavailable,
  statusText,
  isUpdating,
  onDescriptionChange,
  onToggleFacts,
  onToggleEvents,
  onRemoveItem,
  onExport,
  onClose,
}: ReportDialogProps) {
  const onDescriptionInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onDescriptionChange(event.target.value)
  }
  return (
    <Modal title={UI_TEXT.reportTitle} titleId="report-title" isWide onClose={onClose}>
      <div>
        <label className="report-label" htmlFor="report-description">
          {UI_TEXT.reportDescriptionLabel}
        </label>
        <textarea
          id="report-description"
          className="question-input report-description"
          dir="auto"
          rows={DESCRIPTION_ROWS}
          maxLength={REPORT_DESCRIPTION_MAX_CHARS}
          value={description}
          onChange={onDescriptionInput}
        />
        <p className="report-warning">{UI_TEXT.reportDescriptionWarning}</p>
        <div className="report-sections">
          <label className="report-check">
            <input
              type="checkbox"
              checked={includeFacts}
              onChange={(event) => {
                onToggleFacts(event.target.checked)
              }}
            />
            {UI_TEXT.reportIncludeFacts}
          </label>
          <label className="report-check">
            <input
              type="checkbox"
              checked={includeEvents}
              onChange={(event) => {
                onToggleEvents(event.target.checked)
              }}
            />
            {UI_TEXT.reportIncludeEvents}
          </label>
        </div>
        <p id="report-items-label" className="report-label">
          {UI_TEXT.reportItemsLabel}
        </p>
        {recordingUnavailable ? (
          <p className="report-note">{UI_TEXT.reportRecordingUnavailable}</p>
        ) : null}
        <ul className="report-items" aria-labelledby="report-items-label">
          {items.map((item) => (
            <li key={itemKey(item)} dir="auto">
              <span className="report-item-label">{item.label}</span>{' '}
              <button
                type="button"
                className="notice-action"
                aria-label={fill(UI_TEXT.reportRemoveItem, { item: item.label })}
                onClick={() => {
                  onRemoveItem(item)
                }}
              >
                {UI_TEXT.removeAttachment}
              </button>
            </li>
          ))}
        </ul>
        <p id="report-preview-label" className="report-label">
          {UI_TEXT.reportPreviewLabel}
        </p>
        <textarea
          className="question-input report-preview"
          dir="auto"
          rows={PREVIEW_ROWS}
          readOnly
          aria-labelledby="report-preview-label"
          value={draftText}
        />
        {statusText === undefined ? null : (
          <p className="report-status" role="status">
            {statusText}
          </p>
        )}
        <div className="report-actions">
          <button
            type="button"
            className="button-primary"
            disabled={isUpdating}
            onClick={() => {
              onExport('copy')
            }}
          >
            {UI_TEXT.reportCopyAction}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={isUpdating}
            onClick={() => {
              onExport('issue')
            }}
          >
            {UI_TEXT.reportOpenIssueAction}
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={isUpdating}
            onClick={() => {
              onExport('save')
            }}
          >
            {UI_TEXT.reportSaveAction}
          </button>
          {canUseVscodeReporter ? (
            <button
              type="button"
              className="button-secondary"
              disabled={isUpdating}
              onClick={() => {
                onExport('vscodeReporter')
              }}
            >
              {UI_TEXT.reportVscodeReporterAction}
            </button>
          ) : null}
          <button type="button" className="button-secondary" onClick={onClose}>
            {UI_TEXT.reportCancelAction}
          </button>
        </div>
        {canUseVscodeReporter ? (
          <p className="report-note">{UI_TEXT.reportVscodeReporterNote}</p>
        ) : null}
      </div>
    </Modal>
  )
}

/** The update the host rebuilds the preview from: the dialog's whole choice. */
interface ReportUpdate {
  readonly description: string
  readonly includeFacts: boolean
  readonly includeEvents: boolean
  readonly removed: readonly number[]
}

/**
 * The dialog above the panel (M93 lane W): posts the user's choices for the
 * host to rebuild lane P's sealed draft, and exports with the seal of the
 * draft on screen. Mounted while `report` is defined (in the app, or over
 * the crash screen); closing returns focus to whatever opened it.
 */
export function ReportDialogHost({
  report,
  postMessage,
  onClose,
}: {
  readonly report: ReportDialogState
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly onClose: () => void
}): ReactNode {
  // Whatever held focus when the dialog opened. Read in the state
  // initializer (which runs once, on mount) so the modal's own focus effect
  // (which runs later) cannot overwrite it.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' || !(document.activeElement instanceof HTMLElement)
      ? null
      : document.activeElement,
  )
  const [update, setUpdate] = useState<ReportUpdate>(() => ({
    description: report.description,
    includeFacts: report.includeFacts,
    includeEvents: report.includeEvents,
    removed: [],
  }))
  const [isUpdating, setIsUpdating] = useState(false)
  // What the host has seen: mirrors of the last post, so a fresh draft only
  // resends when the user moved on while it was on its way.
  const updateRef = useRef(update)
  useEffect(() => {
    updateRef.current = update
  })
  const lastSent = useRef<ReportUpdate>(update)
  useEffect(() => {
    return () => {
      if (opener?.isConnected === true) {
        opener.focus()
      }
    }
  }, [opener])
  // A fresh draft settles the update in flight — unless the user moved on
  // meanwhile, in which case their newer choice is posted at once, so the
  // preview always converges on what the dialog shows.
  useEffect(() => {
    const current = updateRef.current
    const sent = lastSent.current
    if (
      current.description !== sent.description ||
      current.includeFacts !== sent.includeFacts ||
      current.includeEvents !== sent.includeEvents ||
      current.removed !== sent.removed
    ) {
      lastSent.current = current
      postMessage({
        type: 'updateReport',
        description: current.description.slice(0, REPORT_DESCRIPTION_MAX_CHARS),
        includeFacts: current.includeFacts,
        includeEvents: current.includeEvents,
        removedEventIndexes: [...current.removed],
      })
      return
    }
    setIsUpdating(false)
    if (current.description !== report.description) {
      setUpdate({ ...current, description: report.description })
    }
  }, [report.hash, report.description, postMessage])
  const sendUpdate = (next: ReportUpdate) => {
    lastSent.current = next
    setUpdate(next)
    setIsUpdating(true)
    postMessage({
      type: 'updateReport',
      description: next.description.slice(0, REPORT_DESCRIPTION_MAX_CHARS),
      includeFacts: next.includeFacts,
      includeEvents: next.includeEvents,
      removedEventIndexes: [...next.removed],
    })
  }
  return (
    <ReportDialog
      description={update.description}
      includeFacts={update.includeFacts}
      includeEvents={update.includeEvents}
      items={report.items}
      draftText={report.text}
      canUseVscodeReporter={report.canUseVscodeReporter}
      recordingUnavailable={report.recordingUnavailable}
      statusText={reportDialogStatusText(report.exportStatus, isUpdating)}
      isUpdating={isUpdating}
      onDescriptionChange={(description) => {
        sendUpdate({ ...updateRef.current, description })
      }}
      onToggleFacts={(includeFacts) => {
        sendUpdate({ ...updateRef.current, includeFacts })
      }}
      onToggleEvents={(includeEvents) => {
        sendUpdate({ ...updateRef.current, includeEvents })
      }}
      onRemoveItem={(item) => {
        if (item.kind === 'facts') {
          sendUpdate({ ...updateRef.current, includeFacts: false })
          return
        }
        if (item.eventIndex === undefined) {
          return
        }
        const removed = updateRef.current.removed
        if (removed.includes(item.eventIndex)) {
          return
        }
        sendUpdate({ ...updateRef.current, removed: [...removed, item.eventIndex] })
      }}
      onExport={(via) => {
        postMessage({ type: 'exportReport', via, hash: report.hash })
      }}
      onClose={onClose}
    />
  )
}
