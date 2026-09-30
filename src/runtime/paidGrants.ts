// "Allow always" for the ACP agent (M58, D48, D62). Each feature has a
// revocation generation, and each workspace a grant for that generation.
// Independent grants never rewrite a shared map; a writer begun before a
// revocation can finish later without restoring the old permission. Reads
// sample the generation around the grant, with no cached authorization.
// The earlier whole-file map is ignored: its grants ask again.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { link, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { PaidGrantStore } from '../acp/paid'
import type { CoreLogger } from '../core/logging'
import { describeStoreError, storeErrorCode } from '../host/backend/storeErrors'
import { writeFileAtomically } from '../host/fsAtomic'
import { ATOMIC_TEMPORARY_SUFFIX, PAID_FEATURES, type PaidFeature } from '../shared/constants'
import { workspaceKey } from './dataFolder'

export interface PaidGrantFileDeps {
  /** The legacy map's path; the authoritative records are beside it in `<file>.d`. */
  readonly file: string
  readonly log: CoreLogger
  /** Waits between rename attempts (fsAtomic); injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
}

const ENOENT = 'ENOENT'
const EEXIST = 'EEXIST'
const GENERATION_FILE = 'generation.json'
const generationSchema = z.object({ id: z.uuid(), isInitial: z.boolean() })
const grantSchema = z.uuid()
type Generation = z.infer<typeof generationSchema>

export function paidGrantFile(deps: PaidGrantFileDeps): PaidGrantStore {
  const featureFolder = (feature: PaidFeature) => path.join(`${deps.file}.d`, feature)
  const generationFile = (feature: PaidFeature) =>
    path.join(featureFolder(feature), GENERATION_FILE)
  const grantFile = (workspaceRoot: string, feature: PaidFeature, generation: string) =>
    path.join(featureFolder(feature), `${workspaceKey(workspaceRoot)}.${generation}.json`)

  /** A missing record grants nothing; damaged or unreadable records fail closed. */
  const read = <T>(file: string, schema: z.ZodMiniType<T>, isChanging = false): T | undefined => {
    try {
      const text = readFileSync(file, 'utf8')
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        throw new Error('not valid JSON')
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        throw new Error('not a valid paid-use record')
      }
      return parsed.data
    } catch (error: unknown) {
      if (storeErrorCode(error) === ENOENT) {
        return undefined
      }
      const reason = describeStoreError(error)
      if (isChanging) {
        throw new Error(`${file} could not be read: ${reason}`, { cause: error })
      }
      deps.log.warn(`Paid-use grants in ${file} ignored: ${reason}`)
      return undefined
    }
  }

  const write = (file: string, record: string | Generation) =>
    writeFileAtomically(file, `${JSON.stringify(record)}\n`, { sleep: deps.sleep })

  /**
   * Captures an existing generation before any await. The first generation
   * is published complete with a no-replace hard link, so concurrent first
   * writers cannot overwrite one another or expose half a record. A writer
   * that began before a revocation cannot join the replacement generation.
   * A crash's leftover temporary record grants nothing.
   */
  const generationFor = async (feature: PaidFeature): Promise<Generation> => {
    const file = generationFile(feature)
    const existing = read(file, generationSchema, true)
    if (existing !== undefined) {
      return existing
    }
    const created: Generation = { id: randomUUID(), isInitial: true }
    const temporary = `${file}.${created.id}${ATOMIC_TEMPORARY_SUFFIX}`
    try {
      await write(temporary, created)
      try {
        await link(temporary, file)
        return created
      } catch (error: unknown) {
        if (storeErrorCode(error) !== EEXIST) {
          throw error
        }
        const winner = read(file, generationSchema, true)
        if (winner?.isInitial !== true) {
          throw new Error('Paid-use grants were revoked while this grant was being initialized', {
            cause: error,
          })
        }
        return winner
      }
    } finally {
      await rm(temporary, { force: true })
    }
  }

  const add = async (workspaceRoot: string, feature: PaidFeature): Promise<void> => {
    const generation = await generationFor(feature)
    // The generation came through zod (or randomUUID) before entering a path.
    // A stale writer cannot replace a newer generation's explicit grant.
    await write(grantFile(workspaceRoot, feature, generation.id), generation.id)
  }

  return {
    read: (workspaceRoot) =>
      new Set(
        PAID_FEATURES.filter((feature) => {
          const file = generationFile(feature)
          const before = read(file, generationSchema)
          if (
            before === undefined ||
            read(grantFile(workspaceRoot, feature, before.id), grantSchema) !== before.id
          ) {
            return false
          }
          // Another process may revoke while the grant is read.
          return read(file, generationSchema)?.id === before.id
        }),
      ),
    add: async (workspaceRoot, features) => {
      await Promise.all(features.map((feature) => add(workspaceRoot, feature)))
    },
    forget: async (features) => {
      await Promise.all(
        features.map((feature) =>
          write(generationFile(feature), { id: randomUUID(), isInitial: false }),
        ),
      )
    },
  }
}
