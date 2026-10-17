// The lazy runtime schedule binding through the real loader: a bundle file
// that is not on disk refuses with the unavailable words, and the refusal is
// not cached as a success, so the next call tries the real load again.
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runtimeSchedulesBinding } from '../../src/runtime/schedules/binding'
import { UI_TEXT } from '../../src/shared/constants'

describe('lazy runtime schedule binding', () => {
  it('refuses a missing bundle and retries on the next call', async () => {
    const lines: string[] = []
    const record = (message: string) => {
      lines.push(message)
    }
    const load = runtimeSchedulesBinding(path.join('/no-such-dist-folder', 'schedules.js'), {
      trace: record,
      info: record,
      warn: record,
      error: record,
    })
    await expect(load()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
    await expect(load()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
  })
})
