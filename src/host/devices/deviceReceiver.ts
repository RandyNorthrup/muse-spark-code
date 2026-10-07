// M108 D's receiver admission is shared by native bridges and runtime hosts.
// No vscode import or transport implementation belongs in this fragment.
import { type AccountPool, type AccountPoolRequest } from '../../core/accounts/pool'
import type { AccountPolicyDecision } from '../../core/accounts/policyGate'
import {
  deviceAccountRequestSchema,
  type DeviceAccountRequest,
  type DeviceAccountClaim,
} from '../../core/team/remotePool'
import { UI_TEXT } from '../../shared/constants'
import { accountHeadroomSchema, deviceAccountHeadroomSchema } from '../../shared/devices'
import type { Usd } from '../../shared/usd'

export class DeviceAccountAdmissionError extends Error {
  public readonly code: 'recovery' | 'cancel' | 'ownCapsOnly' | 'routeUnavailable'
  public constructor(public readonly decision?: AccountPolicyDecision) {
    let code: DeviceAccountAdmissionError['code'] = 'routeUnavailable'
    if (decision?.kind === 'recovery') code = 'recovery'
    else if (
      decision?.kind === 'stop' &&
      (decision.reason === 'cancel' || decision.reason === 'ownCapsOnly')
    )
      code = decision.reason
    let message = UI_TEXT.accounts.routeUnavailable
    if (decision?.kind === 'recovery')
      message =
        decision.recovery === 'chatgptPlan'
          ? UI_TEXT.accounts.chatgptRecovery
          : UI_TEXT.accounts.museCodeRecovery
    else if (code === 'cancel' || code === 'ownCapsOnly') message = UI_TEXT.accounts[code]
    super(message)
    this.code = code
    this.name = 'DeviceAccountAdmissionError'
  }
}

export interface DeviceAccountReceiverDeps {
  readonly providers: () => readonly string[]
  /** The existing local provider owner; admission and journal are shared with local sends. */
  readonly pool: (provider: string) => AccountPool | undefined
  /** Receiver's selected model and projection for its provider offer. */
  readonly offerRequest: (provider: string) => AccountPoolRequest
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
  public constructor(private readonly deps: DeviceAccountReceiverDeps) {}

  private bucket(
    provider: string,
    pool: AccountPool | undefined,
    request: AccountPoolRequest,
  ): 'ample' | 'some' | 'none' {
    const source = pool?.deps
    const policy = source?.policy()
    let bucket: 'ample' | 'some' | 'none' = 'none'
    if (
      source !== undefined &&
      policy?.isCredentialHeld === true &&
      policy.pooling !== 'notOffered'
    ) {
      for (const account of source.accounts()) {
        if (
          !this.deps.isPinnedHere(provider, account.id) ||
          pool?.hasRoom(account, request) !== true
        )
          continue
        const headroom = accountHeadroomSchema.parse(this.deps.headroom(provider, account.id))
        if (headroom === 'ample' || (headroom === 'some' && bucket === 'none')) bucket = headroom
      }
    }
    return bucket
  }

  public offer(): Readonly<Record<string, 'ample' | 'some' | 'none'>> {
    const buckets = this.deps
      .providers()
      .map((provider) => [
        provider,
        this.bucket(provider, this.deps.pool(provider), this.deps.offerRequest(provider)),
      ])
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
    const pool = this.deps.pool(fragment.provider)
    if (pool?.deps.provider !== fragment.provider) throw new DeviceAccountAdmissionError()
    const source = pool.deps
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
        if (this.deps.pool(fragment.provider) !== pool || !decision.isCurrent(source.policy()))
          throw new DeviceAccountAdmissionError()
        claim.check()
      }
      check()
      let bucket: 'ample' | 'some' | 'none' | undefined
      const result = await pool.run(
        request,
        async (admission) => {
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
        },
        (account) => {
          // First evaluation runs inside the existing pool's admission queue.
          // Later fences check the same capacity class after credential waits.
          bucket ??= this.bucket(fragment.provider, pool, request)
          return (
            bucket !== 'none' &&
            this.deps.isPinnedHere(fragment.provider, account.id) &&
            accountHeadroomSchema.parse(this.deps.headroom(fragment.provider, account.id)) ===
              bucket
          )
        },
      )
      if (!hasSent()) throw new DeviceAccountAdmissionError()
      outcome = 'returned'
      return result
    } finally {
      await claim.finish(outcome)
    }
  }
}
