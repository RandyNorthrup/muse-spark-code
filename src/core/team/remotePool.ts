// M108 D: local placement and routing fragments. M100 owns authentication,
// envelopes, leases and transport; M107 owns resource admission.
import * as z from 'zod/mini'
import { accountIdSchema, accountTriggerSchema, type Account } from '../../shared/accounts'
import { ACCOUNT_LABEL_MAX_LENGTH, UI_TEXT } from '../../shared/constants'
import { type accountHeadroomSchema, deviceAccountHeadroomSchema } from '../../shared/devices'
import { fill } from '../../shared/l10n/text'

const deviceIdSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(ACCOUNT_LABEL_MAX_LENGTH), z.regex(/^[A-Za-z0-9_-]+$/))
const modelIdSchema = z.string().check(z.minLength(1), z.maxLength(ACCOUNT_LABEL_MAX_LENGTH))
const placementSchema = z.strictObject({
  provider: accountIdSchema,
  account: accountIdSchema,
  device: deviceIdSchema,
})
export type AccountPlacement = z.infer<typeof placementSchema>
const placementsSchema = z
  .array(placementSchema)
  .check(
    z.refine(
      (rows) =>
        new Set(rows.map((row) => JSON.stringify([row.provider, row.account]))).size ===
        rows.length,
    ),
  )

export class AccountPlacementError extends Error {
  public constructor(public readonly placement: AccountPlacement) {
    super(fill(UI_TEXT.accounts.placementConflict, placement))
    this.name = 'AccountPlacementError'
  }
}

export interface AccountPlacementStore {
  read(): Promise<unknown>
  /** The metadata owner calls check synchronously at its atomic publication.
   * Compose with account removal and device unpairing under the same owner. */
  write(rows: readonly AccountPlacement[], check: () => void): Promise<void>
}

/** One profile-owned instance. Install the queue before any storage I/O. */
export class AccountPlacements {
  private writes: Promise<void> = Promise.resolve()
  private generation = 0
  private updating = 0

  public constructor(
    private readonly deps: {
      readonly store: AccountPlacementStore
      readonly isKnown: (placement: AccountPlacement) => boolean
      readonly onePerDevicePerProvider?: () => boolean
    },
  ) {}

  private rule(): boolean {
    return this.deps.onePerDevicePerProvider?.() ?? true
  }

  private check(rows: readonly AccountPlacement[]): void {
    const occupied = new Set<string>()
    for (const row of rows) {
      if (!this.deps.isKnown(row)) throw new Error(UI_TEXT.accounts.routeUnavailable)
      const key = JSON.stringify([row.provider, row.device])
      if (this.rule() && occupied.has(key)) throw new AccountPlacementError(row)
      occupied.add(key)
    }
  }

  public async pin(raw: AccountPlacement): Promise<void> {
    const placement = Object.freeze(placementSchema.parse(raw))
    this.generation += 1
    this.updating += 1
    const previous = this.writes
    const operation = (async () => {
      await previous
      const existing = placementsSchema
        .parse(await this.deps.store.read())
        .filter((row) => row.provider !== placement.provider || row.account !== placement.account)
      const rows = Object.freeze([...existing, placement].map((row) => Object.freeze(row)))
      const check = () => {
        this.check(rows)
      }
      check()
      await this.deps.store.write(rows, check)
    })()
    this.writes = (async () => {
      try {
        await operation
      } catch {
        /* The caller receives the refusal. */
      }
    })()
    try {
      await operation
    } finally {
      this.updating -= 1
    }
  }

  public async snapshot(): Promise<{
    readonly rows: readonly AccountPlacement[]
    readonly check: () => void
  }> {
    await this.writes
    const generation = this.generation
    const isRule = this.rule()
    const rows = Object.freeze(
      placementsSchema.parse(await this.deps.store.read()).map((row) => Object.freeze(row)),
    )
    const check = () => {
      if (this.updating > 0 || generation !== this.generation || isRule !== this.rule())
        throw new Error(UI_TEXT.accounts.routeUnavailable)
      this.check(rows)
    }
    check()
    return { rows, check }
  }
}

// Compose these strict fragments into M100's captured/authenticated envelope.
// No sender account, credential, policy answer or price enters a frame.
export const deviceAccountRequestSchema = z.strictObject({
  provider: accountIdSchema,
  modelId: modelIdSchema,
  trigger: z.optional(accountTriggerSchema),
})
export type DeviceAccountRequest = z.infer<typeof deviceAccountRequestSchema>
const offerSchema = z.strictObject({
  device: deviceIdSchema,
  headroom: deviceAccountHeadroomSchema,
})
const offersSchema = z
  .array(offerSchema)
  .check(z.refine((rows) => new Set(rows.map((row) => row.device)).size === rows.length))
const routeRequestSchema = z.strictObject({
  ...deviceAccountRequestSchema.shape,
  account: accountIdSchema,
  owner: deviceIdSchema,
  kind: z.enum(['conversation', 'worker']),
  budgetOwner: deviceIdSchema,
  destination: z.optional(deviceIdSchema),
})
export type AccountRouteRequest = z.infer<typeof routeRequestSchema>

/** Reservations keep the original parent/daily scopes. Uncertain sends retain
 * their lease/liability; finish is not permission to re-dispatch (G6). */
export interface DeviceAccountClaim {
  check(): void
  finish(outcome: 'notSent' | 'returned' | 'uncertain'): Promise<void>
}
export interface RemoteAccountPoolDeps {
  readonly placements: AccountPlacements
  readonly accounts: (provider: string) => readonly Account[]
  /** Authenticated, live offers only; missing/unknown peers are absent (G5). */
  readonly offers: () => unknown
  /** Selected-model capabilities, pair/receiver epoch, permission and governor. */
  readonly canRoute: (device: string, request: AccountRouteRequest) => boolean
  /** M100 consent plus M107's atomic reservation. Denial stops this attempt. */
  readonly admit: (
    device: string,
    request: AccountRouteRequest,
  ) => Promise<DeviceAccountClaim | undefined>
}

export function sendToDeviceLabel(device: string): string {
  return fill(UI_TEXT.accounts.sendToDevice, { device })
}

const HEADROOM_RANK: Readonly<Record<z.infer<typeof accountHeadroomSchema>, number>> = {
  ample: 2,
  some: 1,
  none: 0,
}

function headroomRank(value: z.infer<typeof accountHeadroomSchema> | undefined): number {
  return value === undefined ? 0 : HEADROOM_RANK[value]
}

export class AccountRouteError extends Error {
  public constructor(public readonly code: 'busyOwner' | 'missingDevice' | 'routeUnavailable') {
    const messages = {
      busyOwner: UI_TEXT.accounts.ownerBusy,
      missingDevice: UI_TEXT.accounts.missingDevice,
      routeUnavailable: UI_TEXT.accounts.routeUnavailable,
    }
    super(messages[code])
    this.name = 'AccountRouteError'
  }
}

export class RemoteAccountPool {
  private readonly sticky = new Map<string, string>()
  private readonly active = new Set<string>()
  private admissions: Promise<void> = Promise.resolve()

  public constructor(private readonly deps: RemoteAccountPoolDeps) {}

  private offers() {
    return offersSchema.parse(this.deps.offers())
  }
  private owner(request: AccountRouteRequest): string {
    return JSON.stringify([request.provider, request.kind, request.owner])
  }

  private routes(
    request: AccountRouteRequest,
    rows: readonly AccountPlacement[],
    liveAccount?: string,
  ) {
    const offers = this.offers()
    const accounts = this.deps.accounts(request.provider).toSorted((a, b) => a.order - b.order)
    const owner = this.owner(request)
    const sticky = this.sticky.get(owner)
    if (sticky !== undefined && accounts.every((account) => account.id !== sticky))
      this.sticky.delete(owner)
    const current = liveAccount ?? this.sticky.get(owner) ?? request.account
    // The sender knows each account's limit group from its own pool rows, so a
    // vendor-limit trigger excludes the blocked account's whole group without
    // any account or group data entering the device frame.
    const currentGroup = accounts.find((account) => account.id === current)?.limitGroup
    const index = accounts.findIndex((account) => account.id === current)
    if (index === -1 && sticky === undefined && liveAccount === undefined)
      throw new Error(UI_TEXT.accounts.invalidAccount)
    const start = index === -1 ? 0 : index
    const ordered = [...accounts.slice(start), ...accounts.slice(0, start)]
    return ordered
      .flatMap((account) => {
        const placement = rows.find(
          (row) => row.provider === request.provider && row.account === account.id,
        )
        if (
          placement === undefined ||
          (request.destination !== undefined && request.destination !== placement.device)
        )
          return []
        if (request.destination === undefined && request.trigger !== undefined) {
          if (account.id === current) return []
          // A vendor limit binds the live account's whole limit group, mirroring
          // the local pool's shared-group skip. Per-account caps move one aside.
          if (
            currentGroup !== undefined &&
            request.trigger.kind === 'vendorLimit' &&
            account.limitGroup === currentGroup
          )
            return []
        }
        const rank = headroomRank(
          offers.find((offer) => offer.device === placement.device)?.headroom[request.provider],
        )
        return rank > 0 && this.deps.canRoute(placement.device, request)
          ? [{ placement, rank }]
          : []
      })
      .toSorted((a, b) => {
        // A conversation/held worker keeps its account while its device has room.
        if (
          request.trigger === undefined &&
          (request.kind === 'conversation' || this.sticky.has(owner))
        ) {
          if (a.placement.account === current) return -1
          if (b.placement.account === current) return 1
        }
        return b.rank - a.rank
      })
  }

  public async run<T>(
    raw: AccountRouteRequest,
    dispatch: (route: {
      readonly device: string
      readonly request: DeviceAccountRequest
      /** Invoke synchronously before every transport send/retry. */
      readonly beforeSend: () => void
    }) => Promise<T>,
  ): Promise<T> {
    const request = Object.freeze(routeRequestSchema.parse(raw))
    if (request.trigger !== undefined) Object.freeze(request.trigger)
    const owner = this.owner(request)
    if (this.active.has(owner)) throw new AccountRouteError('busyOwner')
    this.active.add(owner)
    const previous = this.admissions
    const operation = (async () => {
      await previous
      const snapshot = await this.deps.placements.snapshot()
      if (
        request.destination !== undefined &&
        this.offers().every((offer) => offer.device !== request.destination)
      )
        throw new AccountRouteError('missingDevice')
      const route = this.routes(request, snapshot.rows)[0]
      if (route === undefined) throw new AccountRouteError('routeUnavailable')
      const claim = await this.deps.admit(route.placement.device, request)
      if (claim === undefined) throw new AccountRouteError('routeUnavailable')
      return {
        snapshot,
        placement: route.placement,
        claim,
        current: this.sticky.get(owner) ?? request.account,
      }
    })()
    this.admissions = (async () => {
      try {
        await operation
      } catch {
        /* The caller receives the refusal. */
      }
    })()
    try {
      const { snapshot, placement, claim, current } = await operation
      let outcome: 'notSent' | 'returned' | 'uncertain' = 'notSent'
      const hasSent = () => outcome !== 'notSent'
      try {
        const fragment = Object.freeze(
          deviceAccountRequestSchema.parse({
            provider: request.provider,
            modelId: request.modelId,
            ...(request.trigger !== undefined && { trigger: request.trigger }),
          }),
        )
        if (fragment.trigger !== undefined) Object.freeze(fragment.trigger)
        const result = await dispatch({
          device: placement.device,
          request: fragment,
          beforeSend: () => {
            snapshot.check()
            if (this.offers().every((offer) => offer.device !== placement.device))
              throw new AccountRouteError('missingDevice')
            if (
              this.routes(request, snapshot.rows, current).every(
                (row) =>
                  !(
                    row.placement.account === placement.account &&
                    row.placement.device === placement.device
                  ),
              )
            )
              throw new AccountRouteError('routeUnavailable')
            claim.check()
            this.sticky.set(owner, placement.account)
            outcome = 'uncertain'
          },
        })
        if (!hasSent()) throw new AccountRouteError('routeUnavailable')
        outcome = 'returned'
        return result
      } finally {
        await claim.finish(outcome)
      }
    } finally {
      this.active.delete(owner)
    }
  }
}
