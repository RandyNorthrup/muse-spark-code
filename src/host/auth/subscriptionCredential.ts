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
  private trackedKey: string | undefined
  private releaseTrackedKey: (() => void) | undefined
  public constructor(private readonly deps: SubscriptionCredentialDeps) {
    this.source =
      deps.source ??
      new SubscriptionKeySource({
        platform: deps.platform,
        homeDir: deps.homeDir,
        xdgConfigHome: deps.xdgConfigHome,
      })
  }

  /**
   * The key about to be sent, held in the shared redactor registry while
   * it is current: every `redactSecrets` call site (logs, snapshots,
   * exports, receipts, errors) then redacts the credential actually sent,
   * subscription or pasted. Rotation releases the old value and tracks the
   * new one, so at most one value is held.
   */
  private track(key: string): void {
    if (this.trackedKey === key) return
    this.releaseTrackedKey?.()
    this.releaseTrackedKey = undefined
    this.trackedKey = key
    this.releaseTrackedKey = registerSecretValue(key)
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
    if (resolved.kind === 'key') this.track(resolved.key)
    return resolved.kind === 'key' ? resolved.key : undefined
  }

  /**
   * Exact literals for the boundaries that persist or scrub text (session
   * snapshots, receipts): the pasted key and the currently sent one.
   * Best-effort and never throwing, so a store that cannot be read
   * contributes nothing instead of breaking the save.
   */
  public async redactionKeys(): Promise<readonly string[]> {
    const keys: string[] = []
    try {
      const pasted = await this.deps.credentials.getApiKey()
      if (pasted !== undefined) keys.push(pasted)
    } catch {
      // An unreadable store contributes no literal here; availability and
      // turn paths report it where it matters.
    }
    try {
      const resolved = await this.resolved()
      if (resolved.kind === 'key' && !keys.includes(resolved.key)) keys.push(resolved.key)
    } catch {
      // A refusal or an unreadable sign-in contributes no literal here;
      // the turn path surfaces the refusal itself.
    }
    return keys
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
