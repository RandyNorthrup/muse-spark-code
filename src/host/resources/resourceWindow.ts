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
 * The chat documents one surface has had. Each webview document mints its
 * own nonce; a reload marks the current one stale, so later messages from it
 * (queued before the reload) are ignored.
 */
interface SurfaceDocuments {
  readonly surface: ResourceSurface
  readonly stale: Set<string>
  current: string | undefined
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
   * opens in, returned synchronously, before that surface can ask for anything.
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
  /** A document is ready: send it the latest status (its chip then pulls). */
  surfaceReady(surface: Pick<ResourceSurface, 'post'>): void
  /** A document asks for a pending open (its chip mounted). */
  pull(surface: ResourceSurface, nonce: string): void
  /** A document opened the popover for `seq`. */
  acknowledge(surface: ResourceSurface, seq: number, nonce: string): void
  /** A surface's document was replaced (reload): its current nonce is stale. */
  surfaceReset(surface: ResourceSurface): void
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
  // Pull model. Show records one pending open for one surface id, numbered.
  // A document that names itself (its chip's pull) is offered it; only that
  // document's acknowledgement spends it. VS Code may drop posts to a document
  // that is not listening yet, so an unacknowledged open stays pending.
  const documents = new Map<string, SurfaceDocuments>()
  let sequence = 0
  let pending: { readonly surfaceId: string; readonly seq: number } | undefined
  const isCurrentDocument = (surface: ResourceSurface, nonce: string): boolean => {
    let known = documents.get(surface.id)
    if (known?.surface !== surface) {
      known = { surface, stale: new Set(), current: undefined }
      documents.set(surface.id, known)
    }
    if (known.stale.has(nonce)) return false
    known.current = nonce
    return true
  }
  const offer = (surfaceId: string) => {
    const known = documents.get(surfaceId)
    if (isDisposed || pending?.surfaceId !== surfaceId || known?.current === undefined) return
    known.surface.post({ type: 'resourceOpen', seq: pending.seq, nonce: known.current })
  }
  const withdraw = (surfaceId: string, seq: number) => {
    if (pending?.surfaceId === surfaceId && pending.seq === seq) pending = undefined
  }
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
    if (isDisposed) return
    // Bound now, before any await: the chat in view, or the new conversation's
    // surface. A later Show supersedes this one and its continuation stops.
    sequence += 1
    const seq = sequence
    const active = deps.surfaces.active
    const conversation = active === undefined ? deps.openConversation() : undefined
    const surfaceId = active?.id ?? conversation?.surfaceId
    if (surfaceId === undefined) return
    pending = { surfaceId, seq }
    const isCurrent = () => !isDisposed && sequence === seq
    try {
      const window = await loaded()
      if (!isCurrent()) return
      const status = await window.port.refreshStatus()
      if (!isCurrent()) return
      publish(status)
      if (!status.settings.enabled) {
        withdraw(surfaceId, seq)
        await governorOff()
        return
      }
      if (active === undefined) await conversation?.opened
      else {
        active.reveal()
        offer(surfaceId)
      }
    } catch (error: unknown) {
      // A failed open leaves nothing behind for a later, unrelated ready.
      withdraw(surfaceId, seq)
      throw error
    }
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
    if (documents.get(surface.id)?.surface === surface) documents.delete(surface.id)
    if (pending?.surfaceId === surface.id) pending = undefined
  })
  const configuration = vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(SETTINGS_SECTION)) attached?.window.port.settingsChanged()
  })
  return {
    surfaceReady: (surface) => {
      if (!isDisposed && latest !== undefined)
        surface.post({ type: 'resourceStatus', status: latest })
    },
    pull: (surface, nonce) => {
      if (!isDisposed && isCurrentDocument(surface, nonce)) offer(surface.id)
    },
    acknowledge: (surface, seq, nonce) => {
      if (!isDisposed && isCurrentDocument(surface, nonce)) withdraw(surface.id, seq)
    },
    surfaceReset: (surface) => {
      const known = documents.get(surface.id)
      if (isDisposed || known?.surface !== surface || known.current === undefined) return
      known.stale.add(known.current)
      known.current = undefined
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
      pending = undefined
      documents.clear()
      removal.dispose()
      stopWatching()
      configuration.dispose()
      attached?.dispose()
      attached = undefined
    },
  }
}
