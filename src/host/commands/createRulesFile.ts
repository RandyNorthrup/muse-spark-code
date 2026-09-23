// `Muse Spark: Create AGENTS.md` (PLAN.md D15). The file that both backends
// read as project rules (D13) gets created the way Muse Code itself would:
// `muse init` when the CLI is present and the workspace is trusted (the CLI
// detects commands and directories, with no model call), else the same
// layout from `rulesFileTemplate`. An existing file is opened, never
// overwritten. Every VS Code and process interaction is injected.

import path from 'node:path'
import { rulesFileTemplate } from '../../core/context/rulesTemplate'
import { RULES_FILE_NAMES, UI_TEXT } from '../../shared/constants'
import type { ProcessResult } from '../backend/sandboxSetup'
import type { Logger } from '../logger'

export interface CreateRulesFileDeps {
  readonly workspaceRoot: string | undefined
  readonly isWorkspaceTrusted: () => boolean
  readonly fileExists: (fsPath: string) => Promise<boolean>
  readonly writeFile: (fsPath: string, content: string) => Promise<void>
  readonly openFile: (fsPath: string) => Promise<void>
  /** `muse init` in the workspace root, or undefined when the CLI is absent. */
  readonly runInit: () => Promise<ProcessResult> | undefined
  readonly showInformation: (message: string) => void
  readonly showWarning: (message: string) => void
  readonly log: Logger
}

const [RULES_FILE_NAME] = RULES_FILE_NAMES

function firstLine(text: string): string {
  return text.trim().split(/\r?\n/, 1)[0] ?? ''
}

/** Runs `muse init`; true when it wrote the file. Never throws. */
async function didCliWriteFile(deps: CreateRulesFileDeps, target: string): Promise<boolean> {
  const running = deps.isWorkspaceTrusted() ? deps.runInit() : undefined
  if (running === undefined) {
    return false
  }
  const result = await running
  if (result.exitCode === 0 && (await deps.fileExists(target))) {
    deps.log.info(`muse init wrote ${target}`)
    return true
  }
  const detail = firstLine(result.stderr) || firstLine(result.stdout)
  deps.log.warn(
    `muse init exited ${String(result.exitCode)} without writing ${RULES_FILE_NAME}${detail === '' ? '' : `: ${detail}`}; writing the template instead`,
  )
  return false
}

export async function createRulesFile(deps: CreateRulesFileDeps): Promise<void> {
  if (deps.workspaceRoot === undefined) {
    deps.showWarning(UI_TEXT.rulesFileNoWorkspace)
    return
  }
  const target = path.join(deps.workspaceRoot, RULES_FILE_NAME)
  if (await deps.fileExists(target)) {
    deps.showInformation(UI_TEXT.rulesFileExists)
    await deps.openFile(target)
    return
  }
  if (!(await didCliWriteFile(deps, target))) {
    await deps.writeFile(target, rulesFileTemplate(path.basename(deps.workspaceRoot)))
    deps.log.info(`Wrote the ${RULES_FILE_NAME} template to ${target}`)
  }
  deps.showInformation(UI_TEXT.rulesFileCreated)
  await deps.openFile(target)
}
