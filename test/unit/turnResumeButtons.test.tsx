// @vitest-environment jsdom
// M88 lane C (PLAN.md D67, item 16): a failed turn at a limit offers its
// answer on the error row. A timed offer opens Resume later at its own
// minute; a spent budget offers the budget setting, then Continue;
// a far lift says when it lifts and offers no timer.
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Transcript } from '../../src/webview/components/Transcript'
import { UI_TEXT } from '../../src/shared/l10n/text'
import type { ErrorResumeOffer, TranscriptEntry } from '../../src/webview/state/transcriptEntries'

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
    onContinueTurn?: (entryId: string, turnId: string) => void
    onOpenBudgetSetting?: () => void
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
      onResumeLater={options?.onResumeLater}
      onContinueTurn={options?.onContinueTurn}
      onOpenBudgetSetting={options?.onOpenBudgetSetting}
      resendableTurnIds={options?.resendableTurnIds}
      activeTurnId={options?.activeTurnId}
    />,
  )
}

describe('turn resume buttons', () => {
  it('opens Resume later at the offer minute', () => {
    const presses: [string, string, number][] = []
    const defaultAtMs = Date.UTC(2026, 10, 1, 12, 2)
    renderRows([{ ...failedTurn({ kind: 'rateLimit', turnId: 't1', defaultAtMs }) }], {
      onResumeLater: (entryId, turnId, atMs) => {
        presses.push([entryId, turnId, atMs])
      },
    })
    const resume = screen.getByRole('button', { name: UI_TEXT.resumeLaterAction })
    expect(resume).not.toBeDisabled()
    fireEvent.click(resume)
    expect(presses).toEqual([['error:t1', 't1', defaultAtMs]])
  })

  it('offers the budget setting, then Continue, never a timer', () => {
    let settings = 0
    const presses: [string, string][] = []
    renderRows([{ ...failedTurn({ kind: 'budget', turnId: 't1' }) }], {
      onOpenBudgetSetting: () => {
        settings += 1
      },
      onContinueTurn: (entryId, turnId) => {
        presses.push([entryId, turnId])
      },
      resendableTurnIds: new Set(['t1']),
    })
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.budgetSettingAction }))
    expect(settings).toBe(1)
    const resume = screen.queryByRole('button', { name: UI_TEXT.resumeLaterAction })
    expect(resume).toBeNull()
    const continued = screen.getByRole('button', { name: UI_TEXT.fallbackContinue })
    expect(continued).not.toBeDisabled()
    fireEvent.click(continued)
    expect(presses).toEqual([['error:t1', 't1']])
  })

  it('holds Continue without the turn card and while a turn runs', () => {
    renderRows([{ ...failedTurn({ kind: 'budget', turnId: 't1' }) }], {
      onContinueTurn: () => undefined,
      onOpenBudgetSetting: () => undefined,
      resendableTurnIds: new Set(),
    })
    expect(screen.queryByRole('button', { name: UI_TEXT.fallbackContinue })).toBeNull()
    expect(screen.getByRole('button', { name: UI_TEXT.budgetSettingAction })).not.toBeNull()
  })

  it('says when the limit lifts instead of a timer past six days', () => {
    const liftsAtMs = Date.UTC(2026, 10, 8, 12, 0)
    renderRows([{ ...failedTurn({ kind: 'quota', turnId: 't1', liftsAtMs }) }], {
      onResumeLater: () => undefined,
    })
    expect(screen.queryByRole('button', { name: UI_TEXT.resumeLaterAction })).toBeNull()
    expect(screen.getByText(/lifts/i)).not.toBeNull()
  })

  it('offers nothing without an offer or a handler', () => {
    renderRows([failedTurn(undefined)], {
      onResumeLater: () => undefined,
      onContinueTurn: () => undefined,
      onOpenBudgetSetting: () => undefined,
    })
    expect(screen.queryByRole('button', { name: UI_TEXT.resumeLaterAction })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.budgetSettingAction })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.fallbackContinue })).toBeNull()
  })
})
