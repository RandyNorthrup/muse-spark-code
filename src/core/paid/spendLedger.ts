// One atomic admission and one liability state machine for every durable budget.
import { randomUUID, createHash } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  linkSync,
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
} from '../../shared/constants'
import { Usd, type UsdAmount } from '../../shared/usd'
import {
  currentProcessOwner,
  isProcessOwnerGone,
  processOwnerSchema,
  type ProcessOwner,
} from '../locks/processOwner'

const MONEY = z.string().check(z.regex(/^\d+(?:\.\d+)?$/u))
const ID = z.string().check(z.regex(/^[a-f0-9-]+$/u))
const entrySchema = z
  .object({
    id: ID,
    owner: z.optional(processOwnerSchema),
    bound: MONEY,
    state: z.enum(['reserved', 'settled', 'uncertain', 'released']),
    amount: MONEY,
    tariff: z.optional(z.enum(['known', 'unknown'])),
  })
  .check(
    z.refine(
      (entry) =>
        entry.state === 'settled' ||
        (entry.state === 'released'
          ? entry.amount === '0'
          : Usd.from(entry.amount).compare(Usd.from(entry.bound)) === 0),
    ),
  )
export type LedgerEntry = z.infer<typeof entrySchema>
const stateShape = {
  version: z.literal(SPEND_LEDGER_VERSION),
  key: z.string(),
  generation: z.number().check(z.int(), z.nonnegative()),
  settled: MONEY,
  uncertain: MONEY,
  unknownHistory: z.boolean(),
  open: z.array(entrySchema),
  appliedInbox: z.optional(ID),
}
const stateSchema = z
  .object(stateShape)
  .check(
    z.refine(
      (state) =>
        new Set(state.open.map((entry) => entry.id)).size === state.open.length &&
        state.open.every((entry) => entry.state === 'reserved'),
    ),
  )
type State = z.infer<typeof stateSchema>
const transactionSchema = z
  .pipe(
    z.object({
      ...stateShape,
      change: z.object({
        before: z.number().check(z.int(), z.nonnegative()),
        entry: z.optional(entrySchema),
      }),
    }),
    z.transform((value) => ({
      before: value.change.before,
      next: stateSchema.parse(value),
      ...(value.change.entry !== undefined && { entry: value.change.entry }),
    })),
  )
  .check(z.refine((txn) => txn.next.generation === txn.before + 1))
const historySchema = z.pipe(
  z.pipe(
    transactionSchema,
    z.transform((txn) => txn.entry),
  ),
  entrySchema,
)
const noteSchema = z.object({ id: ID, owner: processOwnerSchema })
export { SpendLedgerError, isSpendLedgerError } from './spendLedgerError'
import { SpendLedgerError, isSpendLedgerError, type LedgerFailureKind } from './spendLedgerError'
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
  /** Test-only crash injection at durable boundaries; production leaves it absent. */
  readonly step?: (step: string) => Promise<void>
  readonly onHold?: (ms: number) => void
}
function syncDirectoryNow(directory: string): void {
  if (process.platform === 'win32') return
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}
function syncDirectory(directory: string, deferred?: Set<string>): void {
  if (deferred === undefined) syncDirectoryNow(directory)
  else deferred.add(directory)
}
function total(state: State): LedgerTotal {
  let held = Usd.from(0)
  for (const claim of state.open) held = held.add(Usd.from(claim.amount))
  return {
    spentUsd: Usd.from(state.settled).add(Usd.from(state.uncertain)).add(held).toAmount(),
    heldUsd: held.toAmount(),
    uncertainUsd: Usd.from(state.uncertain).toAmount(),
    openClaims: state.open.length,
    unknownHistory: state.unknownHistory || state.open.some((claim) => claim.tariff === 'unknown'),
  }
}
function receiptId(entry: LedgerEntry): string {
  return createHash('sha256').update(JSON.stringify(entry)).digest('hex')
}
function isSameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
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
// Same-scope operation queues, one per directory for the whole process:
// separate ledger instances in one process (one per bundle copy or caller)
// queue here instead of contending with themselves through the file lock.
const operationTails = new Map<string, Promise<void>>()

/** A complete immutable owner note publishes the lock; no holder ever owns an empty lock. */
export function createSpendLedger(deps: SpendLedgerDeps) {
  const own = currentProcessOwner()
  const gone = isProcessOwnerGone
  const pending = new Map<string, { scope: LedgerScope; entry: LedgerEntry }>()
  const ownerNotes = new Map<string, Promise<string>>()
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
  const stageInto = (
    scope: LedgerScope,
    name: string,
    create: (stage: string) => void,
    deferred?: Set<string>,
  ) => {
    const target = path.join(scope.directory, name)
    const stage = `${target}.${randomUUID()}.tmp`
    try {
      create(stage)
      renameSync(stage, target)
      // POSIX directory sync makes the rename durable; Windows does not expose directory fsync.
      syncDirectory(path.dirname(target), deferred)
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
  const publish = (scope: LedgerScope, name: string, data: unknown, deferred?: Set<string>) => {
    stageInto(
      scope,
      name,
      (stage) => {
        writeFileSync(stage, JSON.stringify(data), { flag: 'wx', flush: true })
      },
      deferred,
    )
  }
  const link = (scope: LedgerScope, source: string, name: string, deferred?: Set<string>) => {
    stageInto(
      scope,
      name,
      (stage) => {
        linkSync(path.join(scope.directory, source), stage)
      },
      deferred,
    )
  }
  const current = (scope: LedgerScope): State => {
    const state = read(scope, 'state.json', stateSchema) ?? fail(scope, 'damaged', 'state.json')
    return state.key === (scope.identity ?? scope.id) ? state : fail(scope, 'integrity', 'scope')
  }
  const finish = (
    scope: LedgerScope,
    txn: z.infer<typeof transactionSchema>,
    deferred?: Set<string>,
  ) => {
    if (txn.entry !== undefined && txn.entry.state !== 'reserved') {
      const file = `history/${txn.entry.id}.json`
      const previous = read(scope, file, historySchema)
      if (previous === undefined) link(scope, 'transaction.json', file, deferred)
      else if (!isSameJson(previous, txn.entry)) fail(scope, 'damaged', 'history')
    }
    const file = `audit/${String(txn.next.generation)}.json`
    const previous = read(scope, file, transactionSchema)
    if (previous === undefined) link(scope, 'transaction.json', file, deferred)
    else if (!isSameJson(previous, txn)) fail(scope, 'damaged', 'audit')
    unlinkSync(path.join(scope.directory, 'transaction.json'))
    syncDirectory(scope.directory, deferred)
  }
  // One commit renames several names in the same directories; syncing each
  // directory once at this commit's end makes the returned state durable
  // without a directory fsync per rename. The set is this commit's own: a
  // publish outside any commit syncs its directory before it returns.
  const commit = async (scope: LedgerScope, before: State, next: State, entry?: LedgerEntry) => {
    const deferred = new Set<string>()
    try {
      const txn = {
        before: before.generation,
        next: { ...next, generation: before.generation + 1 },
        ...(entry !== undefined && { entry }),
      }
      publish(
        scope,
        'transaction.json',
        {
          ...txn.next,
          change: { before: txn.before, ...(entry !== undefined && { entry }) },
        },
        deferred,
      )
      await deps.step?.('transaction')
      link(scope, 'transaction.json', 'state.json', deferred)
      await deps.step?.('state')
      finish(scope, txn, deferred)
      await deps.step?.('audit')
      return txn.next
    } finally {
      for (const dir of deferred) syncDirectoryNow(dir)
    }
  }
  const transition = async (
    scope: LedgerScope,
    state: State,
    entry: LedgerEntry,
  ): Promise<State> => {
    const existing = state.open.find((claim) => claim.id === entry.id)
    if (existing === undefined) {
      const closed = read(scope, `history/${entry.id}.json`, historySchema)
      if (closed !== undefined) {
        if (!isSameJson(closed, entry)) fail(scope, 'integrity', 'history')
        return state
      }
      // A charge without a previous reservation is never discarded.
      if (entry.state === 'released') fail(scope, 'integrity', 'claim')
    } else if (
      !isSameJson(existing.owner, entry.owner) ||
      Usd.from(entry.bound).compare(Usd.from(existing.bound)) < 0
    )
      fail(scope, 'integrity', 'claim')
    const next = { ...withEntry(state, entry), appliedInbox: receiptId(entry) }
    return await commit(scope, state, next, entry)
  }
  const list = (scope: LedgerScope, folder: string): string[] => {
    try {
      return readdirSync(path.join(scope.directory, folder))
    } catch (error: unknown) {
      return fail(scope, 'unreadable', folder, error)
    }
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
        link(scope, 'transaction.json', 'state.json')
      finish(scope, txn)
      state = txn.next
      await deps.step?.('recovery-transaction')
    }
    if (state === undefined) {
      if (list(scope, 'audit').length > 0) fail(scope, 'damaged', 'state.json')
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
    const inboxNames = list(scope, 'inbox')
    for (const name of inboxNames) {
      if (!name.endsWith('.json')) continue
      const entry = read(scope, `inbox/${name}`, entrySchema) ?? fail(scope, 'damaged', 'inbox')
      if (name !== `${entry.id}.json`) fail(scope, 'damaged', 'inbox')
      if (state.appliedInbox !== receiptId(entry)) state = await transition(scope, state, entry)
      unlinkSync(path.join(scope.directory, 'inbox', name))
      syncDirectory(path.join(scope.directory, 'inbox'))
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
  // One process never contends with itself through the filesystem lock:
  // same-scope operations queue here first, so the on-disk lock only ever
  // arbitrates between processes and a holder in this process can never
  // make its own next operation refuse as busy.
  const serialise = async <T>(scope: LedgerScope, operation: () => Promise<T>): Promise<T> => {
    const key = scope.directory
    const previous = operationTails.get(key) ?? Promise.resolve()
    // Not `Promise.withResolvers`, which Node 20 (VS Code 1.99's host) lacks.
    let releaseGate: (() => void) | undefined
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- Node 20 (VS Code 1.99's host) lacks Promise.withResolvers (PLAN.md §8); the executor assigns the resolver synchronously, so releaseGate?.() in finally always releases the next operation.
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve
    })
    const tail = (async (): Promise<void> => {
      await previous
      await gate
    })()
    operationTails.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      releaseGate?.()
      if (operationTails.get(key) === tail) operationTails.delete(key)
    }
  }
  const lockOperation = async <T>(
    scope: LedgerScope,
    operation: (state: State) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> => {
    for (const folder of ['', 'audit', 'history', 'sent', 'inbox', 'owners'])
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
    let note = ownerNotes.get(scope.directory)
    if (note === undefined) {
      note = (async () => {
        const id = randomUUID()
        try {
          publish(scope, `owners/${id}`, { id, owner: await own })
          return id
        } catch (error: unknown) {
          ownerNotes.delete(scope.directory)
          throw error
        }
      })()
      ownerNotes.set(scope.directory, note)
    }
    const id = await note
    const staging = path.join(scope.directory, `.lock-${randomUUID()}`)
    mkdirSync(staging)
    linkSync(path.join(scope.directory, 'owners', id), path.join(staging, id))
    const deadline = performance.now() + timeoutMs
    const judged = new Map<string, boolean>()
    let isAcquired = false
    let attempts = 0
    try {
      for (;;) {
        // The first attempt always runs, so a zero wait means try once.
        if (attempts++ > 0 && performance.now() >= deadline) fail(scope, 'busy', 'lock')
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
            // Windows answers EPERM while the lock directory is being removed
            // (measured, PR 156); a vanished lock is contention, not damage.
            if (
              ['EPERM', 'EACCES'].includes(codeOf(renameError) ?? '') &&
              process.platform !== 'win32'
            )
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
  const locked = async <T>(
    scope: LedgerScope,
    operation: (state: State) => Promise<T>,
    timeoutMs: number = SPEND_LEDGER_LOCK_TIMEOUT_MS,
  ): Promise<T> => {
    try {
      return await serialise(scope, async () => await lockOperation(scope, operation, timeoutMs))
    } catch (error: unknown) {
      if (isSpendLedgerError(error)) throw error
      return fail(scope, 'unreadable', 'lock or recovery', error)
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
      const names = list(scope, 'inbox')
      for (const name of names) {
        if (!name.endsWith('.json')) continue
        const entry = read(scope, `inbox/${name}`, entrySchema)
        if (entry === undefined) continue
        if (name !== `${entry.id}.json`) fail(scope, 'damaged', 'inbox')
        if (snapshot.appliedInbox === receiptId(entry)) continue
        if (read(scope, `history/${entry.id}.json`, historySchema) === undefined)
          state = withEntry(state, entry)
      }
      // A failed publication remains a liability in this process before its next write.
      for (const item of pending.values()) {
        if (
          !isSamePath(item.scope.directory, scope.directory, process.platform) ||
          snapshot.appliedInbox === receiptId(item.entry) ||
          read(scope, `inbox/${item.entry.id}.json`, entrySchema) !== undefined ||
          read(scope, `history/${item.entry.id}.json`, historySchema) !== undefined
        )
          continue
        state = withEntry(state, item.entry)
      }
      if (current(scope).generation === snapshot.generation) return total(state)
    }
  }
  const drainOrView = async (scope: LedgerScope): Promise<LedgerTotal> => {
    // The charge is already durable in the inbox and counted by view():
    // draining it now is opportunistic, so never wait out another
    // process's lock hold just to fold it into the snapshot.
    try {
      return await locked(scope, (state) => Promise.resolve(total(state)), 0)
    } catch (error: unknown) {
      if (isSpendLedgerError(error) && error.kind === 'busy') return view(scope)
      throw error
    }
  }
  const claimFor = (scope: LedgerScope, created: LedgerEntry): LedgerClaim => {
    let latest = created
    const owned = (): LedgerEntry => {
      const state = current(scope)
      const entry =
        pending.get(`${scope.directory}/${created.id}`)?.entry ??
        read(scope, `inbox/${created.id}.json`, entrySchema) ??
        state.open.find((claim) => claim.id === created.id) ??
        read(scope, `history/${created.id}.json`, historySchema)
      return entry === undefined ||
        !isSameJson(entry.owner, created.owner) ||
        Usd.from(entry.bound).compare(Usd.from(created.bound)) < 0
        ? fail(scope, 'integrity', 'claim')
        : entry
    }
    const save = async (entry: LedgerEntry) => {
      validateAmount(scope, entry.amount)
      const previous = latest
      if (previous.state !== 'reserved' && !isSameJson(previous, entry))
        return fail(scope, 'integrity', 'claim')
      const key = `${scope.directory}/${created.id}`
      pending.set(key, { scope, entry })
      latest = entry
      await deps.step?.('settlement-queued')
      publish(scope, `inbox/${entry.id}.json`, entry)
      await deps.step?.('receipt')
      return await drainOrView(scope)
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
        const previous = latest
        if (status === 'released' && Usd.from(amount).compare(Usd.from(0)) !== 0)
          fail(scope, 'integrity', 'claim')
        return await save({
          ...previous,
          state: status,
          amount: status === 'uncertain' ? previous.bound : Usd.from(amount).toString(),
        })
      },
      retain: async (amount) => {
        const previous = latest
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
  const readTotal = async (scope: LedgerScope): Promise<LedgerTotal> => {
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
    read: readTotal,
    readExisting(scope: LedgerScope): LedgerTotal | undefined {
      return read(scope, 'state.json', stateSchema) === undefined ? undefined : view(scope)
    },
    lookup(scope: LedgerScope, id: string): LedgerEntry {
      return ID.safeParse(id).success
        ? (current(scope).open.find((entry) => entry.id === id) ??
            read(scope, `history/${id}.json`, historySchema) ??
            fail(scope, 'damaged', 'claim'))
        : fail(scope, 'integrity', 'claim id')
    },
    async record(
      scope: LedgerScope,
      amount: UsdAmount,
      state: 'settled' | 'uncertain' | 'released' = 'settled',
    ): Promise<LedgerTotal> {
      validateAmount(scope, amount)
      if (state === 'released') {
        // A released record is a non-charge: it must be zero and writes no entry.
        if (Usd.from(amount).compare(Usd.from(0)) !== 0) fail(scope, 'integrity', 'claim')
        return await readTotal(scope)
      }
      const entry: LedgerEntry = {
        id: randomUUID(),
        owner: await own,
        bound: amount,
        state,
        amount,
      }
      pending.set(`${scope.directory}/${entry.id}`, { scope, entry })
      try {
        mkdirSync(path.join(scope.directory, 'inbox'), { recursive: true })
      } catch (error: unknown) {
        fail(scope, 'unreadable', 'inbox', error)
      }
      publish(scope, `inbox/${entry.id}.json`, entry)
      return await drainOrView(scope)
    },
  }
}
