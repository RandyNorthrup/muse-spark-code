import { ExtensionHookRunner, type ExtensionHookRunnerDeps } from '../../host/extensionHooksRunner'
import type { ConfigChangeReason, SetupTrigger } from '../../core/backends/modelapi/extensionHooks'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export interface RuntimeHookDeps extends ExtensionHookRunnerDeps {
  readonly assertCurrent: () => void
}

/** Window hooks share the existing dispatcher on either backend and end with their owner. */
export function createRuntimeHooks(deps: RuntimeHookDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const ending = new AbortController()
  const pending = new Set<Promise<unknown>>()
  let closing: Promise<void> | undefined
  const check = () => {
    ending.signal.throwIfAborted()
    deps.assertCurrent()
  }
  const runner = new ExtensionHookRunner({
    ...deps,
    runHook: async (command, payload, cwd, timeout, signal, names) => {
      check()
      if (!deps.isWorkspaceTrusted() || !deps.isHooksEnabled())
        throw new Error('MHP_HOOK_ADMISSION_REFUSED')
      const cancelled =
        signal === undefined ? ending.signal : AbortSignal.any([ending.signal, signal])
      const result = await deps.runHook(command, payload, cwd, timeout, cancelled, names)
      check()
      if (!deps.isWorkspaceTrusted() || !deps.isHooksEnabled())
        throw new Error('MHP_HOOK_ADMISSION_REFUSED')
      return result
    },
    notice: (level, text) => {
      check()
      deps.notice(level, text)
    },
    showOutput: (title, text) => {
      check()
      deps.showOutput(title, text)
    },
    isWorkspaceTrusted: () => !ending.signal.aborted && deps.isWorkspaceTrusted(),
    isHooksEnabled: () => !ending.signal.aborted && deps.isHooksEnabled(),
  })
  async function track<T>(work: () => Promise<T>): Promise<T> {
    check()
    const running = work()
    pending.add(running)
    try {
      const result = await running
      check()
      return result
    } finally {
      pending.delete(running)
    }
  }
  return {
    reload: () => track(() => runner.reload()),
    listManual: () => {
      check()
      return runner.listManual()
    },
    runManual: (name: string) => track(() => runner.runManual(name)),
    rewriteMessage: (text: string) => track(() => runner.rewriteMessage(text)),
    noteWorkspaceFile: (file: string) => track(() => runner.noteWorkspaceFile(file)),
    noteConfigFile: (file: string, reason: ConfigChangeReason) =>
      track(() => runner.noteConfigFile(file, reason)),
    noteSettingsChange: () => track(() => runner.noteSettingsChange()),
    noteDirectoryAdded: (file: string) => track(() => runner.noteDirectoryAdded(file)),
    runSetup: (trigger: SetupTrigger) => track(() => runner.runSetup(trigger)),
    dispose: (): Promise<void> => {
      ending.abort()
      closing ??= (async () => {
        await Promise.allSettled(pending)
      })()
      return closing
    },
  }
}
