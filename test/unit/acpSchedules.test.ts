import { describe, expect, it, vi } from 'vitest'
import { acpSchedules } from '../../src/acp/schedules'
import type { ScheduleControlPort } from '../../src/runtime/schedules/command'
import { UI_TEXT } from '../../src/shared/constants'
import { workspaceKey } from '../../src/runtime/dataFolder'

describe('ACP schedule adapter', () => {
  it.each(['museCode', 'modelApi'] as const)(
    'uses the shared control on %s without a model turn',
    async (backend) => {
      const control: ScheduleControlPort = {
        request: vi.fn().mockResolvedValue({ kind: 'list', schedules: [] }),
        runDue: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      }
      const load = vi.fn().mockResolvedValue(control)
      const port = acpSchedules(load)
      const context = { cwd: '/workspace', sessionId: 'session-1', backend }
      expect(await port.run('/schedule', context)).toBe(UI_TEXT.scheduleV2.runtime.empty)
      expect(load).toHaveBeenCalledWith(context)
      expect(control.request).toHaveBeenCalledWith({
        method: 'schedules/list',
        workspaceKey: workspaceKey(context.cwd),
      })
      expect(control.runDue).not.toHaveBeenCalled()
    },
  )
  it('keeps a JSON prompt intact and refuses cross-workspace and run-due commands', async () => {
    const control: ScheduleControlPort = {
      request: vi.fn().mockResolvedValue({ kind: 'accepted' }),
      runDue: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const load = vi.fn().mockResolvedValue(control)
    const port = acpSchedules(load)
    const context = { cwd: '/workspace', sessionId: 'session-1', backend: 'modelApi' as const }
    for (const text of [
      '/schedule list --cwd /other',
      '/schedule run-due',
      '/schedule remove',
      '/schedule background on',
    ])
      expect(await port.run(text, context)).toBe(UI_TEXT.scheduleV2.runtime.usage)
    expect(load).not.toHaveBeenCalled()
    expect(await port.run('/schedule add {"prompt":"quoted text and 日本語"}', context)).toBe(
      UI_TEXT.scheduleV2.runtime.invalidRequest,
    )
    expect(control.request).not.toHaveBeenCalled()
  })
})
