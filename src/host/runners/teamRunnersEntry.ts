// Runner transports and Traffic mutations load only for a team action (M96c X2).
import { SshRunner } from './sshRunner'
import { CheckSlots } from '../team/checkSlots'
import { readRunnerConfig, runnerEnvironment } from '../../core/runners/runnerConfig'
import { routeChecks } from '../../core/runners/routing'
import { handleTrafficMessage, handleRunnersMessage } from '../modelsPanelTraffic'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'

export function createTeamRunnersRuntime(table: UiText, locale: string) {
  setUiText(table, locale)
  return {
    SshRunner,
    CheckSlots,
    readRunnerConfig,
    runnerEnvironment,
    routeChecks,
    handleTrafficMessage,
    handleRunnersMessage,
  }
}
