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
  /** The id the host wrote into this surface's current document (webviewSetup.ts). */
  readonly documentId: string
  post(message: HostToWebviewMessage): void
  reveal(): void
}

/** Show's open: for one surface id, numbered; `offeredTo` is the document it was offered to. */
interface PendingOpen {
  readonly surfaceId: string
  readonly seq: number
  offeredTo: string | undefined
}

/**
 * One Show resources run. A newer Show, its target's removal and the window's
 * disposal abort it; after every await it stops if aborted, before any reveal,
 * open or offer.
 */
interface ShowOperation {
  readonly seq: number
  readonly controller: AbortController
  /** The surface in view when Show ran; else the new conversation's surface id, once opened. */
  target: ResourceSurface | string | undefined
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
  /** A document asks for a pending open (its chip mounted), naming itself. */
  pull(surface: ResourceSurface, nonce: string): void
  /** A document opened the popover for `seq`. */
  acknowledge(surface: ResourceSurface, seq: number, nonce: string): void
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
  // Host-issued document identity. A surface's `documentId` is the one current
  // document of that webview; a pull or ack naming any other id is ignored,
  // never promoted, so the order messages arrive in decides nothing.
  // `listening`: per surface id, the document whose chip pulled (it may since
  // have been replaced, which `offer` checks).
  const listening = new Map<
    string,
    { readonly surface: ResourceSurface; readonly documentId: string }
  >()
  let sequence = 0
  let pending: PendingOpen | undefined
  let operation: ShowOperation | undefined
  let attached: { readonly window: ResourceWindowHost; dispose(): void } | undefined
  let isDisposed = false

  /** Offer the pending open to its surface's current document, if that document pulled. */
  const offer = (surfaceId: string) => {
    const document = listening.get(surfaceId)
    if (
      document === undefined ||
      pending?.surfaceId !== surfaceId ||
      document.surface.documentId !== document.documentId
    )
      return
    pending.offeredTo = document.documentId
    document.surface.post({ type: 'resourceOpen', seq: pending.seq, nonce: document.documentId })
  }
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
    // The latest Show wins: the one before stops, and its open is withdrawn.
    operation?.controller.abort()
    pending = undefined
    sequence += 1
    // Bound now, before any await: the chat in view, or none (a new conversation).
    const active = deps.surfaces.active
    const current: ShowOperation = {
      seq: sequence,
      controller: new AbortController(),
      target: active,
    }
    operation = current
    // A call, not a narrowed property: an abort can land during any await.
    const isAborted = () => current.controller.signal.aborted
    try {
      // The governor's state first: when it is off, nothing opens or takes focus.
      const window = await loaded()
      if (isAborted()) return
      const status = await window.port.refreshStatus()
      if (isAborted()) return
      publish(status)
      if (!status.settings.enabled) {
        await governorOff()
        return
      }
      if (active !== undefined) {
        active.reveal()
        pending = { surfaceId: active.id, seq: current.seq, offeredTo: undefined }
        offer(active.id)
        return
      }
      // Awaited as soon as it starts: a rejection always reaches this Show.
      const conversation = deps.openConversation()
      current.target = conversation.surfaceId
      pending = { surfaceId: conversation.surfaceId, seq: current.seq, offeredTo: undefined }
      await conversation.opened
      if (isAborted()) return
      // A surface that already existed (the sidebar) pulled before this Show.
      offer(conversation.surfaceId)
    } catch (error: unknown) {
      // Its own open only: a newer Show's stays.
      if (pending?.seq === current.seq) pending = undefined
      throw error
    } finally {
      if (operation === current) operation = undefined
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
  // A removed target cancels its open and stops its Show; it is never redirected.
  const removal = deps.surfaces.onRemoved((surface) => {
    if (listening.get(surface.id)?.surface === surface) listening.delete(surface.id)
    if (pending?.surfaceId === surface.id) pending = undefined
    const target = operation?.target
    if (target === surface || target === surface.id) operation?.controller.abort()
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
      if (isDisposed || nonce !== surface.documentId) return
      listening.set(surface.id, { surface, documentId: nonce })
      offer(surface.id)
    },
    acknowledge: (surface, seq, nonce) => {
      // Only the current document's ack, for the seq offered to that document.
      if (isDisposed || nonce !== surface.documentId) return
      if (pending?.surfaceId === surface.id && pending.seq === seq && pending.offeredTo === nonce)
        pending = undefined
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
      operation?.controller.abort()
      operation = undefined
      pending = undefined
      listening.clear()
      removal.dispose()
      stopWatching()
      configuration.dispose()
      attached?.dispose()
      attached = undefined
    },
  }
}
