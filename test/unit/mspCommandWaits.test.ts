import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMAND_TIMEOUTS,
  HostLiveness,
  commandTimeoutMs,
} from '../../src/core/backends/musecode/MuseCodeHost'
import { stderrLogger } from '../../src/runtime/stderrLog'

const NOTICE_EVERY_MS = 100

/** Lands mid-way into the next notice period, clear of its edges. */
async function nextPeriod(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, NOTICE_EVERY_MS * 1.5))
}

describe('MSP command waits (NOLIMITS2 A19)', () => {
  it('names no deadline by default: a command waits until answered or stopped', () => {
    expect(DEFAULT_COMMAND_TIMEOUTS.normalMs).toBeUndefined()
    expect(DEFAULT_COMMAND_TIMEOUTS.longMs).toBeUndefined()
    expect(commandTimeoutMs('session/list', DEFAULT_COMMAND_TIMEOUTS)).toBeUndefined()
    expect(commandTimeoutMs('session/read', DEFAULT_COMMAND_TIMEOUTS)).toBeUndefined()
    expect(commandTimeoutMs('item/readOutput', DEFAULT_COMMAND_TIMEOUTS)).toBeUndefined()
  })

  it('keeps the long wait for whole-session loads when a wait is named', () => {
    const timeouts = { normalMs: 1000, longMs: 2000 }
    expect(commandTimeoutMs('session/list', timeouts)).toBe(1000)
    expect(commandTimeoutMs('session/read', timeouts)).toBe(2000)
    expect(commandTimeoutMs('item/readOutput', timeouts)).toBe(2000)
  })
})

describe('the unresponsive-host watchdog under concurrent waits (PR #214 review)', () => {
  it('counts a silent notice period once, however many commands wait in it', async () => {
    const lines: string[] = []
    let toldUnresponsive = 0
    const liveness = new HostLiveness(
      0,
      stderrLogger((line) => {
        lines.push(line)
      }, 'warn'),
      () => {
        toldUnresponsive += 1
      },
      NOTICE_EVERY_MS,
    )
    // Two long commands, each telling once a period, for two periods.
    for (let period = 0; period < 2; period += 1) {
      liveness.stillWaiting('session/read')
      liveness.stillWaiting('item/readOutput')
      await nextPeriod()
    }
    expect(liveness.isUnresponsive).toBe(false)
    expect(toldUnresponsive).toBe(0)
    // The third silent period is the third miss in a row.
    liveness.stillWaiting('session/read')
    expect(liveness.isUnresponsive).toBe(true)
    expect(toldUnresponsive).toBe(1)
    expect(lines.join(' ')).toContain('Muse Code is not answering')
  })
})
