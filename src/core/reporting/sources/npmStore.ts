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
// Sibling channels ship their own default adapters from the C-M113-6
// captures: `marketplaceStore.ts`, `openVsxStore.ts`, and the
// workflow/release port in `githubWorkflowReleases.ts`. Nothing here guesses
// a wire field.

import * as z from 'zod/mini'
import { LEGAL_REGISTRY_HOSTS, LEGAL_REGISTRY_NAME_MAX_CHARS } from '../../../shared/constants'
import type { ReportStoreAdapter } from './stores'

// A name the registry can answer: M97's `NPM_NAME_PATTERN`
// (`src/runtime/legal/legalRegistry.ts`), copied beside the adapter because
// the reporting bundle must not import the runtime legal scanner. npm
// rejects uppercase, leading dots and over-long names for new packages, and
// a slash is only meaningful in an `@scope/name` pair — anything else is
// refused as a channel row, never requested (RVCM1136 P2) and never encoded
// into a neighbouring package's URL (RVCM1136 P3).
const NPM_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*[/])?[a-z0-9-~][a-z0-9-._~]*$/

/** Whether a manifest name may be encoded into a registry request. */
export function isNpmPackageName(name: string): boolean {
  return (
    name.length > 0 && name.length <= LEGAL_REGISTRY_NAME_MAX_CHARS && NPM_NAME_PATTERN.test(name)
  )
}

/**
Registry path encoding for one package name. Mirrors the registry's
captured scoped form (`@types%2Fnode`); kept beside the adapter because the
reporting bundle must not import the runtime legal scanner. Only a leading
`@` opens the scoped form: any other slash (an invalid name the adapter
refuses) encodes as `%2F` instead of borrowing a neighbouring scope.
*/
export function encodeNpmPackageName(name: string): string {
  if (name.startsWith('@')) {
    const slash = name.indexOf('/')
    if (slash !== -1)
      return `@${encodeURIComponent(name.slice(1, slash))}%2F${encodeURIComponent(name.slice(slash + 1))}`
  }
  return encodeURIComponent(name)
}

/**
The default npm channel adapter: latest version document, `version` only.
An invalid name is a refused adapter, never a throw: the stores source
reports its channel row as unavailable with the refusal reason, so one bad
manifest name cannot fail the whole report (RVCM1136 P2).
*/
export function npmStoreAdapter(packageName: string): ReportStoreAdapter {
  if (!isNpmPackageName(packageName))
    return {
      channel: 'npm',
      request: { url: `https://${LEGAL_REGISTRY_HOSTS.npm}/` },
      schema: z.pipe(
        z.looseObject({ version: z.string().check(z.minLength(1)) }),
        z.transform((document) => ({ version: document.version, url: '' })),
      ),
      refused: 'npm-package-required',
    }
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
