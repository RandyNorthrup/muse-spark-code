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
  ReportExportReason,
  WebviewToHostMessage,
} from '../../shared/protocol'
import type { ReportDialogState, ReportExportStatus } from '../state/uiState'
import { Modal } from './Modal'

const DESCRIPTION_ROWS = 3
const PREVIEW_ROWS = 12

/** The export buttons in order, Copy first: the VS Code reporter only while its command exists. */
function exportActions(
  canUseVscodeReporter: boolean,
): readonly (readonly [ReportExportChannel, string])[] {
  const actions: (readonly [ReportExportChannel, string])[] = [
    ['copy', UI_TEXT.reportCopyAction],
    ['issue', UI_TEXT.reportOpenIssueAction],
    ['save', UI_TEXT.reportSaveAction],
  ]
  if (canUseVscodeReporter) {
    actions.push(['vscodeReporter', UI_TEXT.reportVscodeReporterAction])
  }
  return actions
}

function itemKey(item: ReportDraftItem): string {
  return item.kind === 'facts' ? item.kind : String(item.eventIndex)
}

/**
What the dialog's status line reads: the updating state while a rebuilt
preview is on its way, otherwise a refused rebuild (lane REPORTFLOW R2),
otherwise the last export's answer in fixed words. Nothing to say (no
answer yet, a quiet cancellation) reads as silence.
*/
export function reportDialogStatusText(
  exportStatus: ReportExportStatus | undefined,
  isUpdating: boolean,
  isRebuildFailed = false,
): string | undefined {
  if (isUpdating) {
    return UI_TEXT.reportUpdating
  }
  if (isRebuildFailed) {
    return UI_TEXT.reportRebuildFailed
  }
  if (exportStatus === undefined) {
    return undefined
  }
  if (exportStatus.ok) {
    const done: Readonly<Record<ReportExportChannel, string>> = {
      copy: UI_TEXT.reportCopied,
      save: UI_TEXT.reportSaved,
      issue:
        exportStatus.issueFallback === true ? UI_TEXT.reportUrlTooLong : UI_TEXT.reportIssueOpened,
      vscodeReporter: UI_TEXT.reportVscodeReporterOpened,
    }
    return done[exportStatus.via]
  }
  // A quiet cancellation (a dismissed save picker) says nothing.
  const failed: Readonly<Record<ReportExportReason, string | undefined>> = {
    stale: UI_TEXT.reportStaleDraft,
    cancelled: undefined,
    copyFailed: UI_TEXT.reportCopyFailed,
    saveFailed: UI_TEXT.reportSaveFailed,
    openFailed: UI_TEXT.reportIssueOpenFailed,
    reporterFailed: UI_TEXT.reportVscodeReporterFailed,
  }
  return exportStatus.reason === undefined ? undefined : failed[exportStatus.reason]
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
  /** Nothing can connect (lane REPORTFLOW): the landing screen's own two actions show above the form. */
  readonly connectHint: boolean
  readonly statusText: string | undefined
  readonly isUpdating: boolean
  readonly onDescriptionChange: (description: string) => void
  readonly onToggleFacts: (isIncluded: boolean) => void
  readonly onToggleEvents: (isIncluded: boolean) => void
  readonly onRemoveItem: (item: ReportDraftItem) => void
  readonly onExport: (via: ReportExportChannel) => void
  /** The landing screen's own sign-in, for the nothing-can-connect hint. */
  readonly onConnectAction: (method: 'browser' | 'apiKey') => void
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
  connectHint,
  statusText,
  isUpdating,
  onDescriptionChange,
  onToggleFacts,
  onToggleEvents,
  onRemoveItem,
  onExport,
  onConnectAction,
  onClose,
}: ReportDialogProps) {
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    // The modal focuses its close button on open; the report opens on the
    // field instead, past that effect, so the requirement is met where the
    // person types. Once only: typing never steals focus back.
    queueMicrotask(() => {
      field.current?.focus()
    })
  }, [])
  const onDescriptionInput = (event: ChangeEvent<HTMLTextAreaElement>) => {
    onDescriptionChange(event.target.value)
  }
  return (
    <Modal title={UI_TEXT.reportTitle} titleId="report-title" isWide onClose={onClose}>
      <div>
        {connectHint ? (
          <div className="report-connect">
            <p className="report-note">{UI_TEXT.reportConnectHint}</p>
            <div className="report-actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  onConnectAction('browser')
                }}
              >
                {UI_TEXT.reportSignInAction}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => {
                  onConnectAction('apiKey')
                }}
              >
                {UI_TEXT.reportAddKeyAction}
              </button>
            </div>
          </div>
        ) : null}
        <label className="report-label" htmlFor="report-description">
          {UI_TEXT.reportDescriptionLabel}
        </label>
        <textarea
          id="report-description"
          ref={field}
          className="question-input report-description"
          dir="auto"
          rows={DESCRIPTION_ROWS}
          maxLength={REPORT_DESCRIPTION_MAX_CHARS}
          value={description}
          onChange={onDescriptionInput}
          aria-describedby="report-description-hint"
        />
        <ul id="report-description-hint" className="report-prompts">
          <li>{UI_TEXT.reportDescriptionHintDid}</li>
          <li>{UI_TEXT.reportDescriptionHintExpected}</li>
          <li>{UI_TEXT.reportDescriptionHintInstead}</li>
        </ul>
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
          {exportActions(canUseVscodeReporter).map(([via, label], index) => (
            <button
              key={via}
              type="button"
              className={index === 0 ? 'button-primary' : 'button-secondary'}
              disabled={isUpdating}
              onClick={() => {
                onExport(via)
              }}
            >
              {label}
            </button>
          ))}
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

/**
The dialog while the draft is on its way (lane REPORTFLOW R2): the
working state with nothing to export yet, so the button never reads as
doing nothing. Closing returns focus to whatever opened it, like the
dialog itself.
*/
export function ReportLoadingDialog({ onClose }: { readonly onClose: () => void }): ReactNode {
  return (
    <Modal title={UI_TEXT.reportTitle} titleId="report-title" onClose={onClose}>
      <div>
        <p className="report-status" role="status">
          {UI_TEXT.reportUpdating}
        </p>
        <div className="report-actions">
          <button type="button" className="button-secondary" onClick={onClose}>
            {UI_TEXT.reportCancelAction}
          </button>
        </div>
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
The dialog above the panel while its draft is on its way (M93 lane W,
lane REPORTFLOW R2): the working state until the host's draft answers,
then the preview itself. Mounted while the report is asked for (in the
app, or over the crash screen); closing returns focus to whatever opened
it.
*/
export function ReportDialogHostOrLoading({
  report,
  postMessage,
  onClose,
}: {
  readonly report: ReportDialogState | undefined
  readonly postMessage: (message: WebviewToHostMessage) => void
  readonly onClose: () => void
}): ReactNode {
  return report === undefined ? (
    <ReportLoadingDialog onClose={onClose} />
  ) : (
    <ReportDialogHost report={report} postMessage={postMessage} onClose={onClose} />
  )
}

/**
The dialog above the panel (M93 lane W): posts the user's choices for the
host to rebuild the sealed draft, and exports with the seal of the draft on
screen. Each choice carries the dialog's own count (its revision); the
preview counts as updating until the host's draft answers the newest one,
so an older reply never settles a newer choice or unlocks the exports.
Mounted while `report` is defined (in the app, or over the crash screen),
once per host session; closing returns focus to whatever opened it.
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
  // The newest choice posted: the preview is current once the host's draft
  // answers it (`report.revision`), whatever arrived before.
  const [sentRevision, setSentRevision] = useState(report.revision)
  // Mirrors for the handlers: two changes before a render each build on the last.
  const updateRef = useRef(update)
  const revisionRef = useRef(report.revision)
  useEffect(() => {
    return () => {
      if (opener?.isConnected === true) {
        opener.focus()
      }
    }
  }, [opener])
  const isUpdating = report.revision < sentRevision
  const sendUpdate = (next: ReportUpdate) => {
    revisionRef.current += 1
    const revision = revisionRef.current
    updateRef.current = next
    setUpdate(next)
    setSentRevision(revision)
    postMessage({
      type: 'updateReport',
      revision,
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
      connectHint={report.connectHint}
      statusText={reportDialogStatusText(report.exportStatus, isUpdating, report.rebuildFailed)}
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
      onConnectAction={(method) => {
        postMessage({ type: 'signIn', method })
      }}
      onClose={onClose}
    />
  )
}
