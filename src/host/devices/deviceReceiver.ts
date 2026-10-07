// M108 D's receiver admission is shared by native bridges and runtime hosts.
// No vscode import or transport implementation belongs in this fragment.
import {
  AccountPool,
  type AccountPoolDeps,
  type AccountPoolRequest,
} from '../../core/accounts/pool'
import type { AccountPolicyDecision } from '../../core/accounts/policyGate'
import {
  deviceAccountRequestSchema,
  type DeviceAccountRequest,
  type DeviceAccountClaim,
} from '../../core/team/remotePool'
import { UI_TEXT } from '../../shared/constants'
import { accountHeadroomSchema, deviceAccountHeadroomSchema } from '../../shared/devices'
import type { Usd } from '../../shared/accountUsd'

export class DeviceAccountAdmissionError extends Error {
  public constructor(public readonly decision?: AccountPolicyDecision) {
    super(UI_TEXT.accounts.routeUnavailable)
    this.name = 'DeviceAccountAdmissionError'
  }
}

export interface DeviceAccountReceiverDeps {
  readonly providers: () => readonly string[]
  /** One receiver-owned provider/product lifecycle, never a sender's policy or gate. */
  readonly pool: (provider: string) => AccountPoolDeps | undefined
  readonly isPinnedHere: (provider: string, account: string) => boolean
  /** Capture the local placement owner's generation, including away/back changes. */
  readonly placementFence: () => Promise<() => void>
  /** Authoritative per-account/model capacity, including reservations and Retry-After. */
  readonly headroom: (provider: string, account: string) => unknown
  /** Receiver consent, permissions, lease and governor; never sender approvals. */
  readonly admit: (request: DeviceAccountRequest) => Promise<DeviceAccountClaim | undefined>
  /** Build from the receiver's local session, mode, flags, verified tariff/model
   * and budgets. No sender account, interaction flag or price is accepted. */
  readonly request: (request: DeviceAccountRequest) => AccountPoolRequest
}

export class DeviceAccountReceiver {
  private readonly pools = new Map<
    string,
    { readonly source: AccountPoolDeps; readonly pool: AccountPool }
  >()
  public constructor(private readonly deps: DeviceAccountReceiverDeps) {}

  private pool(provider: string) {
    const source = this.deps.pool(provider)
    if (source?.provider !== provider) throw new DeviceAccountAdmissionError()
    const existing = this.pools.get(provider)
    if (existing?.source === source) return existing
    const owned = {
      source,
      pool: new AccountPool({
        ...source,
        accounts: () =>
          source.accounts().filter((account) => this.deps.isPinnedHere(provider, account.id)),
        canUseModel: (account, request) =>
          this.deps.isPinnedHere(provider, account.id) && source.canUseModel(account, request),
      }),
    }
    this.pools.set(provider, owned)
    return owned
  }

  public offer(): Readonly<Record<string, 'ample' | 'some' | 'none'>> {
    const buckets = this.deps.providers().map((provider) => {
      const source = this.deps.pool(provider)
      const policy = source?.policy()
      let bucket: 'ample' | 'some' | 'none' = 'none'
      if (
        source !== undefined &&
        policy?.isCredentialHeld === true &&
        policy.pooling !== 'notOffered'
      ) {
        for (const account of source.accounts()) {
          if (!this.deps.isPinnedHere(provider, account.id)) continue
          const headroom = accountHeadroomSchema.parse(this.deps.headroom(provider, account.id))
          if (headroom === 'ample' || (headroom === 'some' && bucket === 'none')) bucket = headroom
        }
      }
      return [provider, bucket]
    })
    return deviceAccountHeadroomSchema.parse(Object.fromEntries(buckets))
  }

  public async receive<T>(
    raw: unknown,
    dispatch: (admission: {
      readonly account: string
      readonly estimate: AccountPoolRequest['estimate']
      readonly check: () => void
      readonly beforeSend: () => void
    }) => Promise<{ readonly value: T; readonly actualUsd: Usd | null }>,
  ): Promise<T> {
    const fragment = Object.freeze(deviceAccountRequestSchema.parse(raw))
    if (fragment.trigger !== undefined) Object.freeze(fragment.trigger)
    const checkPlacement = await this.deps.placementFence()
    const { source, pool } = this.pool(fragment.provider)
    const local = this.deps.request(fragment)
    const request = Object.freeze({ ...local, estimate: Object.freeze({ ...local.estimate }) })
    if (request.modelId !== fragment.modelId) throw new DeviceAccountAdmissionError()
    const claim = await this.deps.admit(fragment)
    if (claim === undefined) throw new DeviceAccountAdmissionError()
    let outcome: 'notSent' | 'returned' | 'uncertain' = 'notSent'
    const hasSent = () => outcome !== 'notSent'
    try {
      // Routing at a sender's vendor limit still needs THIS machine's decision,
      // even when the receiver's current account itself has ample room.
      const decision = await source.gate.authorize({
        policy: source.policy,
        ...(fragment.trigger !== undefined && { trigger: fragment.trigger }),
        isInteractive: request.isInteractive,
        hasOfferedRecovery: request.hasOfferedRecovery === true,
      })
      if (decision.kind !== 'allow') throw new DeviceAccountAdmissionError(decision)
      const check = () => {
        checkPlacement()
        if (this.deps.pool(fragment.provider) !== source || !decision.isCurrent(source.policy()))
          throw new DeviceAccountAdmissionError()
        claim.check()
      }
      check()
      const result = await pool.run(request, async (admission) => {
        const beforeSend = () => {
          check()
          admission.beforeSend()
          outcome = 'uncertain'
        }
        return await dispatch({
          ...admission,
          check: () => {
            check()
            admission.check()
          },
          beforeSend,
        })
      })
      if (!hasSent()) throw new DeviceAccountAdmissionError()
      outcome = 'returned'
      return result
    } finally {
      await claim.finish(outcome)
    }
  }
}
