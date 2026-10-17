// Durable account admission projections. Each claim owns one immutable name;
// concurrent writers cannot overwrite another claim. Missing completion keeps
// full liability. Strict records contain opaque ids and counters only.
import { createHash, randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  lstatSync,
  unlinkSync,
  rmSync,
  existsSync,
} from 'node:fs'
import path from 'node:path'
import * as z from 'zod/mini'
import {
  accountEventSchema,
  accountIdSchema,
  type AccountEvent,
  type Account,
  type AccountJournalReader,
  type AccountUsageQuery,
  type AccountUsageTotals,
} from '../../shared/accounts'
import {
  ACCOUNT_REQUEST_STORE,
  ACCOUNT_DAY_MS,
  ISO_DATE_LENGTH,
  ACCOUNT_HEADROOM_SCALE,
  ACCOUNT_HEADROOM_ONE,
  ACCOUNT_HEADROOM_ZERO,
  UI_TEXT,
} from '../../shared/constants'
import { Usd, usdAmountSchema, type UsdAmount } from '../../shared/usd'
import { usdDecimal } from '../../shared/accountUsd'
import {
  accountLimitBlockSchema,
  isAccountLimitEligible,
  type AccountLimitBlock,
} from '../../core/accounts/limitBlock'
import { accountPeriodRange } from '../../core/accounts/thresholds'
import type {
  AccountPoolClaim,
  AccountPoolRequest,
  AccountRequestEstimate,
} from '../../core/accounts/pool'

const count = z.int().check(z.nonnegative())
const rowSchema = z.strictObject({
  processId: z.optional(z.int().check(z.positive())),
  provider: accountIdSchema,
  account: accountIdSchema,
  time: z.iso.datetime(),
  reservedUsd: usdAmountSchema,
  settledUsd: z.nullable(usdAmountSchema),
  inputTokens: count,
  outputTokens: count,
  requests: count,
  hasSent: z.boolean(),
  isClosed: z.boolean(),
})
type Row = z.infer<typeof rowSchema>
const blockSchema = z.strictObject({
  provider: accountIdSchema,
  account: accountIdSchema,
  resetAt: z.iso.datetime(),
  identity: accountLimitBlockSchema,
})
type Block = z.infer<typeof blockSchema>

export class AccountRequestJournal implements AccountJournalReader {
  private readonly active = new Map<string, string>()
  private maintenanceDay: string | undefined
  private readonly pendingBlocks = new Map<string, Block>()
  public constructor(
    private readonly directory: string,
    private readonly now: () => number,
  ) {}

  private ensure(directory = this.directory): void {
    mkdirSync(directory, { recursive: true, mode: ACCOUNT_REQUEST_STORE.directoryMode })
    const stat = lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  }

  private maintain(): void {
    this.ensure()
    const today = new Date(this.now()).toISOString().slice(0, ISO_DATE_LENGTH)
    if (this.maintenanceDay === today) return
    for (const name of readdirSync(this.directory)) {
      if (name.startsWith('claim-') || name.startsWith('event-') || name.startsWith('limit-')) {
        const value = this.load(name)
        const row = name.startsWith('claim-')
          ? rowSchema.parse(value)
          : name.startsWith('event-')
            ? accountEventSchema.parse(value)
            : blockSchema.parse(value)
        const bucket = 'time' in row ? row.time.slice(0, ISO_DATE_LENGTH) : 'limits'
        this.ensure(path.join(this.directory, bucket))
        renameSync(path.join(this.directory, name), path.join(this.directory, bucket, name))
      } else if (
        /^\d{4}-\d{2}-\d{2}$/.test(name) &&
        Date.parse(name) < this.now() - ACCOUNT_REQUEST_STORE.retentionDays * ACCOUNT_DAY_MS
      ) {
        const directory = path.join(this.directory, name)
        const stat = lstatSync(directory)
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
        rmSync(directory, { recursive: true, force: true })
      }
    }
    this.maintenanceDay = today
  }

  private files(start?: string, end?: string): string[] {
    try {
      this.maintain()
      const buckets = readdirSync(this.directory).filter((name) =>
        start === undefined
          ? name === 'limits'
          : /^\d{4}-\d{2}-\d{2}$/.test(name) &&
            name >= start.slice(0, ISO_DATE_LENGTH) &&
            name <= (end ?? start).slice(0, ISO_DATE_LENGTH),
      )
      return buckets.flatMap((bucket) => {
        const directory = path.join(this.directory, bucket)
        this.ensure(directory)
        return readdirSync(directory)
          .filter((name) => name.endsWith('.json'))
          .map((name) => path.join(bucket, name))
      })
    } catch {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
  }

  private selectionFile(provider: string, owner: string): string {
    return path.join(
      'selections',
      `${createHash('sha256')
        .update(JSON.stringify([provider, owner]))
        .digest('hex')}.json`,
    )
  }

  private load(file: string): unknown {
    try {
      const name = path.join(this.directory, file)
      const stat = lstatSync(name)
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > ACCOUNT_REQUEST_STORE.maxRowBytes)
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      return JSON.parse(readFileSync(name, 'utf8'))
    } catch {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
  }

  private row(file: string): Row {
    const parsed = rowSchema.safeParse(this.load(file))
    if (!parsed.success) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const row = parsed.data
    if (!row.isClosed && (row.processId === undefined || !this.isAlive(row.processId))) {
      const recovered = {
        ...row,
        isClosed: true,
        ...(!row.hasSent &&
          row.settledUsd === null && {
            settledUsd: Usd.from(0).toAmount(),
            inputTokens: 0,
            outputTokens: 0,
            requests: 0,
          }),
      }
      this.write(file, recovered)
      return recovered
    }
    return row
  }

  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return true
    } catch (error: unknown) {
      return !z.looseObject({ code: z.literal('ESRCH') }).safeParse(error).success
    }
  }

  private write(file: string, value: Row | AccountEvent | Block | { account: string }): void {
    this.ensure()
    this.ensure(path.dirname(path.join(this.directory, file)))
    const temporary = path.join(this.directory, `${randomUUID()}.pending`)
    let hasFailed = false
    try {
      writeFileSync(temporary, JSON.stringify(value), {
        flag: 'wx',
        mode: ACCOUNT_REQUEST_STORE.fileMode,
      })
      renameSync(temporary, path.join(this.directory, file))
    } catch {
      hasFailed = true
    }
    try {
      unlinkSync(temporary)
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        hasFailed = true
    }
    if (hasFailed) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
  }

  private project(query: AccountUsageQuery, exclude?: string): AccountUsageTotals {
    let settled = Usd.from(0),
      reserved = Usd.from(0),
      uncertain = Usd.from(0)
    let inputTokens = 0,
      outputTokens = 0,
      requests = 0
    for (const file of this.files(query.start, query.end)) {
      if (file === exclude || !path.basename(file).startsWith('claim-')) continue
      const row = this.row(file)
      if (
        Date.parse(row.time) < Date.parse(query.start) ||
        Date.parse(row.time) >= Date.parse(query.end) ||
        row.provider !== query.provider ||
        row.account !== query.account
      )
        continue
      // A receipt is already durable settlement evidence, even if the process
      // died before closing its claim. Charge it once, never also reserve it.
      const isResolved = row.isClosed || row.settledUsd !== null
      if (!isResolved) reserved = reserved.add(Usd.from(row.reservedUsd))
      else if (row.settledUsd === null) uncertain = uncertain.add(Usd.from(row.reservedUsd))

      if (row.settledUsd !== null) settled = settled.add(Usd.from(row.settledUsd))
      inputTokens += row.inputTokens
      outputTokens += row.outputTokens
      requests += row.requests
    }
    if ([inputTokens, outputTokens, requests].some((value) => !Number.isSafeInteger(value)))
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    return {
      settledUsd: settled.toAmount(),
      reservedUsd: reserved.toAmount(),
      uncertainUsd: uncertain.toAmount(),
      inputTokens,
      outputTokens,
      requests,
    }
  }

  public selection(provider: string, owner: string): string | undefined {
    const file = this.selectionFile(provider, owner)
    if (!existsSync(path.join(this.directory, file))) return
    const value = this.load(file)
    const parsed = z.strictObject({ account: accountIdSchema }).safeParse(value)
    if (!parsed.success) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    return parsed.data.account
  }

  public select(provider: string, owner: string, account: string): void {
    this.write(this.selectionFile(provider, owner), { account: accountIdSchema.parse(account) })
  }

  public read(query: AccountUsageQuery): AccountUsageTotals {
    return this.project(query)
  }

  public reserve(
    provider: string,
    account: string,
    estimate: AccountRequestEstimate,
    request: AccountPoolRequest,
  ): AccountPoolClaim {
    if (request.checkSharedCaps === undefined)
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    this.maintain()
    let file = path.join(
      new Date(this.now()).toISOString().slice(0, ISO_DATE_LENGTH),
      `claim-${randomUUID()}.json`,
    )
    let row = rowSchema.parse({
      processId: process.pid,
      provider,
      account,
      time: new Date(this.now()).toISOString(),
      reservedUsd: usdDecimal(estimate.costUsd),
      settledUsd: null,
      inputTokens: estimate.inputTokens,
      outputTokens: estimate.outputTokens,
      requests: estimate.requests,
      hasSent: false,
      isClosed: false,
    })
    this.write(file, row)
    const owner = JSON.stringify([request.kind, request.owner])
    this.active.set(owner, file)
    return {
      journal: { read: (query) => this.project(query, file) },
      started: () => {
        const current = this.row(file)
        const time = new Date(this.now()).toISOString()
        const next = path.join(time.slice(0, ISO_DATE_LENGTH), path.basename(file))
        this.write(next, { ...current, hasSent: true, time })
        if (next !== file) unlinkSync(path.join(this.directory, file))
        file = next
        this.active.set(owner, file)
      },
      checkSharedCaps: request.checkSharedCaps,
      settle: (cost, hasSent) => {
        const current = this.row(file)
        row = {
          ...current,
          hasSent,
          isClosed: true,
          settledUsd:
            current.settledUsd ?? (cost === null ? null : Usd.from(usdDecimal(cost)).toAmount()),
          ...(!hasSent && { inputTokens: 0, outputTokens: 0, requests: 0 }),
        }
        this.write(file, row)
        if (this.active.get(owner) === file) this.active.delete(owner)
        return Promise.resolve()
      },
    }
  }

  public receipt(
    request: AccountPoolRequest,
    usage: { inputTokens: number; outputTokens: number },
    cost: UsdAmount | null,
  ): void {
    const file = this.active.get(JSON.stringify([request.kind, request.owner]))
    if (file === undefined) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    const row = this.row(file)
    this.write(file, rowSchema.parse({ ...row, ...usage, settledUsd: cost }))
  }

  public record(event: AccountEvent): void {
    this.maintain()
    this.write(
      path.join(event.time.slice(0, ISO_DATE_LENGTH), `event-${randomUUID()}.json`),
      accountEventSchema.parse(event),
    )
  }

  public commit(event: AccountEvent, adopt: () => () => void): void {
    const rollback = adopt()
    try {
      this.record(event)
    } catch (error: unknown) {
      rollback()
      throw error
    }
  }

  public limits(provider: string, account: string, current?: Pick<Account, 'id' | 'limitGroup'>) {
    for (const [file, pending] of this.pendingBlocks) {
      this.write(file, pending)
      this.pendingBlocks.delete(file)
    }
    let resetAt: string | undefined
    for (const file of this.files()) {
      if (!path.basename(file).startsWith('limit-')) continue
      const parsed = blockSchema.safeParse(this.load(file))
      if (!parsed.success) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      const block = parsed.data
      if (Date.parse(block.resetAt) <= this.now()) {
        unlinkSync(path.join(this.directory, file))
        continue
      }
      if (
        block.provider !== provider ||
        Date.parse(block.resetAt) <= this.now() ||
        isAccountLimitEligible(current ?? { id: account }, block.identity)
      )
        continue
      if (resetAt === undefined || block.resetAt > resetAt) resetAt = block.resetAt
    }
    return resetAt === undefined ? {} : { blocked: { reason: 'rateLimited' as const, resetAt } }
  }

  public block(
    provider: string,
    account: string,
    resetAt: string,
    identity?: AccountLimitBlock,
  ): void {
    const file = path.join('limits', `limit-${provider}-${account}-${randomUUID()}.json`)
    const block = blockSchema.parse({
      provider,
      account,
      resetAt,
      identity: identity ?? { account, scope: 'account', expiresAt: Date.parse(resetAt) },
    })
    this.pendingBlocks.set(file, block)
    this.write(file, block)
    this.pendingBlocks.delete(file)
  }

  public headroom(account: Account, provider: string): bigint {
    const scale = BigInt(ACCOUNT_HEADROOM_SCALE)
    let score = scale
    for (const period of ['day', 'week', 'month'] as const) {
      const total = this.read({
        provider,
        account: account.id,
        ...accountPeriodRange(period, this.now()),
      })
      const spend = Usd.from(total.settledUsd)
        .add(Usd.from(total.reservedUsd))
        .add(Usd.from(total.uncertainUsd))
      for (const metric of ['spendUsd', 'requests', 'inputTokens', 'outputTokens'] as const) {
        const amount = account.thresholds[metric]?.[period]
        if (amount === undefined) continue
        const cap = Usd.from(amount)
        const used = metric === 'spendUsd' ? spend : Usd.from(total[metric])
        const room =
          cap.compare(Usd.from(0)) <= 0 || used.compare(cap) >= 0
            ? ACCOUNT_HEADROOM_ZERO
            : cap.subtract(used).times(ACCOUNT_HEADROOM_SCALE).floorDivide(cap)
        if (room < score) score = room
      }
      // With no configured cap, outstanding work still reduces headroom.
      if (period === 'day' && Object.keys(account.thresholds).length === 0)
        score = scale / (BigInt(total.requests) + ACCOUNT_HEADROOM_ONE)
    }
    return score
  }
}
