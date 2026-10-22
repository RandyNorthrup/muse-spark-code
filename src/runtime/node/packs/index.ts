// The locked pack index (M110t TP1/TP2, PLAN.md D90.27): every pack
// with its locked artifacts (digests, sizes), simulators, the pack CI
// run that built it, and its expiry. Each fetch is verified before use:
// the cosign signature over the exact bytes (in the lazy bundle, over
// the network), the checksum, no-downgrade against the installed index,
// and expiry. Anything failing refuses in words. Pure, except the
// signature check it loads lazily.

import * as z from 'zod/mini'
import { compareVersions, packDefinitionSchema, type PackDefinition } from './definition'

export const PACK_INDEX_VERSION = 1

/** The locked index, as the pack CI signs it. */
export const packIndexSchema = z.strictObject({
  version: z.literal(PACK_INDEX_VERSION),
  /** ISO time the index was built; expiry counts from it. */
  builtAt: z.string(),
  /** ISO time past which the index refuses (a stale index never installs). */
  expiresAt: z.string(),
  /** The pack CI run that built it, for the audit trail. */
  builtBy: z.string().check(z.minLength(1)),
  /** The index's own version for no-downgrade (monotonic per build). */
  revision: z.number().check(z.int(), z.gte(0)),
  packs: z.array(packDefinitionSchema).check(z.minLength(1)),
})
export type PackIndex = z.infer<typeof packIndexSchema>

/** What index verification answers. */
export type IndexVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: IndexRefusal }

/** Why an index refused, in machine words (the sentences live in UI text). */
export type IndexRefusal =
  'bad-signature' | 'checksum-mismatch' | 'downgrade' | 'expired' | 'unlocked-artifact'

/**
Verify a fetched index: signature first (over the exact bytes), then the
checksum of its canonical bytes against the signed digest, no-downgrade
against the installed index's revision, expiry against now, and every
artifact locked (digest and size). `verifySignature` comes from the lazy
bundle; the rest is local.
*/
export async function verifyIndex(options: {
  readonly indexBytes: Uint8Array
  readonly expectedSha256: string
  readonly actualSha256: string
  readonly index: PackIndex
  readonly installedRevision: number | undefined
  readonly now: number
  readonly verifySignature: (bytes: Uint8Array) => Promise<boolean>
}): Promise<IndexVerdict> {
  if (!(await options.verifySignature(options.indexBytes)))
    return { ok: false, reason: 'bad-signature' }
  if (options.actualSha256 !== options.expectedSha256) {
    return { ok: false, reason: 'checksum-mismatch' }
  }
  if (
    options.installedRevision !== undefined &&
    options.index.revision < options.installedRevision
  ) {
    return { ok: false, reason: 'downgrade' }
  }
  if (
    Number.isNaN(Date.parse(options.index.expiresAt)) ||
    Date.parse(options.index.expiresAt) <= options.now
  ) {
    return { ok: false, reason: 'expired' }
  }
  const hasUnlocked = options.index.packs.some((pack) =>
    pack.artifacts.some(
      (artifact) => artifact.sha256 === undefined || artifact.sizeBytes === undefined,
    ),
  )
  return hasUnlocked ? { ok: false, reason: 'unlocked-artifact' } : { ok: true }
}

/** The installed toolchain versions across packs, for constraint checks. */
export function installedToolchainVersions(
  packs: Iterable<Pick<PackDefinition, 'artifacts'>>,
): ReadonlyMap<string, string> {
  const versions = new Map<string, string>()
  for (const pack of packs) {
    for (const artifact of pack.artifacts) {
      const known = versions.get(artifact.name)
      if (known === undefined || compareVersions(artifact.version, known) > 0) {
        versions.set(artifact.name, artifact.version)
      }
    }
  }
  return versions
}
