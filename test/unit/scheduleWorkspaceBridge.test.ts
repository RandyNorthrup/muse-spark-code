// The VS Code schedules bridge through its real code only: with no certified
// delivery installed, holding a workspace and sending panel messages refuse
// before any bundle loads, and the default draft is a valid schedule draft.
import { describe, expect, it } from 'vitest'
import {
  createSchedulesBridge,
  scheduleWindowWorkspace,
} from '../../src/host/schedules/schedulesBridge'
import { UI_TEXT } from '../../src/shared/constants'
import { scheduleDraftSchema } from '../../src/shared/scheduleV2'

function idleBridge(isEnabled = true) {
  const lines: string[] = []
  const record = (message: string) => {
    lines.push(message)
  }
  return createSchedulesBridge({
    distDir: '/dist',
    log: { trace: record, info: record, warn: record, error: record },
    isEnabled: () => isEnabled,
    defaultDelivery: () => 'whenIdle',
  })
}

function recordingLog() {
  const lines: string[] = []
  const record = (message: string) => {
    lines.push(message)
  }
  return { trace: record, info: record, warn: record, error: record }
}

describe('schedule workspace bridge without certified delivery', () => {
  it('uses a valid new-conversation draft when there is no active conversation', () => {
    const bridge = idleBridge()
    expect(
      scheduleDraftSchema.safeParse(bridge.defaultDraft(Date.now(), undefined, 'modelApi')).success,
    ).toBe(true)
    expect(bridge.defaultDraft(Date.now(), undefined, 'modelApi').paidCapUsd).toBe('0')
  })

  it.each([true, false])(
    'does not hold a workspace without certified delivery, enabled=%s',
    async (enabled) => {
      const bridge = idleBridge(enabled)
      expect(bridge.isDeliveryEnabled()).toBe(false)
      await expect(bridge.holdWorkspace('/workspace')).rejects.toThrow(
        UI_TEXT.scheduleV2.runtime.unavailable,
      )
    },
  )

  it('refuses panel messages while schedules are disabled', async () => {
    const bridge = idleBridge(false)
    await expect(bridge.message({}, '/workspace')).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.unavailable,
    )
  })

  it('refuses panel messages after close without loading the bundle', async () => {
    const bridge = idleBridge()
    await bridge.close()
    await expect(bridge.message({}, '/workspace')).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.unavailable,
    )
  })

  it('a window workspace over the real bridge refreshes and disposes without holding', async () => {
    const bridge = idleBridge()
    const window = scheduleWindowWorkspace(bridge, '/workspace', () => true, recordingLog())
    window.refresh()
    window.refresh()
    window.dispose()
    window.refresh()
    await bridge.close()
  })
})
