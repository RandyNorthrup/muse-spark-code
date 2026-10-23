import { paidQuoteSchema } from '../shared/paid'
import {
  paidAuthorityKey,
  latestPaidGrant,
  nextPaidApprovalOrder,
} from '../core/paid/paidAuthority'
// "Allow always" for the ACP agent (M58, D48, D62). Each feature has a
// revocation generation, and each workspace a grant for that generation.
// Independent grants never rewrite a shared map; a writer begun before a
// revocation can finish later without restoring the old permission. Reads
// sample the generation around the grant, with no cached authorization.
// The earlier whole-file map is ignored: its grants ask again.

import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { link, rm } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { paidStoreFailureKind, type PaidQuoteNotice } from '../shared/paid'
import type { PaidGrantStore } from '../acp/paid'
import { type CoreLogger, wireWordForLog } from '../core/logging'
import { DamageNoter, fileDamageMarkers } from './damageNotice'
import { describeStoreError, isStoreErrorCode, storeErrorCode } from '../host/backend/storeErrors'
import { writeFileAtomically } from '../host/fsAtomic'
import {
  ATOMIC_TEMPORARY_SUFFIX,
  PAID_APPROVAL_ORDER_DIRECTORY,
  PAID_FEATURES,
  type PaidFeature,
} from '../shared/constants'
import { workspaceKey } from './dataFolder'
import { isAbsentBelowFolder } from '../core/fs/absentPath'

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
      } catch (error: unknown) {
        // Only malformed JSON reads invalid here: anything else keeps its
        // kind. The cause carries the syntax failure, never the record: a
        // grant record holds no secret.
        if (!(error instanceof SyntaxError)) throw error
        throw new Error('not valid JSON', { cause: error })
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success) {
        throw new Error('not a valid paid-use record')
      }
      return parsed.data
    } catch (error: unknown) {
      // A file where a record's folder belongs is damage on every platform
      // (Windows reports it as ENOENT), never a missing record.
      if (isStoreErrorCode(error, ENOENT) && isAbsentBelowFolder(file)) {
        return undefined
      }
      // read-state: cert TBL-09. Any other read failure warns with its kind
      // and reads as no record, so the use asks again (fail closed for
      // money); the failure is never silent and never "no grant".
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
  Captures an existing generation before any await. The first generation
  is published complete with a no-replace hard link, so concurrent first
  writers cannot overwrite one another or expose half a record. A writer
  that began before a revocation cannot join the replacement generation.
  A crash's leftover temporary record grants nothing.
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
        if (!isStoreErrorCode(error, EEXIST)) {
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

  const quoteSchema = z.object({
    generation: z.string(),
    quote: paidQuoteSchema,
    order: z.optional(z.number().check(z.int(), z.gte(0))),
  })
  const quotePrefix = (workspaceRoot: string, generation: string, key: string) =>
    `${grantFile(workspaceRoot, 'webSearch', generation)}.${workspaceKey(key)}.${PAID_APPROVAL_ORDER_DIRECTORY}.`
  // The last quote-folder read failure's kind, while saved Always quotes
  // cannot be listed. Consent carries it in the question it then asks.
  let quoteNotice: PaidQuoteNotice | undefined
  // An unreadable quote folder warns once per distinct damage (Part 2.1),
  // never on every read: the rule is the shared DamageNoter.
  const quoteListNoter = new DamageNoter(
    fileDamageMarkers(path.join(`${deps.file}.d`, 'webSearch.quoteList')),
    (identity) => {
      deps.log.warn(`Paid-use quotes could not be read (${identity}), so no quote grant applies`)
    },
  )
  // An unreadable quote folder reads as no quotes, never silently: the
  // failure passes into the durable damage record (warned once per distinct
  // damage) and rides the next consent question as its kind, so the use
  // asks again instead of treating saved choices as absent.
  const noteUnreadableQuotes = (error: unknown): never[] => {
    // The errno names the distinct damage for the noter and the log;
    // the person is told the closed kind's word, never the errno.
    quoteListNoter.noteDamaged(wireWordForLog(storeErrorCode(error) ?? 'unknown'))
    quoteNotice = { kind: paidStoreFailureKind(error) }
    return []
  }
  const readQuotes = (workspaceRoot: string, generation: string) => {
    let names: string[]
    try {
      names = readdirSync(featureFolder('webSearch'))
    } catch (error: unknown) {
      // A missing quote folder holds no quotes; an unreadable one is
      // reported with its kind and reads as no quotes, never silently.
      // Fail-closed stays: asking again is the safe direction for money.
      // read-state: cert TBL-10. `[]` here is "cannot list, ask again" with
      // the kind warned and carried in the next question, never "no quotes".
      if (
        error instanceof Error &&
        isStoreErrorCode(error, ENOENT) &&
        isAbsentBelowFolder(featureFolder('webSearch'))
      ) {
        quoteListNoter.noteHealthy()
        // A missing folder is healthy: an older listing failure must not
        // survive as a notice claiming saved choices are unreadable (P3-3).
        quoteNotice = undefined
        return []
      }
      return noteUnreadableQuotes(error)
    }
    quoteListNoter.noteHealthy()
    quoteNotice = undefined
    const prefix = `${path.basename(grantFile(workspaceRoot, 'webSearch', generation))}.`
    return names
      .filter(
        (name) =>
          name.startsWith(prefix) &&
          name.includes(`.${PAID_APPROVAL_ORDER_DIRECTORY}.`) &&
          name.endsWith('.quote'),
      )
      .flatMap((name) => {
        const record = read(path.join(featureFolder('webSearch'), name), quoteSchema)
        return record?.generation === generation &&
          name.startsWith(
            path.basename(quotePrefix(workspaceRoot, generation, paidAuthorityKey(record.quote))),
          )
          ? [record]
          : []
      })
  }
  return {
    quoteNotice: () => quoteNotice,
    nextQuoteOrder: () =>
      nextPaidApprovalOrder(path.join(`${deps.file}.d`, PAID_APPROVAL_ORDER_DIRECTORY)),
    prepareQuoteGeneration: async () => {
      const generation = await generationFor('webSearch')
      return generation.id
    },
    quoteGeneration: () => read(generationFile('webSearch'), generationSchema)?.id ?? 'missing',
    // An account's Always (M108 lane P) lapses with the feature's revocation.
    generation: (feature) => read(generationFile(feature), generationSchema)?.id ?? 'missing',
    readQuote: (workspaceRoot, quote) => {
      const generation = read(generationFile('webSearch'), generationSchema)
      if (generation === undefined) {
        // No generation: no quotes exist, so an older listing failure must
        // not survive as a notice claiming saved choices are unreadable
        // when none exist (P3-3).
        quoteNotice = undefined
        return
      }
      const grant = latestPaidGrant(
        readQuotes(workspaceRoot, generation.id).filter(
          (record) => paidAuthorityKey(record.quote) === paidAuthorityKey(quote),
        ),
      )
      return read(generationFile('webSearch'), generationSchema)?.id === generation.id
        ? grant
        : undefined
    },
    writeQuote: async (workspaceRoot, grant) => {
      // The generation was captured before asking, never sampled here. Each
      // key has its own record; revoked writers cannot touch a fresh record.
      if (read(generationFile('webSearch'), generationSchema)?.id !== grant.generation) return
      await writeFileAtomically(
        `${quotePrefix(workspaceRoot, grant.generation, paidAuthorityKey(grant.quote))}${workspaceKey(JSON.stringify([grant.order ?? 0, grant.quote.id]))}.quote`,
        JSON.stringify(grant),
        { sleep: deps.sleep },
      )
    },
    read: (workspaceRoot) =>
      new Set(
        PAID_FEATURES.filter((feature) => {
          const file = generationFile(feature)
          const before = read(file, generationSchema)
          if (
            before === undefined ||
            (!(feature === 'webSearch' && readQuotes(workspaceRoot, before.id).length > 0) &&
              read(grantFile(workspaceRoot, feature, before.id), grantSchema) !== before.id)
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
