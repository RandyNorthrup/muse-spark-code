import { describe, expect, it, vi } from 'vitest'
import { registerScheduleCommands } from '../../src/host/schedules/schedulesBridge'
import { COMMAND_IDS, UI_TEXT } from '../../src/shared/constants'

function fixture() {
  const actions = new Map<string, () => Promise<void>>()
  const surface = { id: 'panel' }
  const state: { active: typeof surface | undefined; ready: boolean; enabled: boolean } = {
    active: surface,
    ready: true,
    enabled: true,
  }
  const open = vi.fn(() => Promise.resolve())
  const openConversation = vi.fn(() => Promise.resolve())
  const disposable = { dispose: vi.fn() }
  const bridge = registerScheduleCommands({
    register: (id, action) => {
      actions.set(id, action)
      return disposable
    },
    active: () => state.active,
    isReady: () => state.ready,
    isEnabled: () => state.enabled,
    openConversation,
    open,
  })
  const run = async (id: string) => {
    const action = actions.get(id)
    if (action === undefined) throw new Error('missing command')
    await action()
  }
  return { actions, surface, state, open, openConversation, bridge, run }
}

describe('M115 activation commands', () => {
  it.each([
    [COMMAND_IDS.schedulePrompt, 'editor'],
    [COMMAND_IDS.showSchedules, 'list'],
    [COMMAND_IDS.showScheduleTimeline, 'timeline'],
  ] as const)('registers %s and opens its exact view after readiness', async (id, view) => {
    const f = fixture()
    expect(f.actions.size).toBe(3)
    expect(f.open).not.toHaveBeenCalled()
    await f.run(id)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(f.surface, view)
    expect(f.openConversation).not.toHaveBeenCalled()
  })
  it('opens a cold conversation and delivers once after its handshake', async () => {
    const f = fixture()
    f.state.active = undefined
    await f.run(COMMAND_IDS.schedulePrompt)
    expect(f.openConversation).toHaveBeenCalledOnce()
    expect(f.open).not.toHaveBeenCalled()
    await f.bridge.ready(f.surface)
    await f.bridge.ready(f.surface)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(f.surface, 'editor')
  })
  it('holds a mounted panel command until that exact panel is ready', async () => {
    const f = fixture()
    f.state.ready = false
    await f.run(COMMAND_IDS.showScheduleTimeline)
    await f.bridge.ready({ id: 'other-panel' })
    expect(f.open).not.toHaveBeenCalled()
    await f.bridge.ready(f.surface)
    expect(f.open).toHaveBeenCalledExactlyOnceWith(f.surface, 'timeline')
  })
  it('refuses disabled schedules before opening and rechecks pending consent', async () => {
    const f = fixture()
    f.state.ready = false
    await f.run(COMMAND_IDS.showSchedules)
    f.state.enabled = false
    await f.bridge.ready(f.surface)
    await expect(f.run(COMMAND_IDS.schedulePrompt)).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.unavailable,
    )
    expect(f.open).not.toHaveBeenCalled()
    expect(f.openConversation).not.toHaveBeenCalled()
  })
  it('does not retain a cold command after opening fails', async () => {
    const f = fixture()
    f.state.active = undefined
    f.openConversation.mockRejectedValueOnce(new Error('closed'))
    await expect(f.run(COMMAND_IDS.showSchedules)).rejects.toThrow('closed')
    await f.bridge.ready(f.surface)
    expect(f.open).not.toHaveBeenCalled()
  })
})
