import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSchedulesBridge } from '../../src/host/schedules/schedulesBridge'
import { UI_TEXT } from '../../src/shared/constants'

const { load } = vi.hoisted(() => ({
  load: vi.fn(() => Promise.reject(new Error('uncertified delivery must not load'))),
}))
vi.mock('../../src/runtime/schedules/binding', () => ({
  runtimeSchedulesBinding: () => load,
}))
beforeEach(() => vi.clearAllMocks())

describe('schedule workspace registration guard', () => {
  it.each([true, false])(
    'does not watch without certified delivery, enabled=%s',
    async (enabled) => {
      const bridge = createSchedulesBridge({
        distDir: '/dist',
        log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        isEnabled: () => enabled,
        defaultDelivery: () => 'whenIdle',
      })
      await expect(bridge.holdWorkspace('/workspace')).rejects.toThrow(
        UI_TEXT.scheduleV2.runtime.unavailable,
      )
      expect(load).not.toHaveBeenCalled()
    },
  )
})
