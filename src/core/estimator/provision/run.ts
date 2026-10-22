import { z } from 'zod/mini'
import {
  providerSizeSchema,
  providerImageSchema,
  provisionedServerSchema,
  type ProviderSize,
  type ProviderImage,
  type ProvisionedServer,
  type EstimateProviderPort,
  type EstimateNodePort,
} from '../../../shared/estimate'
import {
  ESTIMATE_ID_MAX_CHARS,
  ESTIMATE_MAX_ITEMS,
  MILLISECONDS_PER_SECOND,
  SECONDS_PER_MINUTE,
  MINUTES_PER_HOUR,
} from '../../../shared/constants'
import { EstimateDiagnosticError } from '../diagnostic'
import {
  Usd,
  usdNanos,
  scaleUsdNanos,
  addUsdNanos,
  compareUsdNanos,
  displayUsdNanos,
  type UsdNanos,
} from '../../../shared/usd'
import { USD_LIABILITY_DECIMALS } from '../../../shared/usdConstants'
import { canonicalUsd, legacyUsdSchema, type UsdAmount } from '../../../shared/usdSchema'
import { type EstimateServerLifecycle } from './lifecycle'
import { EstimateSerialOwner } from './owner'
import { EstimateProvisionClock } from './clock'
import machineClasses from '../../../shared/machineClasses.json'

const HOUR_MS = MILLISECONDS_PER_SECOND * SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const NANO_UNIT = usdNanos(1)

/** Floor the exact decimal lifetime to milliseconds, so funding is never
extended by floating-point multiplication or time-unit rounding. The
rational helper's nano unit cancels; this is duration arithmetic only.
*/
function fundedMilliseconds(hours: number): number {
  const duration = scaleUsdNanos(usdNanos(hours), HOUR_MS)
  const milliseconds = Number(
    (duration.numerator * NANO_UNIT.denominator) / (duration.denominator * NANO_UNIT.numerator),
  )
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0)
    throw new EstimateDiagnosticError('provision: invalid-funded-duration')
  return milliseconds
}
const id = z.string().check(z.minLength(1), z.maxLength(ESTIMATE_ID_MAX_CHARS))
const requestSchema = z.strictObject({
  id,
  providerId: id,
  sizeId: id,
  imageId: id,
  billedHours: z.number().check(z.positive()),
})
const requestsSchema = z.array(requestSchema).check(
  z.minLength(1),
  z.maxLength(ESTIMATE_MAX_ITEMS),
  z.refine((requests) => new Set(requests.map((request) => request.id)).size === requests.length),
)
export type EstimateServerRequest = z.infer<typeof requestSchema>

export interface EstimateServerQuote {
  readonly id: string
  readonly providerId: string
  readonly size: ProviderSize
  readonly image: ProviderImage
  readonly billedHours: number
  /** Display only; admission uses the retained exact fraction. */
  readonly priceUsd: UsdAmount
}
export interface EstimateProvisionQuote {
  readonly id: string
  readonly servers: readonly EstimateServerQuote[]
  readonly totalUsd: UsdAmount
  readonly budgetUsd: UsdAmount
}
export interface EstimateProvisionOutcome {
  readonly id: string
  readonly providerId: string
  readonly state: 'ready' | 'denied' | 'uncertain' | 'failed'
  readonly server?: ProvisionedServer
  readonly failure?: 'create' | 'install' | 'pair' | 'cleanup'
}
export interface EstimateProvisionNodeBindings {
  readonly node: EstimateNodePort
  readonly lifecycle: EstimateServerLifecycle
  /** M110f verifies artifacts and installs an independent funded-deadline
  watchdog in cloud-init. No provider credential enters the server.
  */
  readonly cloudInit: (
    size: ProviderSize,
    image: ProviderImage,
    expiresAt: string,
  ) => Promise<string>
}
export interface EstimateProvisionBindings {
  readonly providers: readonly EstimateProviderPort[]
  readonly nodes?: EstimateProvisionNodeBindings
  readonly now: () => number
  readonly showPrices: (quote: EstimateProvisionQuote) => Promise<void>
  /** Explicit fresh confirmation for this exact server and total. No remembered grant. */
  readonly confirmServer: (
    server: EstimateServerQuote,
    quote: EstimateProvisionQuote,
  ) => Promise<boolean>
}
interface PreparedQuote {
  quote: EstimateProvisionQuote
  costs: ReadonlyMap<string, UsdNanos>
  servers: readonly { quote: EstimateServerQuote; provider: EstimateProviderPort; cost: UsdNanos }[]
  consumed: boolean
}

function sumCosts(costs: Iterable<UsdNanos>, initial = usdNanos(0)): UsdNanos {
  let total = initial
  for (const cost of costs) total = addUsdNanos(total, cost)
  return total
}

/** One instance is one explicitly budgeted run; callers share this owner.
No retry of an uncertain create, no automatic release of billed liability.
*/
export class EstimateProvisionRun {
  private readonly providers: ReadonlyMap<string, EstimateProviderPort>
  private readonly quotes = new Map<string, PreparedQuote>()
  private readonly reservations = new Map<string, UsdNanos>()
  private readonly outcomes: EstimateProvisionOutcome[] = []
  private readonly budget: UsdNanos
  private readonly budgetUsd: UsdAmount
  private readonly owner = new EstimateSerialOwner()
  private nextQuote = 0
  private readonly clock: EstimateProvisionClock

  constructor(
    private readonly bindings: EstimateProvisionBindings,
    budgetUsd: unknown,
  ) {
    const budget = legacyUsdSchema.safeParse(budgetUsd)
    if (!budget.success)
      throw new EstimateDiagnosticError('provision: budget-required', undefined, {
        cause: budget.error,
      })
    this.budgetUsd = budget.data
    this.budget = {
      numerator: Usd.from(budget.data).units(USD_LIABILITY_DECIMALS),
      denominator: 1n,
    }
    this.clock = new EstimateProvisionClock(bindings.now, 'invalid-provision-clock')
    this.providers = new Map(bindings.providers.map((provider) => [provider.id, provider]))
    if (this.providers.size !== bindings.providers.length)
      throw new EstimateDiagnosticError('provision: duplicate-provider')
  }

  private nodes(): EstimateProvisionNodeBindings {
    if (this.availability() === 'adviceOnly' || this.bindings.nodes === undefined)
      throw new EstimateDiagnosticError('advice-only')
    return this.bindings.nodes
  }

  private reserved(): UsdNanos {
    return sumCosts(this.reservations.values())
  }

  /** Create and register one server; a failed step returns its error with the
  partial server instead of throwing, so the loop can end it uncertain. */
  private async createServer(
    provider: EstimateProviderPort,
    serverQuote: EstimateServerQuote,
    cloudInit: string,
    expiresAt: string,
    nodes: EstimateProvisionNodeBindings,
  ): Promise<
    | { server: ProvisionedServer }
    | { failure: 'create'; cause: unknown; server?: ProvisionedServer }
  > {
    let server: ProvisionedServer | undefined
    try {
      const parsed = provisionedServerSchema.safeParse(
        await provider.create(
          structuredClone(serverQuote.size),
          structuredClone(serverQuote.image),
          cloudInit,
        ),
      )
      if (!parsed.success)
        throw new EstimateDiagnosticError('provision: invalid-receipt', undefined, {
          cause: parsed.error,
        })
      server = parsed.data
      if (server.sizeId !== serverQuote.size.id || server.imageId !== serverQuote.image.id)
        throw new EstimateDiagnosticError('provision: created-server-identity')
      // The mandatory lifecycle validates the created state before
      // registration or installation.
      nodes.lifecycle.track(provider, server, expiresAt)
      return { server }
    } catch (error) {
      return { failure: 'create', cause: error, ...(server !== undefined && { server }) }
    }
  }

  /** Install and pair one created server; a failed step returns its error
  with the phase instead of throwing, so the loop can end it failed. */
  private async installServer(
    provider: EstimateProviderPort,
    created: ProvisionedServer,
    expiresAt: string,
    nodes: EstimateProvisionNodeBindings,
  ): Promise<{ status: ProvisionedServer } | { failure: 'install' | 'pair'; cause: unknown }> {
    let phase: 'install' | 'pair' = 'install'
    try {
      if (this.clock.now() >= Date.parse(expiresAt))
        throw new EstimateDiagnosticError('provision: funded-lifetime-expired')
      await nodes.node.install(structuredClone(created))
      const parsed = provisionedServerSchema.safeParse(await provider.status(created.id))
      if (!parsed.success)
        throw new EstimateDiagnosticError('provision: invalid-receipt', undefined, {
          cause: parsed.error,
        })
      const status = parsed.data
      if (
        status.id !== created.id ||
        status.sizeId !== created.sizeId ||
        status.imageId !== created.imageId ||
        status.state !== 'running'
      )
        throw new EstimateDiagnosticError('provision: node-not-ready')
      if (this.clock.now() >= Date.parse(expiresAt))
        throw new EstimateDiagnosticError('provision: funded-lifetime-expired')
      phase = 'pair'
      await nodes.node.pair(structuredClone(status))
      if (this.clock.now() >= Date.parse(expiresAt))
        throw new EstimateDiagnosticError('provision: funded-lifetime-expired')
      nodes.lifecycle.activity(provider.id, created.id, false)
      return { status }
    } catch (error) {
      return { failure: phase, cause: error }
    }
  }

  availability(): 'connected' | 'adviceOnly' {
    return this.bindings.nodes === undefined || this.providers.size === 0
      ? 'adviceOnly'
      : 'connected'
  }

  reservedUsd(): number {
    return displayUsdNanos(this.reserved())
  }
  snapshots(): readonly EstimateProvisionOutcome[] {
    return structuredClone(this.outcomes)
  }

  /** Reads normalized connected-provider tariffs before any spend. An advice
  catalog is never substituted for a connected provider's selected size.
  */
  quote(input: readonly EstimateServerRequest[]): Promise<EstimateProvisionQuote> {
    const parsedInput = requestsSchema.safeParse(input)
    if (!parsedInput.success)
      throw new EstimateDiagnosticError('provision: invalid-request', undefined, {
        cause: parsedInput.error,
      })
    const requests = parsedInput.data
    return this.owner.run(async () => {
      this.nodes()
      const costs = new Map<string, UsdNanos>()
      const servers: EstimateServerQuote[] = []
      const preparedServers: PreparedQuote['servers'][number][] = []
      const selections = new Map<string, { sizes: ProviderSize[]; images: ProviderImage[] }>()
      for (const request of requests) {
        fundedMilliseconds(request.billedHours)
        const provider = this.providers.get(request.providerId)
        if (!provider) throw new EstimateDiagnosticError('provision: provider-not-connected')
        let selection = selections.get(provider.id)
        if (!selection) {
          let rawSizes: unknown
          let rawImages: unknown
          try {
            rawSizes = await provider.sizes()
            rawImages = await provider.images()
          } catch (error) {
            throw new EstimateDiagnosticError(
              'provision: provider-catalog-unavailable',
              undefined,
              {
                cause: error,
              },
            )
          }
          const sizes = z.array(providerSizeSchema).safeParse(rawSizes)
          const images = z.array(providerImageSchema).safeParse(rawImages)
          if (!sizes.success || !images.success)
            throw new EstimateDiagnosticError(
              'provision: provider-catalog-unavailable',
              undefined,
              {
                cause: sizes.success ? images.error : sizes.error,
              },
            )
          selection = { sizes: sizes.data, images: images.data }
          if (
            new Set(selection.sizes.map((size) => size.id)).size !== selection.sizes.length ||
            new Set(selection.images.map((image) => image.id)).size !== selection.images.length
          )
            throw new EstimateDiagnosticError('provision: duplicate-selection')
          selections.set(provider.id, selection)
        }
        const size = selection.sizes.find((size) => size.id === request.sizeId)
        const image = selection.images.find((image) => image.id === request.imageId)
        if (!size || !image) throw new EstimateDiagnosticError('provision: unknown-size-image')
        const machineClass = machineClasses.find((entry) => entry.id === size.classId)
        if (machineClass?.os !== image.os || machineClass.architecture !== image.architecture)
          throw new EstimateDiagnosticError('provision: incompatible-image')
        const cost = scaleUsdNanos(usdNanos(size.hourlyUsd), request.billedHours)
        const priceUsdNumber = displayUsdNanos(cost)
        if (!Number.isFinite(priceUsdNumber))
          throw new EstimateDiagnosticError('provision: unrepresentable-price')
        const priceUsd = canonicalUsd(priceUsdNumber)
        costs.set(request.id, cost)
        const serverQuote: EstimateServerQuote = {
          id: request.id,
          providerId: request.providerId,
          size,
          image,
          billedHours: request.billedHours,
          priceUsd,
        }
        servers.push(serverQuote)
        preparedServers.push({ quote: serverQuote, provider, cost })
      }
      const total = sumCosts(costs.values())
      const totalUsdNumber = displayUsdNanos(total)
      if (!Number.isFinite(totalUsdNumber))
        throw new EstimateDiagnosticError('provision: unrepresentable-total')
      const totalUsd = canonicalUsd(totalUsdNumber)
      const quote: EstimateProvisionQuote = {
        id: `quote-${String(this.nextQuote++)}`,
        servers,
        totalUsd,
        budgetUsd: this.budgetUsd,
      }
      this.quotes.set(quote.id, { quote, costs, servers: preparedServers, consumed: false })
      return structuredClone(quote)
    })
  }

  execute(quoteId: string): Promise<readonly EstimateProvisionOutcome[]> {
    return this.owner.run(async () => {
      const nodes = this.nodes()
      const prepared = this.quotes.get(quoteId)
      if (!prepared || prepared.consumed)
        throw new EstimateDiagnosticError('provision: unknown-or-consumed-quote')
      const { quote, costs } = prepared
      const total = sumCosts(costs.values(), this.reserved())
      // Refuse before preview, confirmation, cloud-init or any create request.
      if (compareUsdNanos(total, this.budget) > 0)
        throw new EstimateDiagnosticError('provision: budget-exceeded')
      prepared.consumed = true
      try {
        await this.bindings.showPrices(structuredClone(quote))
      } catch (error) {
        throw new EstimateDiagnosticError('provision: price-preview-failed', undefined, {
          cause: error,
        })
      }
      const outcomes: EstimateProvisionOutcome[] = []
      // The whole quote's nonnegative liabilities were admitted atomically.
      // Only this serialized owner can add a reservation during execution.
      for (const { quote: serverQuote, provider, cost } of prepared.servers) {
        let rawAllowed: unknown
        try {
          rawAllowed = await this.bindings.confirmServer(
            structuredClone(serverQuote),
            structuredClone(quote),
          )
        } catch (error) {
          throw new EstimateDiagnosticError('provision: confirmation-prompt-failed', undefined, {
            cause: error,
          })
        }
        const parsedAllowed = z.boolean().safeParse(rawAllowed)
        if (!parsedAllowed.success)
          throw new EstimateDiagnosticError('provision: confirmation-prompt-failed', undefined, {
            cause: parsedAllowed.error,
          })
        const isAllowed = parsedAllowed.data
        if (!isAllowed) {
          const denied: EstimateProvisionOutcome = {
            id: serverQuote.id,
            providerId: serverQuote.providerId,
            state: 'denied',
          }
          this.outcomes.push(denied)
          outcomes.push(denied)
          continue
        }
        const deadline = this.clock.now() + fundedMilliseconds(serverQuote.billedHours)
        if (!Number.isSafeInteger(deadline) || !Number.isFinite(new Date(deadline).getTime()))
          throw new EstimateDiagnosticError('provision: invalid-funded-lifetime')
        const expiresAt = new Date(deadline).toISOString()
        let rawCloudInit: unknown
        try {
          rawCloudInit = await nodes.cloudInit(
            structuredClone(serverQuote.size),
            structuredClone(serverQuote.image),
            expiresAt,
          )
        } catch (error) {
          throw new EstimateDiagnosticError('provision: cloud-init-failed', undefined, {
            cause: error,
          })
        }
        const parsedInit = z.string().check(z.minLength(1)).safeParse(rawCloudInit)
        if (!parsedInit.success)
          throw new EstimateDiagnosticError('provision: cloud-init-failed', undefined, {
            cause: parsedInit.error,
          })
        const cloudInit = parsedInit.data
        if (cloudInit.trim().length === 0 || this.clock.now() >= Date.parse(expiresAt))
          throw new EstimateDiagnosticError('provision: expired-cloud-init')
        // Claim before create; the broker may create even if its reply is lost.
        this.reservations.set(`${quote.id}:${serverQuote.id}`, cost)
        const created = await this.createServer(provider, serverQuote, cloudInit, expiresAt, nodes)
        if ('failure' in created) {
          const uncertain: EstimateProvisionOutcome = {
            id: serverQuote.id,
            providerId: provider.id,
            state: 'uncertain',
            failure: 'create',
            ...(created.server !== undefined && { server: created.server }),
          }
          this.outcomes.push(uncertain)
          outcomes.push(uncertain)
          break
        }
        const installed = await this.installServer(provider, created.server, expiresAt, nodes)
        if ('failure' in installed) {
          await nodes.lifecycle.retire(provider.id, created.server.id)
          const isCleaned = nodes.lifecycle
            .snapshots()
            .some(
              (lease) =>
                lease.providerId === provider.id &&
                lease.server.id === created.server.id &&
                lease.state === 'deleted',
            )
          const failed: EstimateProvisionOutcome = {
            id: serverQuote.id,
            providerId: provider.id,
            state: 'failed',
            server: created.server,
            failure: isCleaned ? installed.failure : 'cleanup',
          }
          this.outcomes.push(failed)
          outcomes.push(failed)
          break
        }
        const ready: EstimateProvisionOutcome = {
          id: serverQuote.id,
          providerId: provider.id,
          state: 'ready',
          server: installed.status,
        }
        this.outcomes.push(ready)
        outcomes.push(ready)
      }
      return structuredClone(outcomes)
    })
  }
}
