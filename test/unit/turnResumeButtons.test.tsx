// @vitest-environment jsdom
// M88 lane C (PLAN.md D67, item 16): a failed turn at a limit offers its
// answer on the error row. A timed offer opens Resume later at its own
// minute; a spent budget offers the budget setting, then Continue;
// a far lift says when it lifts and offers no timer.
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/l10n/text'
import { failedTurnWithResume, renderTranscriptRows } from './helpers/transcriptRows'

describe('turn resume buttons', () => {
  it('opens Resume later at the offer minute', () => {
    const presses: [string, string, number][] = []
    const defaultAtMs = Date.UTC(2026, 10, 1, 12, 2)
    renderTranscriptRows(
      [{ ...failedTurnWithResume({ kind: 'rateLimit', turnId: 't1', defaultAtMs }) }],
      {
        onResumeLater: (entryId, turnId, atMs) => {
          presses.push([entryId, turnId, atMs])
        },
      },
    )
    const resume = screen.getByRole('button', { name: UI_TEXT.resumeLaterAction })
    expect(resume).not.toBeDisabled()
    fireEvent.click(resume)
    expect(presses).toEqual([['error:t1', 't1', defaultAtMs]])
  })

  it('offers the budget setting, then Continue, never a timer', () => {
    let settings = 0
    const presses: [string, string][] = []
    renderTranscriptRows([{ ...failedTurnWithResume({ kind: 'budget', turnId: 't1' }) }], {
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
    renderTranscriptRows([{ ...failedTurnWithResume({ kind: 'budget', turnId: 't1' }) }], {
      onContinueTurn: () => undefined,
      onOpenBudgetSetting: () => undefined,
      resendableTurnIds: new Set(),
    })
    expect(screen.queryByRole('button', { name: UI_TEXT.fallbackContinue })).toBeNull()
    expect(screen.getByRole('button', { name: UI_TEXT.budgetSettingAction })).not.toBeNull()
  })

  it('says when the limit lifts instead of a timer past six days', () => {
    const liftsAtMs = Date.UTC(2026, 10, 8, 12, 0)
    renderTranscriptRows(
      [{ ...failedTurnWithResume({ kind: 'quota', turnId: 't1', liftsAtMs }) }],
      {
        onResumeLater: () => undefined,
      },
    )
    expect(screen.queryByRole('button', { name: UI_TEXT.resumeLaterAction })).toBeNull()
    expect(screen.getByText(/lifts/i)).not.toBeNull()
  })

  it('offers nothing without an offer or a handler', () => {
    renderTranscriptRows([failedTurnWithResume(undefined)], {
      onResumeLater: () => undefined,
      onContinueTurn: () => undefined,
      onOpenBudgetSetting: () => undefined,
    })
    expect(screen.queryByRole('button', { name: UI_TEXT.resumeLaterAction })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.budgetSettingAction })).toBeNull()
    expect(screen.queryByRole('button', { name: UI_TEXT.fallbackContinue })).toBeNull()
  })
})
