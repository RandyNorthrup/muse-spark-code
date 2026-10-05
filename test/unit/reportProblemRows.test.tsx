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
import type { HostToWebviewMessage, ReportEventRef } from '../../src/shared/protocol'
import { ErrorBoundary } from '../../src/webview/components/ErrorBoundary'
import { Transcript } from '../../src/webview/components/Transcript'
import { initialUiState, uiReducer, type UiState } from '../../src/webview/state/uiState'
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
  type Draft = Extract<HostToWebviewMessage, { type: 'reportDraft' }>

  function draft(overrides: Partial<Draft> = {}): Draft {
    return {
      type: 'reportDraft',
      session: 1,
      revision: 0,
      description: '',
      includeFacts: true,
      includeEvents: true,
      items: [{ kind: 'facts', label: 'Support facts' }],
      title: 'Problem report',
      text: 'Muse Spark problem report',
      hash: HASH,
      canUseVscodeReporter: false,
      recordingUnavailable: false,
      ...overrides,
    }
  }

  function apply(state: UiState, message: HostToWebviewMessage): UiState {
    return uiReducer(state, { type: 'hostMessage', message, at: 0 })
  }

  it('keeps the row reference from a recorded notice', () => {
    const noticed = apply(initialUiState, {
      type: 'notice',
      level: 'error',
      text: 'Muse Code exited.',
      reportRef: REF,
    })
    const entry = noticed.transcript.at(-1)
    expect(entry?.kind).toBe('notice')
    if (entry?.kind === 'notice') {
      expect(entry.reportRef).toEqual(REF)
    }
    const plain = apply(initialUiState, {
      type: 'notice',
      level: 'error',
      text: 'Muse Code exited.',
    })
    const plainEntry = plain.transcript.at(-1)
    if (plainEntry?.kind === 'notice') {
      expect(plainEntry.reportRef).toBeUndefined()
    }
  })

  it('opens, answers and closes the dialog', () => {
    const opened = apply(initialUiState, draft({ recordingUnavailable: true }))
    expect(opened.report).toMatchObject({
      session: 1,
      revision: 0,
      text: 'Muse Spark problem report',
    })
    expect(opened.report?.exportStatus).toBeUndefined()
    const answered = apply(opened, {
      type: 'reportExported',
      session: 1,
      hash: HASH,
      via: 'copy',
      ok: false,
      reason: 'copyFailed',
    })
    expect(answered.report?.exportStatus).toEqual({ via: 'copy', ok: false, reason: 'copyFailed' })
    // An answer for a closed dialog is dropped, never resurrected.
    const closed = uiReducer(answered, { type: 'reportClosed' })
    expect(closed.report).toBeUndefined()
    expect(closed.closedReportSession).toBe(1)
    const late = apply(closed, {
      type: 'reportExported',
      session: 1,
      hash: HASH,
      via: 'copy',
      ok: true,
    })
    expect(late.report).toBeUndefined()
  })

  it('never reopens a cancelled dialog for its late draft (RVM93W 4)', () => {
    const opened = apply(initialUiState, draft())
    const closed = uiReducer(opened, { type: 'reportClosed' })
    // The rebuilt preview for a description typed before Cancel arrives late.
    const late = apply(closed, draft({ revision: 3, text: 'late', hash: '1'.repeat(64) }))
    expect(late.report).toBeUndefined()
    // A new open is a new session, and it opens.
    const reopened = apply(late, draft({ session: 2 }))
    expect(reopened.report?.session).toBe(2)
    // An older session's draft never replaces the newer one's.
    expect(apply(reopened, draft({ session: 1, revision: 9 })).report?.session).toBe(2)
  })

  it('keeps the newest choice when an older reply arrives late (RVM93W 2)', () => {
    const newer = apply(initialUiState, draft({ revision: 2, text: 'AB', hash: '2'.repeat(64) }))
    const stale = apply(newer, draft({ revision: 1, text: 'A', hash: '1'.repeat(64) }))
    expect(stale.report?.text).toBe('AB')
    expect(stale.report?.revision).toBe(2)
  })

  it('shows an export answer only beside the draft it exported (RVM93W 7)', () => {
    const first = apply(initialUiState, draft())
    const second = apply(first, draft({ revision: 1, text: 'second', hash: '1'.repeat(64) }))
    // The copy of the first draft finishes after the second is on screen.
    const copiedFirst = apply(second, {
      type: 'reportExported',
      session: 1,
      hash: HASH,
      via: 'copy',
      ok: true,
    })
    expect(copiedFirst.report?.exportStatus).toBeUndefined()
    // An answer from another session with the same text is not this one's either.
    const otherSession = apply(second, {
      type: 'reportExported',
      session: 2,
      hash: '1'.repeat(64),
      via: 'copy',
      ok: true,
    })
    expect(otherSession.report?.exportStatus).toBeUndefined()
    const copiedSecond = apply(second, {
      type: 'reportExported',
      session: 1,
      hash: '1'.repeat(64),
      via: 'copy',
      ok: true,
    })
    expect(copiedSecond.report?.exportStatus).toEqual({ via: 'copy', ok: true })
  })

  it('clears the last export answer on a fresh draft', () => {
    const opened = apply(initialUiState, draft({ text: 'first' }))
    const answered = apply(opened, {
      type: 'reportExported',
      session: 1,
      hash: HASH,
      via: 'copy',
      ok: true,
    })
    expect(answered.report?.exportStatus).toEqual({ via: 'copy', ok: true })
    const refreshed = apply(answered, draft({ revision: 1, text: 'second', hash: '1'.repeat(64) }))
    expect(refreshed.report?.text).toBe('second')
    expect(refreshed.report?.exportStatus).toBeUndefined()
  })
})
