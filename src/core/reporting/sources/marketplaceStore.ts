// The Marketplace channel adapter for the stores report source (M113 lane
// C-M113-6).
//
// Wire provenance (AGENTS.md rule 14): the lead's N-captures handoff
// (2026-10-11, `test/fixtures/m113/stores/marketplace-extensionquery/`)
// — `POST
// https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery?api-version=3.0-preview.1`
// answered `results[0].extensions[0].versions[0].version: "0.17.0"`. The
// query form (API version in the URL) is the one `publicReportTransport`
// can send: it adds `Content-Type` to a POST and nothing else, so the
// `Accept`-header form `scripts/refresh-badges.mjs` uses is not available
// to reports. The body is the same form that script sends (name filter,
// `filterType` 7, `flags` 513), with the workspace's own
// `<publisher>.<name>` as the value. The served version is read exactly
// where that script reads it (`versions[0]`).
//
// Refusals, each with its own reason: an empty `extensions` array means the
// gallery lists nothing under the queried name (`marketplace-not-listed`);
// any other shape deviation is a bad document (`store-response-invalid`).
// The not-listed answer itself was not captured, so no not-listed body
// shape is asserted beyond the empty extensions array of the captured one.
import * as z from 'zod/mini'
import { ReportNetworkFailure } from './cache'
import type { ReportStoreAdapter } from './stores'

export const MARKETPLACE_HOST = 'marketplace.visualstudio.com'
const MARKETPLACE_API_VERSION = '3.0-preview.1'

const extensionSchema = z.looseObject({
  versions: z.array(z.looseObject({ version: z.string().check(z.minLength(1)) })),
})

/**
The default Marketplace channel adapter: latest gallery version, `version`
only. The publisher and name come from the workspace manifest, never a
hard-coded extension.
*/
export function marketplaceStoreAdapter(publisher: string, name: string): ReportStoreAdapter {
  const url = `https://${MARKETPLACE_HOST}/_apis/public/gallery/extensionquery?api-version=${MARKETPLACE_API_VERSION}`
  const body = JSON.stringify({
    filters: [
      {
        pageNumber: 1,
        pageSize: 1,
        criteria: [{ filterType: 7, value: `${publisher}.${name}` }],
      },
    ],
    assetTypes: [],
    flags: 513,
  })
  return {
    channel: 'Marketplace',
    request: { url, method: 'POST', body },
    schema: z.pipe(
      z.looseObject({
        results: z
          .array(z.looseObject({ extensions: z.array(extensionSchema) }))
          .check(z.minLength(1)),
      }),
      z.transform((answer) => {
        const extension = answer.results[0]?.extensions[0]
        if (extension === undefined) throw new ReportNetworkFailure('marketplace-not-listed')
        const version = extension.versions[0]?.version
        if (version === undefined) throw new ReportNetworkFailure('store-response-invalid')
        return { version, url }
      }),
    ),
  }
}
