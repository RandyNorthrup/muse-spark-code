import {
  billingRoute,
  subscriptionAccountId,
  type BillingRoute,
  type ConversationOwner,
} from '../../core/backends/modelapi/billingRoute'
// C-M95-SUB: the host's view of the subscription credential. One opt-in
// (the VS Code setting, the ACP/headless flag) over the shared core
// resolver: the effective key for sends, plan billing for the turn path,
// and availability for the sign-in gates. Refusals throw
// SubscriptionKeyError, naming the fix; they never carry the key.
import {
  resolveModelApiCredential,
  SubscriptionKeyError,
  SubscriptionKeySource,
} from '../../core/backends/modelapi/subscriptionKey'
import { registerSecretValue } from '../../core/redact'
import type { CredentialStore } from './credentialStore'

export interface SubscriptionCredentialDeps {
  readonly credentials: Pick<CredentialStore, 'getApiKey'>
  /** The one opt-in: the setting in VS Code, the flag in ACP/headless. */
  readonly isEnabled: () => boolean | Promise<boolean>
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly xdgConfigHome: string | undefined
  readonly source?: SubscriptionKeySource | undefined
}

export class SubscriptionCredential {
  private readonly source: SubscriptionKeySource
  private readonly trackedKeys = new Set<string>()
  public constructor(private readonly deps: SubscriptionCredentialDeps) {
    this.source =
      deps.source ??
      new SubscriptionKeySource({
        platform: deps.platform,
        homeDir: deps.homeDir,
        xdgConfigHome: deps.xdgConfigHome,
      })
  }

  /** Keep old literals too: a later snapshot can still contain a rotated key. */
  private track(key: string): void {
    if (this.trackedKeys.has(key)) return
    this.trackedKeys.add(key)
    registerSecretValue(key)
  }

  private resolved() {
    return resolveModelApiCredential({
      readPastedKey: () => this.deps.credentials.getApiKey(),
      isSubscriptionEnabled: () => this.deps.isEnabled(),
      subscription: this.source,
    })
  }

  /** Stable non-secret identity, also available after sign-out to drop its fences. */
  public accountId(): ConversationOwner {
    return subscriptionAccountId(this.source.path(), this.deps.platform)
  }

  /** The CLI auth file read, for diagnostics that never carry the key. */
  public filePath(): string {
    return this.source.path()
  }

  /** Resolve exactly once per Meta attempt; paid extras always use the pasted key. */
  public async route(isPaid = false): Promise<BillingRoute | undefined> {
    if (isPaid) {
      const key = await this.deps.credentials.getApiKey()
      if (key === undefined) return
      this.track(key)
      return billingRoute('payAsYouGo', key)
    }
    const resolved = await this.resolved()
    if (resolved.kind === 'refused') throw new SubscriptionKeyError(resolved.status)
    if (resolved.kind !== 'key') return
    this.track(resolved.key)
    return billingRoute(
      resolved.billing,
      resolved.key,
      resolved.billing === 'museCodePlan' ? this.accountId() : undefined,
    )
  }

  /** The effective Model API key derives from the same route as billing. */
  public async getApiKey(): Promise<string | undefined> {
    const route = await this.route()
    return route?.credential
  }

  /**
  Exact literals for the boundaries that persist or scrub text (session
  snapshots, receipts): every observed key, including rotated values.
  Best-effort and never throwing, so a store that cannot be read
  contributes nothing instead of breaking the save.
  */
  public async redactionKeys(): Promise<readonly string[]> {
    const keys: string[] = []
    try {
      const pasted = await this.deps.credentials.getApiKey()
      if (pasted !== undefined) keys.push(pasted)
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'StoreUnavailableError') throw error
      // An unreadable store contributes no literal here; availability and
      // turn paths report it where it matters.
    }
    try {
      const resolved = await this.resolved()
      if (resolved.kind === 'key' && !keys.includes(resolved.key)) keys.push(resolved.key)
    } catch (error: unknown) {
      if (!(error instanceof Error) || error.name !== 'StoreUnavailableError') throw error
      // A refusal or an unreadable sign-in contributes no literal here;
      // the turn path surfaces the refusal itself.
    }
    for (const key of keys) this.track(key)
    return [...keys, ...[...this.trackedKeys].filter((key) => !keys.includes(key))]
  }

  /** True while this turn would bill the Muse Code plan. */
  public async isSubscriptionBilling(): Promise<boolean> {
    const resolved = await this.resolved()
    return resolved.kind === 'key' && resolved.billing === 'museCodePlan'
  }

  /** Any usable credential: the pasted key, or the opted-in subscription. */
  public async hasCredential(): Promise<boolean> {
    const resolved = await this.resolved()
    return resolved.kind === 'key'
  }
}
