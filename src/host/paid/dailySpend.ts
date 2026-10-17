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

const FILE_EXTENSION = '.json'
// A day ("2026-10-17") or a schedule's own day scope; never a path.
const SCOPE = /^[A-Za-z0-9-]+$/u
const totalSchema = z.strictObject({
  spentUsd: nonnegativeUsdSchema,
  unknownChargeCalls: z.number().check(z.int(), z.nonnegative()),
})

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
