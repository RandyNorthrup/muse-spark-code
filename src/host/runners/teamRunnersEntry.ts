// Runner transports load only for a team action (M96c X2). The Traffic
// read and dispatch load with their own bundle (dist/teamTraffic.js) on
// the first Traffic use, behind the same runtime members (RLF-TEAMFIT).
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
import type { handleTrafficMessage, handleRunnersMessage } from '../modelsPanelTraffic'
import type { dispatchTeamTraffic, readTeamTraffic } from '../team/teamTrafficDispatch'
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
    async handleTrafficMessage(
      ...args: Parameters<typeof handleTrafficMessage>
    ): ReturnType<typeof handleTrafficMessage> {
      const { createTeamTrafficRuntime } = await import('../team/teamTrafficEntry')
      return await createTeamTrafficRuntime(table, locale).handleTrafficMessage(...args)
    },
    async handleRunnersMessage(
      ...args: Parameters<typeof handleRunnersMessage>
    ): ReturnType<typeof handleRunnersMessage> {
      const { createTeamTrafficRuntime } = await import('../team/teamTrafficEntry')
      return await createTeamTrafficRuntime(table, locale).handleRunnersMessage(...args)
    },
    async readTeamTraffic(
      ...args: Parameters<typeof readTeamTraffic>
    ): ReturnType<typeof readTeamTraffic> {
      const { createTeamTrafficRuntime } = await import('../team/teamTrafficEntry')
      return await createTeamTrafficRuntime(table, locale).readTeamTraffic(...args)
    },
    async dispatchTeamTraffic(
      ...args: Parameters<typeof dispatchTeamTraffic>
    ): ReturnType<typeof dispatchTeamTraffic> {
      const { createTeamTrafficRuntime } = await import('../team/teamTrafficEntry')
      await createTeamTrafficRuntime(table, locale).dispatchTeamTraffic(...args)
    },
  }
}
