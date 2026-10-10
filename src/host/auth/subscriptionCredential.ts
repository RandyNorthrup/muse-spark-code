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
  public constructor(private readonly deps: SubscriptionCredentialDeps) {
    this.source =
      deps.source ??
      new SubscriptionKeySource({
        platform: deps.platform,
        homeDir: deps.homeDir,
        xdgConfigHome: deps.xdgConfigHome,
      })
  }

  private resolved() {
    return resolveModelApiCredential({
      readPastedKey: () => this.deps.credentials.getApiKey(),
      isSubscriptionEnabled: () => this.deps.isEnabled(),
      subscription: this.source,
    })
  }

  /** The CLI auth file read, for diagnostics that never carry the key. */
  public filePath(): string {
    return this.source.path()
  }

  /** The effective Model API key. Throws when opted in but unreadable. */
  public async getApiKey(): Promise<string | undefined> {
    const resolved = await this.resolved()
    if (resolved.kind === 'refused') throw new SubscriptionKeyError(resolved.status)
    return resolved.kind === 'key' ? resolved.key : undefined
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
