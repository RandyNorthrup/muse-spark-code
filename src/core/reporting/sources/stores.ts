import * as z from 'zod/mini'
import { compareVersions, isVersion } from '../../whatsNew/whatsNewVersions'
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
  /**
   * Pre-dispatch refusal (RVCM1136 P2): the channel row is unavailable with
   * this reason and no request is ever sent. The request value is unused.
   */
  readonly refused?: string
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
  const isExtension =
    project.publisher !== undefined &&
    project.publisher !== '' &&
    project.engines?.vscode !== undefined
  if (isExtension) {
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
  // The npm row means the workspace's own published package, read from the
  // manifest that is actually published, never a hard-coded name (PLAN M113
  // §6: a channel only for a project that publishes there). A private
  // manifest publishes no npm package under its own name, so its npm row is
  // refused below with the true reason instead of querying the manifest
  // name (C-M113-6: this repository's npm artifact is the ACP agent's
  // generated manifest, which is not in the workspace to read).
  if (isExtension || project.private !== true)
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
        return unavailableReportSource('stores', context.reportText.reportUi.networkOff)
      const targets = channels(options)
      if (targets.length === 0)
        return unavailableReportSource(
          'stores',
          `${context.reportText.reportUi.generationFailed} (no-published-channels)`,
          'notApplicable',
        )
      return await options.reader.read(context, 'stores', storeRowsSchema, async (query) => {
        const rows: StoreRow[] = []
        for (const target of targets) {
          if (target.channel === 'npm' && options.project.private === true) {
            rows.push({
              ...target,
              version: null,
              status: 'unavailable',
              reason: 'npm-private-manifest',
            })
            continue
          }
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
          if (adapter.refused !== undefined) {
            rows.push({
              ...target,
              version: null,
              status: 'unavailable',
              reason: adapter.refused,
            })
            continue
          }
          try {
            const fact = await query(adapter.request, adapter.schema, storeFactSchema)
            const served = fact.version.replace(/^v/, '')
            const release = options.releaseVersion.replace(/^v/, '')
            // A non-semver local version is reported as what it is: the
            // served version stands, and the reason names the manifest, not
            // the registry document (RVCM1136 P3). A non-semver served
            // version is a bad document, as before.
            if (!isVersion(release)) {
              rows.push({
                ...target,
                version: fact.version,
                status: 'unavailable',
                reason: 'release-version-invalid',
              })
              continue
            }
            if (!isVersion(served)) throw new ReportNetworkFailure('store-response-invalid')
            const isLagging = compareVersions(served, release) < 0
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
