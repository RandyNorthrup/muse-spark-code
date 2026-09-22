import { describe, expect, it } from 'vitest'
import { DICTATION_HOLD_MS } from '../../src/shared/constants'
import { pressAction, releaseAction } from '../../src/webview/dictationGesture'

describe('dictation gesture', () => {
  it('a press starts from idle, stops while starting or listening, and is inert when unavailable', () => {
    expect(pressAction('idle')).toBe('start')
    expect(pressAction('starting')).toBe('stop')
    expect(pressAction('listening')).toBe('stop')
    expect(pressAction('unavailable')).toBeUndefined()
  })

  it('releasing a held press stops; releasing a tap keeps recording', () => {
    const press = { at: 1000, action: 'start' } as const
    expect(releaseAction(press, 1000 + DICTATION_HOLD_MS - 1)).toBeUndefined()
    expect(releaseAction(press, 1000 + DICTATION_HOLD_MS)).toBe('stop')
  })

  it('a release without a press, or after a press that stopped, does nothing', () => {
    expect(releaseAction(undefined, 5000)).toBeUndefined()
    expect(releaseAction({ at: 0, action: 'stop' }, 5000)).toBeUndefined()
  })
})
