// D107 (M125 lane W): the setup reads the Settings section, the
// status item and the remove flow use without loading the driver.
// No `vscode` import: the panel host and the unit tests share it.
import { homedir } from 'node:os'
import path from 'node:path'
import { readJudgeRegistration } from '../../core/judge/setup/register'
import { removeJudgeInstall } from '../../core/judge/setup/remove'
import { runtimePaths } from '../../core/judge/setup/runtime'
import type { JudgeSetupPaths } from '../../core/judge/setup/ports'
import { agentDataFolder } from '../../runtime/dataFolder'
import { GLOBAL_STATE_KEYS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { Logger } from '../logger'

/** The setup the Settings section and the status item read. */
export interface JudgeSetupState {
  readonly isInstalled: boolean
  readonly model?: string | undefined
  readonly recordFile: string
}

export interface JudgeSetupPanelPaths extends JudgeSetupPaths {
  readonly recordFile: string
}

/** One install per user, shared by the editor and the CLI. */
export function judgeSetupPanelPaths(extensionDir: string): JudgeSetupPanelPaths {
  const storageRoot = agentDataFolder({
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
  })
  return {
    storageRoot,
    tableFile: path.join(extensionDir, 'dist', 'judgeModels.json'),
    recordFile: path.join(storageRoot, 'judge', 'registration.json'),
  }
}

/**
The installed setup, or not installed. A corrupt registration reads
as nothing installed. Synchronous and light: one registry read,
never the driver.
*/
export function readJudgeSetupState(paths: JudgeSetupPanelPaths): JudgeSetupState {
  const record = readJudgeRegistration(paths.recordFile)
  return record === undefined
    ? { isInstalled: false, recordFile: paths.recordFile }
    : { isInstalled: true, model: record.model, recordFile: paths.recordFile }
}

export interface JudgeSetupRemoveDeps {
  readonly paths: JudgeSetupPanelPaths
  readonly log: Logger
  /** The native question; true removes. */
  readonly confirm: (title: string, message: string, yes: string) => Promise<boolean>
  readonly info: (message: string) => void
}

/**
Remove the private install after the native question, answering
whether anything was removed. Nothing installed answers so; a
declined question changes nothing. Only what setup added is ever
deleted.
*/
export async function didRemoveJudgeSetupInstall(deps: JudgeSetupRemoveDeps): Promise<boolean> {
  const text = UI_TEXT.judgeSetupWizard
  const layout = runtimePaths(deps.paths.storageRoot, 'current')
  const record = readJudgeRegistration(layout.record)
  if (record === undefined) {
    deps.info(text.removeNone)
    return false
  }
  const isConfirmed = await deps.confirm(
    text.removeConfirmTitle,
    fill(text.removeConfirm, {
      model: record.model,
      path: path.dirname(record.runtimePath),
    }),
    text.removeYes,
  )
  if (!isConfirmed) return false
  await removeJudgeInstall({
    runtimeRoot: path.dirname(record.runtimePath),
    modelsDir: record.modelsDir,
    lock: layout.lock,
    record: layout.record,
  })
  deps.info(fill(text.removeDone, { model: record.model }))
  return true
}

/** The deferred flag behind the status item. */
export function isJudgeSetupDeferred(get: (key: string) => unknown): boolean {
  return get(GLOBAL_STATE_KEYS.judgeSetupDeferred) === true
}
