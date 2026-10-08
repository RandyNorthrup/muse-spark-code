import type { AgentReceipt, AgentAttempt } from '../../shared/agentEvidence'
import { useState } from 'react'
import { UI_TEXT } from '../../shared/constants'
import { fill, formatNumber } from '../../shared/l10n/text'
import { formatDurationMs } from '../agentFormat'

function checkLabel(check: AgentReceipt['checks'][number]): string {
  const outcome = check.outcome
  switch (outcome) {
    case 'passed':
    case 'failed':
    case 'timedOut':
    case 'cancelled':
    case 'notRun': {
      return fill(UI_TEXT.checkOutcomes[outcome], { name: check.command })
    }
    default: {
      return check.command
    }
  }
}

/** Common bounded receipt body for subagents, workflow agents and tasks. */
export function AgentReceiptBody({
  receipt,
  onOpenFile,
}: {
  readonly receipt: AgentReceipt
  readonly onOpenFile?: ((path: string, range: undefined) => void) | undefined
}) {
  return (
    <>
      <p>
        {UI_TEXT.agentReceiptStop}: {UI_TEXT.agentStopReasons[receipt.stopReason]}
      </p>
      <h4>{UI_TEXT.agentReceiptFiles}</h4>
      {receipt.files.length === 0 ? (
        <p>{UI_TEXT.agentReceiptUnavailable}</p>
      ) : (
        <ul>
          {receipt.files.map((file, index) => (
            <li key={index}>
              <button
                type="button"
                className="tool-more"
                disabled={onOpenFile === undefined}
                onClick={() => onOpenFile?.(file.path, undefined)}
              >
                {file.path}
              </button>{' '}
              +{formatNumber(file.added)} / −{formatNumber(file.removed)}
            </li>
          ))}
        </ul>
      )}
      <h4>{UI_TEXT.agentReceiptChecks}</h4>
      {receipt.checks.length === 0 ? (
        <p>{UI_TEXT.agentReceiptUnavailable}</p>
      ) : (
        <ul>
          {receipt.checks.map((check, index) => (
            <li key={index}>
              <code>{checkLabel(check)}</code> ·{' '}
              {check.exitCode === undefined
                ? UI_TEXT.agentReceiptUnavailable
                : formatNumber(check.exitCode)}
              {check.durationMs === undefined ? '' : ` · ${formatDurationMs(check.durationMs)}`}
            </li>
          ))}
        </ul>
      )}
      {receipt.unfinished.length === 0 ? null : (
        <>
          <h4>{UI_TEXT.agentReceiptUnfinished}</h4>
          <ul>
            {receipt.unfinished.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        </>
      )}
      <h4>{UI_TEXT.agentResultText}</h4>
      <pre className="agent-result-text">
        {receipt.finalMessage || UI_TEXT.agentReceiptUnavailable}
      </pre>
      {receipt.truncated ? <p role="note">{UI_TEXT.agentReceiptTruncated}</p> : null}
    </>
  )
}

export function AgentReceiptHistory({
  attempts,
  onOpenFile,
}: {
  readonly attempts: readonly AgentAttempt[]
  readonly onOpenFile?: ((path: string, range: undefined) => void) | undefined
}) {
  return attempts.length === 0 ? null : (
    <>
      <h4>{UI_TEXT.agentReceiptHistory}</h4>
      <ul>
        {attempts.map((attempt) => (
          <li key={attempt.number}>
            <details>
              <summary>
                {fill(UI_TEXT.workflowAttempt, { attempt: formatNumber(attempt.number) })} ·{' '}
                {UI_TEXT.agentOutcomes[attempt.outcome]}
              </summary>
              <AgentReceiptBody receipt={attempt.receipt} onOpenFile={onOpenFile} />
            </details>
          </li>
        ))}
      </ul>
    </>
  )
}

/** Only a click builds a workflow/task receipt; this file ships with the lazy map. */
export function AgentReceiptDisclosure({
  readReceipt,
  onOpenFile,
  attempts = [],
}: {
  readonly readReceipt: () => AgentReceipt
  readonly onOpenFile?: ((path: string, range: undefined) => void) | undefined
  readonly attempts?: readonly AgentAttempt[] | undefined
}) {
  const [isOpen, setOpen] = useState(false)
  return (
    <details
      onToggle={(event) => {
        setOpen(event.currentTarget.open)
      }}
    >
      <summary>{UI_TEXT.agentReceipt}</summary>
      {isOpen ? (
        <>
          <AgentReceiptBody receipt={readReceipt()} onOpenFile={onOpenFile} />
          <AgentReceiptHistory attempts={attempts} onOpenFile={onOpenFile} />
        </>
      ) : null}
    </details>
  )
}
