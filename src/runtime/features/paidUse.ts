import { AcpPaidUse, type PaidUseAsker, type PaidGrantStore } from '../../acp/paid'
import { type PaidFeatureGate, type PaidUsage } from '../../core/paid/paidFeatures'
import { unlessAborted } from '../../core/timeouts'
import type { CoreLogger } from '../../core/logging'
import { PAID_FEATURES, type PaidFeature } from '../../shared/constants'
import type { PaidUseRequest } from '../../shared/paid'

export interface RuntimePaidUseDeps {
  readonly gate: PaidFeatureGate
  readonly usage: PaidUsage
  readonly grants: PaidGrantStore
  readonly isSettingOn: (feature: PaidFeature) => boolean
  readonly canRemember: () => boolean
  readonly isCurrent: () => boolean
  readonly log: CoreLogger
}

/** The interactive policy shares D48's real consent engine while ACP keeps its flag-only policy. */
export class RuntimePaidUse extends AcpPaidUse {
  private readonly ending = new AbortController()
  private readonly pending = new Set<Promise<boolean>>()
  private closing: Promise<void> | undefined

  public constructor(private readonly runtimeDeps: RuntimePaidUseDeps) {
    super({
      flagged: [],
      canRemember: runtimeDeps.canRemember,
      grants: runtimeDeps.grants,
      log: runtimeDeps.log,
    })
  }

  public override isOn(feature: PaidFeature): boolean {
    return (
      !this.ending.signal.aborted &&
      this.runtimeDeps.isCurrent() &&
      this.runtimeDeps.gate.isOn(feature)
    )
  }

  public override attach(asker: PaidUseAsker): void {
    super.attach(async (...args) => {
      this.ending.signal.throwIfAborted()
      return (await unlessAborted(asker(...args), this.ending.signal)) ?? 'deny'
    })
  }

  public override async allows(
    root: string,
    sessionId: string,
    request: PaidUseRequest,
    requiresAsking: boolean,
  ): Promise<boolean> {
    const decision = super.allows(root, sessionId, request, requiresAsking)
    this.pending.add(decision)
    try {
      return (await decision) && this.isOn(request.feature)
    } finally {
      this.pending.delete(decision)
    }
  }

  public override noteUse(feature: PaidFeature, units: number): void {
    if (!Number.isFinite(units) || units < 0) throw new Error('MHP_PAID_USAGE_INVALID')
    this.runtimeDeps.usage.add(feature, units)
  }

  public override async forgetUnflagged(): Promise<void> {
    const disabled = PAID_FEATURES.filter((feature) => !this.runtimeDeps.isSettingOn(feature))
    await this.runtimeDeps.grants.forget(disabled)
  }

  public dispose(): Promise<void> {
    this.ending.abort()
    this.closing ??= (async () => {
      await Promise.allSettled(this.pending)
    })()
    return this.closing
  }
}
