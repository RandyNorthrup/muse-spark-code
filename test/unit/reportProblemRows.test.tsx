// @vitest-environment jsdom
// Report a problem, lane W (M93, PLAN.md D72): the entry points. A recorded
// failure's error row or notice offers "Report this", which hands the row's
// sanitized event reference to the report workflow — never its text. Rows
// without a reference offer nothing, and the crash screen offers the same
// way on. The reducer keeps the reference on the row and the dialog's
// sealed draft in state.

import type { ReactNode } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { ReportEventRef } from '../../src/shared/protocol'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'
import { Transcript } from '../../src/webview/components/Transcript'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import type { TranscriptEntry } from '../../src/webview/state/transcriptEntries'
import { renderTranscript } from './helpers/transcriptFixtures'

const REF: ReportEventRef = { kind: 'backendExit', entryIndex: 3 }

function Bomb(): ReactNode {
  throw new Error('render exploded')
}

describe('report entry points', () => {
  it('offers "Report this" on an error row that carries a reference, with the reference only', () => {
    setUiText(EN, 'en')
    const onReportProblem = vi.fn()
    const entries: readonly TranscriptEntry[] = [
      { kind: 'error', id: 'e1', text: 'The turn failed: a secret prompt.', reportRef: REF },
      { kind: 'error', id: 'e2', text: 'An unrecorded failure.' },
    ]
    renderTranscript(entries, { onReportProblem })
    const buttons = screen.getAllByRole('button', { name: 'Report this' })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0]!)
    expect(onReportProblem).toHaveBeenCalledTimes(1)
    expect(onReportProblem).toHaveBeenCalledWith('e1', REF)
    // Only the bounded identifiers cross: no row text rides along.
    expect(onReportProblem.mock.calls[0]?.[1]).toEqual({ kind: 'backendExit', entryIndex: 3 })
  })

  it('offers "Report this" on a recorded notice without spending its actions', () => {
    setUiText(EN, 'en')
    const onReportProblem = vi.fn()
    const onNoticeAction = vi.fn()
    const entries: readonly TranscriptEntry[] = [
      {
        kind: 'notice',
        id: 'n1',
        level: 'error',
        text: 'Muse Code exited.',
        actions: ['restartMuseCode'],
        reportRef: REF,
      },
      { kind: 'notice', id: 'n2', level: 'error', text: 'Muse Code exited again.', reportRef: REF },
    ]
    render(
      <Transcript
        entries={entries}
        isRunning={false}
        isFocusView={false}
        outputPages={{}}
        toolImages={{}}
        onReadImage={vi.fn()}
        onOpenLink={vi.fn()}
        onCopy={vi.fn()}
        onInsert={vi.fn()}
        onReadOutput={vi.fn()}
        onOpenOutput={vi.fn()}
        onAnswer={vi.fn()}
        onCancelQuestion={vi.fn()}
        onClarifyQuestion={vi.fn()}
        onMoveToBackground={vi.fn()}
        onStopTask={vi.fn()}
        canStopUserShell={false}
        onApply={vi.fn()}
        onOpenEditDiff={vi.fn()}
        onOpenFile={vi.fn()}
        onNoticeAction={onNoticeAction}
        onReportProblem={onReportProblem}
        showReplyUsage={false}
      />,
    )
    expect(screen.getAllByRole('button', { name: 'Report this' })).toHaveLength(2)
    // The recovery action still spends; reporting never does.
    fireEvent.click(screen.getByRole('button', { name: 'Restart now' }))
    expect(onNoticeAction).toHaveBeenCalledWith('n1', 'restartMuseCode')
    expect(screen.getByRole('button', { name: 'Restart now' })).toBeDisabled()
    fireEvent.click(screen.getAllByRole('button', { name: 'Report this' })[0]!)
    fireEvent.click(screen.getAllByRole('button', { name: 'Report this' })[0]!)
    expect(onReportProblem).toHaveBeenCalledTimes(2)
  })

  it('offers nothing without a reference or a handler', () => {
    setUiText(EN, 'en')
    renderTranscript(
      [
        { kind: 'error', id: 'e1', text: 'The turn failed.' },
        { kind: 'notice', id: 'n1', level: 'error', text: 'Muse Code exited.', reportRef: REF },
      ],
      {},
    )
    expect(screen.queryByRole('button', { name: 'Report this' })).not.toBeInTheDocument()
  })
})

describe('report on the crash screen', () => {
  it('keeps only the reload without a report handler', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(
        <ErrorBoundary onReload={() => undefined} onError={() => undefined}>
          <Bomb />
        </ErrorBoundary>,
      )
      expect(screen.getByRole('button', { name: /Reload/ })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('hands the render failure to the report workflow with no row text', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const onReportProblem = vi.fn()
      render(
        <ErrorBoundary
          onReload={() => undefined}
          onError={() => undefined}
          onReportProblem={onReportProblem}
        >
          <Bomb />
        </ErrorBoundary>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Report a problem' }))
      expect(onReportProblem).toHaveBeenCalledTimes(1)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('report dialog state', () => {
  const HASH = '0'.repeat(64)

  it('keeps the row reference from a recorded notice', () => {
    const noticed = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: { type: 'notice', level: 'error', text: 'Muse Code exited.', reportRef: REF },
      at: 0,
    })
    const entry = noticed.transcript.at(-1)
    expect(entry?.kind).toBe('notice')
    if (entry?.kind === 'notice') {
      expect(entry.reportRef).toEqual(REF)
    }
    const plain = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: { type: 'notice', level: 'error', text: 'Muse Code exited.' },
      at: 0,
    })
    const plainEntry = plain.transcript.at(-1)
    if (plainEntry?.kind === 'notice') {
      expect(plainEntry.reportRef).toBeUndefined()
    }
  })

  it('opens, answers and closes the dialog', () => {
    const opened = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: {
        type: 'reportDraft',
        description: 'The panel went blank.',
        includeFacts: true,
        includeEvents: true,
        items: [{ kind: 'facts', label: 'Support facts' }],
        title: 'Problem report',
        text: 'Muse Spark problem report',
        hash: HASH,
        canUseVscodeReporter: false,
        recordingUnavailable: true,
      },
      at: 0,
    })
    expect(opened.report?.text).toBe('Muse Spark problem report')
    expect(opened.report?.exportStatus).toBeUndefined()
    const answered = uiReducer(opened, {
      type: 'hostMessage',
      message: { type: 'reportExported', via: 'copy', ok: false, reason: 'copyFailed' },
      at: 0,
    })
    expect(answered.report?.exportStatus).toEqual({ via: 'copy', ok: false, reason: 'copyFailed' })
    // An answer for a closed dialog is dropped, never resurrected.
    const closed = uiReducer(answered, { type: 'reportClosed' })
    expect(closed.report).toBeUndefined()
    const late = uiReducer(closed, {
      type: 'hostMessage',
      message: { type: 'reportExported', via: 'copy', ok: true },
      at: 0,
    })
    expect(late.report).toBeUndefined()
  })

  it('clears the last export answer on a fresh draft', () => {
    const opened = uiReducer(initialUiState, {
      type: 'hostMessage',
      message: {
        type: 'reportDraft',
        description: '',
        includeFacts: true,
        includeEvents: true,
        items: [],
        title: 'Problem report',
        text: 'first',
        hash: HASH,
        canUseVscodeReporter: false,
        recordingUnavailable: false,
      },
      at: 0,
    })
    const answered = uiReducer(opened, {
      type: 'hostMessage',
      message: { type: 'reportExported', via: 'copy', ok: true },
      at: 0,
    })
    const refreshed = uiReducer(answered, {
      type: 'hostMessage',
      message: {
        type: 'reportDraft',
        description: '',
        includeFacts: true,
        includeEvents: true,
        items: [],
        title: 'Problem report',
        text: 'second',
        hash: '1'.repeat(64),
        canUseVscodeReporter: false,
        recordingUnavailable: false,
      },
      at: 0,
    })
    expect(refreshed.report?.text).toBe('second')
    expect(refreshed.report?.exportStatus).toBeUndefined()
  })
})
