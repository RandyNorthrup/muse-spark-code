// The lazy runtime binding lane X named for W/S: the real engine, no fakes.
// Loaded by the schedule CLI and the ACP agent through runtimeSchedulesBinding.
import { homedir } from 'node:os'
import path from 'node:path'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { SCHEDULE_STORE_SUBFOLDER } from '../../shared/constants'
import { agentDataFolder } from '../dataFolder'
import { createNodeScheduleFs, createNodeScheduleQueue } from './nodeScheduleFs'
import type { RuntimeSchedulesBinding } from './binding'
import { createScheduleEngine } from './engine'
import { agentFileBeside, createVerifyWake } from './wake'

export function createRuntimeSchedules(
  table: UiText,
  locale: string,
): Promise<RuntimeSchedulesBinding> {
  setUiText(table, locale)
  const platform = process.platform
  const homeDir = homedir()
  const dataDir = agentDataFolder({ platform, env: process.env, homeDir })
  const root = path.join(dataDir, SCHEDULE_STORE_SUBFOLDER)
  const agentFile = agentFileBeside(__filename)
  const { runtime } = createScheduleEngine({
    fs: createNodeScheduleFs(root),
    queue: createNodeScheduleQueue(root),
    platform,
    homeDir,
    dataDir,
    executable: process.execPath,
    agentFile,
    verifyWake: createVerifyWake(process.execPath, agentFile),
  })
  return Promise.resolve(runtime)
}
