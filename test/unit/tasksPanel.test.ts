import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TasksPanel } from '../../src/host/views/tasksPanel'
import { TASKS_MOVE_TO_WINDOW_COMMAND } from '../../src/shared/constants'
import { FakeWebviewPanel, fakeHostContext } from './helpers/fakes'
import { commands, window as fakeWindow } from './mocks/vscode'

const { getCommands } = vi.hoisted(() => ({ getCommands: vi.fn<() => Promise<string[]>>() }))
vi.mock('vscode', async () => {
  const fake = await import('./mocks/vscode')
  return { ...fake, commands: { ...fake.commands, getCommands } }
})

const view = { conversation: 'Fix parser', items: [{ text: 'Test', status: 'pending' }] }
function open() {
  const reveal = vi.fn()
  const released = vi.fn()
  const port = new TasksPanel(fakeHostContext(), reveal, released)
  port.open(view)
  const panel = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
  if (!(panel instanceof FakeWebviewPanel)) {
    throw new TypeError('expected fake panel')
  }
  return { port, panel, reveal, released }
}

describe('TasksPanel', () => {
  beforeEach(() => {
    fakeWindow.createWebviewPanel.mockReset()
    fakeWindow.createWebviewPanel.mockImplementation(
      (type, title) => new FakeWebviewPanel(type, title),
    )
    getCommands.mockResolvedValue([])
    commands.executeCommand.mockReset()
    commands.executeCommand.mockResolvedValue(undefined)
  })

  it('opens a secured tab beside the editor, caches until ready and replays after webview reload', async () => {
    const { port, panel } = open()
    await Promise.resolve()
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledWith(
      'museSpark.tasksPanel',
      'Tasks: Fix parser',
      -2,
      {},
    )
    expect(panel.webview.options.enableCommandUris).toBe(false)
    expect(panel.webview.html).toContain('data-surface="tasks"')
    expect(panel.webview.html).toContain("default-src 'none'")
    port.update({ conversation: 'Renamed', items: [{ text: 'Done', status: 'completed' }] })
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
    panel.webview.messages.fire({ type: 'tasksReady' })
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        conversation: 'Renamed',
        items: [{ text: 'Done', status: 'completed' }],
        ended: false,
      }),
    )
    panel.webview.messages.fire({ type: 'tasksReady' })
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(2)
    port.update(view)
    expect(panel.title).toBe('Tasks: Fix parser')
    expect(panel.webview.postMessage).toHaveBeenCalledTimes(3)
  })

  it('keeps ended state through reload, ignores late updates and can bind again', () => {
    const { port, panel, reveal } = open()
    panel.webview.messages.fire({ type: 'tasksReady' })
    port.ended()
    port.update({ conversation: 'Wrong', items: [] })
    panel.webview.messages.fire({ type: 'tasksReady' })
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ended: true, conversation: 'Fix parser' }),
    )
    panel.webview.messages.fire({ type: 'revealConversation' })
    expect(reveal).not.toHaveBeenCalled()
    port.open({ conversation: 'New', items: [] })
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledOnce()
    expect(panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ended: false, conversation: 'New' }),
    )
  })

  it('rejects chat and malformed actions, and stops receiving after disposal', () => {
    const { port, panel, reveal } = open()
    for (const raw of [
      { type: 'sendMessage', text: 'send' },
      { type: 'revealConversation', text: 'send' },
      null,
    ]) {
      panel.webview.messages.fire(raw)
    }
    expect(reveal).not.toHaveBeenCalled()
    panel.webview.messages.fire({ type: 'revealConversation' })
    expect(reveal).toHaveBeenCalledOnce()
    port.dispose()
    panel.webview.messages.fire({ type: 'tasksReady' })
    expect(panel.webview.postMessage).not.toHaveBeenCalled()
    port.open(view)
    expect(fakeWindow.createWebviewPanel).toHaveBeenCalledTimes(2)
  })

  it('gates window movement by available commands and reveals the tab before execution', async () => {
    const { panel } = open()
    await Promise.resolve()
    panel.webview.messages.fire({ type: 'moveTasksToWindow' })
    expect(commands.executeCommand).not.toHaveBeenCalled()
    getCommands.mockResolvedValue([TASKS_MOVE_TO_WINDOW_COMMAND])
    const supported = open()
    await Promise.resolve()
    supported.panel.webview.messages.fire({ type: 'tasksReady' })
    expect(getCommands).toHaveBeenCalledWith(true)
    expect(supported.panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ canMoveToWindow: true }),
    )
    supported.panel.webview.messages.fire({ type: 'moveTasksToWindow' })
    expect(supported.panel.reveal).toHaveBeenCalledWith(undefined, false)
    expect(commands.executeCommand).toHaveBeenCalledWith(TASKS_MOVE_TO_WINDOW_COMMAND)
    expect(supported.panel.reveal.mock.invocationCallOrder[0]).toBeLessThan(
      commands.executeCommand.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('lets go when the chat closes: at once without a tab, after the tab closes with one', () => {
    const { port, panel, released } = open()
    panel.dispose()
    expect(released).not.toHaveBeenCalled()
    port.release()
    expect(released).toHaveBeenCalledExactlyOnceWith(port)

    const kept = open()
    kept.panel.webview.messages.fire({ type: 'tasksReady' })
    kept.port.ended()
    kept.port.release()
    expect(kept.released).not.toHaveBeenCalled()
    kept.panel.webview.messages.fire({ type: 'tasksReady' })
    expect(kept.panel.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ ended: true, conversation: 'Fix parser' }),
    )
    kept.panel.dispose()
    expect(kept.released).toHaveBeenCalledExactlyOnceWith(kept.port)
  })

  it('ignores capability lookup from a disposed tab when another tab opens', async () => {
    const lookup = Promise.withResolvers<string[]>()
    getCommands.mockReturnValueOnce(lookup.promise)
    const { port } = open()
    port.dispose()
    port.open(view)
    const replacement = fakeWindow.createWebviewPanel.mock.results.at(-1)?.value
    if (!(replacement instanceof FakeWebviewPanel)) {
      throw new TypeError('expected replacement')
    }
    await Promise.resolve()
    lookup.resolve([TASKS_MOVE_TO_WINDOW_COMMAND])
    await Promise.resolve()
    replacement.webview.messages.fire({ type: 'tasksReady' })
    expect(replacement.webview.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ canMoveToWindow: false }),
    )
  })
})
