import { AcpPaidUse, type PaidUseAsker } from '../../acp/paid'
import { type PaidFeatureGate, type PaidUsage } from '../../core/paid/paidFeatures'
import { unlessAborted } from '../../core/timeouts'
import type { CoreLogger } from '../../core/logging'
import { PAID_FEATURES, type PaidFeature } from '../../shared/constants'
import type { PaidUseRequest } from '../../shared/paid'
import type { ConversationCompositionPorts } from '../../host/compose/conversationDeps'
import type { RuntimePaidGrantStore } from '../paidGrants'

export interface RuntimePaidUseDeps {
  readonly gate: PaidFeatureGate
  readonly usage: PaidUsage
  readonly grants: RuntimePaidGrantStore
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

  /** Contract v2: the controller and backend consume the same priced policy and tally. */
  public composition(root: string, surfaceId: string): ConversationCompositionPorts['paid'] {
    const check = () => {
      this.ending.signal.throwIfAborted()
      if (!this.runtimeDeps.isCurrent()) throw new Error('MHP_PAID_OWNER_REPLACED')
    }
    return {
      gate: {
        isOn: (feature) => this.isOn(feature),
        turnOn: async (feature) => {
          check()
          const isOn = await this.runtimeDeps.gate.turnOn(feature)
          check()
          return isOn
        },
        turnOff: async (feature) => {
          check()
          await this.runtimeDeps.gate.turnOff(feature)
          await this.runtimeDeps.grants.forget([feature])
          check()
        },
      },
      consent: {
        allows: (request) => this.allows(root, surfaceId, request, false),
        forget: async () => {
          check()
          await this.runtimeDeps.grants.forgetWorkspace(root)
          check()
        },
      },
      usage: {
        add: (feature, units) => {
          this.noteUse(feature, units)
        },
        addBestOfNRequest: () => {
          this.runtimeDeps.usage.addBestOfNRequest()
        },
        addBestOfNUsage: (modelId, usage) => {
          this.runtimeDeps.usage.addBestOfNUsage(modelId, usage)
        },
      },
    }
  }

  public dispose(): Promise<void> {
    this.ending.abort()
    this.closing ??= (async () => {
      await Promise.allSettled(this.pending)
    })()
    return this.closing
  }
}
