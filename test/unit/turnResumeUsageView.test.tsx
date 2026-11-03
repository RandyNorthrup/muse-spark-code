// @vitest-environment jsdom
// M88 lane C (PLAN.md D67, item 16): the usage read's round trip. The
// App asks the host to read the usage for a pending turn, and the row
// says a usage offer rests on the latest usage report.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App } from '../../src/webview/App'
import { createUiStore } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { GOAL_STATUS } from '../../src/shared/constants'
import type { WebviewToHostMessage } from '../../src/shared/protocol'
import { failedTurnWithResume, renderTranscriptRows } from './helpers/transcriptRows'

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

describe('usage offer row', () => {
  it('opens Resume later at the fitted minute and names the report', () => {
    const opened: { entryId: string; turnId: string; defaultAtMs: number }[] = []
    renderTranscriptRows(
      [failedTurnWithResume({ kind: 'usage', turnId: 't1', defaultAtMs: FAILED_AT + 60_000 })],
      {
        onResumeLater: (entryId, turnId, defaultAtMs) => {
          opened.push({ entryId, turnId, defaultAtMs })
        },
      },
    )
    expect(screen.getByText(UI_TEXT.resumeUsageReportNote)).not.toBeNull()
    fireEvent.click(screen.getByText(UI_TEXT.resumeLaterAction))
    expect(opened).toEqual([{ entryId: 'error:t1', turnId: 't1', defaultAtMs: FAILED_AT + 60_000 }])
  })

  it('says nothing on a typed offer’s row', () => {
    renderTranscriptRows([
      failedTurnWithResume({ kind: 'quota', turnId: 't1', defaultAtMs: FAILED_AT + 60_000 }),
    ])
    expect(screen.queryByText(UI_TEXT.resumeUsageReportNote)).toBeNull()
  })
})
