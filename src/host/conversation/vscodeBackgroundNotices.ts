// The window's background-notice ports backed by the real editor host
// (M82): the `museSpark.notifyOnBackgroundTurn` setting as VS Code holds
// it, the window's live focus state, and VS Code's own notification with
// the **Show conversation** button. `src/extension.ts` wires these into
// `BackgroundNotifier`; the integration tests drive them in the real
// Extension Development Host, so a broken adapter or wiring fails there
// instead of passing against scripted closures.

import * as vscode from 'vscode'
import { SETTINGS_SECTION, UI_TEXT } from '../../shared/constants'
import { type Logger } from '../logger'
import { readSettings } from '../settings'
import { type BackgroundNotifierDeps } from './turnNotifications'

/** The production `BackgroundNotifier` ports: every read hits the live host. */
export function vscodeBackgroundNoticeDeps(log: Logger): BackgroundNotifierDeps {
  return {
    isEnabled: () =>
      readSettings(vscode.workspace.getConfiguration(SETTINGS_SECTION), log).notifyOnBackgroundTurn,
    isWindowFocused: () => vscode.window.state.focused,
    show: async (message) =>
      (await vscode.window.showInformationMessage(message, UI_TEXT.notifyShowConversation)) ===
      UI_TEXT.notifyShowConversation,
    log,
  }
}
