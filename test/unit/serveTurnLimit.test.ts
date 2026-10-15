import { describe, expect, it } from 'vitest'
import { parseCommandLine } from '../../src/runtime/cliArgs'

// Lane TURNLIMIT: serve takes the sessions' per-turn tool-round limit from
// --max-turn-requests. Pure: the real parser, values passed in as data.
describe('serve --max-turn-requests', () => {
  it('takes a preset limit for new sessions', () => {
    const parsed = parseCommandLine(['--backend', 'modelApi', '--max-turn-requests', '50'])
    expect(parsed).toMatchObject({ command: 'serve', options: { maxTurnRequests: 50 } })
  })

  it('leaves the limit unset by default', () => {
    const parsed = parseCommandLine(['--backend', 'modelApi'])
    expect(parsed.command).toBe('serve')
    if (parsed.command !== 'serve') throw new Error('expected serve')
    expect(parsed.options.maxTurnRequests).toBeUndefined()
  })

  // Lane LIMITSFIX, F8: any whole number from 1 up is the person's own limit.
  it('takes a value that is not one of the suggested presets', () => {
    const parsed = parseCommandLine(['--backend', 'modelApi', '--max-turn-requests', '75'])
    expect(parsed).toMatchObject({ command: 'serve', options: { maxTurnRequests: 75 } })
  })

  it('refuses a value that is not a whole number of rounds', () => {
    for (const bad of ['0', '-1', '2.5', 'abc']) {
      expect(
        parseCommandLine(['--backend', 'modelApi', '--max-turn-requests', bad]).command,
        bad,
      ).toBe('invalid')
    }
  })

  it('refuses the flag on the Muse Code backend, naming the backend', () => {
    const parsed = parseCommandLine(['--max-turn-requests', '50'])
    expect(parsed.command).toBe('invalid')
    if (parsed.command !== 'invalid') throw new Error('expected invalid')
    expect(parsed.reason).toContain('--max-turn-requests')
    expect(parsed.reason).toContain('--backend modelApi')
  })
})
