// M107 U–C1/W: the VS Code window's resource surfaces. Activation registers
// only this adapter and its two commands; the governor, its checked status
// and the status item load with dist/resourceGovernor.js at the first governed
// spawn (or an explicit Show resources / Resume now), never at activation.

import type * as VSCode from 'vscode'
import type { ResourceWindowHost } from '../../core/resources/admission'
import {
  COMMAND_IDS,
  RESOURCE_STATUS_MAX_CHARS,
  SETTINGS_SECTION,
  UI_TEXT,
  VSCODE_COMMANDS,
} from '../../shared/constants'
import { fill, formatDateTime } from '../../shared/l10n/text'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../shared/protocol'
import type { ResourceStatus } from '../../shared/resources'

type ResourceAction = Extract<WebviewToHostMessage, { type: 'resourceAction' }>['action']

interface ResourceSurface {
  post(message: HostToWebviewMessage): void
  reveal(): void
}

export interface ResourceWindowDeps {
  readonly vscode: Pick<
    typeof VSCode,
    'window' | 'commands' | 'workspace' | 'StatusBarAlignment' | 'ThemeColor'
  >
  /** admission.ts: attach when the host loads; registering imports nothing. */
  readonly onLoad: (attach: (window: ResourceWindowHost) => void) => () => void
  /** admission.ts: load the host for an explicit command. */
  readonly load: () => Promise<ResourceWindowHost | undefined>
  readonly surfaces: {
    readonly active: ResourceSurface | undefined
    broadcast(message: HostToWebviewMessage): void
  }
  /** No surface in view: open one; its ready hears the pending open. */
  readonly openConversation: () => Promise<unknown>
  /** The conversation in view, for the once-per-conversation pause notice. */
  readonly conversationId: () => string | undefined
  readonly warn: (message: string) => void
}

export interface ResourceWindow {
  /** A surface mounted: send it the latest status and any pending open. */
  surfaceReady(surface: Pick<ResourceSurface, 'post'>): void
  /** The chip's popover controls (webview `resourceAction`). */
  action(action: ResourceAction): Promise<void>
  /** `museSpark.showResources`: the chip's popover in the chat in view. */
  show(): Promise<void>
  /** `museSpark.resumeResources`: the governor's fifteen-minute override. */
  resume(): Promise<void>
  dispose(): void
}

export function createResourceWindow(deps: ResourceWindowDeps): ResourceWindow {
  const { vscode } = deps
  let latest: string | undefined
  let isOpenPending = false
  let attached: { readonly window: ResourceWindowHost; dispose(): void } | undefined
  let isDisposed = false

  const publish = (status: ResourceStatus) => {
    const text = JSON.stringify(status)
    if (text.length > RESOURCE_STATUS_MAX_CHARS) {
      deps.warn('Resource status exceeds the window message bound; not sent')
      return
    }
    if (text === latest) return
    latest = text
    deps.surfaces.broadcast({ type: 'resourceStatus', status: text })
  }
  const run = (step: () => Promise<void>, what: string) => {
    void step().catch(() => {
      deps.warn(`Resource ${what} failed`)
    })
  }
  const openSettings = async () => {
    await vscode.commands.executeCommand(
      VSCODE_COMMANDS.openSettings,
      `${SETTINGS_SECTION}.resource`,
    )
  }
  const governorOff = async () => {
    const choice = await vscode.window.showInformationMessage(
      UI_TEXT.resourceGovernorOff,
      UI_TEXT.openSettings,
    )
    if (choice === UI_TEXT.openSettings) await openSettings()
  }
  const attach = (window: ResourceWindowHost) => {
    if (attached !== undefined || isDisposed) return
    const status = window.createStatus({
      port: {
        getSnapshot: () => window.port.status(),
        subscribe: (changed) => window.port.subscribe(changed),
        resume: () => {
          run(resume, 'resume')
        },
        settings: () => {
          run(openSettings, 'settings')
        },
        show: () => {
          run(show, 'show')
        },
      },
      conversationId: deps.conversationId,
      notice: (text, actions) => {
        void vscode.window
          .showWarningMessage(text, ...actions.map((action) => action.label))
          .then((choice) => {
            actions.find((action) => action.label === choice)?.run()
          })
      },
      invalidStatus: () => {
        deps.warn('Resource status failed its schema check')
      },
      createItem: () => window.createVsCodeItem(vscode),
    })
    const unsubscribe = window.port.subscribe(() => {
      publish(window.port.status())
    })
    attached = {
      window,
      dispose: () => {
        unsubscribe()
        status.dispose()
      },
    }
    publish(window.port.status())
  }
  const loaded = async (): Promise<ResourceWindowHost> => {
    const window = (await deps.load()) ?? attached?.window
    if (window === undefined) throw new Error(UI_TEXT.resourceUnavailable)
    attach(window)
    return window
  }
  const show = async () => {
    const window = await loaded()
    const status = await window.port.refreshStatus()
    publish(status)
    if (!status.settings.enabled) {
      await governorOff()
      return
    }
    const surface = deps.surfaces.active
    if (surface === undefined) {
      isOpenPending = true
      await deps.openConversation()
      return
    }
    surface.reveal()
    surface.post({ type: 'resourceOpen' })
  }
  const resume = async () => {
    const window = await loaded()
    const status = window.port.resume()
    publish(status)
    if (!status.settings.enabled) {
      await governorOff()
      return
    }
    if (status.overrideUntilMs !== null)
      void vscode.window.showInformationMessage(
        fill(UI_TEXT.resourceOverrideNotice, { time: formatDateTime(status.overrideUntilMs) }),
      )
  }
  const stopWatching = deps.onLoad(attach)
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SETTINGS_SECTION)) attached?.window.port.settingsChanged()
  })
  return {
    surfaceReady: (surface) => {
      if (latest !== undefined) surface.post({ type: 'resourceStatus', status: latest })
      if (!isOpenPending) return
      isOpenPending = false
      surface.post({ type: 'resourceOpen' })
    },
    action: async (action) => {
      switch (action) {
        case 'resume': {
          await resume()
          break
        }
        case 'settings': {
          await openSettings()
          break
        }
        case 'show': {
          // The popover is the window's summary; its Show opens the usage
          // page, where M102/J's Resources history lives.
          await vscode.commands.executeCommand(COMMAND_IDS.openUsagePage)
          break
        }
      }
    },
    show,
    resume,
    dispose: () => {
      isDisposed = true
      stopWatching()
      configuration.dispose()
      attached?.dispose()
      attached = undefined
    },
  }
}
