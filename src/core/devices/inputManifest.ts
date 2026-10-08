// M100 phase 2, lane V (D100: G1, G2, G12): dispatch input manifests,
// verified before use. A dispatch carries its inputs by digest reference
// (the snapshot's manifestDigest); the manifest itself names every
// content-addressed input plus the base objects the worker must already
// hold. The worker verifies both before starting and refuses when any item
// is missing or mismatched. Wire paths use forward slashes on every
// platform (lane 0's relative-path rule); the builder normalizes Windows
// separators to `/` before validation, and the reader lookup normalizes
// again before comparing.
import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { DEVICE_LIMITS } from '../../shared/constants'
import {
  deviceAttemptIdentitySchema,
  deviceDispatchSchema,
  isSameAttempt,
  type DeviceAttemptIdentity,
  type DeviceDispatch,
} from '../../shared/devices'
import { DevicePairingError } from './pairing'

/** Wire paths use `/`; normalize before any compare, on every platform. */
export function normalizeManifestPath(path: string): string {
  return path.replaceAll('\\', '/')
}

// The relative-path rule lane 0 enforces on plannedWrites: nothing that
// escapes the worker copy, no empty or dot parts. The two rules must agree;
// lane 0 owns the canonical text, so this stays a compact mirror (the
// duplication gate forbids a second full copy there and here).
const isManifestPath = (value: string): boolean =>
  !/[\\:]|\p{Cc}|\p{Zl}|\p{Zp}/u.test(value) &&
  value.split('/').every((part) => part !== '' && part !== '.' && part !== '..')

const manifestPath = z.string().check(
  z.minLength(1),
  z.maxLength(DEVICE_LIMITS.pathChars),
  z.refine((value) => isManifestPath(value)),
)
const digest = z
  .string()
  .check(
    z.minLength(DEVICE_LIMITS.digestChars),
    z.maxLength(DEVICE_LIMITS.digestChars),
    z.regex(/^[a-f0-9]{64}$(?![\s\S])/),
  )
// Git object ids are 40- or 64-hex (lane 0's gitObject); both ends must use
// the same length, as lane 0's snapshot requires.
const gitObject = z.union([z.string().check(z.regex(/^[a-f0-9]{40}$(?![\s\S])/)), digest])

const manifestItem = z.strictObject({
  path: manifestPath,
  digest,
  bytes: z.int().check(z.gte(0), z.lte(DEVICE_LIMITS.artifactBytes)),
})
export type DeviceInputManifestItem = z.infer<typeof manifestItem>

export const deviceInputManifestSchema = z
  .strictObject({
    version: z.literal(DEVICE_LIMITS.protocolVersion),
    identity: deviceAttemptIdentitySchema,
    baseCommit: gitObject,
    tree: gitObject,
    // The manifest names files, like an artifact: bounded by artifactFiles.
    items: z.array(manifestItem).check(z.maxLength(DEVICE_LIMITS.artifactFiles)),
  })
  .check(
    z.refine(
      (value) =>
        value.baseCommit.length === value.tree.length &&
        new Set(value.items.map((item) => item.path)).size === value.items.length,
    ),
  )
export type DeviceInputManifest = z.infer<typeof deviceInputManifestSchema>

export interface DeviceInputManifestInput {
  readonly identity: DeviceAttemptIdentity
  readonly baseCommit: string
  readonly tree: string
  readonly items: readonly {
    readonly path: string
    readonly digest: string
    readonly bytes: number
  }[]
}

/** Builds the canonical manifest; refuses measured input that fits no schema. */
export function buildInputManifest(input: DeviceInputManifestInput): DeviceInputManifest {
  const parsed = deviceInputManifestSchema.safeParse({
    version: DEVICE_LIMITS.protocolVersion,
    identity: input.identity,
    baseCommit: input.baseCommit,
    tree: input.tree,
    items: input.items.map((item): DeviceInputManifestItem => ({
      ...item,
      path: normalizeManifestPath(item.path),
    })),
  })
  if (!parsed.success) throw new DevicePairingError('invalid-frame')
  return parsed.data
}

/**
 * The digest the dispatch snapshot binds. Fixed key order, so both ends
 * agree regardless of property insertion order; item order is the manifest
 * order the dispatcher built.
 */
export function deviceInputManifestDigest(manifest: DeviceInputManifest): string {
  const parsed = deviceInputManifestSchema.parse(manifest)
  const { identity } = parsed
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: parsed.version,
        identity: {
          pairId: identity.pairId,
          receiverIncarnationId: identity.receiverIncarnationId,
          boardId: identity.boardId,
          taskId: identity.taskId,
          attemptId: identity.attemptId,
        },
        baseCommit: parsed.baseCommit,
        tree: parsed.tree,
        items: parsed.items.map((item) => ({
          path: item.path,
          digest: item.digest,
          bytes: item.bytes,
        })),
      }),
    )
    .digest('hex')
}

/** Worker-side authority over the copy the dispatch names; tests inject fakes. */
export interface DeviceInputReader {
  readInput(path: string): Promise<{ digest: string; bytes: number } | undefined>
  hasBaseObject(id: string): Promise<boolean>
}

/**
 * Verifies the manifest and the base objects before the worker starts. The
 * caller parses the dispatch first (the receiver does); every failure throws
 * the typed refusal the frame carries. Verifies only: never starts anything.
 */
export async function verifyDispatchInputs(
  dispatch: DeviceDispatch,
  manifest: unknown,
  reader: DeviceInputReader,
): Promise<DeviceInputManifest> {
  const dispatchResult = deviceDispatchSchema.safeParse(dispatch)
  const parsed = deviceInputManifestSchema.safeParse(manifest)
  if (!dispatchResult.success || !parsed.success) throw new DevicePairingError('invalid-frame')
  const request = dispatchResult.data
  const candidate = parsed.data
  if (
    !isSameAttempt(candidate.identity, request.identity) ||
    candidate.baseCommit !== request.snapshot.baseCommit ||
    candidate.tree !== request.snapshot.tree ||
    deviceInputManifestDigest(candidate) !== request.snapshot.manifestDigest
  )
    throw new DevicePairingError('payload-changed')
  if (
    !(await reader.hasBaseObject(candidate.baseCommit)) ||
    !(await reader.hasBaseObject(candidate.tree))
  )
    throw new DevicePairingError('reconcile-required')
  for (const item of candidate.items) {
    const found = await reader.readInput(normalizeManifestPath(item.path))
    if (found?.digest !== item.digest || found.bytes !== item.bytes)
      throw new DevicePairingError('payload-changed')
  }
  return candidate
}
