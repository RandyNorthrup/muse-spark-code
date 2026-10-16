import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMAND_TIMEOUTS,
  commandTimeoutMs,
} from '../../src/core/backends/musecode/MuseCodeHost'

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
