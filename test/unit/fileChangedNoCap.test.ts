// NOLIMITS4 B15: FileChanged has no per-minute drop. Every change past the quiet
// window fires, however many ran in the minute; only a repeat of the same
// path inside the quiet window is debounced. Pure: explicit timestamps.
import { describe, expect, it } from 'vitest'
import { createFileChangedThrottle } from '../../src/core/backends/modelapi/extensionHooks'
import { HOOK_FILE_CHANGED_DEBOUNCE_MS } from '../../src/shared/constants'

describe('createFileChangedThrottle without a per-minute cap', () => {
  it('fires more than the old thirty runs in one minute', () => {
    const throttle = createFileChangedThrottle()
    for (let index = 0; index < 45; index += 1) {
      expect(throttle.check(`src/file-${String(index)}.ts`, index)).toBe('fire')
    }
  })

  it('debounces the same path inside the quiet window, fires past it', () => {
    const throttle = createFileChangedThrottle()
    expect(throttle.check('src/a.ts', 0)).toBe('fire')
    expect(throttle.check('src/a.ts', HOOK_FILE_CHANGED_DEBOUNCE_MS - 1)).toBe('debounced')
    expect(throttle.check('src/a.ts', HOOK_FILE_CHANGED_DEBOUNCE_MS)).toBe('fire')
  })
})
