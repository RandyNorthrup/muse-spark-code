// The team's load guard reads the machine as it is, and a person who is refused gets words.
// macOS's free pages leave out all it can reclaim, so a healthy Mac read as short of memory and every
// team agent there was refused with the bare code TEAM_HOST_BUSY (run 41723994114, macOS shard 7).
import { describe, expect, it } from 'vitest'
import { TEAM_LOAD_FREE_MEMORY_MIN, TEAM_PROCESS_MODEL_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { createLoadGuard, machineFreeMemory } from '../../src/host/team/loadGuard'
import { launchFailureInWords } from '../../src/host/team/teamProcessWorkers'

function isBusyReading(memory: number | undefined): boolean {
  const guard = createLoadGuard({
    sampleMs: 60_000,
    cpuHigh: 1,
    windowMs: 60_000,
    freeMemoryMin: TEAM_LOAD_FREE_MEMORY_MIN,
    now: () => 0,
    readFreeMemory: () => memory,
    changed: () => undefined,
  })
  guard.sample()
  return guard.isHostBusy()
}

describe('the team load guard’s memory', () => {
  it('is busy only on a reading below its limit, and an unknown reading is no pressure', () => {
    expect(isBusyReading(TEAM_LOAD_FREE_MEMORY_MIN - 1)).toBe(true)
    expect(isBusyReading(TEAM_LOAD_FREE_MEMORY_MIN)).toBe(false)
    expect(isBusyReading(undefined)).toBe(false)
  })

  it('never reads macOS’s free pages: its headroom from libuv 1.52, unknown before', () => {
    expect(machineFreeMemory('darwin', '1.51.0')).toBeUndefined()
    expect(machineFreeMemory('darwin', '1.52.0')).toBeGreaterThan(0)
    expect(machineFreeMemory('darwin', '2.0.0')).toBeGreaterThan(0)
  })

  it('reads the system’s own figure elsewhere', () => {
    expect(machineFreeMemory('linux', '1.51.0')).toBeGreaterThan(0)
    expect(machineFreeMemory('win32', '1.51.0')).toBeGreaterThan(0)
  })
})

describe('a team process that did not start', () => {
  it('says the host is busy in words, keeping the code as its cause', () => {
    const code = new Error('TEAM_HOST_BUSY')
    const told = launchFailureInWords(code)
    expect(told).toHaveProperty('message', TEAM_PROCESS_MODEL_TEXT.hostBusy)
    expect(told).toHaveProperty('cause', code)
  })

  it('never hands a person another of the lifetime’s bare codes', () => {
    expect(launchFailureInWords(new Error('TEAM_SCOPE_NOT_READY'))).toHaveProperty(
      'message',
      fill(TEAM_PROCESS_MODEL_TEXT.hostLaunchFailed, { code: 'TEAM_SCOPE_NOT_READY' }),
    )
  })

  it('leaves a failure that is already a sentence, or no error at all, as it was', () => {
    const sentence = new Error('The file could not be read.')
    expect(launchFailureInWords(sentence)).toBe(sentence)
    expect(launchFailureInWords('TEAM_HOST_BUSY')).toBe('TEAM_HOST_BUSY')
  })
})
