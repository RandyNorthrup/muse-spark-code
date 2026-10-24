// Tab's hook bridge (M94 lane K, PLAN.md D73): lane K's guard
// (`createTabHooks`) over M91's configured, bounded hook runner, loaded on
// first use. Pure: no `vscode` import, so VS Code's lazy Tab bundle and the
// language server (M104 lane H) build the same bridge, and a configured
// `beforeTabFileRead` guards every read in every editor.

import { createTabHooks, type TabHooksDeps } from '../../core/tab/tabHooks'
import type { Logger } from '../logger'
import type { TabHookBridge, TabHookDispatch } from './tabContract'

export function createTabHookBridge(
  dispatch: TabHookDispatch,
  isTrusted: () => boolean,
  log: Logger,
): TabHookBridge {
  let runner: Awaited<ReturnType<Extract<TabHookDispatch, { load: unknown }>['load']>>
  const hookDispatch: Omit<TabHooksDeps, 'isWorkspaceTrusted' | 'log'> =
    'load' in dispatch
      ? {
          isHooksEnabled: dispatch.isHooksEnabled,
          configurationVersion: () => runner?.configurationVersion() ?? '',
          isReloading: () => runner?.isReloading() ?? false,
          hookState: async (event) => {
            runner = await dispatch.load()
            if (runner === undefined) throw new Error('Tab hook dispatch unavailable')
            return await runner.tabHookState(event)
          },
          run: async (request) => {
            runner = await dispatch.load()
            return await runner?.runTab(request)
          },
        }
      : dispatch
  const hooks = createTabHooks({
    ...hookDispatch,
    isWorkspaceTrusted: isTrusted,
    log: (message) => {
      log.info(message)
    },
  })
  return {
    beforeRead: hooks.beforeRead,
    afterEdit: (edit) => {
      hooks.afterEdit({ ...edit, acceptance: edit.inferred ? 'partial' : 'full' }, edit)
    },
    bindPolicy: hooks.bindPolicy,
    policyKey: hooks.policyKey,
    dispose: hooks.dispose,
  }
}
