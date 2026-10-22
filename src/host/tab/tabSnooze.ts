// Tab's snooze (M94, PLAN.md D73): timed across every window through the
// extension-private global state, or until restart in this window. The
// status bar shows it and the provider stays quiet under it. Pure: no
// `vscode` import.

const MS_PER_MINUTE = 60_000

/** The snooze the status bar keeps and the provider reads. */
export interface TabSnooze {
  /** True while a timed or until-restart snooze covers now. */
  isSnoozed(nowMs: number): boolean
  /** Whole minutes left, for the status text. */
  minutesLeft(nowMs: number): number | undefined
  /** Snooze every window until `nowMs + minutes`, kept in global state. */
  snoozeMinutes(minutes: number, nowMs: number): Promise<void>
  /** Snooze this window until it closes. */
  snoozeUntilRestart(): void
}

/** The snooze's store: the global-state end plus the clock. */
export interface TabSnoozeStore {
  /** The timed snooze's end the global state keeps, if it parses. */
  readSnoozedUntil(): number | undefined
  writeSnoozedUntil(endMs: number | undefined): Promise<void>
  nowMs(): number
}

/** The snooze: timed across every window, or until restart in this one. */
export function createTabSnooze(store: TabSnoozeStore): TabSnooze {
  let isUntilRestart = false
  return {
    isSnoozed: (nowMs) => isUntilRestart || (store.readSnoozedUntil() ?? 0) > nowMs,
    minutesLeft: (nowMs) => {
      if (isUntilRestart) {
        return
      }
      const end = store.readSnoozedUntil()
      return end === undefined || end <= nowMs
        ? undefined
        : Math.max(1, Math.ceil((end - nowMs) / MS_PER_MINUTE))
    },
    snoozeMinutes: async (minutes, nowMs) => {
      isUntilRestart = false
      await store.writeSnoozedUntil(nowMs + minutes * MS_PER_MINUTE)
    },
    snoozeUntilRestart: () => {
      isUntilRestart = true
    },
  }
}
