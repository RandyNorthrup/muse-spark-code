import { beforeEach, describe, expect, it } from 'vitest'
import { openWalkthrough } from '../../src/host/commands/openWalkthrough'
import { COMMAND_IDS, VSCODE_COMMANDS, WALKTHROUGH_QUALIFIED_ID } from '../../src/shared/constants'
import { FakeWebviewPanel } from './helpers/fakes'
import { commands, window } from './mocks/vscode'

beforeEach(() => {
  commands.getCommands.mockReset()
  commands.executeCommand.mockReset()
  window.createWebviewPanel.mockReset()
  window.createWebviewPanel.mockImplementation(
    (viewType, title) => new FakeWebviewPanel(viewType, title),
  )
})

describe('walkthrough host parity', () => {
  it('uses the native walkthrough when its command exists', async () => {
    commands.getCommands.mockResolvedValue([VSCODE_COMMANDS.openWalkthrough])
    expect(await openWalkthrough()).toBeUndefined()
    expect(commands.executeCommand).toHaveBeenCalledWith(
      VSCODE_COMMANDS.openWalkthrough,
      WALKTHROUGH_QUALIFIED_ID,
      false,
    )
    expect(window.createWebviewPanel).not.toHaveBeenCalled()
  })

  it('provides sign-in, every shortcut and allowlisted actions when the host has no walkthroughs', async () => {
    commands.getCommands.mockResolvedValue([])
    const panel = await openWalkthrough()
    expect(panel).toBeInstanceOf(FakeWebviewPanel)
    expect(panel?.title).toContain('Muse Spark Code (Unofficial)')
    expect(panel?.webview.html).toContain('Sign in with your Meta account')
    expect(panel?.webview.html).toContain('Use a Model API key')
    expect(panel?.webview.html).toContain('Shift+Tab')
    expect(panel?.webview.html.match(/<li>/g)).toHaveLength(9)
    expect(panel?.webview.html).toContain(`command:${COMMAND_IDS.openInNewTab}`)
    expect(panel?.webview.html).toContain(`command:${COMMAND_IDS.createRulesFile}`)
    expect(panel?.webview.html).toContain("default-src 'none'")
    expect(panel?.webview.html).not.toContain('<script')
    expect(window.createWebviewPanel).toHaveBeenCalledWith(
      WALKTHROUGH_QUALIFIED_ID,
      expect.any(String),
      -1,
      { enableCommandUris: [COMMAND_IDS.openInNewTab, COMMAND_IDS.createRulesFile] },
    )
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })

  it('propagates native command failures instead of hiding them with a second page', async () => {
    commands.getCommands.mockResolvedValue([VSCODE_COMMANDS.openWalkthrough])
    commands.executeCommand.mockRejectedValue(new Error('host failure'))
    await expect(openWalkthrough()).rejects.toThrow('host failure')
    expect(window.createWebviewPanel).not.toHaveBeenCalled()
  })
})
