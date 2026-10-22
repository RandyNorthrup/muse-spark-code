import {
  newWorktree,
  removeWorktree,
  type WorktreeDeps,
} from '../../host/commands/worktreeCommands'
import { captureWorkspaceIdentity } from '../../host/workspaceIdentity'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { runtimeFeatureLifetime } from './lifetime'

export interface RuntimeWorktreeDeps extends Omit<WorktreeDeps, 'runGit'> {
  readonly runGit: (
    args: readonly string[],
    cwd: string,
    timeoutMs: number | undefined,
    beforeRun: () => void,
    signal: AbortSignal,
  ) => Promise<string>
  readonly assertCurrent: () => void
  /** The real shared checkpoint/process admission, before any repository Git runs. */
  readonly beforeWorkspaceProcessStart: (signal: AbortSignal) => Promise<void>
  readonly cancelPrompts: () => void
}

/** Runs the existing worktree flows against one physical workspace and immutable owner. */
export function createRuntimeWorktrees(deps: RuntimeWorktreeDeps, table: UiText, locale: string) {
  setUiText(table, locale)
  const lifetime = runtimeFeatureLifetime(deps.assertCurrent, deps.cancelPrompts)
  const isActive = () => {
    if (lifetime.signal.aborted || !deps.isWorkspaceTrusted()) return false
    try {
      deps.assertCurrent()
      return true
    } catch {
      return false
    }
  }
  const run = async (action: (ports: WorktreeDeps) => Promise<void>) => {
    if (!isActive()) throw new Error(UI_TEXT.worktreeUntrusted)
    const root = deps.workspaceRoot
    if (root === undefined) throw new Error(UI_TEXT.worktreeNoWorkspace)
    await lifetime.track(async () => {
      const identity = await captureWorkspaceIdentity(root)
      const check = () => {
        lifetime.check()
        if (!identity?.isCurrent() || !isActive()) throw new Error(UI_TEXT.worktreeUntrusted)
      }
      check()
      if (identity === undefined) throw new Error(UI_TEXT.worktreeNoWorkspace)
      async function current<T>(work: () => Promise<T>): Promise<T> {
        check()
        const answer = await work()
        check()
        return answer
      }
      const ports: WorktreeDeps = {
        ...deps,
        workspaceRoot: identity.canonical,
        isWorkspaceTrusted: () => isActive() && identity.isCurrent(),
        runGit: (args, cwd, timeout, beforeRun) =>
          current(async () => {
            await deps.beforeWorkspaceProcessStart(lifetime.signal)
            check()
            return await deps.runGit(
              args,
              cwd,
              timeout,
              () => {
                check()
                beforeRun?.()
              },
              lifetime.signal,
            )
          }),
        askBranchName: (validate) => current(() => deps.askBranchName(validate)),
        pick: (...args) => current(() => deps.pick(...args)),
        confirm: (...args) => current(() => deps.confirm(...args)),
        offerOpen: (...args) => current(() => deps.offerOpen(...args)),
        openFolder: (folder) => current(() => deps.openFolder(folder)),
        recordWorktree: (...args) => current(() => deps.recordWorktree(...args)),
        showInformation: (message) => {
          if (isActive() && identity.isCurrent()) deps.showInformation(message)
        },
        showWarning: (message) => {
          if (isActive() && identity.isCurrent()) deps.showWarning(message)
        },
        showError: (message) => {
          if (isActive() && identity.isCurrent()) deps.showError(message)
        },
      }
      await action(ports)
    })
  }
  return {
    create: () => run(newWorktree),
    remove: () => run(removeWorktree),
    dispose: lifetime.dispose,
  }
}
