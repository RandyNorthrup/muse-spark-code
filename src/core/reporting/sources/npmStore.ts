// The npm channel adapter for the stores report source (M113 lane C-M113-6).
//
// Wire provenance (AGENTS.md rule 14): M97 lane R's live capture (2026-10-04,
// docs/certification/m97-r.md) — `GET
// https://registry.npmjs.org/is-even/1.0.0` answered a version document
// carrying `version: "1.0.0"`, kept verbatim at
// test/unit/fixtures/legalRegistry/npm-is-even-1.0.0.json. `GET
// https://registry.npmjs.org/<name>/latest` answers the same version-document
// shape for the newest release, so this adapter reads only `version` and
// ignores every other field. Scoped names keep the bare `@` with an encoded
// slash (`@types%2Fnode`), as captured; encoding the `@` itself answers 404.
// A missing package answers 404 `"Not Found"` (same capture record).
//
// No other channel ships a default adapter on this lane: Marketplace, Open
// VSX, GitHub Actions workflow runs and GitHub releases have no approved wire
// capture (this lane makes no network calls), so those rows stay honestly
// unavailable (`store-capture-required` / `workflow-release-capture-required`)
// until the lead's N-captures handoff lands. Nothing here guesses a wire
// field.

import * as z from 'zod/mini'
import { LEGAL_REGISTRY_HOSTS } from '../../../shared/constants'
import type { ReportStoreAdapter } from './stores'

/**
 * Registry path encoding for one package name. Mirrors the registry's
 * captured scoped form (`@types%2Fnode`); kept beside the adapter because the
 * reporting bundle must not import the runtime legal scanner.
 */
export function encodeNpmPackageName(name: string): string {
  const slash = name.indexOf('/')
  return slash === -1
    ? encodeURIComponent(name)
    : `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`
}

/** The default npm channel adapter: latest version document, `version` only. */
export function npmStoreAdapter(packageName: string): ReportStoreAdapter {
  if (packageName.trim() === '' || /\s/u.test(packageName)) throw new Error('npm-package-required')
  const url = `https://${LEGAL_REGISTRY_HOSTS.npm}/${encodeNpmPackageName(packageName)}/latest`
  return {
    channel: 'npm',
    request: { url },
    schema: z.pipe(
      z.looseObject({ version: z.string().check(z.minLength(1)) }),
      z.transform((document) => ({ version: document.version, url })),
    ),
  }
}
