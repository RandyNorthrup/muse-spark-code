// The account consent store (M108 lane P, PLAN.md D88.7): one owner-only
// folder per workspace, one subfolder per account binding, shared by every
// window and agent process of this user. It meets the atomic contract of
// `AccountPaidUseConsentDeps` across processes without a lock, the way the
// ACP agent's grants do (runtime/paidGrants.ts):
//
// - The revocation epoch is the highest `epoch-<n>` marker. A revoke creates
//   `epoch-<expected + 1>` with an exclusive create, which only one writer
//   can win, and only after reading `expected` as the highest: markers are
//   never removed, so the epoch only grows and a delayed writer can never
//   move it back or republish an older value.
// - Every grant file names the epoch it was approved under. A write under an
//   epoch that is no longer current reports `StaleEpochError`; reads see only
//   the current epoch's files, so a write that lost a race to a revoke is
//   never current either, and consent's own fence refuses its answer.
// - A clear removes only files named with an epoch below its cutoff, so an
//   older revoke never purges a grant approved after its advance.
// - Binding features are one file each, so two windows adding different
//   features under one epoch never overwrite each other. Each records the
//   feature's price-acceptance generation; a grant kept under another lapses.
//
// No `vscode` here: the extension and the ACP agent each give it their own
// folder. Loaded only with dist/accountPaid.js.

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { ACCOUNT_PAID_STORE, PAID_FEATURES, type PaidFeature } from '../../shared/constants'
import { paidQuoteSchema, type PaidQuote } from '../../shared/paid'
import {
  StaleEpochError,
  quoteGrantEpoch,
  type AccountBindingGrants,
  type AccountPaidUseConsentDeps,
} from '../../core/paid/accountPaidConsent'
import { latestPaidGrant, paidAuthorityKey, type PaidGrant } from '../../core/paid/paidAuthority'
import type { CoreLogger } from '../../core/logging'
import { describeStoreError, storeErrorCode } from '../backend/storeErrors'
import { writeFileAtomically } from '../fsAtomic'

export interface AccountPaidFilesDeps {
  /** This workspace's folder of account bindings; created owner-only on first write. */
  readonly folder: string
  /** Current shared feature/quote and price generations: a grant under another lapses. */
  readonly featureGeneration: (feature: PaidFeature) => string
  /** Waits between rename attempts (fsAtomic); injectable so tests do not sleep. */
  readonly sleep: (ms: number) => Promise<void>
  readonly log: CoreLogger
}

/** The store's ports for one account binding, as `AccountPaidUseConsent` takes them. */
export type AccountPaidStore = Pick<
  AccountPaidUseConsentDeps,
  | 'readGrants'
  | 'readRevocationEpoch'
  | 'advanceEpoch'
  | 'saveGrantIf'
  | 'clearGrantsBefore'
  | 'readQuoteGrant'
  | 'saveQuoteGrantIf'
  | 'revokeQuoteGrants'
>

const EEXIST = 'EEXIST'
const ENOENT = 'ENOENT'
const EPOCH_MARKER = /^epoch-([1-9][0-9]{0,14})$/u
const GRANT_FILE = /^grant-(0|[1-9][0-9]{0,14})-([A-Za-z]+)\.json$/u
const QUOTE_FILE = /^quote-(0|[1-9][0-9]{0,14})-([0-9a-f]+)-[0-9a-f]+\.json$/u
const grantRecordSchema = z.object({ generation: z.string() })
const quoteRecordSchema = z.object({
  quote: paidQuoteSchema,
  order: z.optional(z.number().check(z.int(), z.gte(0))),
  generation: z.string(),
})

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, ACCOUNT_PAID_STORE.digestChars)
}

const PAID_FEATURE_NAMES: readonly string[] = PAID_FEATURES

function isPaidFeature(value: string): value is PaidFeature {
  return PAID_FEATURE_NAMES.includes(value)
}

export function accountPaidFiles(deps: AccountPaidFilesDeps, bindingKey: string): AccountPaidStore {
  const folder = path.join(deps.folder, digest(bindingKey))
  /** Refuses another binding's key: this store answers for one binding only. */
  const assertKey = (key: string) => {
    if (key !== bindingKey) throw new StaleEpochError(key)
  }
  const names = (): readonly string[] => {
    try {
      return readdirSync(folder)
    } catch (error: unknown) {
      if (storeErrorCode(error) === ENOENT) return []
      throw new Error(`${folder} could not be read: ${describeStoreError(error)}`, {
        cause: error,
      })
    }
  }
  const epoch = (): number => {
    let highest = 0
    for (const name of names()) {
      const match = EPOCH_MARKER.exec(name)
      if (match !== null) highest = Math.max(highest, Number(match[1]))
    }
    return highest
  }
  /** Files named for `pattern` whose epoch passes `isKept`, with their captures. */
  const matching = (pattern: RegExp, isKept: (fileEpoch: number) => boolean) => {
    const found: { name: string; match: RegExpExecArray }[] = []
    for (const name of names()) {
      const match = pattern.exec(name)
      if (match !== null && isKept(Number(match[1]))) found.push({ name, match })
    }
    return found
  }
  /** A record that cannot be read grants nothing, and says so once in the log. */
  const readRecord = <T>(name: string, schema: z.ZodMiniType<T>): T | undefined => {
    try {
      const parsed = schema.safeParse(JSON.parse(readFileSync(path.join(folder, name), 'utf8')))
      if (parsed.success) return parsed.data
      deps.log.warn(`Account paid grant ${name} ignored: not a valid record`)
    } catch (error: unknown) {
      if (storeErrorCode(error) !== ENOENT)
        deps.log.warn(`Account paid grant ${name} ignored: ${describeStoreError(error)}`)
    }
    return undefined
  }
  const ensureFolder = () => {
    mkdirSync(folder, { recursive: true, mode: ACCOUNT_PAID_STORE.folderMode })
  }
  /**
  Writes a record named for `fileEpoch`, refusing once that epoch is no
  longer current. A revoke that lands while it is written leaves it named
  for an older epoch, so it is never read as current; consent's own fence
  refuses the answer, and the next revoke's clear removes the file.
  */
  const writeUnder = async (fileEpoch: number, name: string, content: string) => {
    if (epoch() !== fileEpoch) throw new StaleEpochError(bindingKey)
    ensureFolder()
    await writeFileAtomically(path.join(folder, name), content, {
      sleep: deps.sleep,
      mode: ACCOUNT_PAID_STORE.fileMode,
    })
  }
  const removeBefore = async (pattern: RegExp, before: number) => {
    await Promise.all(
      matching(pattern, (fileEpoch) => fileEpoch < before).map(({ name }) =>
        rm(path.join(folder, name), { force: true }),
      ),
    )
  }
  return {
    readRevocationEpoch: (key) => {
      assertKey(key)
      const current = epoch()
      return current === 0 ? undefined : current
    },
    advanceEpoch: async (key, expected) => {
      assertKey(key)
      if (epoch() !== expected) throw new StaleEpochError(key)
      ensureFolder()
      try {
        await writeFile(path.join(folder, `epoch-${String(expected + 1)}`), '', {
          flag: 'wx',
          mode: ACCOUNT_PAID_STORE.fileMode,
        })
      } catch (error: unknown) {
        if (storeErrorCode(error) === EEXIST) throw new StaleEpochError(key)
        throw error
      }
    },
    readGrants: (key): AccountBindingGrants | undefined => {
      assertKey(key)
      const current = epoch()
      const features = new Set<PaidFeature>()
      const generations = new Map<PaidFeature, string>()
      const files = matching(GRANT_FILE, (fileEpoch) => fileEpoch === current)
      for (const { name, match } of files) {
        const feature = match[2] ?? ''
        if (!isPaidFeature(feature)) continue
        const record = readRecord(name, grantRecordSchema)
        if (record?.generation !== deps.featureGeneration(feature)) continue
        features.add(feature)
        generations.set(feature, record.generation)
      }
      return features.size === 0 ? undefined : { epoch: current, features, generations }
    },
    saveGrantIf: async (key, grantEpoch, grants) => {
      assertKey(key)
      if (grants.epoch !== grantEpoch) throw new StaleEpochError(key)
      for (const feature of grants.features) {
        const generation = grants.generations.get(feature)
        if (generation === undefined || generation !== deps.featureGeneration(feature))
          throw new StaleEpochError(key)
        await writeUnder(
          grantEpoch,
          `grant-${String(grantEpoch)}-${feature}.json`,
          JSON.stringify({ generation }),
        )
      }
    },
    clearGrantsBefore: async (key, before) => {
      assertKey(key)
      await removeBefore(GRANT_FILE, before)
    },
    readQuoteGrant: (quote: PaidQuote): PaidGrant | undefined => {
      const current = epoch()
      const authority = paidAuthorityKey(quote)
      const keyDigest = digest(authority)
      return latestPaidGrant(
        matching(QUOTE_FILE, (fileEpoch) => fileEpoch === current).flatMap(({ name, match }) => {
          if (match[2] !== keyDigest) return []
          const record = readRecord(name, quoteRecordSchema)
          return record !== undefined &&
            paidAuthorityKey(record.quote) === authority &&
            quoteGrantEpoch(record.generation) === current
            ? [record]
            : []
        }),
      )
    },
    saveQuoteGrantIf: async (key, grantEpoch, grant) => {
      assertKey(key)
      if (quoteGrantEpoch(grant.generation) !== grantEpoch) throw new StaleEpochError(key)
      await writeUnder(
        grantEpoch,
        `quote-${String(grantEpoch)}-${digest(paidAuthorityKey(grant.quote))}-${digest(
          JSON.stringify([grant.order ?? 0, grant.quote.id]),
        )}.json`,
        JSON.stringify(grant),
      )
    },
    revokeQuoteGrants: async (key, before) => {
      assertKey(key)
      await removeBefore(QUOTE_FILE, before)
    },
  }
}
