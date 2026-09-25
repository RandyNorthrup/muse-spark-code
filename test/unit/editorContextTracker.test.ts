import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EditorContextTracker } from '../../src/host/editor/editorContextTracker'
import { EDITOR_CONTEXT_DEBOUNCE_MS } from '../../src/shared/constants'

const snapshot = {
  relativePath: 'src/a.ts',
  startLine: 1,
  endLine: 1,
  isEmpty: true,
  selectedText: undefined,
}

describe('EditorContextTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the latest snapshot at once and broadcasts the label after the quiet gap', () => {
    const broadcast = vi.fn()
    const tracker = new EditorContextTracker({ broadcast })
    tracker.update(() => snapshot)
    expect(tracker.active).toEqual(snapshot)
    expect(broadcast).not.toHaveBeenCalled()
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS)
    expect(broadcast).toHaveBeenCalledWith({
      relativePath: 'src/a.ts',
      startLine: 1,
      endLine: 1,
      isEmpty: true,
    })
  })

  it('coalesces a burst of selection changes into one broadcast of the last state', () => {
    const broadcast = vi.fn()
    const tracker = new EditorContextTracker({ broadcast })
    const step = EDITOR_CONTEXT_DEBOUNCE_MS / 3
    tracker.update(() => ({ ...snapshot, isEmpty: false, endLine: 2, selectedText: 'ab' }))
    vi.advanceTimersByTime(step)
    tracker.update(() => ({ ...snapshot, isEmpty: false, endLine: 3, selectedText: 'abc' }))
    vi.advanceTimersByTime(step)
    tracker.update(() => ({ ...snapshot, isEmpty: false, endLine: 4, selectedText: 'abcd' }))
    // The quiet gap restarts on every change: nothing yet at the first
    // update's deadline, one broadcast at the last update's deadline.
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS - step)
    expect(broadcast).not.toHaveBeenCalled()
    vi.advanceTimersByTime(step)
    expect(broadcast).toHaveBeenCalledTimes(1)
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ endLine: 4 }))
    expect(tracker.active?.selectedText).toBe('abcd')
  })

  // M39: selections change on every arrow key; the text is read once they settle.
  it('reads the editor once the selection settles, not on every change', () => {
    const broadcast = vi.fn()
    const tracker = new EditorContextTracker({ broadcast })
    const read = vi.fn(() => snapshot)
    for (let key = 0; key < 20; key += 1) {
      tracker.update(read)
    }
    expect(read).not.toHaveBeenCalled()
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS)
    expect(read).toHaveBeenCalledOnce()
    expect(broadcast).toHaveBeenCalledOnce()
  })

  it('does not repeat an unchanged label, and announces the editor going away', () => {
    const broadcast = vi.fn()
    const tracker = new EditorContextTracker({ broadcast })
    tracker.update(() => snapshot)
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS)
    tracker.update(() => ({ ...snapshot }))
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS)
    expect(broadcast).toHaveBeenCalledTimes(1)
    tracker.update(() => undefined)
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS)
    expect(broadcast).toHaveBeenLastCalledWith(undefined)
    expect(tracker.summary).toBeUndefined()
  })

  it('drops a pending broadcast on dispose', () => {
    const broadcast = vi.fn()
    const tracker = new EditorContextTracker({ broadcast })
    tracker.update(() => snapshot)
    tracker.dispose()
    vi.advanceTimersByTime(EDITOR_CONTEXT_DEBOUNCE_MS)
    expect(broadcast).not.toHaveBeenCalled()
  })
})
