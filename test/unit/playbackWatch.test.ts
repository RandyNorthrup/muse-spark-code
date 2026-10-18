import { describe, expect, it } from 'vitest'
import { PlaybackWatch } from '../../src/core/playback/playbackWatch'

describe('the watch on a Plan-held playback turn (D203)', () => {
  it('stops a turn that reached for a tool before its acknowledgement named it', () => {
    const watch = new PlaybackWatch()
    watch.arm()
    // Muse Code's turn/start and the turn's items can beat the command's answer.
    expect(watch.sawTool('turn-other')).toBe(false)
    expect(watch.sawTool('turn-playback')).toBe(false)
    expect(watch.bind('turn-playback')).toBe(true)
    // Stopped once: the turn's later tool items ask for nothing more.
    expect(watch.sawTool('turn-playback')).toBe(false)
    expect(watch.isWatching('turn-playback')).toBe(true)
  })

  it('stops the watched turn at its first tool item only, and nothing once it ended', () => {
    const watch = new PlaybackWatch()
    watch.arm()
    expect(watch.sawTool('turn-earlier')).toBe(false)
    expect(watch.bind('turn-playback')).toBe(false)
    expect(watch.sawTool('turn-earlier')).toBe(false)
    expect(watch.sawTool('turn-playback')).toBe(true)
    expect(watch.sawTool('turn-playback')).toBe(false)
    watch.clear()
    expect(watch.isWatching('turn-playback')).toBe(false)
    // A watch never armed, or cleared, stops nothing.
    expect(watch.sawTool('turn-playback')).toBe(false)
  })
})
