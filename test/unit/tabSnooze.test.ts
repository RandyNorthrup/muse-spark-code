import { describe, expect, it } from 'vitest'
import { TAB_SNOOZE_SHORT_MINUTES } from '../../src/shared/constants'
import { createTabSnooze, type TabSnoozeStore } from '../../src/host/tab/tabSnooze'

// M94 acceptance 15 (the snooze): a timed snooze covers every window
// through the shared store and ends on time; until-restart covers this
// window only.

function storeOf(shared: { end: number | undefined }): TabSnoozeStore {
  return {
    readSnoozedUntil: () => shared.end,
    writeSnoozedUntil: (endMs) => {
      shared.end = endMs
      return Promise.resolve()
    },
    nowMs: () => Date.now(),
  }
}

describe('createTabSnooze', () => {
  it('covers every window on the shared store until the minutes end', async () => {
    const shared = { end: undefined as number | undefined }
    const first = createTabSnooze(storeOf(shared))
    const second = createTabSnooze(storeOf(shared))
    const now = Date.now()
    await first.snoozeMinutes(TAB_SNOOZE_SHORT_MINUTES, now)
    expect(first.isSnoozed(now)).toBe(true)
    expect(second.isSnoozed(now)).toBe(true)
    expect(first.minutesLeft(now)).toBe(TAB_SNOOZE_SHORT_MINUTES)
    const end = now + TAB_SNOOZE_SHORT_MINUTES * 60_000
    expect(first.isSnoozed(end - 1)).toBe(true)
    expect(first.minutesLeft(end - 1)).toBe(1)
    expect(first.isSnoozed(end)).toBe(false)
    expect(second.isSnoozed(end)).toBe(false)
    expect(first.minutesLeft(end)).toBeUndefined()
  })

  it('covers only this window until restart', () => {
    const shared = { end: undefined as number | undefined }
    const first = createTabSnooze(storeOf(shared))
    const second = createTabSnooze(storeOf(shared))
    first.snoozeUntilRestart()
    expect(first.isSnoozed(Date.now())).toBe(true)
    expect(first.minutesLeft(Date.now())).toBeUndefined()
    expect(second.isSnoozed(Date.now())).toBe(false)
  })

  it('a timed snooze clears an until-restart one', async () => {
    const shared = { end: undefined as number | undefined }
    const snooze = createTabSnooze(storeOf(shared))
    snooze.snoozeUntilRestart()
    const now = Date.now()
    await snooze.snoozeMinutes(TAB_SNOOZE_SHORT_MINUTES, now)
    expect(snooze.minutesLeft(now)).toBe(TAB_SNOOZE_SHORT_MINUTES)
    expect(snooze.isSnoozed(now + TAB_SNOOZE_SHORT_MINUTES * 60_000)).toBe(false)
  })
})
