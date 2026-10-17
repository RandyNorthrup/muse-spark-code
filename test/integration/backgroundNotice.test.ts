// M82: background notices through the real Extension Development Host.
// The production deps factory reads the live host (the real setting, the
// real window-focus state, VS Code's real notification), so a broken
// adapter or wiring fails here instead of passing against scripted
// closures. The one exception is `show` below: it delegates to the real
// `showInformationMessage` (a wrongly reached notice really appears) and
// only counts the call, since no API clicks the button for us. Clicking
// **Show conversation** stays a real-life step for the lead.
import * as assert from 'node:assert/strict'
import * as vscode from 'vscode'
import { BackgroundNotifier } from '../../src/host/conversation/turnNotifications'
import { vscodeBackgroundNoticeDeps } from '../../src/host/conversation/vscodeBackgroundNotices'
import { createLogger } from '../../src/host/logger'
import { SETTINGS_SECTION } from '../../src/shared/constants'

const SETTING_KEY = 'notifyOnBackgroundTurn'
const SETTLE_MS = 500
// How long a displayed probe toast waits for its human click.
const SHOW_WAIT_MS = 2000

function delay(ms: number): Promise<'waiting'> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve('waiting')
    }, ms)
  })
}

function readSetting(): boolean | undefined {
  return vscode.workspace.getConfiguration(SETTINGS_SECTION).get<boolean>(SETTING_KEY)
}

suite('M82 background notices in the real host', () => {
  test('isEnabled follows the real setting', async () => {
    const channel = vscode.window.createOutputChannel('M82 notice-setting test', { log: true })
    const deps = vscodeBackgroundNoticeDeps(createLogger(channel))
    const original = readSetting()
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING_KEY, false, vscode.ConfigurationTarget.Global)
      assert.equal(deps.isEnabled(), false)
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING_KEY, true, vscode.ConfigurationTarget.Global)
      assert.equal(deps.isEnabled(), true)
    } finally {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING_KEY, original, vscode.ConfigurationTarget.Global)
      channel.dispose()
    }
  })

  test('isWindowFocused reports the live window state', () => {
    const channel = vscode.window.createOutputChannel('M82 notice-focus test', { log: true })
    try {
      const deps = vscodeBackgroundNoticeDeps(createLogger(channel))
      assert.equal(deps.isWindowFocused(), vscode.window.state.focused)
    } finally {
      channel.dispose()
    }
  })

  test('the real notifier stays quiet while the real setting is off', async () => {
    const channel = vscode.window.createOutputChannel('M82 notice-quiet test', { log: true })
    const original = readSetting()
    try {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING_KEY, false, vscode.ConfigurationTarget.Global)
      const deps = vscodeBackgroundNoticeDeps(createLogger(channel))
      let showCalls = 0
      const notifier = new BackgroundNotifier({
        ...deps,
        show: async (message) => {
          showCalls += 1
          return await deps.show(message)
        },
      })
      const notice = { key: 's1:turn:t1', message: 'M82 quiet probe' }
      notifier.notify(notice, () => {
        assert.fail('reveal must not run while the setting is off')
      })
      notifier.notify(notice, () => {
        assert.fail('reveal must not run while the setting is off')
      })
      await delay(SETTLE_MS)
      assert.equal(showCalls, 0)
    } finally {
      await vscode.workspace
        .getConfiguration(SETTINGS_SECTION)
        .update(SETTING_KEY, original, vscode.ConfigurationTarget.Global)
      channel.dispose()
    }
  })

  test('show displays a real notification through the real editor API', async () => {
    const channel = vscode.window.createOutputChannel('M82 notice-show test', { log: true })
    try {
      const deps = vscodeBackgroundNoticeDeps(createLogger(channel))
      const shown = deps.show(`M82 display probe ${String(Date.now())}`)
      // The real editor API accepted and displayed the notice: only a
      // human click settles it, so it is still waiting here. A throw or
      // a synchronous answer would fail this instead.
      assert.equal(await Promise.race([shown, delay(SHOW_WAIT_MS)]), 'waiting')
      // Dismiss it where the build allows; absent on some builds, in
      // which case the toast dies with the test window.
      try {
        await vscode.commands.executeCommand('notifications.hideToasts')
      } catch {
        // No such command on this build.
      }
      const afterDismiss = await Promise.race([shown, delay(SHOW_WAIT_MS)])
      if (afterDismiss !== 'waiting') {
        // A dismissed toast settles to "not picked": no reveal follows.
        assert.equal(afterDismiss, false)
      }
    } finally {
      channel.dispose()
    }
  })
})
