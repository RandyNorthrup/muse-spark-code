import path from 'node:path'
import type { AcpAgentDeps, AcpController } from '../../acp/agent'
import type { RuntimeBackend } from '../backends'
import type { ServeOptions } from '../cliArgs'
import { RuntimeSettingsStore } from '../settingsStore'
import { UI_TEXT, RUNTIME_PANEL_PORTS_BUNDLE_FILE } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { Usd } from '../../shared/usd'
import { MHP_METHODS, type HostServices } from '../../shared/hostApi/methods'
import { parseMhpResult } from '../../shared/hostApi/protocol'
import type { Logger } from '../../host/logger'
import type {
  ConversationController,
  ConversationDeps,
} from '../../host/conversation/conversationController'
import { RuntimeConversation } from './runtimeController'
import { panelPortsLoader } from './panelLoader'
import type { ControllerRegistry } from './controllerRegistry'

export interface AcpCompositionOptions {
  readonly runtime: RuntimeBackend
  readonly options: ServeOptions
  readonly dataRoot: string
  readonly conversationBundle: string
  readonly log: Logger
  readonly runGit: ConversationDeps['runGit']
  readonly controllers: ControllerRegistry<AcpController>
}

/** ACP is a view; the same registry and composed controller own its actual session. */
export function acpConversationFactory(
  deps: AcpCompositionOptions,
): AcpAgentDeps['createConversation'] {
  return async (session, host, cwd, mode) => {
    const store = new RuntimeSettingsStore(deps.dataRoot, cwd)
    const ports = panelPortsLoader({
      bundlePath: path.join(path.dirname(deps.conversationBundle), RUNTIME_PANEL_PORTS_BUNDLE_FILE),
      log: deps.log,
    })().createRuntimePanelPorts(UI_TEXT, uiLocale())
    const settings = await ports.runtimeSettings(store, deps.log)
    const services: HostServices = {
      async request(method, value, signal) {
        signal?.throwIfAborted()
        MHP_METHODS[method].params.parse(value)
        let result: unknown
        switch (method) {
          case 'settings/get': {
            const parsed = MHP_METHODS['settings/get'].params.parse(value)
            result = { value: await store.getSetting(parsed.key) }
            break
          }
          case 'settings/update': {
            const parsed = MHP_METHODS['settings/update'].params.parse(value)
            await store.updateSetting(parsed.key, parsed.value, parsed.scope)
            await settings.refresh()
            result = null
            break
          }
          default: {
            throw new Error('ACP_HOST_SERVICE_UNAVAILABLE')
          }
        }
        return parseMhpResult(method, { jsonrpc: '2.0', id: 1, result }).result
      },
      notify() {
        throw new Error('ACP_HOST_SERVICE_UNAVAILABLE')
      },
    }
    const conversation = new RuntimeConversation(session, host, deps.log, () => {
      deps.log.warn('ACP_CONTROLLER_HOST_EXIT')
    })
    let loaded
    try {
      loaded = await host.resumeSession(session.sessionId, session.modelId)
      await conversation.prepare(
        {
          host: services,
          runtime: deps.runtime,
          options: deps.options,
          store,
          settings: {
            ...settings,
            current: () => ({
              ...settings.current(),
              initialPermissionMode: mode,
              modelApiSessionBudgetUsd: Usd.from(0).toAmount(),
            }),
          },
          workspaceRoot: cwd,
          ownsPaidConsent: false,
          ownsSettings: true,
          // ACP already requires this explicit flag before adopting a contributor model.
          confirmContributor: () => Promise.resolve(deps.options.allowsContributorModels),
          controllers: function* (): Iterable<ConversationController> {
            for (const held of deps.controllers.controllers())
              if (held.controller !== undefined) yield held.controller
          },
          runGit: deps.runGit,
          selection: () => null,
          documents: () => [],
          log: deps.log,
        },
        { ...loaded, session },
        deps.conversationBundle,
        ports.runtimeConversationDeps,
        mode,
      )
    } catch (error: unknown) {
      await conversation.release()
      await settings.dispose()
      throw error
    } finally {
      if (loaded !== undefined && loaded.session !== session) loaded.session.dispose()
    }
    return {
      get controller() {
        return conversation.controller
      },
      submit: (parts, text) => {
        const controller = conversation.controller
        return controller === undefined
          ? Promise.reject(new Error('ACP_CONTROLLER_UNAVAILABLE'))
          : controller.submitParts(parts, text)
      },
      permissionModeChanged: (next) => conversation.controller?.useExternalPermissionMode(next),
      hostExited: (description) => {
        conversation.hostExited(description)
      },
      release: () => conversation.release(),
    }
  }
}
