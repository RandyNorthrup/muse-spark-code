// What a toolchain pack is (M110t TP1/TP2, PLAN.md D90.27): a named,
// versioned, layered toolchain with pinned upstream artifacts, the gate
// commands agents may propose from it, and the constraints it places on
// the shared toolchain set. Definitions live in deploy/packs/; the pack
// CI locks them (digests, sizes) into the signed index; the node
// installs from the index only. Pure.

import * as z from 'zod/mini'
import { packNameSchema } from '../../../shared/profile'

/** A dotted numeric version with an optional prerelease and build suffix. */
export const versionSchema = z
  .string()
  .check(z.regex(/^\d+(\.\d+)*(-[0-9A-Za-z.]+)?(\+[0-9A-Za-z.]+)?$/))

/** One machine kind an artifact runs on. Absent means every machine. */
export const packPlatformSchema = z.strictObject({
  os: z.enum(['linux', 'darwin', 'windows']),
  arch: z.enum(['x64', 'arm64']),
})
export type PackPlatform = z.infer<typeof packPlatformSchema>

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
  /** The machines this artifact runs on; absent runs everywhere. */
  platforms: z.optional(z.array(packPlatformSchema).check(z.minLength(1))),
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

/** One installed tool a pack carries, locked to its version. */
export const packToolSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  version: versionSchema,
})
export type PackTool = z.infer<typeof packToolSchema>

/** One toolchain pack definition, as the signed index carries it. */
export const packDefinitionSchema = z.strictObject({
  name: packNameSchema,
  version: versionSchema,
  description: z.string().check(z.minLength(1)),
  license: z.string().check(z.minLength(1)),
  languages: z.array(z.string().check(z.minLength(1))),
  /** Packs installed first, in order (the base everything stands on). */
  requires: z.array(z.string().check(z.minLength(1))),
  artifacts: z.array(packArtifactSchema).check(z.minLength(1)),
  /** The locked tools, for the pack list, constraints and the audit. */
  tools: z.array(packToolSchema).check(z.minLength(1)),
  checks: z.array(packCheckSchema),
  constraints: z.array(packConstraintSchema),
  /** Simulators and other downloads the person's click accepts (never a flag). */
  clickThrough: z.boolean(),
  /** Checked against upstream on this date (ISO); the pack CI refreshes it. */
  checkedAt: z.string(),
})
export type PackDefinition = z.infer<typeof packDefinitionSchema>

/**
One binary an upstream places on the layer's PATH: `name` finds the
file by basename in the extracted tree (one `*` wildcard allowed),
`as` names it on the PATH. A matched `.jar` is wrapped with
`java -jar`. Without `bin`, the build links the tree's `bin/` contents
(or its top-level executables) under their own names.
*/
export const packBinSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  as: z.string().check(z.minLength(1)),
})
export type PackBin = z.infer<typeof packBinSchema>

/** One upstream download the pack build locks, by URL. */
export const packUpstreamSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  version: versionSchema,
  /** The upstream download URL; `{version}` expands to the version. */
  url: z.string().check(z.minLength(1)),
  /** The upstream's licence, as an SPDX id. */
  license: z.string().check(z.minLength(1)),
  /** The machines this upstream serves; absent serves everywhere. */
  platforms: z.optional(z.array(packPlatformSchema).check(z.minLength(1))),
  /**
  The install command, run in the extracted tree (`{prefix}` expands to
  the layer root), for upstreams that install themselves (bats).
  */
  install: z.optional(z.array(z.string().check(z.minLength(1))).check(z.minLength(1))),
  /**
  Where the tree lands under the layer root (`opt/<name>` when absent).
  Upstreams that form one SDK share a destination (the Android SDK).
  */
  dest: z.optional(z.string().check(z.regex(/^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._/-]*$/))),
  /**
  Archive levels stripped on extract: `1` drops a single top-level
  directory, `0` keeps the tree whole. Absent strips one level exactly
  when every member sits under one top-level directory.
  */
  strip: z.optional(z.union([z.literal(0), z.literal(1)])),
  /**
  The binaries this upstream places on the PATH. An explicit empty
  array means the upstream carries no binaries (SDK data); without
  `bin`, the build links the tree's `bin/` contents (or its top-level
  executables) under their own names, and fails when there are none.
  */
  bin: z.optional(z.array(packBinSchema)),
})
export type PackUpstream = z.infer<typeof packUpstreamSchema>

/** One tool the pack build installs through a toolchain manager. */
export const packManagedToolSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  version: z.string().check(z.minLength(1)),
  /** The tool's licence, as an SPDX id. */
  license: z.string().check(z.minLength(1)),
})
export type PackManagedTool = z.infer<typeof packManagedToolSchema>

/** One Go tool the pack build installs (`go install module@version`). */
export const packGoToolSchema = z.strictObject({
  module: z.string().check(z.minLength(1)),
  version: z.string().check(z.minLength(1)),
  /** The tool's licence, as an SPDX id. */
  license: z.string().check(z.minLength(1)),
})
export type PackGoTool = z.infer<typeof packGoToolSchema>

/** The tools the pack build installs through toolchain managers. */
export const packManagedSchema = z.strictObject({
  /** `npm install` into the layer, locked with hashes. */
  npm: z.optional(z.array(packManagedToolSchema).check(z.minLength(1))),
  /** `cargo install --locked` into the layer. */
  cargo: z.optional(z.array(packManagedToolSchema).check(z.minLength(1))),
  /** `uv tool install` into the layer. */
  uvTools: z.optional(z.array(packManagedToolSchema).check(z.minLength(1))),
  /** `uv python install` into the layer. */
  uvPythons: z.optional(z.array(packManagedToolSchema).check(z.minLength(1))),
  /** `go install module@version` into the layer. */
  go: z.optional(z.array(packGoToolSchema).check(z.minLength(1))),
  /** PowerShell Gallery modules saved into the layer. */
  psGallery: z.optional(z.array(packManagedToolSchema).check(z.minLength(1))),
  /** `rustup toolchain install` into the layer. */
  rust: z.optional(z.array(packManagedToolSchema).check(z.minLength(1))),
})
export type PackManaged = z.infer<typeof packManagedSchema>

/** One Debian package the pack build takes from a snapshot. */
export const packAptPackageSchema = z.strictObject({
  name: z.string().check(z.minLength(1)),
  /** The package's licence, as an SPDX id. */
  license: z.string().check(z.minLength(1)),
})
export type PackAptPackage = z.infer<typeof packAptPackageSchema>

/**
Debian packages the pack build takes from a snapshot. Versions resolve
from the snapshot at build time (the same snapshot resolves the same
versions) and lock into the tools list.
*/
export const packAptSchema = z.strictObject({
  /** The snapshot.debian.org timestamp, `YYYYMMDDTHHMMSSZ`. */
  snapshot: z.string().check(z.regex(/^\d{8}T\d{6}Z$/)),
  packages: z.array(packAptPackageSchema).check(z.minLength(1)),
})
export type PackApt = z.infer<typeof packAptSchema>

/** One smoke command the pack CI runs against the built layer. */
export const packSmokeSchema = z.strictObject({
  command: z.array(z.string().check(z.minLength(1))).check(z.minLength(1)),
})
export type PackSmoke = z.infer<typeof packSmokeSchema>

/** One pack build definition, as deploy/packs/ carries it. */
export const packBuildDefinitionSchema = z.strictObject({
  name: packNameSchema,
  version: versionSchema,
  description: z.string().check(z.minLength(1)),
  license: z.string().check(z.minLength(1)),
  languages: z.array(z.string().check(z.minLength(1))),
  requires: z.array(z.string().check(z.minLength(1))),
  checks: z.array(packCheckSchema),
  constraints: z.array(packConstraintSchema),
  clickThrough: z.boolean(),
  /** Checked against upstream on this date (ISO); the pack CI refreshes it. */
  checkedAt: z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/)),
  /** The upstream downloads the layer builds from. */
  upstream: z.array(packUpstreamSchema).check(z.minLength(1)),
  managed: z.optional(packManagedSchema),
  apt: z.optional(packAptSchema),
  /** The smoke commands the pack CI runs against the built layer. */
  smoke: z.array(packSmokeSchema).check(z.minLength(1)),
})
export type PackBuildDefinition = z.infer<typeof packBuildDefinitionSchema>

/** A dotted version split into its numeric core and prerelease suffix. */
interface SplitVersion {
  readonly parts: number[]
  readonly pre: string | undefined
}

function splitVersion(version: string): SplitVersion {
  const [withoutBuild = ''] = version.split('+', 1)
  const [core = '', pre] = withoutBuild.split('-', 2)
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
    const match = /^(>=|<=|>|<|=)?\s*(\d+(\.\d+)*(-[0-9A-Za-z.]+)?(\+[0-9A-Za-z.]+)?)$/.exec(clause)
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
