// Runner transports and Traffic mutations load only for a team action (M96c X2).
import { SshRunner } from './sshRunner'
import { CheckSlots } from '../team/checkSlots'
import { readRunnerConfig, runnerEnvironment } from '../../core/runners/runnerConfig'
import {
  routeChecks,
  ResourceRunnerRouter,
  type ResourceRunnerRouteOptions,
} from '../../core/runners/routing'
import {
  loadResourceWindow,
  registerResourceRunnerRoutes,
  resourceRunnerRoutesJoin,
} from '../../core/resources/admission'
import { UI_TEXT } from '../../shared/constants'
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
    /** M96c supplies its exact conversation/attempt and surface ports. */
    async createResourceRouting(options: Omit<ResourceRunnerRouteOptions, 'port'>) {
      // The scheduler/surface ports landed with this binding (M100-R): the
      // join completes, so this and later bindings register their routes.
      resourceRunnerRoutesJoin.isComplete = true
      const unregister = registerResourceRunnerRoutes(
        () => !options.headless && (options.hasTarget() || options.devicesEnabled()),
      )
      try {
        const window = await loadResourceWindow()
        if (window === undefined) throw new Error(UI_TEXT.resourceUnavailable)
        return new ResourceRunnerRouter({ ...options, port: window.port }, unregister)
      } catch (error: unknown) {
        unregister()
        throw error
      }
    },
    handleTrafficMessage,
    handleRunnersMessage,
  }
}
