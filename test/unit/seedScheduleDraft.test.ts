// M88 lane C (D67 item 15): Schedule This Prompt seeds the opening
// schedule editor with the composer's own draft. An explicit
// `/schedule add` stash wins; a blank draft seeds nothing.
import { describe, expect, it } from 'vitest'
import type { ScheduleDraft } from '../../src/shared/scheduleV2'
import { seedScheduleDraft } from '../../src/webview/schedules/seedDraft'
import { testScheduleBridge } from './helpers/schedules/scheduleTestRig'

function draft(): ScheduleDraft {
  const bridge = testScheduleBridge(import.meta.dirname)
  return bridge.defaultDraft(Date.now(), undefined, 'modelApi')
}

describe('seedScheduleDraft', () => {
  it('seeds the composer draft when nothing else pre-fills the editor', () => {
    const seeded = seedScheduleDraft(draft(), undefined, 'Ship the cache shard')
    expect(seeded.action).toEqual({ kind: 'prompt', prompt: 'Ship the cache shard' })
  })

  it('keeps an explicit schedule stash ahead of the composer draft', () => {
    const seeded = seedScheduleDraft(draft(), 'Stashed prompt', 'Composer draft')
    expect(seeded.action).toEqual({ kind: 'prompt', prompt: 'Stashed prompt' })
  })

  it('leaves the draft alone without a stash and a blank composer', () => {
    const plain = draft()
    expect(seedScheduleDraft(plain, undefined, undefined)).toBe(plain)
    expect(seedScheduleDraft(plain, undefined, ' '.repeat(3))).toBe(plain)
  })
})
