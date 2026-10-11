import { describe, expect, it, vi } from 'vitest'
import { acpSchedules } from '../../src/acp/schedules'
import { fakeRuntimeScheduleControl } from './helpers/schedules/runtimeFixtures'
import { UI_TEXT } from '../../src/shared/constants'
import { workspaceKey } from '../../src/runtime/dataFolder'

describe('ACP schedule adapter', () => {
  it('returns the accepted id together with a cleanup warning after removal commits', async () => {
    const control = fakeRuntimeScheduleControl({ kind: 'accepted', id: 'committed-1' })
    control.close.mockRejectedValue(new Error('private cleanup detail'))
    const port = acpSchedules(() => Promise.resolve(control))
    const result = await port.run('/schedule remove committed-1', {
      cwd: '/workspace',
      sessionId: 'session-1',
      backend: 'modelApi',
    })
    expect(result).toBe(
      `${UI_TEXT.scheduleV2.runtime.accepted}: committed-1\n${UI_TEXT.scheduleV2.runtime.cleanupFailed}`,
    )
    expect(result).not.toContain('private cleanup detail')
    expect(control.request).toHaveBeenCalledOnce()
    expect(control.close).toHaveBeenCalledOnce()
  })
  it.each(['museCode', 'modelApi'] as const)(
    'uses the shared control on %s without a model turn',
    async (backend) => {
      const control = fakeRuntimeScheduleControl()
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
    const control = fakeRuntimeScheduleControl({ kind: 'accepted' })
    const load = vi.fn().mockResolvedValue(control)
    const port = acpSchedules(load)
    const context = { cwd: '/workspace', sessionId: 'session-1', backend: 'modelApi' as const }
    for (const text of [
      '/schedule list --cwd /other',
      '/schedule run-due',
      '/schedule background-maintain',
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
