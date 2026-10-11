import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createSchedulesBridge } from '../../src/host/schedules/schedulesBridge'
import { UI_TEXT } from '../../src/shared/constants'
import type { RuntimeSchedulesBinding } from '../../src/runtime/schedules/binding'
import { scheduleDraftSchema } from '../../src/shared/scheduleV2'

const { load } = vi.hoisted(() => ({
  load: vi.fn<() => Promise<RuntimeSchedulesBinding>>(() =>
    Promise.reject(new Error('uncertified delivery must not load')),
  ),
}))
vi.mock('../../src/runtime/schedules/binding', () => ({
  runtimeSchedulesBinding: () => load,
}))
beforeEach(() => vi.clearAllMocks())

function idleBridge(isEnabled = true) {
  return createSchedulesBridge({
    distDir: '/dist',
    log: { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    isEnabled: () => isEnabled,
    defaultDelivery: () => 'whenIdle',
  })
}

describe('schedule workspace registration guard', () => {
  it('uses a valid new-conversation draft when there is no active conversation', () => {
    const bridge = idleBridge()
    expect(
      scheduleDraftSchema.safeParse(bridge.defaultDraft(Date.now(), undefined, 'modelApi')).success,
    ).toBe(true)
    expect(bridge.defaultDraft(Date.now(), undefined, 'modelApi').paidCapUsd).toBe('0')
  })

  it('retires a late bundle acquisition after close and refuses a later request', async () => {
    const acquired = Promise.withResolvers<RuntimeSchedulesBinding>()
    load.mockImplementationOnce(() => acquired.promise)
    const close = vi.fn(() => Promise.resolve())
    const message = vi.fn(() => Promise.resolve({}))
    const bridge = idleBridge()
    const request = bridge.message({}, '/workspace')
    const rejected = expect(request).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
    await bridge.close()
    acquired.resolve({
      close,
      message,
      run: () => Promise.resolve(''),
      command: () => Promise.resolve({ exitCode: 0, output: '' }),
      holdWorkspace: () => Promise.resolve(() => Promise.resolve()),
    })
    await rejected
    expect(close).toHaveBeenCalledOnce()
    expect(message).not.toHaveBeenCalled()
    await expect(bridge.message({}, '/workspace')).rejects.toThrow()
    expect(load).toHaveBeenCalledOnce()
  })
  it.each([true, false])(
    'does not watch without certified delivery, enabled=%s',
    async (enabled) => {
      const bridge = idleBridge(enabled)
      await expect(bridge.holdWorkspace('/workspace')).rejects.toThrow(
        UI_TEXT.scheduleV2.runtime.unavailable,
      )
      expect(load).not.toHaveBeenCalled()
    },
  )
})
