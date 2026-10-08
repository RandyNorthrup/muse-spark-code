// M107 U–C1/W: the VS Code window's resource surfaces. Activation registers
// only this adapter and its two commands; the governor, its checked status
// and the status item load with dist/resourceGovernor.js at the first governed
// spawn (or an explicit Show resources / Resume now), never at activation.

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
import type { VsCodeStatusBar } from './resourceStatus'

type ResourceAction = Extract<WebviewToHostMessage, { type: 'resourceAction' }>['action']

interface ResourceSurface {
  readonly id: string
  post(message: HostToWebviewMessage): void
  reveal(): void
}

/**
 * Show resources' open request, bound when Show runs to exactly one target:
 * a surface in view, or the surface a new conversation opens in (by its id).
 */
type OpenTarget = { readonly surface: object } | { readonly surfaceId: string }

/** One surface's current document: a reload starts an unready generation. */
interface SurfaceDocument {
  readonly generation: number
  isReady: boolean
}

/** The slice of VS Code's namespace the window uses; the real one is injected. */
type WindowApi<Alignment> = VsCodeStatusBar<Alignment> & {
  readonly window: {
    showInformationMessage(message: string, ...items: string[]): PromiseLike<string | undefined>
    showWarningMessage(message: string, ...items: string[]): PromiseLike<string | undefined>
  }
  readonly commands: { executeCommand(command: string, ...rest: unknown[]): PromiseLike<unknown> }
  readonly workspace: {
    onDidChangeConfiguration(
      listener: (event: { affectsConfiguration(section: string): boolean }) => void,
    ): { dispose(): unknown }
  }
}

export interface ResourceWindowDeps<Alignment> {
  readonly vscode: WindowApi<Alignment>
  /** admission.ts: attach when the host loads; registering imports nothing. */
  readonly onLoad: (attach: (window: ResourceWindowHost) => void) => () => void
  /** admission.ts: load the host for an explicit command. */
  readonly load: () => Promise<ResourceWindowHost | undefined>
  readonly surfaces: {
    readonly active: ResourceSurface | undefined
    broadcast(message: HostToWebviewMessage): void
    onRemoved(listener: (surface: ResourceSurface) => void): { dispose(): unknown }
  }
  /**
   * No surface in view: open a conversation. `surfaceId` names the surface it
   * opens in, known before that surface can report ready.
   */
  readonly openConversation: () => {
    readonly surfaceId: string
    readonly opened: PromiseLike<unknown>
  }
  /** The conversation in view, for the once-per-conversation pause notice. */
  readonly conversationId: () => string | undefined
  readonly warn: (message: string) => void
}

export interface ResourceWindow {
  /** A surface's document is ready: send it the latest status and its pending open. */
  surfaceReady(surface: Pick<ResourceSurface, 'id' | 'post'>): void
  /** A surface's document was replaced (reload): it is unready until its next ready. */
  surfaceReset(surface: object): void
  /** The chip's popover controls (webview `resourceAction`). */
  action(action: ResourceAction): Promise<void>
  /** `museSpark.showResources`: the chip's popover in the chat in view. */
  show(): Promise<void>
  /** `museSpark.resumeResources`: the governor's fifteen-minute override. */
  resume(): Promise<void>
  dispose(): void
}

export function createResourceWindow<Alignment>(
  deps: ResourceWindowDeps<Alignment>,
): ResourceWindow {
  const { vscode } = deps
  // null: the latest status was refused (over the message bound).
  let latest: string | null | undefined
  // VS Code drops posts made before a document's listener is attached, so an
  // open waits for its target's first ready generation, then is spent.
  const documents = new WeakMap<object, SurfaceDocument>()
  let intent: OpenTarget | undefined
  const isTarget = (surface: Pick<ResourceSurface, 'id'>, target: OpenTarget | undefined) =>
    target !== undefined &&
    ('surface' in target ? target.surface === surface : target.surfaceId === surface.id)
  let attached: { readonly window: ResourceWindowHost; dispose(): void } | undefined
  let isDisposed = false

  const publish = (status: ResourceStatus) => {
    const encoded = JSON.stringify(status)
    // Over the bound, the chip says the status is unavailable instead of
    // keeping an older reading; the log records why.
    const text = encoded.length > RESOURCE_STATUS_MAX_CHARS ? null : encoded
    if (text === null)
      deps.warn('Resource status exceeds the window message bound; sent as refused')
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
      const conversation = deps.openConversation()
      intent = { surfaceId: conversation.surfaceId }
      await conversation.opened
      return
    }
    surface.reveal()
    if (documents.get(surface)?.isReady === true) {
      intent = undefined
      surface.post({ type: 'resourceOpen' })
    } else intent = { surface }
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
  // A disposed target cancels its open; it is never redirected to another surface.
  const removal = deps.surfaces.onRemoved((surface) => {
    documents.delete(surface)
    if (isTarget(surface, intent)) intent = undefined
  })
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SETTINGS_SECTION)) attached?.window.port.settingsChanged()
  })
  return {
    surfaceReady: (surface) => {
      if (isDisposed) return
      const current = documents.get(surface)
      documents.set(surface, { generation: current?.generation ?? 0, isReady: true })
      if (latest !== undefined) surface.post({ type: 'resourceStatus', status: latest })
      if (!isTarget(surface, intent)) return
      intent = undefined
      surface.post({ type: 'resourceOpen' })
    },
    surfaceReset: (surface) => {
      if (isDisposed) return
      const current = documents.get(surface)
      documents.set(surface, { generation: (current?.generation ?? 0) + 1, isReady: false })
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
      intent = undefined
      removal.dispose()
      stopWatching()
      configuration.dispose()
      attached?.dispose()
      attached = undefined
    },
  }
}
