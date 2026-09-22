// One tool call: status dot, label, argument summary, change line, and a
// collapsible body (shell IN/OUT, edit diff, read output, or generic
// args/output), plus the approval or question card when the host is waiting.

import { useState } from 'react'
import { OUTPUT_PREVIEW_LINES, UI_TEXT } from '../../shared/constants'
import { type DiffRow, parsePatchDocument, parseUnifiedText } from '../diff'
import type { OutputPage, TranscriptEntry } from '../state/uiState'
import { changeSummary, describeTool, writtenContent } from '../toolPresentation'
import { ApprovalCard, type ApprovalCardProps } from './ApprovalCard'
import { QuestionCard, type QuestionCardProps } from './QuestionCard'

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

export interface ToolRowProps {
  readonly entry: ToolEntry
  readonly patchPage: OutputPage | undefined
  readonly onReadOutput: (itemId: string, outputRef: string, offsetBytes: number) => void
  readonly onDecide: ApprovalCardProps['onDecide']
  readonly onAnswer: QuestionCardProps['onAnswer']
  /** Edit review (M5): the stored patch of a completed edit-family item. */
  readonly onOpenEditDiff: (itemId: string, outputRef: string) => void
  readonly onRevertEdit: (itemId: string, outputRef: string) => void
}

function statusClass(entry: ToolEntry): string {
  if (entry.status === 'inProgress') {
    return 'tool-dot tool-dot-running'
  }
  return entry.status === 'completed' ? 'tool-dot tool-dot-ok' : 'tool-dot tool-dot-failed'
}

/** Text clipped to the preview line count with a Show more toggle. */
function Clipped({ text, className }: { readonly text: string; readonly className: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const allLines = text.split('\n')
  const isLong = allLines.length > OUTPUT_PREVIEW_LINES
  const shown = isExpanded || !isLong ? text : allLines.slice(0, OUTPUT_PREVIEW_LINES).join('\n')
  return (
    <div className={className}>
      <pre className="tool-pre">{shown}</pre>
      {isLong ? (
        <button
          type="button"
          className="tool-more"
          onClick={() => {
            setIsExpanded(!isExpanded)
          }}
        >
          {isExpanded ? UI_TEXT.showLess : UI_TEXT.showMore}
        </button>
      ) : null}
    </div>
  )
}

function DiffTable({ rows }: { readonly rows: readonly DiffRow[] }) {
  return (
    <table className="diff">
      <tbody>
        {rows.map((row, index) => (
          <tr key={String(index)} className={`diff-${row.kind}`}>
            <td className="diff-gutter">{row.oldLine ?? ''}</td>
            <td className="diff-gutter">{row.newLine ?? ''}</td>
            <td className="diff-text">{row.kind === 'hunk' ? '⋯' : row.text}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function EditBody({
  entry,
  patchPage,
}: {
  readonly entry: ToolEntry
  readonly patchPage: OutputPage | undefined
}) {
  const files = patchPage === undefined ? undefined : parsePatchDocument(patchPage.content)
  if (files !== undefined && files.length > 0) {
    return (
      <>
        {files.map((file) => (
          <DiffTable key={file.path} rows={file.rows} />
        ))}
      </>
    )
  }
  const rows = parseUnifiedText(entry.output)
  if (rows !== undefined) {
    return <DiffTable rows={rows} />
  }
  const content = writtenContent(entry.args)
  if (content !== undefined) {
    return <Clipped text={content} className="tool-output" />
  }
  return entry.patchRef === undefined ? null : (
    <p className="tool-loading">{UI_TEXT.loadingOutput}</p>
  )
}

function ShellBody({
  entry,
  command,
}: {
  readonly entry: ToolEntry
  readonly command: string | undefined
}) {
  return (
    <div className="shell">
      {command === undefined ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.inLabel}</span>
          <pre className="tool-pre">{command}</pre>
        </div>
      )}
      {entry.output === '' ? null : (
        <div className="shell-box">
          <span className="shell-label">{UI_TEXT.outLabel}</span>
          <Clipped text={entry.output} className="shell-out" />
        </div>
      )}
    </div>
  )
}

export function ToolRow({
  entry,
  patchPage,
  onReadOutput,
  onDecide,
  onAnswer,
  onOpenEditDiff,
  onRevertEdit,
}: ToolRowProps) {
  const presentation = describeTool(entry.tool, entry.args)
  const isWaiting = entry.approval !== undefined || entry.question !== undefined
  const [isOpen, setIsOpen] = useState(false)
  const change = changeSummary(entry.patchSummary)
  const isFailed = entry.status !== 'inProgress' && entry.status !== 'completed'
  // A finished edit with a stored patch can be reviewed in the editor.
  const reviewRef =
    presentation.body === 'edit' && entry.status === 'completed' ? entry.patchRef : undefined
  const toggle = () => {
    const isOpening = !isOpen
    setIsOpen(isOpening)
    // The stored patch is fetched the first time the row opens.
    if (isOpening && patchPage === undefined && entry.patchRef !== undefined) {
      onReadOutput(entry.id, entry.patchRef.id, 0)
    }
  }
  let body
  switch (presentation.body) {
    case 'shell': {
      body = <ShellBody entry={entry} command={presentation.command} />
      break
    }
    case 'edit': {
      body = <EditBody entry={entry} patchPage={patchPage} />
      break
    }
    case 'read': {
      body = entry.output === '' ? null : <Clipped text={entry.output} className="tool-output" />
      break
    }
    case 'question': {
      body = null
      break
    }
    case 'generic': {
      body = (
        <>
          {entry.args === '' ? null : <Clipped text={entry.args} className="tool-output" />}
          {entry.output === '' ? null : <Clipped text={entry.output} className="tool-output" />}
        </>
      )
      break
    }
  }
  return (
    <li className={isWaiting ? 'tool tool-waiting' : 'tool'} data-status={entry.status}>
      <button type="button" className="tool-header" aria-expanded={isOpen} onClick={toggle}>
        <span className={statusClass(entry)} aria-hidden="true" />
        <span className="tool-label">{presentation.label}</span>
        {presentation.summary === '' ? null : (
          <span className="tool-summary">{presentation.summary}</span>
        )}
      </button>
      {change === undefined ? null : <div className="tool-change">{change}</div>}
      {reviewRef === undefined ? null : (
        <div className="tool-actions">
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onOpenEditDiff(entry.id, reviewRef.id)
            }}
          >
            {UI_TEXT.openDiff}
          </button>
          <button
            type="button"
            className="tool-more"
            onClick={() => {
              onRevertEdit(entry.id, reviewRef.id)
            }}
          >
            {UI_TEXT.revertEdit}
          </button>
        </div>
      )}
      {isFailed ? (
        <div className="tool-failure" role="alert">
          {entry.status === 'rejected' ? UI_TEXT.toolRejected : UI_TEXT.toolFailed}
          {entry.failureReason === undefined ? '' : `: ${entry.failureReason}`}
        </div>
      ) : null}
      {isOpen ? <div className="tool-body">{body}</div> : null}
      {entry.approval === undefined ? null : (
        <ApprovalCard approval={entry.approval} toolName={entry.tool} onDecide={onDecide} />
      )}
      {entry.approvalOutcome === undefined ? null : (
        <div className="tool-outcome">
          {UI_TEXT.approvalDecided}: {entry.approvalOutcome.decision} (
          {entry.approvalOutcome.resolvedBy})
        </div>
      )}
      {entry.question === undefined ? null : (
        <QuestionCard question={entry.question} onAnswer={onAnswer} />
      )}
      {entry.questionOutcome === undefined ? null : (
        <div className="tool-outcome">
          {UI_TEXT.questionAnswered}:{' '}
          {entry.questionOutcome.answers
            .map(
              (answer) =>
                answer.selectedLabel ?? answer.selectedLabels?.join(', ') ?? answer.freeText ?? '',
            )
            .join('; ')}
        </div>
      )}
    </li>
  )
}
