import * as z from 'zod/mini'
import { UI_TEXT } from '../../../shared/constants'
import { compareVersions } from '../../whatsNew/whatsNewVersions'
import type { ReportSourcePayloads, ReportSourcePort } from './types'
import {
  ReportNetworkFailure,
  type ReportNetworkReader,
  type ReportNetworkRequest,
  unavailableReportSource,
} from './cache'

type StoreRow = ReportSourcePayloads['stores'][number]
type Channel = 'Marketplace' | 'Open VSX' | 'npm'
const storeFactSchema = z.strictObject({ version: z.string().check(z.minLength(1)), url: z.url() })

/**
 * N-captures: the host binds a captured endpoint's schema/transformation to
 * this normalized contract. No store JSON shape is guessed on this base.
 */
export interface ReportStoreAdapter {
  readonly channel: Channel
  readonly request: ReportNetworkRequest
  readonly schema: z.ZodMiniType<z.infer<typeof storeFactSchema>>
}
export interface ReportStoreOptions {
  readonly reader: ReportNetworkReader
  readonly project: {
    readonly name: string
    readonly publisher?: string
    readonly engines?: { readonly vscode?: string }
    readonly private?: boolean
  }
  /** Local tag, not the store's own version, is the reference for channel lag. */
  readonly releaseVersion: string
  readonly adapters: readonly ReportStoreAdapter[]
}

function channels(options: ReportStoreOptions): { channel: Channel; url: string }[] {
  const result: { channel: Channel; url: string }[] = []
  const { project } = options
  if (
    project.publisher !== undefined &&
    project.publisher !== '' &&
    project.engines?.vscode !== undefined
  ) {
    result.push(
      {
        channel: 'Marketplace',
        url: `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(`${project.publisher}.${project.name}`)}`,
      },
      {
        channel: 'Open VSX',
        url: `https://open-vsx.org/extension/${encodeURIComponent(project.publisher)}/${encodeURIComponent(project.name)}`,
      },
    )
  }
  if (project.private !== true)
    result.push({
      channel: 'npm',
      url: `https://www.npmjs.com/package/${encodeURIComponent(project.name)}`,
    })
  return result
}

const storeRowsSchema = z.array(
  z.strictObject({
    channel: z.string(),
    version: z.nullable(z.string()),
    url: z.url(),
    status: z.enum(['current', 'lagging', 'unavailable']),
    reason: z.nullable(z.string()),
  }),
)

export function storesReportSource(options: ReportStoreOptions): ReportSourcePort<'stores'> {
  return {
    kind: 'stores',
    id: 'stores',
    async read(context) {
      if (!options.reader.allowed(context))
        return unavailableReportSource('stores', UI_TEXT.reportUi.networkOff)
      const targets = channels(options)
      if (targets.length === 0)
        return unavailableReportSource(
          'stores',
          `${UI_TEXT.reportUi.generationFailed} (no-published-channels)`,
          'notApplicable',
        )
      return await options.reader.read(context, 'stores', storeRowsSchema, async (query) => {
        const rows: StoreRow[] = []
        for (const target of targets) {
          const adapters = options.adapters.filter((adapter) => adapter.channel === target.channel)
          const adapter = adapters[0]
          if (adapter === undefined || adapters.length !== 1) {
            rows.push({
              ...target,
              version: null,
              status: 'unavailable',
              reason: 'store-capture-required',
            })
            continue
          }
          try {
            const fact = storeFactSchema.parse(await query(adapter.request, adapter.schema))
            const isLagging =
              compareVersions(
                fact.version.replace(/^v/, ''),
                options.releaseVersion.replace(/^v/, ''),
              ) < 0
            rows.push({
              ...target,
              version: fact.version,
              status: isLagging ? 'lagging' : 'current',
              reason: null,
            })
          } catch (error: unknown) {
            rows.push({
              ...target,
              version: null,
              status: 'unavailable',
              reason:
                error instanceof ReportNetworkFailure ? error.message : 'store-response-invalid',
            })
          }
        }
        if (rows.every((row) => row.status === 'unavailable'))
          throw new ReportNetworkFailure(
            rows.map((row) => `${row.channel}: ${row.reason ?? 'unavailable'}`).join('; '),
          )
        return {
          data: rows,
          reason: rows.some((row) => row.status === 'unavailable') ? 'channels-unavailable' : null,
        }
      })
    },
  }
}
