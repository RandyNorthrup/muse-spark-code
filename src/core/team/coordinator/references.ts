// M96d machine coordinator (PLAN.md D75): exact native process references.
//
// A reference names one process incarnation: the platform, the reference
// kind, the held token, the boot identity, the birth reading and the PID.
// Comparison binds every field; a single changed field refuses. Only a
// reference captured under launch custody and held at the dispatch
// boundary carries authority: a later numeric-PID lookup never does
// (docs/design/m96d-coordinator.md §§1-4).
//
// Stability by platform: Linux signals through a retained pidfd, Windows
// through the CreateProcess handle, macOS never signals a foreign PID
// (owned-child wait status is observation only). Coarse kinds (`psSeconds`,
// `processGroup`) never release, whatever they claim.

import * as z from 'zod/mini'
import { exactProcessBirth, systemBootIdentity } from '../../locks/processOwner'

export const coordinatorReferenceSchema = z.strictObject({
  platform: z.enum(['linux', 'darwin', 'win32']),
  kind: z.enum(['pidfd', 'processHandle', 'ownedChild', 'psSeconds', 'processGroup']),
  token: z.string().check(z.minLength(1)),
  boot: z.string().check(z.minLength(1)),
  start: z.string().check(z.minLength(1)),
  pid: z.number().check(z.int(), z.gt(0)),
  validated: z.boolean(),
  exited: z.boolean(),
})
export type CoordinatorReference = z.infer<typeof coordinatorReferenceSchema>

/** Every field binds: platform, kind, token, boot, start and PID, validated on both sides. */
export function isSameCoordinatorReference(
  expected: CoordinatorReference,
  observed: CoordinatorReference,
): boolean {
  return (
    expected.validated &&
    observed.validated &&
    expected.platform === observed.platform &&
    expected.kind === observed.kind &&
    expected.token === observed.token &&
    expected.boot === observed.boot &&
    expected.start === observed.start &&
    expected.pid === observed.pid
  )
}

/** Only a held native reference (or an owned macOS child) can release. */
export function isStableCoordinatorReference(reference: CoordinatorReference): boolean {
  return (
    (reference.platform === 'linux' && reference.kind === 'pidfd') ||
    (reference.platform === 'win32' && reference.kind === 'processHandle') ||
    (reference.platform === 'darwin' && reference.kind === 'ownedChild')
  )
}

/**
The signal target for a validated observation, or undefined when the
observation cannot carry a signal: a changed reference, an unstable
kind, any macOS foreign PID, or an already exited process.
*/
export function coordinatorSignalTarget(
  expected: CoordinatorReference,
  observed: CoordinatorReference,
): string | undefined {
  return !isSameCoordinatorReference(expected, observed) ||
    !isStableCoordinatorReference(observed) ||
    observed.platform === 'darwin' ||
    observed.exited
    ? undefined
    : expected.token
}

export interface ProcessBirthObservation {
  readonly platform: NodeJS.Platform
  readonly pid: number
  /** This boot's identity, read beside the birth. */
  readonly boot: string
  /** The native birth token: ticks, FILETIME or ps seconds. */
  readonly birth: string
  /**
  Whether the birth reading distinguishes incarnations: Linux clock
  ticks and Windows FILETIME do; macOS `ps` seconds do not, so a
  macOS observation never validates a foreign reference.
  */
  readonly precise: boolean
}

/**
One native birth observation: the exact birth token beside this boot's
identity. An unreadable PID, an unreadable boot identity or an
unsupported platform reads as unknown, never as death or absence.
*/
export async function observeProcessBirth(
  pid: number,
): Promise<ProcessBirthObservation | undefined> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  const platform = process.platform
  if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') return undefined
  const [birth, boot] = await Promise.all([exactProcessBirth(pid), systemBootIdentity()])
  return birth === undefined || boot === undefined || boot === ''
    ? undefined
    : { platform, pid, boot, birth, precise: platform !== 'darwin' }
}
