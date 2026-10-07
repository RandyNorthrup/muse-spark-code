import {
  BackgroundNotifier,
  notifyOpenQuestions,
} from '../../src/host/conversation/turnNotifications'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { describe, expect, it, vi } from 'vitest'
import { registryHarness } from './helpers/questions/registry'

async function setup() {
  const t = registryHarness()
  await t.register()
  await t.registry.defer('q-1')
  return t
}

describe('bounded question reminders', () => {
  it('expands at most one card per turn and twice per question without a model call', async () => {
    const t = await setup()
    await t.register('q-2', 0, false, 'Another question?')
    await t.registry.defer('q-2')
    const reminder1 = await t.registry.endTurn('turn-1', false, false)
    expect(reminder1?.userInputId).toBe('q-1')
    expect(await t.registry.endTurn('turn-1', false, false)).toBeUndefined()
    const reminder2 = await t.registry.endTurn('turn-2', false, false)
    expect(reminder2?.userInputId).toBe('q-1')
    const reminder3 = await t.registry.endTurn('turn-3', false, false)
    expect(reminder3?.userInputId).toBe('q-2')
    const reminder4 = await t.registry.endTurn('turn-4', false, false)
    expect(reminder4?.userInputId).toBe('q-2')
    expect(await t.registry.endTurn('turn-5', false, false)).toBeUndefined()
    expect(t.registry.snapshot().questions.map((entry) => entry.reminders)).toEqual([2, 2])
    expect(t.port.deliver).not.toHaveBeenCalled()
    expect(t.session.steer).not.toHaveBeenCalled()
    expect(t.session.sendTurn).not.toHaveBeenCalled()
  })
  it('does not expand or spend a reminder while an approval waits', async () => {
    const t = await setup()
    expect(await t.registry.endTurn('turn-1', false, true)).toBeUndefined()
    expect(t.registry.snapshot().questions[0]?.reminders).toBe(0)
  })
})

it('notifies once per session/turn, only while unfocused and enabled', () => {
  let isFocused = false
  let isEnabled = true
  const show = vi.fn(() => Promise.resolve(false))
  const notifier = new BackgroundNotifier({
    show,
    isEnabled: () => isEnabled,
    isWindowFocused: () => isFocused,
    log: new FakeLogOutputChannel(),
  })
  const reveal = vi.fn()
  notifier.notify(notifyOpenQuestions('session', 'turn'), reveal)
  notifier.notify(notifyOpenQuestions('session', 'turn'), reveal)
  expect(show).toHaveBeenCalledTimes(1)
  expect(show).toHaveBeenCalledWith(UI_TEXT.notifyOpenQuestions)
  isFocused = true
  notifier.notify(notifyOpenQuestions('session', 'focused'), reveal)
  isFocused = false
  isEnabled = false
  notifier.notify(notifyOpenQuestions('session', 'disabled'), reveal)
  expect(show).toHaveBeenCalledTimes(1)
})
