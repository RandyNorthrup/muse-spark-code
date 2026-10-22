// What a toolchain pack is (M110t TP1/TP2, PLAN.md D90.27): a named,
// versioned, layered toolchain with pinned upstream artifacts, the gate
// commands agents may propose from it, and the constraints it places on
// the shared toolchain set. Definitions live in deploy/packs/; the pack
// CI locks them (digests, sizes) into the signed index; the node
// installs from the index only. Pure.

import * as z from 'zod/mini'

/** A dotted numeric version with an optional prerelease suffix. */
export const versionSchema = z.string().check(z.regex(/^\d+(\.\d+)*(-[0-9A-Za-z.]+)?$/))

/** One upstream artifact a pack installs, pinned by version and URL. */
export const packArtifactSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  version: versionSchema,
  /** The upstream download URL; `{version}` expands to the version. */
  url: z.string().check(z.minLength(1)),
  /** SHA-256 of the artifact, locked by the pack build. */
  sha256: z.optional(z.string().check(z.regex(/^[0-9a-f]{64}$/))),
  /** The artifact's bytes, measured by the pack build. */
  sizeBytes: z.optional(z.number().check(z.int(), z.gte(0))),
})
export type PackArtifact = z.infer<typeof packArtifactSchema>

/** A gate command the pack's toolchains provide (TA proposes, M68 runs). */
export const packCheckSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  command: z.array(z.string().check(z.minLength(1))).check(z.minLength(1)),
})
export type PackCheck = z.infer<typeof packCheckSchema>

/**
A constraint on the shared toolchain set: `package` at a version the
`range` accepts, or the pack refuses to install beside it. Ranges are
`>=`, `<=`, `>` or `<` dotted versions, comma-separated (all must hold).
*/
export const packConstraintSchema = z.strictObject({
  package: z.string().check(z.minLength(1)),
  range: z.string().check(z.minLength(1)),
  reason: z.string().check(z.minLength(1)),
})
export type PackConstraint = z.infer<typeof packConstraintSchema>

/** One toolchain pack definition, as deploy/packs/ carries it. */
export const packDefinitionSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  version: versionSchema,
  description: z.string().check(z.minLength(1)),
  license: z.string().check(z.minLength(1)),
  languages: z.array(z.string().check(z.minLength(1))),
  /** Packs installed first, in order (the base everything stands on). */
  requires: z.array(z.string().check(z.minLength(1))),
  artifacts: z.array(packArtifactSchema).check(z.minLength(1)),
  checks: z.array(packCheckSchema),
  constraints: z.array(packConstraintSchema),
  /** Simulators and other downloads the person's click accepts (never a flag). */
  clickThrough: z.boolean(),
  /** Checked against upstream on this date (ISO); the pack CI refreshes it. */
  checkedAt: z.string(),
})
export type PackDefinition = z.infer<typeof packDefinitionSchema>

/** A dotted version split into its numeric core and prerelease suffix. */
interface SplitVersion {
  readonly parts: number[]
  readonly pre: string | undefined
}

function splitVersion(version: string): SplitVersion {
  const [core = '', pre] = version.split('-', 2)
  return { parts: core.split('.').map(Number), pre }
}

/** Compare dotted versions: negative, zero, or positive. */
export function compareVersions(left: string, right: string): number {
  const a = splitVersion(left)
  const b = splitVersion(right)
  const width = Math.max(a.parts.length, b.parts.length)
  for (let index = 0; index < width; index += 1) {
    const diff = (a.parts[index] ?? 0) - (b.parts[index] ?? 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  if (a.pre === b.pre) return 0
  if (a.pre === undefined) return 1
  if (b.pre === undefined) return -1
  return a.pre < b.pre ? -1 : 1
}

/** Whether `version` satisfies every clause of `range`. */
export function isVersionInRange(version: string, range: string): boolean {
  const clauses = range
    .split(',')
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '')
  if (clauses.length === 0) return false
  return clauses.every((clause) => {
    const match = /^(>=|<=|>|<|=)?\s*(\d+(\.\d+)*(-[0-9A-Za-z.]+)?)$/.exec(clause)
    if (match === null) return false
    const operator = match[1] ?? '='
    const bound = match[2] ?? ''
    const order = compareVersions(version, bound)
    switch (operator) {
      case '=': {
        return order === 0
      }
      case '>': {
        return order > 0
      }
      case '>=': {
        return order >= 0
      }
      case '<': {
        return order < 0
      }
      case '<=': {
        return order <= 0
      }
      default: {
        return false
      }
    }
  })
}

/** A constraint and the installed versions that break it, in words. */
export interface ConstraintConflict {
  readonly constraint: PackConstraint
  readonly installed: string
}

/**
Check `pack`'s constraints against the installed toolchain versions
(`package` to version): every conflict, naming both sides. Empty means
the pack installs beside them.
*/
export function checkConstraints(
  pack: Pick<PackDefinition, 'constraints'>,
  installed: ReadonlyMap<string, string>,
): ConstraintConflict[] {
  const conflicts: ConstraintConflict[] = []
  for (const constraint of pack.constraints) {
    const version = installed.get(constraint.package)
    if (version !== undefined && !isVersionInRange(version, constraint.range)) {
      conflicts.push({ constraint, installed: version })
    }
  }
  return conflicts
}
