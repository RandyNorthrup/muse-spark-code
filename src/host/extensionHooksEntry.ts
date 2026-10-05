// The extension hooks' bundle (M91, PLAN.md D6): esbuild builds this file
// into dist/extensionHooks.js, which `extensionHooksBundle` requires the
// first time the window fires a both-backend hook event (a watched file, a
// folder, Run Setup Hooks, Run Hook), so the hook runner stays out of the
// bundle VS Code loads at activation. It imports no `vscode`, so it is not
// external there and a stray import fails this build.

import { ExtensionHookRunner, type ExtensionHookRunnerDeps } from './extensionHooksRunner'
import type { UiText } from '../shared/l10n/en'
import { setUiText } from '../shared/l10n/text'

export function createExtensionHookRunner(
  deps: ExtensionHookRunnerDeps,
  uiText: UiText,
  locale: string,
): ExtensionHookRunner {
  setUiText(uiText, locale)
  return new ExtensionHookRunner(deps)
}
export type { ExtensionHookRunner, ExtensionHookRunnerDeps } from './extensionHooksRunner'
