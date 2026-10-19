// A `/loop` draft carries no end of ours: how long a schedule lives is the
// person's choice in the editor, so the parser must not stamp one in.
import { describe, expect, it } from 'vitest'
import { parseLoopPrompt } from '../../src/core/backends/modelapi/schedules'
import { createSchedulesBridge } from '../../src/host/schedules/schedulesBridge'
import { UI_TEXT } from '../../src/shared/constants'
import { schedulePromptAction, scheduleUnavailableReason } from '../../src/webview/schedules/prompt'

const nowMs = Date.parse('2026-10-17T12:00:00Z')

function defaultDraft() {
  const lines: string[] = []
  const record = (message: string) => {
    lines.push(message)
  }
  const bridge = createSchedulesBridge({
    distDir: '/dist',
    log: { trace: record, info: record, warn: record, error: record },
    isEnabled: () => true,
    defaultDelivery: () => 'whenIdle',
  })
  return bridge.defaultDraft(nowMs, undefined, 'modelApi')
}

describe('/loop schedule draft', () => {
  it('opens the editor with no end stamped in', () => {
    const action = schedulePromptAction(
      '/loop 10m Review the build',
      'workspace',
      defaultDraft(),
      nowMs,
      parseLoopPrompt,
    )
    expect(action?.kind).toBe('open')
    if (action?.kind !== 'open') return
    expect(action.draft?.action).toEqual({ kind: 'prompt', prompt: 'Review the build' })
    expect(action.draft?.end).toBeUndefined()
  })

  it("keeps an end the person's draft already carries", () => {
    const action = schedulePromptAction(
      '/loop 10m Review the build',
      'workspace',
      { ...defaultDraft(), end: { afterRuns: 2 } },
      nowMs,
      parseLoopPrompt,
    )
    expect(action?.kind).toBe('open')
    if (action?.kind !== 'open') return
    expect(action.draft?.end).toEqual({ afterRuns: 2 })
  })
})

describe('/schedule refusal', () => {
  it('refuses with the live schedule words while the runtime is unbound', () => {
    // The lazy prompt module reads the installed table at call time, so a
    // changed translation reaches the refusal without touching this module.
    expect(scheduleUnavailableReason()).toBe(UI_TEXT.scheduleV2.runtime.unavailable)
  })
})
