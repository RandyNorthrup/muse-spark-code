// Durable account admission projections. Each claim owns one immutable name;
// concurrent writers cannot overwrite another claim. Missing completion keeps
// full liability. Strict records contain opaque ids and counters only.
import { randomUUID } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  lstatSync,
  unlinkSync,
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
  private readonly pendingBlocks = new Map<string, Block>()
  public constructor(
    private readonly directory: string,
    private readonly now: () => number,
  ) {}

  private files(): string[] {
    try {
      mkdirSync(this.directory, { recursive: true, mode: ACCOUNT_REQUEST_STORE.directoryMode })
      if (!lstatSync(this.directory).isDirectory())
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      const files = readdirSync(this.directory).filter((file) => file.endsWith('.json'))
      if (files.length > ACCOUNT_REQUEST_STORE.maxRows)
        throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      return files
    } catch {
      throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
    }
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
    return parsed.data
  }

  private write(file: string, value: Row | AccountEvent | Block): void {
    this.files()
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
    for (const file of this.files()) {
      if (file === exclude || !file.startsWith('claim-')) continue
      const row = this.row(file)
      if (row.time >= query.end || row.provider !== query.provider || row.account !== query.account)
        continue
      if (!row.isClosed) reserved = reserved.add(Usd.from(row.reservedUsd))
      else if (row.settledUsd === null) uncertain = uncertain.add(Usd.from(row.reservedUsd))
      if (row.isClosed && !(row.time >= query.start)) {
        continue
      }

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
    const file = `claim-${randomUUID()}.json`
    let row = rowSchema.parse({
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
        this.write(file, { ...current, hasSent: true, time: new Date(this.now()).toISOString() })
      },
      checkSharedCaps: request.checkSharedCaps,
      settle: (cost, hasSent) => {
        const current = this.row(file)
        row = {
          ...current,
          hasSent,
          isClosed: true,
          settledUsd:
            cost === null ? null : (current.settledUsd ?? Usd.from(usdDecimal(cost)).toAmount()),
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
    this.write(`event-${randomUUID()}.json`, accountEventSchema.parse(event))
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
      if (!file.startsWith('limit-')) continue
      const parsed = blockSchema.safeParse(this.load(file))
      if (!parsed.success) throw new Error(UI_TEXT.sessionBudgetStoreUnavailable)
      const block = parsed.data
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
    const file = `limit-${provider}-${account}-${randomUUID()}.json`
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

export { rowSchema as accountRequestRowSchema, blockSchema as accountRequestBlockSchema }
