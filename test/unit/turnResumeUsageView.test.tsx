// @vitest-environment jsdom
// M88 lane C (PLAN.md D67, item 16): the usage read's round trip. The
// App asks the host to read the usage for a pending turn, and the row
// says a usage offer rests on the latest usage report.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/webview/App'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { Transcript } from '../../src/webview/components/Transcript'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { GOAL_STATUS } from '../../src/shared/constants'
import type { WebviewToHostMessage } from '../../src/shared/protocol'
import type { ErrorResumeOffer, TranscriptEntry } from '../../src/webview/state/transcriptEntries'

const FAILED_AT = Date.UTC(2026, 10, 1, 12, 0, 30)

describe('usage resume request', () => {
  it('asks the host to read the usage for a pending turn, once', () => {
    const sent: WebviewToHostMessage[] = []
    const store = createUiStore({
      ...initialUiState,
      sessionId: 'session-1',
      auth: { ...initialUiState.auth, status: 'signedIn', backend: 'museCode' },
      goal: { objective: 'Ship it', status: GOAL_STATUS.usageLimited, percentComplete: 40 },
    })
    render(
      <App
        store={store}
        postMessage={(message) => {
          sent.push(message)
        }}
        now={() => FAILED_AT}
        newLocalId={() => 'local-1'}
      />,
    )
    expect(sent.filter((message) => message.type === 'usageForResume')).toEqual([])
    act(() => {
      store.dispatch({
        type: 'hostMessage',
        message: {
          type: 'agentEvent',
          event: { type: 'turnCompleted', turnId: 't1', terminal: 'failed', retryable: false },
        },
        at: FAILED_AT,
      })
    })
    const requests = sent.filter((message) => message.type === 'usageForResume')
    expect(requests).toEqual([{ type: 'usageForResume', turnId: 't1' }])
    expect(store.getState().usageResume).toEqual({ t1: 'requested' })
  })
})

function failedTurn(resume: ErrorResumeOffer | undefined): TranscriptEntry {
  return {
    kind: 'error',
    id: 'error:t1',
    text: 'broke',
    ...(resume !== undefined && { resume }),
  }
}

function renderRows(
  entries: readonly TranscriptEntry[],
  options?: {
    onResumeLater?: (entryId: string, turnId: string, defaultAtMs: number) => void
  },
): void {
  const noop = () => undefined
  render(
    <Transcript
      entries={entries}
      isRunning={false}
      isFocusView={false}
      outputPages={{}}
      toolImages={{}}
      onReadImage={noop}
      onOpenLink={noop}
      onCopy={noop}
      onInsert={undefined}
      onReadOutput={noop}
      onOpenOutput={noop}
      onAnswer={noop}
      onCancelQuestion={noop}
      onClarifyQuestion={noop}
      onAcceptElicitation={noop}
      onDeclineElicitation={noop}
      onCancelElicitation={noop}
      onMoveToBackground={noop}
      onStopTask={noop}
      canStopUserShell={false}
      onApply={undefined}
      onOpenEditDiff={noop}
      onOpenFile={noop}
      showReplyUsage={false}
      onResumeLater={options?.onResumeLater}
      onContinueTurn={undefined}
      onOpenBudgetSetting={undefined}
    />,
  )
}

describe('usage offer row', () => {
  it('opens Resume later at the fitted minute and names the report', () => {
    const opened: { entryId: string; turnId: string; defaultAtMs: number }[] = []
    renderRows([failedTurn({ kind: 'usage', turnId: 't1', defaultAtMs: FAILED_AT + 60_000 })], {
      onResumeLater: (entryId, turnId, defaultAtMs) => {
        opened.push({ entryId, turnId, defaultAtMs })
      },
    })
    expect(screen.getByText(UI_TEXT.resumeUsageReportNote)).not.toBeNull()
    fireEvent.click(screen.getByText(UI_TEXT.resumeLaterAction))
    expect(opened).toEqual([{ entryId: 'error:t1', turnId: 't1', defaultAtMs: FAILED_AT + 60_000 }])
  })

  it('says nothing on a typed offer’s row', () => {
    renderRows([failedTurn({ kind: 'quota', turnId: 't1', defaultAtMs: FAILED_AT + 60_000 })])
    expect(screen.queryByText(UI_TEXT.resumeUsageReportNote)).toBeNull()
  })
})
