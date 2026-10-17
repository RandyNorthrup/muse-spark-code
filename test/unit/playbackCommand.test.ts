import { describe, expect, it } from 'vitest'
import { parsePlaybackPrompt } from '../../src/shared/playbackCommand'

describe('/playback in the prompt (D203)', () => {
  it('runs bare, however padded', () => {
    expect(parsePlaybackPrompt('/playback')).toEqual({ kind: 'run' })
    expect(parsePlaybackPrompt('  /playback  ')).toEqual({ kind: 'run' })
  })

  it('is usage with anything after it, since a playback takes no arguments', () => {
    expect(parsePlaybackPrompt('/playback what do you think')).toEqual({ kind: 'usage' })
    expect(parsePlaybackPrompt('/playback   ')).toEqual({ kind: 'run' })
  })

  it('is any other text otherwise', () => {
    for (const text of ['/playbacks', '/playbackx', 'please /playback', '/play', '', '/compact']) {
      expect(parsePlaybackPrompt(text), text).toBeUndefined()
    }
  })
})
