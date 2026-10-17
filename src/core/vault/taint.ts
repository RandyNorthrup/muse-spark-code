import { VAULT_LIMITS } from '../../shared/constants'
import { vaultTaintSchema, type VaultTaint } from '../../shared/vault'

export type VaultProvenance = VaultTaint['reasons'][number]

/** Validate, copy and bound reasons without losing the tainted bit at the cap. */
export function combineVaultTaint(context: readonly VaultTaint[]): VaultTaint {
  const reasons: VaultProvenance[] = []
  const seen = new Set<string>()
  let isTainted = false
  for (const input of context) {
    const parsed = vaultTaintSchema.parse(input)
    isTainted ||= parsed.tainted
    for (const reason of parsed.reasons) {
      const key = JSON.stringify(reason)
      if (!(reasons.length < VAULT_LIMITS.reasons) || seen.has(key)) {
        continue
      }

      reasons.push({ ...reason })
      seen.add(key)
    }
  }
  return { tainted: isTainted, reasons }
}

/** Only trusted adapters choose these facts; a tool's trust claims are ignored. */
export function vaultProvenance(source: VaultProvenance['source'], label: string): VaultTaint {
  return vaultTaintSchema.parse({ tainted: true, reasons: [{ source, label }] })
}

/**
 * Model API snapshots only the context of this request. Muse Code cannot
 * expose that context, so observations remain tainted until the session ends.
 * Returned snapshots are copies: an approval or tool cannot clear the owner.
 */
export class VaultTaintSession {
  private observed: VaultTaint = { tainted: false, reasons: [] }
  private request: VaultTaint = { tainted: false, reasons: [] }

  public constructor(private readonly backend: 'modelApi' | 'museCode') {}

  public observe(provenance: VaultTaint): void {
    this.observed = combineVaultTaint([this.observed, provenance])
  }

  public beginRequest(context: readonly VaultTaint[], isWorkspaceTrusted: boolean): VaultTaint {
    this.request = combineVaultTaint([
      ...context,
      ...(this.backend === 'museCode' ? [this.observed] : []),
      ...(isWorkspaceTrusted ? [] : [vaultProvenance('restrictedWorkspace', 'workspace')]),
    ])
    if (this.backend === 'museCode') this.observe(this.request)
    return this.current()
  }

  public current(): VaultTaint {
    return combineVaultTaint([
      this.request,
      ...(this.backend === 'museCode' ? [this.observed] : []),
    ])
  }

  /** A summary/reply still depends on the request that generated it. */
  public derived(provenance?: VaultTaint): VaultTaint {
    return combineVaultTaint([this.current(), ...(provenance === undefined ? [] : [provenance])])
  }
}
