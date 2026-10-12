// The Open VSX channel adapter for the stores report source (M113 lane
// C-M113-6).
//
// Wire provenance (AGENTS.md rule 14): the lead's N-captures handoff
// (2026-10-11, `test/fixtures/m113/stores/openvsx-extension/`) — `GET
// https://open-vsx.org/api/RandyNorthrup/muse-spark-code` answered an
// extension record carrying `version: "0.17.0"` with `versionAlias:
// ["latest"]`, so this adapter reads only `version` and ignores every
// other field. A missing extension answers 404, which the reader reports
// as `http-404`: that refusal needs no adapter code and no guessed 404
// body (the 404 body was not captured).
import * as z from 'zod/mini'
import type { ReportStoreAdapter } from './stores'

export const OPEN_VSX_HOST = 'open-vsx.org'

/**
 * The default Open VSX channel adapter: extension record, `version` only.
 * The publisher and name come from the workspace manifest, never a
 * hard-coded extension.
 */
export function openVsxStoreAdapter(publisher: string, name: string): ReportStoreAdapter {
  const url = `https://${OPEN_VSX_HOST}/api/${encodeURIComponent(publisher)}/${encodeURIComponent(name)}`
  return {
    channel: 'Open VSX',
    request: { url },
    schema: z.pipe(
      z.looseObject({ version: z.string().check(z.minLength(1)) }),
      z.transform((record) => ({ version: record.version, url })),
    ),
  }
}
