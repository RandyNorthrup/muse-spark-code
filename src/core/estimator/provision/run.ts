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
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  usdNanos,
  scaleUsdNanos,
  addUsdNanos,
  compareUsdNanos,
  displayUsdNanos,
  type UsdNanos,
} from '../../../shared/usd'
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
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) fail('invalid-funded-duration')
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
  readonly priceUsd: number
}
export interface EstimateProvisionQuote {
  readonly id: string
  readonly servers: readonly EstimateServerQuote[]
  readonly totalUsd: number
  readonly budgetUsd: number
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

function fail(detail: string): never {
  throw new Error(fill(UI_TEXT.estimateFailed, { detail }))
}

/** A failure that carries the step's own error for the catch gate. */
function failWith(detail: string, cause: unknown): Error {
  return new Error(fill(UI_TEXT.estimateFailed, { detail }), { cause })
}

/** A create/install/pair step that failed with the step's own error: the
loop ends the server uncertain or failed naming the step instead of
dropping the error. */
export class ProvisionStepFailed extends Error {
  readonly step: 'create' | 'install' | 'pair'
  readonly server?: ProvisionedServer
  constructor(step: 'create' | 'install' | 'pair', cause: unknown, server?: ProvisionedServer) {
    super(`provision ${step} failed`, { cause })
    this.step = step
    if (server !== undefined) this.server = server
  }
}

export function isProvisionStepFailed(error: unknown): error is ProvisionStepFailed {
  return error instanceof ProvisionStepFailed
}

function provisionStepFailed(
  step: 'create' | 'install' | 'pair',
  cause: unknown,
  server?: ProvisionedServer,
): ProvisionStepFailed {
  return new ProvisionStepFailed(step, cause, server)
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
  private readonly budgetUsd: number
  private readonly owner = new EstimateSerialOwner()
  private nextQuote = 0
  private readonly clock: EstimateProvisionClock

  constructor(
    private readonly bindings: EstimateProvisionBindings,
    budgetUsd: number | undefined,
  ) {
    const budget = z.number().check(z.nonnegative()).safeParse(budgetUsd)
    if (!budget.success) throw new Error(UI_TEXT.estimateBudgetRequired)
    this.budgetUsd = budget.data
    this.budget = usdNanos(budget.data)
    this.clock = new EstimateProvisionClock(bindings.now, 'invalid-provision-clock')
    this.providers = new Map(bindings.providers.map((provider) => [provider.id, provider]))
    if (this.providers.size !== bindings.providers.length) fail('duplicate-provider')
  }

  private nodes(): EstimateProvisionNodeBindings {
    if (this.availability() === 'adviceOnly' || this.bindings.nodes === undefined)
      throw new Error(UI_TEXT.estimateAdvice)
    return this.bindings.nodes
  }

  private reserved(): UsdNanos {
    return sumCosts(this.reservations.values())
  }

  /** Create and register one server; a rejected step throws branded. */
  private async createServer(
    provider: EstimateProviderPort,
    serverQuote: EstimateServerQuote,
    cloudInit: string,
    expiresAt: string,
    nodes: EstimateProvisionNodeBindings,
  ): Promise<ProvisionedServer> {
    let server: ProvisionedServer | undefined
    try {
      server = provisionedServerSchema.parse(
        await provider.create(
          structuredClone(serverQuote.size),
          structuredClone(serverQuote.image),
          cloudInit,
        ),
      )
      if (server.sizeId !== serverQuote.size.id || server.imageId !== serverQuote.image.id)
        fail('created-server-identity')
      // The mandatory lifecycle validates the created state before
      // registration or installation.
      nodes.lifecycle.track(provider, server, expiresAt)
      return server
    } catch (error) {
      throw provisionStepFailed('create', error, server)
    }
  }

  /** Install and pair one created server; a rejected step throws branded. */
  private async installServer(
    provider: EstimateProviderPort,
    created: ProvisionedServer,
    expiresAt: string,
    nodes: EstimateProvisionNodeBindings,
  ): Promise<ProvisionedServer> {
    let phase: 'install' | 'pair' = 'install'
    try {
      if (this.clock.now() >= Date.parse(expiresAt)) fail('funded-lifetime-expired')
      await nodes.node.install(structuredClone(created))
      const status = provisionedServerSchema.parse(await provider.status(created.id))
      if (
        status.id !== created.id ||
        status.sizeId !== created.sizeId ||
        status.imageId !== created.imageId ||
        status.state !== 'running'
      )
        fail('node-not-ready')
      if (this.clock.now() >= Date.parse(expiresAt)) fail('funded-lifetime-expired')
      phase = 'pair'
      await nodes.node.pair(structuredClone(status))
      if (this.clock.now() >= Date.parse(expiresAt)) fail('funded-lifetime-expired')
      nodes.lifecycle.activity(provider.id, created.id, false)
      return status
    } catch (error) {
      throw provisionStepFailed(phase, error)
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
    const requests = requestsSchema.parse(input)
    return this.owner.run(async () => {
      this.nodes()
      const costs = new Map<string, UsdNanos>()
      const servers: EstimateServerQuote[] = []
      const preparedServers: PreparedQuote['servers'][number][] = []
      const selections = new Map<string, { sizes: ProviderSize[]; images: ProviderImage[] }>()
      for (const request of requests) {
        fundedMilliseconds(request.billedHours)
        const provider = this.providers.get(request.providerId)
        if (!provider) fail('provider-not-connected')
        let selection = selections.get(provider.id)
        if (!selection) {
          try {
            selection = {
              sizes: z.array(providerSizeSchema).parse(await provider.sizes()),
              images: z.array(providerImageSchema).parse(await provider.images()),
            }
          } catch (error) {
            throw failWith('provider-catalog', error)
          }
          if (
            new Set(selection.sizes.map((size) => size.id)).size !== selection.sizes.length ||
            new Set(selection.images.map((image) => image.id)).size !== selection.images.length
          )
            fail('duplicate-selection')
          selections.set(provider.id, selection)
        }
        const size = selection.sizes.find((size) => size.id === request.sizeId)
        const image = selection.images.find((image) => image.id === request.imageId)
        if (!size || !image) fail('unknown-size-image')
        const machineClass = machineClasses.find((entry) => entry.id === size.classId)
        if (machineClass?.os !== image.os || machineClass.architecture !== image.architecture)
          fail('incompatible-image')
        const cost = scaleUsdNanos(usdNanos(size.hourlyUsd), request.billedHours)
        const priceUsd = displayUsdNanos(cost)
        if (!Number.isFinite(priceUsd)) fail('unrepresentable-price')
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
      const totalUsd = displayUsdNanos(total)
      if (!Number.isFinite(totalUsd)) fail('unrepresentable-total')
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
      if (!prepared || prepared.consumed) fail('unknown-or-consumed-quote')
      const { quote, costs } = prepared
      const total = sumCosts(costs.values(), this.reserved())
      // Refuse before preview, confirmation, cloud-init or any create request.
      if (compareUsdNanos(total, this.budget) > 0) throw new Error(UI_TEXT.estimateCapExceeded)
      prepared.consumed = true
      try {
        await this.bindings.showPrices(structuredClone(quote))
      } catch (error) {
        throw failWith('price-preview', error)
      }
      const outcomes: EstimateProvisionOutcome[] = []
      // The whole quote's nonnegative liabilities were admitted atomically.
      // Only this serialized owner can add a reservation during execution.
      for (const { quote: serverQuote, provider, cost } of prepared.servers) {
        let isAllowed: boolean
        try {
          isAllowed = z
            .boolean()
            .parse(
              await this.bindings.confirmServer(
                structuredClone(serverQuote),
                structuredClone(quote),
              ),
            )
        } catch (error) {
          throw failWith('server-confirmation', error)
        }
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
          fail('invalid-funded-lifetime')
        const expiresAt = new Date(deadline).toISOString()
        let cloudInit: string
        try {
          cloudInit = z
            .string()
            .check(z.minLength(1))
            .parse(
              await nodes.cloudInit(
                structuredClone(serverQuote.size),
                structuredClone(serverQuote.image),
                expiresAt,
              ),
            )
        } catch (error) {
          throw failWith('cloud-init', error)
        }
        if (cloudInit.trim().length === 0 || this.clock.now() >= Date.parse(expiresAt))
          fail('expired-cloud-init')
        // Claim before create; the broker may create even if its reply is lost.
        this.reservations.set(`${quote.id}:${serverQuote.id}`, cost)
        let created: ProvisionedServer
        try {
          created = await this.createServer(provider, serverQuote, cloudInit, expiresAt, nodes)
        } catch (error) {
          if (!isProvisionStepFailed(error)) throw error
          const uncertain: EstimateProvisionOutcome = {
            id: serverQuote.id,
            providerId: provider.id,
            state: 'uncertain',
            failure: 'create',
            ...(error.server !== undefined && { server: error.server }),
          }
          this.outcomes.push(uncertain)
          outcomes.push(uncertain)
          break
        }
        let status: ProvisionedServer
        try {
          status = await this.installServer(provider, created, expiresAt, nodes)
        } catch (error) {
          if (!isProvisionStepFailed(error)) throw error
          await nodes.lifecycle.retire(provider.id, created.id)
          const isCleaned = nodes.lifecycle
            .snapshots()
            .some(
              (lease) =>
                lease.providerId === provider.id &&
                lease.server.id === created.id &&
                lease.state === 'deleted',
            )
          const failed: EstimateProvisionOutcome = {
            id: serverQuote.id,
            providerId: provider.id,
            state: 'failed',
            server: created,
            failure: isCleaned ? error.step : 'cleanup',
          }
          this.outcomes.push(failed)
          outcomes.push(failed)
          break
        }
        const ready: EstimateProvisionOutcome = {
          id: serverQuote.id,
          providerId: provider.id,
          state: 'ready',
          server: status,
        }
        this.outcomes.push(ready)
        outcomes.push(ready)
      }
      return structuredClone(outcomes)
    })
  }
}
