// Lane E's injected seam to lane S. No service implementation or usage strings
// enter activation/ACP: the installed service and companion load on first use.
import path from 'node:path'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import type {
  UsagePageState,
  UsagePageToServiceMessage,
  UsageQuery,
  UsageServiceToPageMessage,
} from '../../shared/usagePage'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { runUsageCommand } from './usageCli'

export interface UsagePagePorts {
  readonly post: (message: UsageServiceToPageMessage) => void
  readonly saveFile: (content: string, format: 'csv' | 'json') => Promise<boolean>
  readonly confirmDelete: (records: number) => Promise<boolean>
  readonly openSettings: () => Promise<void>
  readonly revealFolder: () => Promise<void>
  readonly openModels: (provider: string, model?: string) => Promise<void>
  readonly openExternal: (url: string) => Promise<void>
  readonly setHistory: (isEnabled: boolean) => Promise<void>
}

export interface UsagePageConnection {
  readonly receive: (message: UsagePageToServiceMessage) => Promise<void>
  readonly dispose: () => void
}

export type UsageSection = 'summary' | 'daily' | 'models' | 'limits'
export type UsageExportFormat = 'callsCsv' | 'summaryCsv' | 'json'

/** Lane S implements these operations over the same service and aggregates. */
export interface UsageAccess {
  readonly connect: (ports: UsagePagePorts) => UsagePageConnection
  readonly read: (query: UsageQuery) => Promise<UsagePageState>
  readonly usageText: (
    state: UsagePageState,
    format: 'plain' | 'markdown',
    section: UsageSection,
  ) => string
  readonly export: (query: UsageQuery, format: UsageExportFormat) => Promise<string>
}

export interface UsageAccessDeps {
  readonly dataFolder: string
  readonly packageRoot: string
  readonly host: string
  readonly locale: string
  readonly uiText: UiText
  readonly log: CoreLogger
  readonly historySettings?: () => { readonly enabled: boolean; readonly days: number }
}

interface UsageServiceBundle {
  readonly createUsageAccess: (deps: UsageAccessDeps) => UsageAccess
  readonly runUsageCommand: typeof runUsageCommand
}
interface UsageCompanionBundle {
  readonly openUsageCompanion: (deps: {
    readonly usage: UsageAccess
    readonly assetsFolder: string
    readonly locale: string
  }) => Promise<{
    readonly url: string
    readonly close: () => Promise<void>
    /** Resolves on idle shutdown too, so another command never reuses a dead URL. */
    readonly closed: Promise<void>
  }>
}
function isService(value: unknown): value is UsageServiceBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createUsageAccess' in value &&
    typeof value.createUsageAccess === 'function' &&
    'runUsageCommand' in value &&
    typeof value.runUsageCommand === 'function'
  )
}
function isCompanion(value: unknown): value is UsageCompanionBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'openUsageCompanion' in value &&
    typeof value.openUsageCompanion === 'function'
  )
}

export interface UsageAdapter {
  readonly access: () => UsageAccess
  readonly openPage: () => Promise<string>
  readonly dispose: () => Promise<void>
  readonly runCommand: typeof runUsageCommand
}

/** Validate before handing a companion URL to an editor or an OS opener. */
export function usageCompanionUrl(input: string): string {
  const url = new URL(input)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    !/^#[\da-f]{64}$/iu.test(url.hash)
  ) {
    throw new Error(UI_TEXT.actionFailed)
  }
  return url.href
}

export function lazyUsageAdapter(
  deps: UsageAccessDeps & { readonly loadBundle?: (file: string) => unknown },
): UsageAdapter {
  const service = lazyBundleLoader({
    bundlePath: path.join(deps.packageRoot, 'dist', 'usageService.js'),
    log: deps.log,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    isBundle: isService,
    label: 'usage service',
    unavailable: () => UI_TEXT.actionFailed,
  })
  const companion = lazyBundleLoader({
    bundlePath: path.join(deps.packageRoot, 'dist', 'usageCompanion.js'),
    log: deps.log,
    ...(deps.loadBundle !== undefined && { loadBundle: deps.loadBundle }),
    isBundle: isCompanion,
    label: 'usage companion',
    unavailable: () => UI_TEXT.actionFailed,
  })
  let access: UsageAccess | undefined
  let page: ReturnType<UsageCompanionBundle['openUsageCompanion']> | undefined
  const observeClose = async (started: NonNullable<typeof page>): Promise<void> => {
    try {
      const server = await started
      await server.closed
    } catch {
      // A failed start owns its caller's error; no dead URL remains cached.
    } finally {
      if (page === started) page = undefined
    }
  }
  return {
    runCommand: (command, ports) => service().runUsageCommand(command, ports),
    access: () => (access ??= service().createUsageAccess(deps)),
    openPage: async () => {
      if (page === undefined) {
        const started = companion().openUsageCompanion({
          usage: (access ??= service().createUsageAccess(deps)),
          assetsFolder: path.join(deps.packageRoot, 'dist', 'webview'),
          locale: deps.locale,
        })
        page = started
        void observeClose(started)
      }
      const current = page
      try {
        const server = await current
        return usageCompanionUrl(server.url)
      } catch (error: unknown) {
        if (page === current) page = undefined
        try {
          const server = await current
          await server.close()
        } catch {
          /* The original start/URL error is the refusal. */
        }
        throw error
      }
    },
    dispose: async () => {
      const closing = page
      page = undefined
      if (closing === undefined) return
      try {
        const server = await closing
        await server.close()
      } catch {
        /* A failed start already reached its caller. */
      }
    },
  }
}
