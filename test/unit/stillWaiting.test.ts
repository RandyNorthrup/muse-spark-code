import { describe, expect, it } from 'vitest'
import { TIMER_MAX_DELAY_MS } from '../../src/shared/constants'
import {
  setLongTimeout,
  startStillWaiting,
  stillWaitingSubjectText,
  stillWaitingText,
} from '../../src/core/timeouts'

describe('stillWaitingText (NOLIMITS2)', () => {
  it('names what waits and how long, ending with Stop', () => {
    const text = stillWaitingText({ key: 'mcpServerStartup', name: 's' }, 125_000)
    expect(text).toContain('MCP server "s" startup')
    expect(text).toContain('Stop ends it.')
  })
})

describe('stillWaitingSubjectText (PR #214 review)', () => {
  it('reads every subject from the translated table, never English prose', () => {
    expect(stillWaitingSubjectText({ key: 'imageRequest' })).toBe('the image request')
    expect(stillWaitingSubjectText({ key: 'providerAnswer' })).toBe('the provider answer')
    expect(stillWaitingSubjectText({ key: 'modelReply' })).toBe('the model reply')
    expect(stillWaitingSubjectText({ key: 'sessionDeletion' })).toBe('session deletion')
    expect(stillWaitingSubjectText({ key: 'shellCommand' })).toBe('the shell command')
    expect(stillWaitingSubjectText({ key: 'museServeStarting' })).toBe('muse serve starting')
    expect(stillWaitingSubjectText({ key: 'mcpServerStartup', name: 's' })).toBe(
      'MCP server "s" startup',
    )
    expect(
      stillWaitingSubjectText({ key: 'mcpServerRequest', name: 's', method: 'tools/list' }),
    ).toBe('MCP server "s" tools/list')
    expect(stillWaitingSubjectText({ key: 'museCodeCommand', method: 'session/read' })).toBe(
      'Muse Code session/read',
    )
  })
})

describe('startStillWaiting (NOLIMITS2)', () => {
  it('tells repeatedly with growing elapsed time until stopped', async () => {
    const seen: number[] = []
    const stop = startStillWaiting((elapsedMs) => {
      seen.push(elapsedMs)
    }, 10)
    await new Promise((resolve) => setTimeout(resolve, 45))
    stop()
    expect(seen.length).toBeGreaterThanOrEqual(2)
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]!).toBeGreaterThan(seen[index - 1]!)
    }
    const count = seen.length
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(seen.length).toBe(count)
  })
})

describe('setLongTimeout (PR #214 review)', () => {
  it('holds a delay past one timer range instead of firing at once', async () => {
    let hasFired = false
    const cancel = setLongTimeout(() => {
      hasFired = true
    }, TIMER_MAX_DELAY_MS + 1)
    // One plain timer would have fired after 1 ms here.
    await new Promise((resolve) => setTimeout(resolve, 50))
    cancel()
    expect(hasFired).toBe(false)
  })

  it('fires a short delay on time, and not after a cancel', async () => {
    const fired: string[] = []
    setLongTimeout(() => {
      fired.push('kept')
    }, 10)
    const cancel = setLongTimeout(() => {
      fired.push('cancelled')
    }, 10)
    cancel()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(fired).toEqual(['kept'])
  })
})
