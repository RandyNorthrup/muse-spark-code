// F94 review: which exits count as the previous run having failed, so a
// replacement host can name the restart when its first turn loses the
// sign-in. The incident's exit was code 1 with a close already asked
// ("exited as asked"), so a failure code counts asked or not; a clean
// stop and an asked-for signal do not.
import { describe, expect, it } from 'vitest'
import { describeExit } from '../../src/core/backends/musecode/MuseCodeHost'

describe('describeExit isFailure', () => {
  it('counts a non-zero code as a failure, asked or not', () => {
    expect(describeExit({ code: 1, signal: null }, false).isFailure).toBe(true)
    expect(describeExit({ code: 1, signal: null }, true).isFailure).toBe(true)
    expect(describeExit({ code: 3, signal: null }, true).isFailure).toBe(true)
  })

  it('counts a clean stop and an asked-for signal as no failure', () => {
    expect(describeExit({ code: 0, signal: null }, true).isFailure).toBe(false)
    expect(describeExit({ code: 0, signal: null }, false).isFailure).toBe(false)
    expect(describeExit({ code: null, signal: 'SIGTERM' }, true).isFailure).toBe(false)
  })

  it('counts a signal nobody asked for as a failure', () => {
    expect(describeExit({ code: null, signal: 'SIGKILL' }, false).isFailure).toBe(true)
  })
})
