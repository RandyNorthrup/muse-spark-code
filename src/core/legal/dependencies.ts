import * as z from 'zod/mini'
// Shared dependency evidence (M97, PLAN.md D76): every ecosystem reader
// returns the same shape — declared packages with their license evidence,
// plus the coverage it could not establish. Readers parse manifests and
// locks already present in the workspace; no resolver, install or build
// file ever runs. Findings are built later from this evidence, so every
// reader stays a pure function of the snapshot.

/** Where a dependency stands: production, development, optional, unknown. */
export type LegalDependencyScope = 'production' | 'development' | 'optional' | 'unknown'

/** One declared package and the license evidence found for it. */
export interface LegalDependency {
  /** The D76 ecosystem row: npm, pip, cargo, go, maven, gradle, nuget, composer, gems. */
  readonly ecosystem: string
  readonly name: string
  readonly version: string | undefined
  readonly scope: LegalDependencyScope
  /** The license declaration as written, before SPDX parsing. */
  readonly licenseRaw: string | undefined
  /** The manifest or lock holding the evidence above. */
  readonly evidenceFile: string
  /** The scanner's own words for the lane 0 finding field. */
  readonly evidenceSource: string
}

/** A manifest's license declaration, for the project-license comparison. */
export interface ManifestLicenseDeclaration {
  /** The license field as written (an SPDX expression, once joined). */
  readonly raw: string
  /** The manifest holding it. */
  readonly file: string
}

/** An ecosystem reader's outcome: evidence plus honest coverage gaps. */
export interface EcosystemResult {
  readonly dependencies: readonly LegalDependency[]
  /** Project manifests' own license declarations (root and members). */
  readonly projectLicenses: readonly ManifestLicenseDeclaration[]
  /** Each starts `not checked: ` and names its reason. */
  readonly incomplete: readonly string[]
}

/** Installed package evidence shared by manifest and distribution readers. */
export interface InstalledLicenseMetadata {
  readonly version: string | undefined
  readonly licenseRaw: string | undefined
  readonly file: string
}

/** One dependency with its evidence, for readers with a single source. */
export function dependency(
  ecosystem: string,
  evidenceFile: string,
  name: string,
  init: {
    readonly version?: string | undefined
    readonly scope?: LegalDependencyScope
    readonly licenseRaw?: string | undefined
  } = {},
): LegalDependency {
  const built: LegalDependency = {
    ecosystem,
    name,
    version: init.version,
    scope: init.scope ?? 'unknown',
    licenseRaw: init.licenseRaw,
    evidenceFile,
    evidenceSource: `${ecosystem} reader at ${evidenceFile}`,
  }
  return built
}

const objectRecordSchema = z.record(z.string(), z.unknown())

/** Validate parsed metadata before any property is read. Arrays are not records. */
export function recordOf(value: unknown): Record<string, unknown> | undefined {
  const parsed = objectRecordSchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

/** Parse local JSON as untrusted data; malformed bytes stay unknown. */
export function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return undefined
  }
}
