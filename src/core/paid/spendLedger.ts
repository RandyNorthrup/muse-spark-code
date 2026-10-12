// One atomic admission and one liability state machine for every durable budget.
import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { isSamePath } from '../paths'
import * as z from 'zod/mini'
import {
  SPEND_LEDGER_LOCK_TIMEOUT_MS,
  SPEND_LEDGER_VERSION,
  DAILY_BUDGET_LOCK_WAIT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { formatUsd } from '../../shared/l10n/exactUsd'
import { fill } from '../../shared/l10n/text'
import { Usd, type UsdAmount } from '../../shared/usd'
import {
  currentProcessOwner,
  isProcessOwnerGone,
  processOwnerSchema,
  type ProcessOwner,
} from '../locks/processOwner'

const MONEY = z.string().check(z.regex(/^\d+(?:\.\d+)?$/u))
const ID = z.string().check(z.regex(/^[a-f0-9-]+$/u))
const entrySchema = z.object({
  id: ID,
  owner: z.optional(processOwnerSchema),
  bound: MONEY,
  state: z.enum(['reserved', 'settled', 'uncertain', 'released']),
  amount: MONEY,
  tariff: z.optional(z.enum(['known', 'unknown'])),
})
export type LedgerEntry = z.infer<typeof entrySchema>
const stateSchema = z.object({
  version: z.literal(SPEND_LEDGER_VERSION),
  key: z.string(),
  generation: z.number().check(z.int(), z.nonnegative()),
  settled: MONEY,
  uncertain: MONEY,
  unknownHistory: z.boolean(),
  open: z.array(entrySchema),
  appliedInbox: z.optional(ID),
})
type State = z.infer<typeof stateSchema>
const transactionSchema = z.object({
  before: z.number(),
  next: stateSchema,
  entry: z.optional(entrySchema),
})
const noteSchema = z.object({ id: ID, owner: processOwnerSchema })
export type LedgerFailureKind =
  'budget' | 'busy' | 'damaged' | 'unreadable' | 'recovery' | 'integrity' | 'legacy'
export class SpendLedgerError extends Error {
  public constructor(
    public readonly kind: LedgerFailureKind,
    public readonly facts: {
      readonly scope: string
      readonly file?: string
      readonly errno?: string | undefined
      readonly bound?: UsdAmount
      readonly total?: UsdAmount
      readonly cap?: UsdAmount
    },
    cause?: unknown,
  ) {
    let sentence: string
    switch (kind) {
      case 'busy': {
        sentence = UI_TEXT.spendLedgerBusy
        break
      }
      case 'damaged': {
        sentence = UI_TEXT.spendLedgerDamaged
        break
      }
      case 'unreadable': {
        sentence = UI_TEXT.spendLedgerUnreadable
        break
      }
      case 'legacy': {
        sentence = fill(UI_TEXT.sessionBudgetLegacyFeesUnknown, {
          scope: facts.scope,
          spent: formatUsd(facts.total ?? 0),
        })
        break
      }
      case 'recovery': {
        sentence = UI_TEXT.spendLedgerRecovery
        break
      }
      default: {
        sentence = UI_TEXT.spendLedgerIntegrity
      }
    }
    super(
      fill(sentence, { scope: facts.scope, file: facts.file ?? '', errno: facts.errno ?? '' }),
      { cause },
    )
    this.name = 'SpendLedgerError'
  }
}
export function isSpendLedgerError(error: unknown): error is SpendLedgerError {
  return (
    error instanceof Error &&
    error.name === 'SpendLedgerError' &&
    'kind' in error &&
    'facts' in error
  )
}
function codeOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}
export interface LedgerScope {
  readonly directory: string
  readonly id: string
  readonly identity?: string
}
export interface LedgerTotal {
  readonly spentUsd: UsdAmount
  readonly heldUsd: UsdAmount
  readonly uncertainUsd: UsdAmount
  readonly openClaims: number
  readonly unknownHistory: boolean
}
export interface LedgerClaim {
  readonly id: string
  readonly bound: UsdAmount
  markSent(): void
  markUnsent(): void
  check(): LedgerTotal
  settle(state: Exclude<LedgerEntry['state'], 'reserved'>, amount: UsdAmount): Promise<LedgerTotal>
  retain(amount: UsdAmount): Promise<LedgerTotal>
}
export interface SpendLedgerDeps {
  readonly sleep: (ms: number) => Promise<void>
  readonly initial: (scope: LedgerScope) => Promise<{
    readonly settled: UsdAmount
    readonly uncertain?: UsdAmount
    readonly unknownHistory: boolean
    readonly open?: readonly LedgerEntry[]
  }>
  readonly owner?: () => Promise<ProcessOwner>
  readonly isGone?: (owner: ProcessOwner) => Promise<boolean>
  /** Test-only crash injection at durable boundaries; production leaves it absent. */
  readonly step?: (step: string) => Promise<void>
  readonly rename?: (from: string, to: string) => void
  readonly onHold?: (ms: number) => void
}
function total(state: State): LedgerTotal {
  let held = Usd.from(0)
  for (const claim of state.open) held = held.add(Usd.from(claim.amount))
  return {
    spentUsd: Usd.from(state.settled).add(Usd.from(state.uncertain)).add(held).toAmount(),
    heldUsd: held.toAmount(),
    uncertainUsd: Usd.from(state.uncertain).add(held).toAmount(),
    openClaims: state.open.length,
    unknownHistory: state.unknownHistory || state.open.some((claim) => claim.tariff === 'unknown'),
  }
}
function withEntry(state: State, entry: LedgerEntry): State {
  const next = { ...state, open: state.open.filter((claim) => claim.id !== entry.id) }
  switch (entry.state) {
    case 'reserved': {
      next.open.push(entry)
      return next
    }
    case 'settled': {
      return { ...next, settled: Usd.from(next.settled).add(Usd.from(entry.amount)).toString() }
    }
    case 'uncertain': {
      return {
        ...next,
        unknownHistory: next.unknownHistory || entry.tariff === 'unknown',
        uncertain: Usd.from(next.uncertain).add(Usd.from(entry.amount)).toString(),
      }
    }
    case 'released': {
      return next
    }
  }
}
/** A complete immutable owner note publishes the lock; no holder ever owns an empty lock. */
export function createSpendLedger(deps: SpendLedgerDeps) {
  const own = (deps.owner ?? currentProcessOwner)()
  const gone = deps.isGone ?? isProcessOwnerGone
  const pending = new Map<string, { scope: LedgerScope; entry: LedgerEntry }>()
  const fail = (
    scope: LedgerScope,
    kind: LedgerFailureKind,
    file?: string,
    cause?: unknown,
  ): never => {
    throw new SpendLedgerError(
      kind,
      {
        scope: scope.id,
        ...(file !== undefined && { file }),
        ...(codeOf(cause) !== undefined && { errno: codeOf(cause) }),
      },
      cause,
    )
  }
  const read = <T>(scope: LedgerScope, name: string, schema: z.ZodMiniType<T>): T | undefined => {
    let text: string
    try {
      text = readFileSync(path.join(scope.directory, name), 'utf8')
    } catch (error: unknown) {
      if (codeOf(error) === 'ENOENT') return
      return fail(scope, 'unreadable', name, error)
    }
    try {
      return schema.parse(JSON.parse(text))
    } catch (error: unknown) {
      return fail(scope, 'damaged', name, error)
    }
  }
  const publish = (scope: LedgerScope, name: string, data: unknown) => {
    const target = path.join(scope.directory, name)
    const stage = `${target}.${randomUUID()}.tmp`
    try {
      writeFileSync(stage, JSON.stringify(data), { flag: 'wx', flush: true })
      ;(deps.rename ?? renameSync)(stage, target)
      // POSIX directory sync makes the rename durable; Windows does not expose directory fsync.
      if (process.platform !== 'win32') {
        const fd = openSync(path.dirname(target), 'r')
        try {
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
      }
    } catch (error: unknown) {
      fail(scope, 'unreadable', name, error)
    } finally {
      try {
        unlinkSync(stage)
      } catch (error: unknown) {
        if (codeOf(error) !== 'ENOENT') fail(scope, 'unreadable', name, error)
      }
    }
  }
  const current = (scope: LedgerScope): State => {
    const state = read(scope, 'state.json', stateSchema) ?? fail(scope, 'damaged', 'state.json')
    return state.key === (scope.identity ?? scope.id) ? state : fail(scope, 'integrity', 'scope')
  }
  const finish = (scope: LedgerScope, txn: z.infer<typeof transactionSchema>) => {
    if (txn.entry !== undefined && txn.entry.state !== 'reserved') {
      const file = `history/${txn.entry.id}.json`
      const previous = read(scope, file, entrySchema)
      if (previous === undefined) publish(scope, file, txn.entry)
      else if (JSON.stringify(previous) !== JSON.stringify(txn.entry))
        fail(scope, 'damaged', 'history')
    }
    const file = `audit/${String(txn.next.generation)}.json`
    const previous = read(scope, file, transactionSchema)
    if (previous === undefined) publish(scope, file, txn)
    else if (JSON.stringify(previous) !== JSON.stringify(txn)) fail(scope, 'damaged', 'audit')
    unlinkSync(path.join(scope.directory, 'transaction.json'))
  }
  const commit = async (scope: LedgerScope, before: State, next: State, entry?: LedgerEntry) => {
    const txn = {
      before: before.generation,
      next: { ...next, generation: before.generation + 1 },
      ...(entry !== undefined && { entry }),
    }
    publish(scope, 'transaction.json', txn)
    await deps.step?.('transaction')
    publish(scope, 'state.json', txn.next)
    await deps.step?.('state')
    finish(scope, txn)
    await deps.step?.('audit')
    return txn.next
  }
  const transition = async (
    scope: LedgerScope,
    state: State,
    entry: LedgerEntry,
  ): Promise<State> => {
    const existing = state.open.find((claim) => claim.id === entry.id)
    if (existing === undefined) {
      const closed = read(scope, `history/${entry.id}.json`, entrySchema)
      if (closed !== undefined) {
        if (JSON.stringify(closed) !== JSON.stringify(entry)) fail(scope, 'integrity', 'history')
        return state
      }
      // A charge without a previous reservation is never discarded.
      if (entry.state === 'released') fail(scope, 'integrity', 'claim')
    } else if (
      JSON.stringify(existing.owner) !== JSON.stringify(entry.owner) ||
      (existing.bound !== entry.bound &&
        !(
          entry.state === 'reserved' && Usd.from(entry.bound).compare(Usd.from(existing.bound)) >= 0
        ))
    )
      fail(scope, 'integrity', 'claim')
    const next = { ...withEntry(state, entry), appliedInbox: entry.id }
    return await commit(scope, state, next, entry)
  }
  const recover = async (scope: LedgerScope, deadOwners: ReadonlySet<string>): Promise<State> => {
    const txn = read(scope, 'transaction.json', transactionSchema)
    let state = read(scope, 'state.json', stateSchema)
    if (state !== undefined && state.key !== (scope.identity ?? scope.id))
      fail(scope, 'integrity', 'scope')
    if (txn !== undefined) {
      if (txn.next.key !== (scope.identity ?? scope.id))
        fail(scope, 'integrity', 'transaction scope')
      if (
        state !== undefined &&
        state.generation !== txn.before &&
        state.generation !== txn.next.generation
      )
        fail(scope, 'damaged', 'transaction.json')
      if (state === undefined || state.generation === txn.before)
        publish(scope, 'state.json', txn.next)
      finish(scope, txn)
      state = txn.next
      await deps.step?.('recovery-transaction')
    }
    if (state === undefined) {
      if (readdirSync(path.join(scope.directory, 'audit')).length > 0)
        fail(scope, 'damaged', 'state.json')
      const initial = await deps.initial(scope)
      state = {
        version: SPEND_LEDGER_VERSION,
        key: scope.identity ?? scope.id,
        generation: 0,
        settled: initial.settled,
        uncertain: initial.uncertain ?? '0',
        unknownHistory: initial.unknownHistory,
        open: [...(initial.open ?? [])],
      }
      publish(scope, 'state.json', state)
    }
    const inboxNames = readdirSync(path.join(scope.directory, 'inbox'))
    for (const name of inboxNames) {
      if (!name.endsWith('.json')) continue
      const entry = read(scope, `inbox/${name}`, entrySchema) ?? fail(scope, 'damaged', 'inbox')
      if (state.appliedInbox !== entry.id) state = await transition(scope, state, entry)
      unlinkSync(path.join(scope.directory, 'inbox', name))
      if (process.platform !== 'win32') {
        const fd = openSync(path.join(scope.directory, 'inbox'), 'r')
        try {
          fsyncSync(fd)
        } finally {
          closeSync(fd)
        }
      }
      pending.delete(`${scope.directory}/${entry.id}`)
      await deps.step?.('inbox-consumed')
    }
    for (const claim of state.open) {
      if (claim.owner === undefined) continue
      const isDead = deadOwners.has(JSON.stringify(claim.owner))
      if (!isDead) continue
      const wasSent =
        read(scope, `sent/${claim.id}.json`, z.object({ sent: z.boolean() }))?.sent === true
      state = await transition(scope, state, {
        ...claim,
        state: wasSent ? 'uncertain' : 'released',
        amount: wasSent ? claim.bound : '0',
      })
      await deps.step?.('recovery-claim')
    }
    return state
  }
  const locked = async <T>(
    scope: LedgerScope,
    operation: (state: State) => Promise<T>,
  ): Promise<T> => {
    for (const folder of ['', 'audit', 'history', 'sent', 'inbox'])
      mkdirSync(path.join(scope.directory, folder), { recursive: true })
    for (const item of pending.values()) {
      if (!isSamePath(item.scope.directory, scope.directory, process.platform)) continue
      const queued = read(scope, `inbox/${item.entry.id}.json`, entrySchema)
      if (queued === undefined) publish(scope, `inbox/${item.entry.id}.json`, item.entry)
    }
    // Birth probes can start PowerShell on Windows. Gather immutable death evidence
    // before owning the ledger lock; a newly appeared owner stays reserved this pass.
    const deadOwners = new Set<string>()
    const candidates = [
      read(scope, 'state.json', stateSchema),
      read(scope, 'transaction.json', transactionSchema)?.next,
    ]
    const owners = new Map<string, ProcessOwner>()
    for (const candidate of candidates) {
      const entries = candidate?.open ?? []
      for (const entry of entries) {
        if (entry.owner !== undefined) owners.set(JSON.stringify(entry.owner), entry.owner)
      }
    }
    for (const [identity, owner] of owners) if (await gone(owner)) deadOwners.add(identity)
    const lock = path.join(scope.directory, 'lock')
    const id = randomUUID()
    const staging = path.join(scope.directory, `.lock-${id}`)
    const note = { id, owner: await own }
    mkdirSync(staging)
    writeFileSync(path.join(staging, id), JSON.stringify(note), { flag: 'wx', flush: true })
    const deadline = performance.now() + SPEND_LEDGER_LOCK_TIMEOUT_MS
    const judged = new Map<string, boolean>()
    let isAcquired = false
    try {
      for (;;) {
        if (performance.now() >= deadline) fail(scope, 'busy', 'lock')
        let renameError: unknown
        try {
          renameSync(staging, lock)
          isAcquired = true
          break
        } catch (error: unknown) {
          renameError = error
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(codeOf(error) ?? ''))
            fail(scope, 'unreadable', 'lock', error)
        }
        let names: string[]
        try {
          names = readdirSync(lock)
        } catch (error: unknown) {
          if (codeOf(error) === 'ENOENT') {
            if (['EPERM', 'EACCES'].includes(codeOf(renameError) ?? ''))
              return fail(scope, 'unreadable', 'lock', renameError)
            continue
          }
          return fail(scope, 'unreadable', 'lock', error)
        }
        if (names.length === 0) {
          try {
            rmdirSync(lock)
          } catch (error: unknown) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(codeOf(error) ?? ''))
              fail(scope, 'unreadable', 'lock', error)
          }
          continue
        }
        if (names.length !== 1) fail(scope, 'damaged', 'lock')
        const filename = names[0] ?? fail(scope, 'damaged', 'lock')
        let owner: z.infer<typeof noteSchema>
        try {
          owner = noteSchema.parse(JSON.parse(readFileSync(path.join(lock, filename), 'utf8')))
        } catch (error: unknown) {
          if (codeOf(error) === 'ENOENT') continue
          return fail(scope, codeOf(error) === undefined ? 'damaged' : 'unreadable', 'lock', error)
        }
        if (owner.id !== filename) fail(scope, 'damaged', 'lock')
        let isDead = judged.get(owner.id)
        if (isDead === undefined) {
          isDead = await gone(owner.owner)
          judged.set(owner.id, isDead)
        }
        if (isDead) {
          try {
            unlinkSync(path.join(lock, owner.id))
            rmdirSync(lock)
          } catch (error: unknown) {
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(codeOf(error) ?? ''))
              fail(scope, 'unreadable', 'lock', error)
          }
          continue
        }
        if (performance.now() >= deadline) fail(scope, 'busy', 'lock')
        await deps.sleep(DAILY_BUDGET_LOCK_WAIT_MS)
      }
      const heldAt = performance.now()
      await deps.step?.('lock')
      const state = await recover(scope, deadOwners)
      try {
        return await operation(state)
      } finally {
        deps.onHold?.(performance.now() - heldAt)
      }
    } finally {
      if (isAcquired) {
        unlinkSync(path.join(lock, id))
        try {
          rmdirSync(lock)
        } catch (error: unknown) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(codeOf(error) ?? ''))
            fail(scope, 'unreadable', 'lock', error)
        }
      } else {
        unlinkSync(path.join(staging, id))
        rmdirSync(staging)
      }
    }
  }
  const validateAmount = (scope: LedgerScope, amount: string) => {
    try {
      if (Usd.from(amount).compare(Usd.from(0)) < 0) fail(scope, 'integrity', 'amount')
    } catch (error: unknown) {
      if (isSpendLedgerError(error)) throw error
      fail(scope, 'integrity', 'amount', error)
    }
  }
  const view = (scope: LedgerScope): LedgerTotal => {
    for (;;) {
      const snapshot = current(scope)
      let state = snapshot
      const names = readdirSync(path.join(scope.directory, 'inbox'))
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const entry = read(scope, `inbox/${name}`, entrySchema)
        if (entry === undefined || snapshot.appliedInbox === entry.id) continue
        if (read(scope, `history/${entry.id}.json`, entrySchema) === undefined)
          state = withEntry(state, entry)
      }
      if (current(scope).generation === snapshot.generation) return total(state)
    }
  }
  const claimFor = (scope: LedgerScope, created: LedgerEntry): LedgerClaim => {
    const owned = (): LedgerEntry => {
      const state = current(scope)
      const entry =
        read(scope, `inbox/${created.id}.json`, entrySchema) ??
        state.open.find((claim) => claim.id === created.id) ??
        read(scope, `history/${created.id}.json`, entrySchema)
      return entry === undefined ||
        JSON.stringify(entry.owner) !== JSON.stringify(created.owner) ||
        Usd.from(entry.bound).compare(Usd.from(created.bound)) < 0
        ? fail(scope, 'integrity', 'claim')
        : entry
    }
    const save = async (entry: LedgerEntry) => {
      validateAmount(scope, entry.amount)
      const previous = owned()
      if (previous.state !== 'reserved' && JSON.stringify(previous) !== JSON.stringify(entry))
        return fail(scope, 'integrity', 'claim')
      const key = `${scope.directory}/${created.id}`
      pending.set(key, { scope, entry })
      publish(scope, `inbox/${entry.id}.json`, entry)
      try {
        return await locked(scope, (state) => Promise.resolve(total(state)))
      } catch (error: unknown) {
        if (isSpendLedgerError(error) && error.kind === 'busy') return view(scope)
        throw error
      }
    }
    return {
      id: created.id,
      bound: Usd.from(created.bound).toAmount(),
      check: () => {
        if (owned().state !== 'reserved') fail(scope, 'integrity', 'claim')
        return view(scope)
      },
      markSent: () => {
        if (owned().state !== 'reserved') fail(scope, 'integrity', 'claim')
        publish(scope, `sent/${created.id}.json`, { sent: true })
      },
      markUnsent: () => {
        if (owned().state !== 'reserved') fail(scope, 'integrity', 'claim')
        publish(scope, `sent/${created.id}.json`, { sent: false })
      },
      settle: async (status, amount) => {
        const previous = owned()
        if (status === 'released' && Usd.from(amount).compare(Usd.from(0)) !== 0)
          fail(scope, 'integrity', 'claim')
        return await save({
          ...previous,
          state: status,
          amount: status === 'uncertain' ? previous.bound : Usd.from(amount).toString(),
        })
      },
      retain: async (amount) => {
        const previous = owned()
        if (
          previous.state !== 'reserved' ||
          Usd.from(amount).compare(Usd.from(previous.amount)) < 0
        )
          fail(scope, 'integrity', 'claim')
        return await save({
          ...previous,
          bound: Usd.from(amount).toString(),
          amount: Usd.from(amount).toString(),
        })
      },
    }
  }
  return {
    async admit(
      scope: LedgerScope,
      bound: UsdAmount,
      cap: UsdAmount,
      tariff: 'known' | 'unknown' = 'known',
    ): Promise<LedgerClaim> {
      validateAmount(scope, bound)
      validateAmount(scope, cap)
      return await locked(scope, async (state) => {
        const totals = total(state)
        if (Usd.from(cap).compare(Usd.from(0)) > 0) {
          if (tariff === 'unknown' || totals.unknownHistory)
            throw new SpendLedgerError('legacy', {
              scope: scope.id,
              file: 'migration',
              total: totals.spentUsd,
            })
          if (Usd.from(totals.spentUsd).add(Usd.from(bound)).compare(Usd.from(cap)) > 0)
            throw new SpendLedgerError('budget', {
              scope: scope.id,
              bound,
              total: totals.spentUsd,
              cap,
            })
        }
        const entry: LedgerEntry = {
          id: randomUUID(),
          owner: await own,
          bound,
          state: 'reserved',
          amount: bound,
          tariff,
        }
        await commit(
          scope,
          state,
          {
            ...state,
            unknownHistory: state.unknownHistory,
            open: [...state.open, entry],
          },
          entry,
        )
        await deps.step?.('admitted')
        return claimFor(scope, entry)
      })
    },
    async read(scope: LedgerScope): Promise<LedgerTotal> {
      try {
        return await locked(scope, (state) => Promise.resolve(total(state)))
      } catch (error: unknown) {
        if (
          isSpendLedgerError(error) &&
          error.kind === 'busy' &&
          read(scope, 'state.json', stateSchema) !== undefined
        )
          return view(scope)
        throw error
      }
    },
    readExisting(scope: LedgerScope): LedgerTotal | undefined {
      return read(scope, 'state.json', stateSchema) === undefined ? undefined : view(scope)
    },
    lookup(scope: LedgerScope, id: string): LedgerEntry {
      return ID.safeParse(id).success
        ? (current(scope).open.find((entry) => entry.id === id) ??
            read(scope, `history/${id}.json`, entrySchema) ??
            fail(scope, 'damaged', 'claim'))
        : fail(scope, 'integrity', 'claim id')
    },
    async record(scope: LedgerScope, amount: UsdAmount, isUncertain = false): Promise<LedgerTotal> {
      validateAmount(scope, amount)
      const entry: LedgerEntry = {
        id: randomUUID(),
        owner: await own,
        bound: amount,
        state: isUncertain ? 'uncertain' : 'settled',
        amount,
      }
      mkdirSync(path.join(scope.directory, 'inbox'), { recursive: true })
      pending.set(`${scope.directory}/${entry.id}`, { scope, entry })
      publish(scope, `inbox/${entry.id}.json`, entry)
      try {
        return await locked(scope, (state) => Promise.resolve(total(state)))
      } catch (error: unknown) {
        if (isSpendLedgerError(error) && error.kind === 'busy') return view(scope)
        throw error
      }
    },
  }
}
