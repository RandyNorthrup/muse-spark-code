import * as z from 'zod/mini'
import { ESTIMATE_MAX_ITEMS, UI_TEXT } from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  providerImageSchema,
  providerSizeSchema,
  type EstimateNodePort,
  type EstimateProviderPort,
  type ProviderImage,
  type ProviderSize,
  type ProvisionedServer,
} from '../../../shared/estimate'
import {
  addUsdNanos,
  compareUsdNanos,
  displayUsdNanos,
  scaleUsdNanos,
  Usd,
  usdNanos,
  type UsdNanos,
} from '../../../shared/usd'
import { USD_LIABILITY_DECIMALS } from '../../../shared/usdConstants'
import { nonnegativeUsdSchema, type UsdAmount } from '../../../shared/usdSchema'
import { EstimateSerialOwner } from './owner'

const ZERO = 0n
const ONE = 1n

const provisionRequestSchema = z.strictObject({
  size: providerSizeSchema,
  image: providerImageSchema,
  cloudInit: z.string().check(z.refine((value) => value.trim().length > 0)),
  maxBilledHours: z.number().check(z.refine((hours) => Number.isFinite(hours) && hours > 0)),
})

const provisionBatchSchema = z
  .array(provisionRequestSchema)
  .check(z.minLength(1), z.maxLength(ESTIMATE_MAX_ITEMS))

export interface ProvisionRequest {
  readonly size: ProviderSize
  readonly image: ProviderImage
  readonly cloudInit: string
  readonly maxBilledHours: number
}

export interface ProvisionQuote {
  readonly size: ProviderSize
  readonly image: ProviderImage
  readonly maxBilledHours: number
  /** Exact nano-USD fraction: hourly rate times maximum billed hours. */
  readonly cost: UsdNanos
  /** Display only: the fraction rounded up to nano-USD. Never arithmetic. */
  readonly costUsd: number
}

export interface ProvisionPreview {
  readonly quotes: readonly ProvisionQuote[]
  /** Exact nano-USD fraction over the whole batch. */
  readonly total: UsdNanos
  /** Display only: the fraction rounded up to nano-USD. Never arithmetic. */
  readonly totalUsd: number
}

export interface ManagedProvisionedServer {
  readonly server: ProvisionedServer
  /** The funded lifetime chosen at admission. Keep never extends it. */
  readonly maxBilledHours: number
  readonly cost: UsdNanos
  readonly costUsd: number
}

/** One question per spend, answered by the surface that owns the run. */
export type ProvisionConfirm = (message: string, quote: ProvisionQuote) => Promise<boolean>

/** The caller drives every notice: this module keeps no timers. */
export type ProvisionIdleCheck = (server: ProvisionedServer) => boolean | Promise<boolean>

function refusedBudget(): never {
  throw new Error(UI_TEXT.estimateBudgetRequired)
}

function refusedCap(): never {
  throw new Error(UI_TEXT.estimateCapExceeded)
}

function denied(): never {
  throw new Error(UI_TEXT.estimateDenied)
}

function unknownServer(id: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail: `unknown-server:${id}` }))
}

/** Exact per-server quotes with the batch total, before any confirmation. */
export function quoteProvisioning(selections: readonly ProvisionRequest[]): ProvisionPreview {
  const requests = provisionBatchSchema.parse(selections)
  const quotes = requests.map((request) => {
    const cost = scaleUsdNanos(usdNanos(request.size.hourlyUsd), request.maxBilledHours)
    return {
      size: request.size,
      image: request.image,
      maxBilledHours: request.maxBilledHours,
      cost,
      costUsd: displayUsdNanos(cost),
    }
  })
  const [first, ...rest] = quotes
  if (first === undefined) throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'no-servers' }))
  let total = first.cost
  for (const quote of rest) total = addUsdNanos(total, quote.cost)
  return { quotes, total, totalUsd: displayUsdNanos(total) }
}

/** Slice 2's portable provisioning lifecycle, on fakes until M109, M110d
 * and M110f land. Prices first, one confirmation per spend, a hard run
 * budget admitted before any provider request, liability reserved before
 * create and retained on every uncertain outcome, install then pair through
 * the injected node bindings, wipe before provider deletion with a status
 * receipt, and Keep postponing idle teardown only. No timers, no provider
 * network client, no payment field, no command and no UI live here: the
 * caller shows each price and drives each notice.
 */
export class EstimateProvisioner {
  private readonly owner = new EstimateSerialOwner()
  private readonly budget: UsdAmount
  private readonly budgetNanos: UsdNanos
  /** Reserved before create while no server id exists yet. */
  private pending: UsdNanos[] = []
  private readonly managed = new Map<string, ManagedProvisionedServer>()

  constructor(
    private readonly provider: EstimateProviderPort,
    private readonly node: EstimateNodePort,
    private readonly isSpendConfirmed: ProvisionConfirm,
    budget: string,
  ) {
    try {
      this.budget = nonnegativeUsdSchema.parse(budget)
    } catch {
      refusedBudget()
    }
    try {
      this.budgetNanos = {
        numerator: Usd.from(this.budget).units(USD_LIABILITY_DECIMALS),
        denominator: ONE,
      }
    } catch {
      refusedBudget()
    }
  }

  private async provisionOne(
    quote: ProvisionQuote,
    preview: ProvisionPreview,
    cloudInit: string,
  ): Promise<ManagedProvisionedServer> {
    if (compareUsdNanos(addUsdNanos(this.liability(), quote.cost), this.budgetNanos) > 0)
      refusedCap()
    const message = fill(UI_TEXT.estimateConfirmServer, {
      server: `${quote.size.id}/${quote.image.id}`,
      price: String(quote.costUsd),
      total: String(preview.totalUsd),
      budget: this.budget,
    })
    let isConfirmed = false
    try {
      isConfirmed = await this.isSpendConfirmed(message, quote)
    } catch {
      denied()
    }
    if (!isConfirmed) denied()
    // Reserve before create. A failed or uncertain create never releases:
    // the provider may still have made the server.
    this.pending.push(quote.cost)
    const pendingIndex = this.pending.length - 1
    const server = await this.provider.create(quote.size, quote.image, cloudInit)
    const record: ManagedProvisionedServer = {
      server,
      maxBilledHours: quote.maxBilledHours,
      cost: quote.cost,
      costUsd: quote.costUsd,
    }
    this.pending.splice(pendingIndex, 1)
    this.managed.set(server.id, record)
    // M110f installs before M110d pairs; the node binding enforces the
    // order and the funded teardown deadline independently of this process.
    await this.node.install(server)
    await this.node.pair(server)
    return record
  }

  private async teardown(record: ManagedProvisionedServer): Promise<void> {
    // Wipe precedes provider deletion: a failed wipe keeps the server and
    // its liability. A non-deleted status keeps the liability too.
    await this.node.teardownAndWipe(record.server)
    await this.provider.delete(record.server.id)
    const receipt = await this.provider.status(record.server.id)
    if (receipt.state !== 'deleted')
      throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'deletion-unconfirmed' }))
    this.managed.delete(record.server.id)
  }

  /** Exact admitted rental liability: pending reservations plus live servers. */
  liability(): UsdNanos {
    let sum: UsdNanos = { numerator: ZERO, denominator: ONE }
    for (const cost of this.pending) sum = addUsdNanos(sum, cost)
    for (const record of this.managed.values()) sum = addUsdNanos(sum, record.cost)
    return sum
  }

  /** Display only: admitted liability rounded up to nano-USD. */
  liabilityUsd(): number {
    return displayUsdNanos(this.liability())
  }

  servers(): readonly ManagedProvisionedServer[] {
    return Array.from(this.managed.values(), (record) => ({
      ...record,
      server: { ...record.server },
      cost: { ...record.cost },
    }))
  }

  /** The idle notice text for a tracked server; the caller shows it. */
  describeIdle(serverId: string, duration: string): string {
    const record = this.managed.get(serverId)
    if (record === undefined) unknownServer(serverId)
    return fill(UI_TEXT.estimateIdleNotice, { server: serverId, duration })
  }

  /** An idle answer rechecks activity first; Keep never extends funding. */
  settleIdle(
    serverId: string,
    decision: 'keep' | 'teardown',
    isIdleNow: ProvisionIdleCheck,
  ): Promise<'kept' | 'torn-down'> {
    return this.owner.run(async () => {
      const record = this.managed.get(serverId)
      if (record === undefined) unknownServer(serverId)
      if (decision === 'keep' || !(await isIdleNow(record.server))) return 'kept'
      await this.teardown(record)
      return 'torn-down'
    })
  }

  /** Wipe, provider deletion and a deleted status receipt, then release. */
  decommission(serverId: string): Promise<void> {
    return this.owner.run(async () => {
      const record = this.managed.get(serverId)
      if (record === undefined) unknownServer(serverId)
      await this.teardown(record)
    })
  }

  provision(requests: readonly ProvisionRequest[]): Promise<readonly ManagedProvisionedServer[]> {
    // Clone/validate before queuing, so a caller cannot alter pending work.
    // Every price and the whole total are fixed before any confirmation.
    const parsed = provisionBatchSchema.parse(requests)
    const preview = quoteProvisioning(parsed)
    return this.owner.run(async () => {
      const created: ManagedProvisionedServer[] = []
      for (const [index, quote] of preview.quotes.entries()) {
        const cloudInit = parsed[index]?.cloudInit ?? ''
        created.push(await this.provisionOne(quote, preview, cloudInit))
      }
      return created.map((record) => ({
        ...record,
        server: { ...record.server },
        cost: { ...record.cost },
      }))
    })
  }
}
