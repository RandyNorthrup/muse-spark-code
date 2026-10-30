// @vitest-environment jsdom
// RLF-ACPTURNS: a failed turn the backend judged retryable offers Retry
// on its error row, which resends the turn's own message. The row offers
// it only while it carries the failed turn and the panel holds that
// turn's user card; the button waits while a turn runs.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Transcript } from '../../src/webview/components/Transcript'
import type { TranscriptEntry } from '../../src/webview/state/transcriptEntries'

function failedTurn(retryTurnId: string | undefined): TranscriptEntry {
  return {
    kind: 'error',
    id: 'error:t1',
    text: 'broke',
    ...(retryTurnId !== undefined && { retryTurnId }),
  }
}

function retryWait(retryingTurnId: string | undefined): TranscriptEntry {
  return {
    kind: 'notice',
    id: 'retry:t1',
    level: 'warning',
    text: 'Retrying in 5 s (attempt 1 of 3).',
    ...(retryingTurnId !== undefined && { retryingTurnId }),
  }
}

function renderRows(
  entries: readonly TranscriptEntry[],
  options?: {
    onRetryTurn?: (entryId: string, turnId: string) => void
    onStopRetry?: (entryId: string, turnId: string) => void
    resendableTurnIds?: ReadonlySet<string>
    activeTurnId?: string
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
      onRetryTurn={options?.onRetryTurn}
      onStopRetry={options?.onStopRetry}
      resendableTurnIds={options?.resendableTurnIds}
      activeTurnId={options?.activeTurnId}
    />,
  )
}

describe('turn retry button', () => {
  it('offers Retry on a retryable failed turn whose card this panel holds', () => {
    const presses: [string, string][] = []
    renderRows([failedTurn('t1')], {
      onRetryTurn: (entryId, turnId) => {
        presses.push([entryId, turnId])
      },
      resendableTurnIds: new Set(['t1']),
    })
    const retry = screen.getByRole('button', { name: 'Retry' })
    expect(retry).not.toBeDisabled()
    fireEvent.click(retry)
    expect(presses).toEqual([['error:t1', 't1']])
  })

  it("offers no Retry without the backend's judgment or the turn's card", () => {
    renderRows([failedTurn(undefined)], {
      onRetryTurn: () => undefined,
      resendableTurnIds: new Set(['t1']),
    })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it("offers no Retry where this panel never held the turn's card", () => {
    renderRows([failedTurn('t1')], {
      onRetryTurn: () => undefined,
      resendableTurnIds: new Set(['t2']),
    })
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('waits while a turn runs', () => {
    renderRows([failedTurn('t1')], {
      onRetryTurn: () => undefined,
      resendableTurnIds: new Set(['t1']),
      activeTurnId: 't2',
    })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled()
  })
})

describe('retry wait stop button', () => {
  it('offers Stop on a retry wait, which names the waiting turn', () => {
    const presses: [string, string][] = []
    renderRows([retryWait('t1')], {
      onStopRetry: (entryId, turnId) => {
        presses.push([entryId, turnId])
      },
    })
    const stop = screen.getByRole('button', { name: 'Stop' })
    fireEvent.click(stop)
    expect(presses).toEqual([['retry:t1', 't1']])
  })

  it('offers no Stop on a plain notice', () => {
    renderRows([retryWait(undefined)], {
      onStopRetry: () => undefined,
    })
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })
})
