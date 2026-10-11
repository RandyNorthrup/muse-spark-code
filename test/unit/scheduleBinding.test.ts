import { describe, expect, it, vi } from 'vitest'
import {
  runtimeSchedulesBinding,
  type RuntimeSchedulesBinding,
} from '../../src/runtime/schedules/binding'
import { UI_TEXT } from '../../src/shared/constants'
import { uiLocale } from '../../src/shared/l10n/text'

describe('lazy runtime schedule binding', () => {
  it('loads once on use and installs the caller table before creating the runtime', async () => {
    const binding: RuntimeSchedulesBinding = {
      command: vi.fn(),
      run: vi.fn(),
      holdWorkspace: vi.fn(),
      message: vi.fn(),
      close: vi.fn(),
    }
    const factory = vi.fn().mockResolvedValue(binding)
    const requireBundle = vi.fn().mockReturnValue({ createRuntimeSchedules: factory })
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const load = runtimeSchedulesBinding('/dist/schedules.js', log, requireBundle)
    expect(requireBundle).not.toHaveBeenCalled()
    expect(await Promise.all([load(), load()])).toEqual([binding, binding])
    expect(factory).toHaveBeenCalledOnce()
    expect(factory).toHaveBeenCalledWith(UI_TEXT, uiLocale())
    expect(requireBundle).toHaveBeenCalledOnce()
  })
  it('rejects a missing factory and retries a failed engine creation', async () => {
    const log = { trace: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const factory = vi
      .fn()
      .mockRejectedValueOnce(new Error('Unavailable binding'))
      .mockResolvedValue('recovered')
    const requireBundle = vi
      .fn()
      .mockReturnValueOnce({ createRuntimeSchedules: true })
      .mockReturnValue({ createRuntimeSchedules: factory })
    const load = runtimeSchedulesBinding('/dist/schedules.js', log, requireBundle)
    await expect(load()).rejects.toThrow(UI_TEXT.scheduleV2.runtime.unavailable)
    await expect(load()).rejects.toThrow('Unavailable binding')
    expect(await load()).toBe('recovered')
    expect(factory).toHaveBeenCalledTimes(2)
  })
})
