// The running total behind a daily spending limit the person set (PLAN.md
// D121). Each process keeps what its own calls spent in memory and writes it
// to a file of its own after each call; the day's total is the sum of every
// process's file. Nothing is written before a send, nothing is held for a
// call in flight, and no process ever waits for another: there is no lock,
// because no two processes write the same file.
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import { SpendLedgerError } from '../../core/paid/spendLedgerError'
import { DAILY_SPEND_FOLDER } from '../../shared/constants'
import { Usd, nonnegativeUsdSchema, type UsdAmount } from '../../shared/usd'
import { storeErrorCode } from '../backend/storeErrors'
import { writeFileAtomically } from '../fsAtomic'
import {
  legacyClaimIdentityError,
  legacyClaimSpendUsd,
  legacyClaimSchema,
  legacySeedSchema,
  type LegacyClaim,
  type LegacySeed,
} from '../backend/legacyJournal'

const FILE_EXTENSION = '.json'
// A day ("2026-10-17") or a schedule's own day scope; never a path.
const SCOPE = /^[A-Za-z0-9-]+$/u
const totalSchema = z.strictObject({
  spentUsd: nonnegativeUsdSchema,
  unknownChargeCalls: z.number().check(z.int(), z.nonnegative()),
})
// The pre-D121 daily journal (removed by the spend-simple lane): settled
// charges lived in `budget-journal/<account>/<day>/seed.json` plus
// `claims/<id>/claim.json`, under the one fixed daily account. A total
// settled there on the upgrade day is still today's spend.
const LEGACY_JOURNAL_DIRECTORY = 'budget-journal'
const LEGACY_CLAIMS_DIRECTORY = 'claims'
const LEGACY_SEED_FILE = 'seed.json'
const LEGACY_CLAIM_FILE = 'claim.json'
const LEGACY_DAILY_ACCOUNT = '0000000000000000000000000000000000000000000000000000000000000000'

/** What a scope's calls spent, from the usage each reported. */
export interface DailySpendTotal {
  readonly spentUsd: UsdAmount
  /** Calls that went out and reported no usage: their cost is unknown and not in `spentUsd`. */
  readonly unknownChargeCalls: number
}

const NOTHING: DailySpendTotal = { spentUsd: Usd.from(0).toAmount(), unknownChargeCalls: 0 }

export function createDailySpend(deps: {
  readonly directory: string
  readonly sleep: (ms: number) => Promise<void>
}) {
  const ownFile = `${randomUUID()}${FILE_EXTENSION}`
  const own = new Map<string, DailySpendTotal>()
  const writes = new Map<string, Promise<void>>()
  const folder = (scope: string): string => {
    if (!SCOPE.test(scope)) throw new SpendLedgerError('integrity', { scope, file: 'scope' })
    return path.join(deps.directory, scope, DAILY_SPEND_FOLDER)
  }
  const parse = (scope: string, file: string): DailySpendTotal => {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error: unknown) {
      const errno = storeErrorCode(error)
      if (errno === 'ENOENT') return NOTHING
      throw new SpendLedgerError('unreadable', { scope, file: path.basename(file), errno }, error)
    }
    try {
      return totalSchema.parse(JSON.parse(text))
    } catch (error: unknown) {
      throw new SpendLedgerError('damaged', { scope, file: path.basename(file) }, error)
    }
  }
  /**
   * What the pre-D121 journal settled for this scope, or nothing when it
   * never did. Read-only: the legacy files stay where they are, so the
   * first request after upgrading still sees today's spend instead of
   * another full allowance. A legacy record that does not read refuses,
   * like a damaged new one; only settled dollars carry over.
   */
  const readLegacy = (scope: string): DailySpendTotal => {
    const directory = path.join(
      deps.directory,
      LEGACY_JOURNAL_DIRECTORY,
      LEGACY_DAILY_ACCOUNT,
      scope,
    )
    const damaged = (file: string, error: unknown): never => {
      throw new SpendLedgerError('damaged', { scope, file, errno: storeErrorCode(error) }, error)
    }
    // A legacy amount the schema let through but exact decimals cannot hold.
    const finite = (file: string, value: number | string): number | string => {
      if (typeof value === 'number' && !Number.isFinite(value)) damaged(file, value)
      return value
    }
    const readSeedText = (): string | undefined => {
      try {
        return readFileSync(path.join(directory, LEGACY_SEED_FILE), 'utf8')
      } catch (error: unknown) {
        if (storeErrorCode(error) === 'ENOENT') return undefined
        throw new SpendLedgerError(
          'unreadable',
          { scope, file: LEGACY_JOURNAL_DIRECTORY, errno: storeErrorCode(error) },
          error,
        )
      }
    }
    const parseSeed = (text: string): LegacySeed => {
      try {
        return legacySeedSchema.parse(JSON.parse(text))
      } catch (error: unknown) {
        return damaged(LEGACY_SEED_FILE, error)
      }
    }
    const parseClaim = (file: string, text: string): LegacyClaim => {
      try {
        return legacyClaimSchema.parse(JSON.parse(text))
      } catch (error: unknown) {
        return damaged(file, error)
      }
    }
    const readClaimText = (file: string): string => {
      try {
        return readFileSync(path.join(directory, file), 'utf8')
      } catch (error: unknown) {
        return damaged(file, error)
      }
    }
    const seedText = readSeedText()
    if (seedText === undefined) return NOTHING
    const seed = parseSeed(seedText)
    if (seed.sessionId !== scope || seed.accountId !== LEGACY_DAILY_ACCOUNT)
      damaged(LEGACY_SEED_FILE, undefined)
    let spent = Usd.from(finite(LEGACY_SEED_FILE, seed.spentUsd))
    const claimNames = ((): string[] => {
      try {
        return readdirSync(path.join(directory, LEGACY_CLAIMS_DIRECTORY))
      } catch (error: unknown) {
        return damaged(LEGACY_CLAIMS_DIRECTORY, error)
      }
    })()
    for (const name of claimNames) {
      const file = path.join(LEGACY_CLAIMS_DIRECTORY, name, LEGACY_CLAIM_FILE)
      const claim = parseClaim(file, readClaimText(file))
      const identityError = legacyClaimIdentityError(claim, {
        name,
        scopeId: seed.scopeId,
        sessionId: scope,
        accountId: LEGACY_DAILY_ACCOUNT,
      })
      if (identityError !== undefined) damaged(file, identityError)
      // D121: a reservation is never spend. An open claim's reservation is
      // held, not spent, so only a settled charge enters the migrated total;
      // counting the reservation recreates phantom spend (for example from a
      // dead process's unsettled claim) and stops paid requests until
      // midnight. A retained liability its run incurred past the
      // reservation counts all the same (see legacyClaimSpendUsd).
      const claimSpend = legacyClaimSpendUsd(claim)
      if (claimSpend !== undefined) spent = spent.add(Usd.from(finite(file, claimSpend)))
    }
    return { spentUsd: spent.toAmount(), unknownChargeCalls: 0 }
  }
  /** The scope's total across every process; this process's own figure comes from memory. */
  const read = (scope: string): DailySpendTotal => {
    const directory = folder(scope)
    let names: string[]
    try {
      names = readdirSync(directory)
    } catch (error: unknown) {
      const errno = storeErrorCode(error)
      if (errno !== 'ENOENT')
        throw new SpendLedgerError('unreadable', { scope, file: DAILY_SPEND_FOLDER, errno }, error)
      names = []
    }
    let spent = Usd.from(own.get(scope)?.spentUsd ?? 0)
    let unknownChargeCalls = own.get(scope)?.unknownChargeCalls ?? 0
    for (const name of names) {
      if (name === ownFile || !name.endsWith(FILE_EXTENSION)) continue
      const other = parse(scope, path.join(directory, name))
      spent = spent.add(Usd.from(other.spentUsd))
      unknownChargeCalls += other.unknownChargeCalls
    }
    const legacy = readLegacy(scope)
    spent = spent.add(Usd.from(legacy.spentUsd))
    return { spentUsd: spent.toAmount(), unknownChargeCalls }
  }
  /**
   * One finished call, after it ended: its cost from the provider's usage,
   * or `undefined` when it went out and no usage came back. This process's
   * file is rewritten whole, so a crash between calls loses nothing written.
   */
  const add = async (scope: string, costUsd: UsdAmount | undefined): Promise<DailySpendTotal> => {
    const directory = folder(scope)
    if (costUsd !== undefined && Usd.from(costUsd).compare(Usd.from(0)) < 0)
      throw new SpendLedgerError('integrity', { scope, file: 'amount' })
    if (costUsd !== undefined && Usd.from(costUsd).compare(Usd.from(0)) === 0) return read(scope)
    const before = own.get(scope) ?? NOTHING
    const next: DailySpendTotal =
      costUsd === undefined
        ? { ...before, unknownChargeCalls: before.unknownChargeCalls + 1 }
        : { ...before, spentUsd: Usd.from(before.spentUsd).add(Usd.from(costUsd)).toAmount() }
    own.set(scope, next)
    // Writes of one scope go in order, so an older figure never lands last.
    const previous = writes.get(scope) ?? Promise.resolve()
    const write = (async () => {
      try {
        await previous
      } catch {
        // That write's own caller received its failure; this one writes the newer figure.
      }
      const latest = own.get(scope) ?? next
      try {
        await writeFileAtomically(path.join(directory, ownFile), JSON.stringify(latest), {
          sleep: deps.sleep,
        })
      } catch (error: unknown) {
        throw new SpendLedgerError(
          'unreadable',
          { scope, file: DAILY_SPEND_FOLDER, errno: storeErrorCode(error) },
          error,
        )
      }
    })()
    writes.set(scope, write)
    await write
    return read(scope)
  }
  return { read, add }
}
