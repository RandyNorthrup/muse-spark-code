import { AcpPaidUse, type PaidUseAsker } from '../../acp/paid'
import { type PaidFeatureGate, type PaidUsage } from '../../core/paid/paidFeatures'
import { unlessAborted } from '../../core/timeouts'
import type { CoreLogger } from '../../core/logging'
import { PAID_FEATURES, type PaidFeature } from '../../shared/constants'
import type { PaidUseDecision, PaidUseRequest, SearchSettlement } from '../../shared/paid'
import type { UsdAmount } from '../../shared/usd'
import type { ConversationCompositionPorts } from '../../host/compose/conversationDeps'
import type { JudgeWindowDeps } from '../../host/judge/judgeBundle'
import type { RuntimePaidGrantStore } from '../paidGrants'
import { PaidOwnerReplacedError, PaidUseConsent } from '../../core/paid/paidConsent'
import { failureForLog } from '../../core/backends/musecode/logText'

export interface RuntimePaidUseDeps {
  readonly gate: PaidFeatureGate
  readonly usage: PaidUsage
  readonly grants: RuntimePaidGrantStore
  readonly isSettingOn: (feature: PaidFeature) => boolean
  readonly canRemember: () => boolean
  readonly isCurrent: () => boolean
  readonly log: CoreLogger
}

/**
PaidUseConsent's `allows` overloads for a port built from a decision
function: only a web-search decision carries its frozen quote (which
ModelApiHost matches before searching); every other feature is a boolean.
*/
export function consentAllows(
  decide: (request: PaidUseRequest) => Promise<PaidUseDecision>,
): PaidUseConsent['allows'] {
  function allows(request: Exclude<PaidUseRequest, { feature: 'webSearch' }>): Promise<boolean>
  function allows(request: PaidUseRequest): Promise<PaidUseDecision>
  async function allows(request: PaidUseRequest): Promise<PaidUseDecision> {
    const decision = await decide(request)
    return request.feature === 'webSearch' ? decision : decision === true
  }
  return allows
}

interface RuntimeConsent {
  readonly consent: PaidUseConsent
  readonly state: { generation: number; isTabDenied: boolean }
}

/** The interactive policy shares D48's real consent engine while ACP keeps its flag-only policy. */
export class RuntimePaidUse extends AcpPaidUse {
  private readonly ending = new AbortController()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly windows = new Map<string, Map<string, Map<PaidFeature, RuntimeConsent>>>()
  private runtimeAsker: PaidUseAsker | undefined
  private mutation: Promise<void> = Promise.resolve()
  private generation = 0
  private closing: Promise<void> | undefined

  public constructor(private readonly runtimeDeps: RuntimePaidUseDeps) {
    super({
      flagged: [],
      canRemember: runtimeDeps.canRemember,
      grants: runtimeDeps.grants,
      log: runtimeDeps.log,
    })
  }

  private check(generation: number): void {
    this.ending.signal.throwIfAborted()
    if (generation !== this.generation || !this.runtimeDeps.isCurrent())
      throw new PaidOwnerReplacedError()
  }

  private async track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    try {
      return await work
    } finally {
      this.pending.delete(work)
    }
  }

  /** Every setting/acceptance/grant writer belongs to the same drained queue. */
  private mutate<T>(work: (check: () => void) => Promise<T>): Promise<T> {
    const generation = this.generation
    const check = () => {
      this.check(generation)
    }
    const previous = this.mutation
    const mutation = (async () => {
      await previous
      check()
      const result = await work(check)
      check()
      return result
    })()
    this.mutation = (async () => {
      try {
        await mutation
      } catch {
        // The caller receives the failure; the serialized owner can accept its next action.
      }
    })()
    return this.track(mutation)
  }

  private consent(root: string, surfaceId: string, feature: PaidFeature): PaidUseConsent {
    let windows = this.windows.get(root)
    if (windows === undefined) {
      windows = new Map()
      this.windows.set(root, windows)
    }
    let features = windows.get(surfaceId)
    if (features === undefined) {
      features = new Map()
      windows.set(surfaceId, features)
    }
    const held = features.get(feature)
    if (held !== undefined) return held.consent
    const state = { generation: 0, isTabDenied: false }
    const windowGeneration = state.generation
    const consent = new PaidUseConsent({
      isOn: (feature) =>
        windowGeneration === state.generation &&
        this.isOn(feature) &&
        (feature !== 'tab' || !state.isTabDenied),
      canRemember: this.runtimeDeps.canRemember,
      readGrants: () => this.runtimeDeps.grants.read(root),
      writeGrants: (grants) =>
        this.mutate(async (check) => {
          const held = this.runtimeDeps.grants.read(root)
          check()
          if (windowGeneration !== state.generation) throw new PaidOwnerReplacedError()
          await this.runtimeDeps.grants.add(
            root,
            grants.has(feature) && !held.has(feature) ? [feature] : [],
          )
          check()
        }),
      windowOnceFeatures: new Set(['tab']),
      windowOnceGeneration: () => state.generation,
      ask: async (request, canRemember) => {
        // Both generations are captured when the popup opens: an answer
        // that arrives after Ask again (or disposal) bumped either one is
        // stale and denies, whatever it says.
        const generation = this.generation
        const windowGenerationAtOpen = state.generation
        try {
          this.check(generation)
          if (this.runtimeAsker === undefined) return 'deny'
          const answer =
            (await unlessAborted(
              this.runtimeAsker(surfaceId, request, canRemember),
              this.ending.signal,
            )) ?? 'deny'
          this.check(generation)
          if (windowGenerationAtOpen !== state.generation) return 'deny'
          if (answer === 'deny' && request.feature === 'tab') state.isTabDenied = true
          return answer
        } catch (error: unknown) {
          this.runtimeDeps.log.warn(`Paid use refused: ${failureForLog(error)}`)
          return 'deny'
        }
      },
      log: this.runtimeDeps.log,
    })
    features.set(feature, { consent, state })
    return consent
  }

  private revoke(root?: string, feature?: PaidFeature): void {
    for (const [workspace, windows] of this.windows) {
      if (root !== undefined && root !== workspace) continue
      for (const features of windows.values()) {
        for (const [heldFeature, { consent, state }] of features) {
          if (feature !== undefined && feature !== heldFeature) continue
          state.generation += 1
          consent.revokeWindowOnce(heldFeature)
          features.delete(heldFeature)
        }
      }
    }
  }

  public override isOn(feature: PaidFeature): boolean {
    return (
      !this.ending.signal.aborted &&
      this.runtimeDeps.isCurrent() &&
      this.runtimeDeps.gate.isOn(feature)
    )
  }

  public override attach(asker: PaidUseAsker): void {
    this.runtimeAsker = asker
  }

  public override async allows(
    root: string,
    sessionId: string,
    request: PaidUseRequest,
    requiresAsking: boolean,
  ): Promise<PaidUseDecision> {
    if (!this.isOn(request.feature)) return false
    const generation = this.generation
    const decision = await this.track(
      this.consent(root, sessionId, request.feature).allows(request, requiresAsking),
    )
    // A search approval is its frozen quote; it survives only the same owner generation.
    return (
      decision !== undefined &&
      generation === this.generation &&
      this.isOn(request.feature) &&
      decision
    )
  }

  public override noteUse(
    feature: PaidFeature,
    units: number,
    searchPriceUsd?: UsdAmount | SearchSettlement,
  ): void {
    if (!Number.isFinite(units) || units < 0) throw new Error('MHP_PAID_USAGE_INVALID')
    this.runtimeDeps.usage.add(feature, units, searchPriceUsd)
  }

  public override async forgetUnflagged(): Promise<void> {
    await this.mutate(async (check) => {
      const disabled = PAID_FEATURES.filter((feature) => !this.runtimeDeps.isSettingOn(feature))
      for (const feature of disabled) this.revoke(undefined, feature)
      check()
      await this.runtimeDeps.grants.forget(disabled)
    })
  }

  /** Contract v2: the controller and backend consume the same priced policy and tally. */
  public composition(root: string, surfaceId: string): ConversationCompositionPorts['paid'] {
    return {
      gate: {
        isOn: (feature) => this.isOn(feature),
        turnOn: (feature) =>
          this.mutate((check) =>
            this.runtimeDeps.gate.turnOn(feature, { signal: this.ending.signal, check }),
          ),
        turnOff: (feature) =>
          this.mutate(async (check) => {
            this.revoke(undefined, feature)
            await this.runtimeDeps.gate.turnOff(feature, { signal: this.ending.signal, check })
            check()
            await this.runtimeDeps.grants.forget([feature])
            check()
          }),
      },
      consent: {
        allows: consentAllows((request) => this.allows(root, surfaceId, request, false)),
        forget: () => {
          // Ask again revokes this workspace's window consent synchronously,
          // before the mutation queue is awaited: every popup it opened
          // captured the old per-consent generation, so its answer denies,
          // while other workspaces' answers stand and unrelated queued
          // mutations complete under their own generation.
          this.revoke(root)
          return this.mutate(async (check) => {
            check()
            await this.runtimeDeps.grants.forgetWorkspace(root)
            check()
          })
        },
      },
      usage: {
        add: (feature, units, searchPriceUsd) => {
          this.noteUse(feature, units, searchPriceUsd)
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

  /** The same interactive D48 grants/gate/tally back the optional advisory source. */
  public judge(
    root: string,
    surfaceId: string,
    budgetUsd: () => UsdAmount,
  ): JudgeWindowDeps['paid'] {
    return {
      gate: { isOn: (feature) => this.isOn(feature) },
      consent: {
        remembered: () => PAID_FEATURES.filter((feature) => this.isRemembered(root, feature)),
      },
      usage: this.runtimeDeps.usage,
      allowsJudgeUse: async (modelId) =>
        (await this.allows(
          root,
          surfaceId,
          {
            feature: 'judge',
            modelId,
            dailyBudgetUsd: budgetUsd(),
          },
          false,
        )) === true,
    }
  }

  public dispose(): Promise<void> {
    if (!this.ending.signal.aborted) this.generation += 1
    this.ending.abort()
    this.closing ??= (async () => {
      await Promise.allSettled(this.pending)
      this.windows.clear()
    })()
    return this.closing
  }
}
