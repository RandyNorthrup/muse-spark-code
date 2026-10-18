// The scanner's pinned SPDX data (M97, PLAN.md D76): the identifier and
// exception lists vendored under `data/`, with their provenance. No
// runtime download: the data ships with the extension and the result names
// its version. Custom or unrecognized licenses stay unknown rather than
// expanding into an unreviewed database.

import exceptionIds from './data/spdxExceptions.json'
import deprecatedExceptionIds from './data/spdxExceptionsDeprecated.json'
import * as z from 'zod/mini'
import deprecatedIds from './data/spdxLicenseIdsDeprecated.json'
import currentIds from './data/spdxLicenseIds.json'
import provenance from './data/provenance.json'

/** The vendored SPDX License List identifier set (current ids). */
export const SPDX_LICENSE_IDS: ReadonlySet<string> = new Set(currentIds)

/** SPDX ids retired from the list; still recognized, flagged as deprecated. */
export const SPDX_DEPRECATED_LICENSE_IDS: ReadonlySet<string> = new Set(deprecatedIds)

/** The vendored SPDX exception list for `WITH` expressions. */
export const SPDX_EXCEPTIONS: ReadonlySet<string> = new Set(exceptionIds)

/** Retired SPDX exceptions; still recognized, flagged as deprecated. */
export const SPDX_DEPRECATED_EXCEPTIONS: ReadonlySet<string> = new Set(deprecatedExceptionIds)

const canonicalByLowerId = new Map<string, string>()
for (const id of SPDX_LICENSE_IDS) {
  canonicalByLowerId.set(id.toLowerCase(), id)
}
for (const id of SPDX_DEPRECATED_LICENSE_IDS) {
  if (!canonicalByLowerId.has(id.toLowerCase())) {
    canonicalByLowerId.set(id.toLowerCase(), id)
  }
}

const canonicalExceptionByLowerId = new Map<string, string>()
for (const id of SPDX_EXCEPTIONS) {
  canonicalExceptionByLowerId.set(id.toLowerCase(), id)
}
for (const id of SPDX_DEPRECATED_EXCEPTIONS) {
  if (!canonicalExceptionByLowerId.has(id.toLowerCase())) {
    canonicalExceptionByLowerId.set(id.toLowerCase(), id)
  }
}

/**
 * The list's own spelling of a license id, matched case-insensitively
 * (manifests commonly write `mit`): `undefined` when the id is neither
 * current nor deprecated.
 */
export function canonicalLicenseId(id: string): string | undefined {
  return canonicalByLowerId.get(id.toLowerCase())
}

/** Whether an id is on the retired list (still a real SPDX identifier). */
export function isDeprecatedLicenseId(id: string): boolean {
  return SPDX_DEPRECATED_LICENSE_IDS.has(canonicalLicenseId(id) ?? id)
}

/**
 * The exception list's own spelling of a `WITH` exception id, or
 * `undefined` when unrecognized.
 */
export function canonicalExceptionId(id: string): string | undefined {
  return canonicalExceptionByLowerId.get(id.toLowerCase())
}

/**
 * One pinned SPDX template file (M97 CM971-R3): its path under
 * `legal-data/`, what it holds, and the SHA-256 of its exact upstream
 * bytes. The files themselves ship beside the scanner, not inside it, so
 * the 150 KiB scanner budget carries only these records.
 */
export interface SpdxTemplateFile {
  readonly path: string
  readonly kind: 'template' | 'equivalentWords'
  readonly sha256: string
}

const TEMPLATE_DATASET = 'spdx-license-templates'

const templateFileSchema = z.array(
  z.object({
    path: z.string().check(z.regex(/^[\w.-]+(?:\/[\w.-]+)?$/u)),
    kind: z.enum(['template', 'equivalentWords']),
    sha256: z.string().check(z.regex(/^[0-9a-f]{64}$/u)),
  }),
)

/**
 * The pinned template files from the provenance record. A missing or
 * malformed record yields no files, which the loader reports as a named
 * problem, so matching fails closed instead of guessing.
 */
export const SPDX_TEMPLATE_FILES: readonly SpdxTemplateFile[] =
  templateFileSchema.safeParse(
    provenance.datasets.find((dataset) => dataset.name === TEMPLATE_DATASET)?.files,
  ).data ?? []

/** Where the vendored data came from; see `data/provenance.json`. */
export type SpdxProvenance = typeof provenance

/** The dataset tag the scan result carries as its data version. */
export const SPDX_DATA_VERSION: string = provenance.dataVersion

/** The provenance record for review surfaces and the certification log. */
export function spdxProvenance(): SpdxProvenance {
  return provenance
}
