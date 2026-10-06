// Lazy entry for VSIX hosts, ACP, native stdio adapters and the CLI. Lane W
// registers this entry as dist/usageService.js; no eager host imports it.
import {
  createUsageService,
  type UsageService,
  type UsageServiceDeps,
  type UsageJournalRead,
} from '../../core/usage/usageService'
import { usageText, type UsageTextFormat } from '../../core/usage/usageText'
import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import { setUsageText } from '../../shared/l10n/usageTable'
import {
  usageServiceToPageMessageSchema,
  type UsagePageState,
  type UsageServiceToPageMessage,
} from '../../shared/usagePage'
import {
  USAGE_PROVIDER_CONSOLES,
  USAGE_RECORD_MAX_BYTES,
  USAGE_SETTINGS_FILE,
} from '../../shared/constants'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  UsageJournalStore,
  type UsageJournalRead as StoredJournal,
} from '../../core/usage/journalStore'
import { NodeUsageFs } from './nodeUsageFs'
import { loadUsageTable } from '../../shared/l10n/usageTable'
import { readUsageTableFile } from './usageTableFile'
import {
  USAGE_HISTORY_DAYS_DEFAULT,
  USAGE_HISTORY_DAYS_MIN,
  USAGE_HISTORY_DAYS_MAX,
  CHECKPOINT_STORAGE_MODE,
} from '../../shared/constants'
import {
  exportUsageCallsCsv,
  exportUsageJson,
  exportUsageSummaryCsv,
} from '../../core/usage/usageExport'
import { usageRange, type UsageAggregateRow } from '../../core/usage/aggregate'
import type { UsageAccess, UsageAccessDeps, UsagePagePorts } from './usageAdapter'
import type { UsageWriterBundle } from '../../core/usage/recording'
import { readTraceAttempts } from './traceLogs'
import { writeFileAtomically } from '../../host/fsAtomic'
import { setTimeout as delay } from 'node:timers/promises'

export { runUsageCommand } from './usageCli'

export { createInsightsReader } from './traceLogs'

const settingsSchema = z.strictObject({
  enabled: z.boolean(),
  days: z.int().check(z.minimum(USAGE_HISTORY_DAYS_MIN), z.maximum(USAGE_HISTORY_DAYS_MAX)),
})
function readSettings(dataFolder: string): z.infer<typeof settingsSchema> {
  try {
    return settingsSchema.parse(
      JSON.parse(readFileSync(path.join(dataFolder, USAGE_SETTINGS_FILE), 'utf8')),
    )
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return { enabled: true, days: USAGE_HISTORY_DAYS_DEFAULT }
    throw new Error('invalidUsageSettings', { cause: error })
  }
}
function unsupported(): never {
  throw new Error('unsupportedUsageAction')
}
export const createUsageWriter: UsageWriterBundle['createUsageWriter'] = (options) => {
  return Promise.resolve(
    new UsageJournalStore(new NodeUsageFs(options.dataFolder, options.now), {
      ...options,
      isEnabled: () => options.isEnabled() && readSettings(options.dataFolder).enabled,
    }),
  )
}

/** Adapt validated stored rollups without inventing unknown paired rates. */
function aggregateRows(journal: StoredJournal): UsageAggregateRow[] {
  return journal.rollups.map((row) => ({
    day: row.day,
    client: row.client,
    backend: row.backend,
    provider: row.provider,
    model: row.model,
    kind: row.kind,
    histogram: row.latencyHistogram,
    totals: {
      records: row.records,
      tokens: row.tokens,
      units: row.units,
      costs: [
        {
          certainty: row.cost.certainty,
          records: row.records,
          ...(row.cost.usd !== undefined && { usd: row.cost.usd }),
          ...(row.cost.apiEquivalentUsd !== undefined && {
            apiEquivalentUsd: row.cost.apiEquivalentUsd,
          }),
        },
      ],
      retries: row.retries,
      rateLimited: row.rateLimited,
      ...(row.durationMs !== undefined && { durationMs: row.durationMs }),
      ...(row.firstTokenMs !== undefined && { firstTokenMs: row.firstTokenMs }),
      ...(row.packedAvoided !== undefined && { packedAvoided: row.packedAvoided }),
    },
  }))
}

/** J's store, S's service and formatter are shared by every editor surface. */
export function createUsageAccess(deps: UsageAccessDeps): UsageAccess {
  setUiText(deps.uiText, deps.locale)
  const settings = () => {
    const stored = readSettings(deps.dataFolder)
    const configured = deps.historySettings?.()
    return configured === undefined
      ? stored
      : { ...configured, enabled: configured.enabled && stored.enabled }
  }
  const store = new UsageJournalStore(new NodeUsageFs(deps.dataFolder), {
    writerId: randomUUID(),
    now: Date.now,
    isEnabled: () => settings().enabled,
    onWriteError: () => {
      deps.log.warn('Usage history could not be recorded')
    },
  })
  let retainedDay: string | undefined
  const providers = new Set<string>()
  const readJournal = async (): Promise<StoredJournal> => {
    await deps.beforeRead?.()
    const day = new Date().toDateString()
    if (retainedDay !== day && settings().enabled && (await store.retain(settings().days)))
      retainedDay = day
    const journal = await store.read()
    for (const row of [...journal.records, ...journal.rollups]) providers.add(row.provider)
    return journal
  }
  const table = (async () => {
    const loaded = await loadUsageTable({
      language: deps.locale,
      readTableFile: (segments) => readUsageTableFile(deps.packageRoot, segments),
      warn: (message) => {
        deps.log.warn(message)
      },
    })
    setUsageText(loaded.table)
    return loaded
  })()
  const setHistory = async (isEnabled: boolean): Promise<void> => {
    await mkdir(deps.dataFolder, { recursive: true, mode: CHECKPOINT_STORAGE_MODE })
    await writeFileAtomically(
      path.join(deps.dataFolder, USAGE_SETTINGS_FILE),
      JSON.stringify({ ...settings(), enabled: isEnabled }),
      { sleep: delay },
    )
  }
  const snapshots = new WeakMap<UsageJournalRead, StoredJournal>()
  const service = async (ports?: UsagePagePorts): Promise<UsageService> =>
    createUsageService({
      now: Date.now,
      host: deps.host,
      table: await table,
      capabilities: {
        settings: ports?.openSettings !== undefined,
        folder: ports?.revealFolder !== undefined,
        models: ports?.openModels !== undefined,
        external: ports?.openExternal !== undefined,
        export: ports?.saveFile !== undefined,
        deleteHistory: ports?.confirmDelete !== undefined,
        setHistory: ports?.setHistory !== undefined,
        ...(ports?.exportMaxBytes !== undefined && { exportMaxBytes: ports.exportMaxBytes }),
      },
      history: () => ({ enabled: settings().enabled, historyDays: settings().days }),
      journal: {
        read: async () => {
          const journal = await readJournal()
          const adapted = { ...journal, rollups: aggregateRows(journal) }
          snapshots.set(adapted, journal)
          return adapted
        },
        deleteHistory: () => store.reset(),
      },
      readBudgets: deps.live?.readBudgets ?? (() => Promise.resolve([])),
      readLiveLimits: deps.live?.readLiveLimits ?? (() => Promise.resolve([])),
      readAttempts: deps.live?.readAttempts ?? (() => readTraceAttempts({ homeDir: homedir() })),
      providerConsoles: () => {
        const consoles = deps.live?.providerConsoles() ?? []
        return [
          ...consoles,
          ...[...providers]
            .filter((provider) => consoles.every((row) => row.provider !== provider))
            .map((provider) => {
              const consoleUrl = USAGE_PROVIDER_CONSOLES[provider]
              return { provider, ...(consoleUrl !== undefined && { consoleUrl }) }
            }),
        ]
      },
      ...(deps.live?.readModelPrice !== undefined && { readModelPrice: deps.live.readModelPrice }),
      ...(deps.live?.priceUnpriced !== undefined && { priceUnpriced: deps.live.priceUnpriced }),
      saveFile:
        ports?.saveFile === undefined
          ? unsupported
          : (file) =>
              ports.saveFile?.(
                file.content,
                file.mimeType === 'application/json' ? 'json' : 'csv',
              ) ?? Promise.resolve(false),
      confirmDelete:
        ports?.confirmDelete === undefined
          ? unsupported
          : (prompt) => ports.confirmDelete?.(prompt.count) ?? Promise.resolve(false),
      setHistory: ports?.setHistory ?? setHistory,
      ...(ports !== undefined && {
        openSettings: ports.openSettings,
        revealFolder: ports.revealFolder,
        openModels: ports.openModels,
        openExternal: ports.openExternal,
      }),
      exportFile: (format, _journal, state) => {
        const journal = snapshots.get(_journal)
        if (journal === undefined) throw new Error('missingUsageSnapshot')
        const { from, to } = usageRange(state.query, state.generatedAt)
        const range = { from, to }
        let content: string
        if (format === 'json') content = exportUsageJson(journal, range, state)
        else if (format === 'callsCsv')
          content = exportUsageCallsCsv(journal, range, state.generatedAt)
        else content = exportUsageSummaryCsv(state)
        return Promise.resolve({
          name: `usage.${format === 'json' ? 'json' : 'csv'}`,
          mimeType: format === 'json' ? 'application/json' : 'text/csv',
          content,
        })
      },
    })
  return {
    setHistory,
    connect: (ports) => {
      const connection = service(ports)
      const lifecycle = { isDisposed: false }
      const isOpen = () => !lifecycle.isDisposed
      return {
        receive: async (message) => {
          const current = await connection
          if (!isOpen()) throw new Error('usageConnectionClosed')
          const replies = await current.handle(message)
          if (isOpen()) for (const reply of replies) ports.post(reply)
        },
        dispose: () => {
          lifecycle.isDisposed = true
        },
      }
    },
    read: async (query) => {
      const current = await service()
      return await current.snapshot(query)
    },
    usageText: (state, format, section) => usageText(state, format, section),
    export: async (query, format) => {
      let content: string | undefined
      const exporter = await service({
        post: unsupported,
        confirmDelete: unsupported,
        openSettings: unsupported,
        revealFolder: unsupported,
        openModels: unsupported,
        openExternal: unsupported,
        setHistory: unsupported,
        saveFile: (value) => {
          content = value
          return Promise.resolve(true)
        },
      })
      await exporter.handle({ type: 'usage/export', requestId: randomUUID(), format, query })
      if (content === undefined) throw new Error('usageExportFailed')
      return content
    },
  }
}

export interface UsageServiceEntryDeps extends UsageServiceDeps {
  readonly uiText: UiText
  readonly uiLocale: string
}
export function createUsageFeatures(
  deps: UsageServiceEntryDeps,
): UsageService & { readonly text: (state: UsagePageState, format?: UsageTextFormat) => string } {
  setUiText(deps.uiText, deps.uiLocale)
  setUsageText(deps.table.table)
  return { ...createUsageService(deps), text: usageText }
}

/** NDJSON transport for native plugins; CLI routing belongs to lane E. */
export async function serveUsageStdio(
  service: UsageService,
  ports: {
    readonly requests: AsyncIterable<string>
    readonly sendLine: (line: string) => Promise<void>
  },
): Promise<void> {
  for await (const line of ports.requests) {
    let replies: UsageServiceToPageMessage[]
    try {
      if (Buffer.byteLength(line, 'utf8') >= USAGE_RECORD_MAX_BYTES)
        throw new Error('oversized usage request')
      const input: unknown = JSON.parse(line)
      replies = await service.handle(input)
    } catch {
      replies = [{ type: 'usage/error', code: 'invalidMessage' }]
    }
    for (const reply of replies) {
      await ports.sendLine(`${JSON.stringify(usageServiceToPageMessageSchema.parse(reply))}\n`)
    }
  }
}

export { replyAcpUsage } from './usageAcp'
export { setUiText } from '../../shared/l10n/text'
