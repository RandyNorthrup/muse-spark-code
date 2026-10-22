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

/** The callback sees only this frozen copy; admission, reservation and
`create` use the pre-confirmation values the cap already passed. A write
through the copy throws instead of moving money. */
function snapshotQuote(quote: ProvisionQuote): ProvisionQuote {
  const snapshot: ProvisionQuote = {
    size: { ...quote.size },
    image: { ...quote.image },
    maxBilledHours: quote.maxBilledHours,
    cost: { ...quote.cost },
    costUsd: quote.costUsd,
  }
  Object.freeze(snapshot.size)
  Object.freeze(snapshot.image)
  Object.freeze(snapshot.cost)
  return Object.freeze(snapshot)
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
and M110f land. Prices first, one confirmation per spend, a hard run
budget admitted before any provider request, liability reserved before
create and retained on every uncertain outcome, install then pair through
the injected node bindings, wipe before provider deletion with a status
receipt, and Keep postponing idle teardown only. No timers, no provider
network client, no payment field, no command and no UI live here: the
caller shows each price and drives each notice.
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
      // The budget parsed but is not representable at liability precision.
      // That is a different failure from a missing budget: say so honestly.
      throw new Error(fill(UI_TEXT.estimateFailed, { detail: 'budget-unrepresentable' }))
    }
  }

  /** Check-and-reserve under the serial owner, after a confirmation. The
  quote is the pre-confirmation snapshot: the callback only saw a frozen
  copy, so the reservation and `create` cannot follow a mutated object. */
  private async admit(quote: ProvisionQuote, cloudInit: string): Promise<ManagedProvisionedServer> {
    if (compareUsdNanos(addUsdNanos(this.liability(), quote.cost), this.budgetNanos) > 0)
      refusedCap()
    // Reserve before create. A failed or uncertain create never releases:
    // the provider may still have made the server.
    this.pending.push(quote.cost)
    const pendingIndex = this.pending.length - 1
    const server = await this.provider.create(quote.size, quote.image, cloudInit)
    if (this.managed.has(server.id)) {
      // Two costs must never alias onto one id: the earlier record keeps
      // its cost and the new reservation stays pending, so liability is the
      // sum of both instead of silently dropping the first.
      throw new Error(fill(UI_TEXT.estimateFailed, { detail: `duplicate-server-id:${server.id}` }))
    }
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
    // its liability. An unconfirmed or foreign deletion receipt keeps it too.
    await this.node.teardownAndWipe(record.server)
    await this.provider.delete(record.server.id)
    const receipt = await this.provider.status(record.server.id)
    if (receipt.state !== 'deleted' || receipt.id !== record.server.id)
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

  /** An idle answer rechecks activity first; Keep never extends funding.
  The activity check runs without holding the serial owner, so it can
  call back into this instance (a teardown answer included) instead of
  deadlocking against the turn it would otherwise be queued behind. The
  record is re-read under the owner before any wipe runs. */
  async settleIdle(
    serverId: string,
    decision: 'keep' | 'teardown',
    isIdleNow: ProvisionIdleCheck,
  ): Promise<'kept' | 'torn-down'> {
    const probe = this.managed.get(serverId)
    if (probe === undefined) unknownServer(serverId)
    // Short-circuit: Keep never runs the activity check.
    if (decision === 'keep' || !(await isIdleNow({ ...probe.server }))) return 'kept'
    return await this.owner.run(async (): Promise<'torn-down'> => {
      const record = this.managed.get(serverId)
      if (record === undefined) unknownServer(serverId)
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

  /** Confirmations run without holding the serial owner: a confirmation
  that calls back into this instance (denying while tearing down an
  earlier server of the batch, for example) runs instead of deadlocking
  against its own turn. Admission stays atomic: each confirmed server is
  cap-checked and reserved inside one owner turn in `admit`. */
  provision(requests: readonly ProvisionRequest[]): Promise<readonly ManagedProvisionedServer[]> {
    // Clone/validate before queuing, so a caller cannot alter pending work.
    // Every price and the whole total are fixed before any confirmation.
    const parsed = provisionBatchSchema.parse(requests)
    const preview = quoteProvisioning(parsed)
    return (async () => {
      const created: ManagedProvisionedServer[] = []
      for (const [index, quote] of preview.quotes.entries()) {
        const cloudInit = parsed[index]?.cloudInit ?? ''
        // Advisory refusal before the surface is asked; `admit` re-checks
        // atomically after the confirmation returns.
        if (compareUsdNanos(addUsdNanos(this.liability(), quote.cost), this.budgetNanos) > 0)
          refusedCap()
        const snapshot = snapshotQuote(quote)
        const message = fill(UI_TEXT.estimateConfirmServer, {
          server: `${snapshot.size.id}/${snapshot.image.id}`,
          price: String(snapshot.costUsd),
          total: String(preview.totalUsd),
          budget: this.budget,
        })
        let isConfirmed = false
        try {
          isConfirmed = await this.isSpendConfirmed(message, snapshot)
        } catch {
          denied()
        }
        if (!isConfirmed) denied()
        created.push(await this.owner.run(() => this.admit(snapshot, cloudInit)))
      }
      return created.map((record) => ({
        ...record,
        server: { ...record.server },
        cost: { ...record.cost },
      }))
    })()
  }
}
