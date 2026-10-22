// M100 phase 2 (lane W): the production Devices tab. One live tab for the
// Devices surface: opening it never loads the bundle, and the first host
// message does (through the shared lazy port). Unparsable webview traffic
// is logged and ignored; service refusals already carry their typed setup
// failure for the recovery UI, and a service that cannot open at all
// (an unqualified host, unusable storage) answers the request that needed
// it with that typed failure instead of leaving the document waiting.
import type * as vscode from 'vscode'
import * as z from 'zod/mini'
import { DEVICES_PANEL_VIEW_TYPE, UI_TEXT } from '../../shared/constants'
import type { DeviceHostMessage } from '../../shared/devicesPanel'
import type { DeviceProductionContext } from '../devices/deviceEntry'
import type { DeviceExecutionHost } from '../devices/deviceSecrets'
import { deviceMethods } from '../devices/deviceBundle'
import { logRejection, type Logger } from '../logger'
import { createAuxWebviewPanel } from './auxWebviewPanel'
import type { WebviewHostContext } from './webviewSetup'

/** The lazily loaded device service behind this tab; construction loads nothing. */
export interface DevicesPanelService {
  request(input: unknown, signal?: AbortSignal): Promise<DeviceHostMessage>
}

/** What the editor reports about this extension host, before any Devices code loads. */
export interface DeviceHostFacts {
  readonly uiKind: 'desktop' | 'web'
  readonly remoteName: string | undefined
  readonly extensionKind: 'ui' | 'workspace'
}

/**
The host qualification D80 checks, from the editor's own facts: a remote
window runs a workspace extension on the remote machine while VS Code keeps
SecretStorage on the client, so neither execution nor secrets are local
there. `assertLocalDeviceHost` refuses every such host.
*/
export function deviceExecutionHost(facts: DeviceHostFacts): DeviceExecutionHost {
  const isRemoteExecution = facts.remoteName !== undefined && facts.extensionKind === 'workspace'
  return {
    ui: facts.uiKind,
    remoteName: facts.remoteName,
    execution: isRemoteExecution ? 'remote' : 'local',
    secretLocation: isRemoteExecution ? 'client' : 'execution-host',
  }
}

// Only the correlation envelope: the bundle's strict parser owns the rest.
const deviceRequestCorrelation = z.object({
  type: z.literal('deviceRequest'),
  viewId: z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/)),
  requestId: z.string().check(z.regex(/^[a-f0-9]{32}$(?![\s\S])/)),
  revision: z.int().check(z.gte(0)),
})
type OpenRefusal = 'unsupported-host' | 'storage'

/** The typed reason a service that could not open gives, if it gave one. */
function openRefusal(error: unknown): OpenRefusal | undefined {
  if (!(error instanceof Error) || !('reason' in error)) return undefined
  return error.reason === 'unsupported-host' || error.reason === 'storage'
    ? error.reason
    : undefined
}

export class DevicesPanelTab implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined
  private isReady = false
  // Once a request was refused here, this document's revisions are this
  // tab's own; it is never handed to a service whose revisions would collide.
  private refusal: { reason: OpenRefusal; revision: number } | undefined

  public constructor(
    private readonly context: Pick<WebviewHostContext, 'extensionUri' | 'l10n' | 'log'>,
    private readonly service: () => Promise<DevicesPanelService>,
    private readonly onDisposed?: () => void,
  ) {}

  private send(message: DeviceHostMessage): void {
    if (!this.isReady || this.panel === undefined) return
    void this.panel.webview.postMessage(message)
  }

  /** Answers a request locally with the typed refusal; false when it is not one. */
  private refuse(raw: unknown, reason: OpenRefusal): boolean {
    const request = deviceRequestCorrelation.safeParse(raw)
    if (!request.success) return false
    const revision = Math.max(this.refusal?.revision ?? 0, request.data.revision) + 1
    this.refusal = { reason, revision }
    this.send({
      type: 'deviceState',
      revision,
      state: { enabled: false },
      setup: { viewId: request.data.viewId, requestId: request.data.requestId, failure: reason },
    })
    return true
  }

  public open(): void {
    if (this.panel !== undefined) {
      this.panel.reveal(undefined, false)
      return
    }
    const panel = createAuxWebviewPanel(
      this.context,
      DEVICES_PANEL_VIEW_TYPE,
      UI_TEXT.devices.title,
      'devices',
    )
    this.panel = panel
    this.isReady = false
    this.refusal = undefined
    const subscription = panel.webview.onDidReceiveMessage((raw: unknown) => {
      // Readiness only: the document announces itself with `devicesReady`
      // (replayed observations follow through the same reply). The service
      // still strictly parses every message before use.
      if (typeof raw === 'object' && raw !== null && 'type' in raw && raw.type === 'devicesReady') {
        this.isReady = true
      }
      if (this.refusal !== undefined) {
        this.refuse(raw, this.refusal.reason)
        return
      }
      const deliver = async (): Promise<void> => {
        let service: DevicesPanelService
        try {
          service = await this.service()
        } catch (error) {
          const reason = openRefusal(error)
          if (reason === undefined || !this.refuse(raw, reason)) throw error
          return
        }
        this.send(await service.request(raw))
      }
      void deliver().catch(logRejection(this.context.log, 'devices request'))
    })
    panel.onDidDispose(() => {
      subscription.dispose()
      this.panel = undefined
      this.isReady = false
      this.onDisposed?.()
    })
  }

  /** Host-side pushes (observations, grant prompts) reach the document. */
  public publish(message: DeviceHostMessage): void {
    if (this.refusal === undefined) this.send(message)
  }

  public dispose(): void {
    this.panel?.dispose()
  }
}

/**
The window-owned Devices service and its one tab. Disposing it (the
window's subscriptions do, at deactivation) closes the tab, revokes a
preparation still in flight and ends a bound service with its store and
storage helper. Lane K binds execution, approval policy, the channel source
and the listener facts after its owner-validity check; until then those
actions refuse explicitly instead of succeeding without an owner check.
*/
export function devicesWindow(options: {
  readonly hostContext: Pick<WebviewHostContext, 'extensionUri' | 'l10n' | 'log'>
  readonly bundlePath: string
  readonly log: Logger
  readonly production: Omit<DeviceProductionContext, 'log'>
  readonly loadBundle?: ((file: string) => unknown) | undefined
}): vscode.Disposable & { open(): void } {
  const { log } = options
  let tab: DevicesPanelTab | undefined
  const methods = deviceMethods({
    bundlePath: options.bundlePath,
    log,
    loadBundle: options.loadBundle,
    dependencies: async (bundle, scope) => {
      const deps = await bundle.openDeviceProductionDeps(
        bundle,
        { ...options.production, log },
        bundle.unboundDeviceLanePorts(log),
      )
      scope.own(() => {
        void deps.dispose()
      })
      return {
        ...deps,
        snapshot: () => Promise.resolve({ enabled: false as const }),
        publish: (message) => {
          tab?.publish(message)
        },
        report: (reason) => {
          log.error(`Devices report: ${reason}`)
        },
      }
    },
  })
  return {
    open(): void {
      tab ??= new DevicesPanelTab(
        options.hostContext,
        () => methods.service(),
        () => {
          tab = undefined
        },
      )
      tab.open()
    },
    dispose(): void {
      tab?.dispose()
      tab = undefined
      methods.dispose()
    },
  }
}
