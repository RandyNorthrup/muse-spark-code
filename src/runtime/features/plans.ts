// Plans as files in the runtime panel (M104 lane B; M79): int's own plan store
// over `.agents/plans/` of the workspace, with the editor's pick for the
// Plans… list and its modal for the one yes a save needs (`.agents/` is a
// protected path, D24). The Markdown reader is int's lazy bundle. No
// checkpoint exists in the panel to record a save in, so none is asked.
import path from 'node:path'
import type { PlanFiles } from '../../host/conversation/conversationController'
import type { Logger } from '../../host/logger'
import { createPlanFiles, createPlanIo } from '../../host/planFeatures'
import { planMarkdownLoader } from '../../host/planMarkdownBundle'
import { PLAN_MARKDOWN_BUNDLE_FILE, UI_TEXT } from '../../shared/constants'
import type { HostServices } from '../../shared/hostApi/methods'
import { editorPick } from './pick'

export interface RuntimePlansDeps {
  readonly host: HostServices
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /** The folder holding the shipped bundles (dist/). */
  readonly distDir: string
  /** A modal; true when the person chose `action`. */
  readonly confirm: (message: string, detail: string, action: string) => Promise<boolean>
  /** Whether the editor trusts the workspace; read at every write. */
  readonly isTrusted: () => boolean
  /** Ends with the conversation. */
  readonly signal: AbortSignal
  readonly log: Logger
}

export function createRuntimePlans(deps: RuntimePlansDeps): PlanFiles {
  // A save publishes only while the conversation is held and the workspace
  // still trusted, rechecked at the write as VS Code's workspace-action
  // guard rechecks its plan writes: trust can go between the person's yes
  // (which the controller checks) and the publish.
  const check = (): void => {
    deps.signal.throwIfAborted()
    if (!deps.isTrusted()) throw new Error(UI_TEXT.planRestricted)
  }
  return createPlanFiles({
    workspaceRoot: deps.workspaceRoot,
    platform: deps.platform,
    io: createPlanIo({
      log: deps.log,
      now: () => Date.now(),
      edit: async (work) => {
        check()
        await work(check)
      },
    }),
    pick: editorPick(deps.host, deps.signal),
    confirm: deps.confirm,
    markdown: planMarkdownLoader({
      bundlePath: path.join(deps.distDir, PLAN_MARKDOWN_BUNDLE_FILE),
      log: deps.log,
    }),
  })
}
