// M124 (D106, design §§5–6): what a connection may do. The grant decides
// scopes, workspaces, content and the user library; client hints never do.
// Ordinary calls are rate limited and bounded; Stop has its own path and
// never meets these limits, the kill switch or the approval queue.
import { CONNECTOR_LIMITS, CONNECTOR_MODEL_TEXT } from '../../shared/constants'
import type {
  ConnectorGrant,
  ConnectorReason,
  ConnectorScope,
  ConnectorWorkspaceGrant,
} from '../../shared/connector'
import type { ConnectorToolSpec } from '../../shared/connectorTools'
import { fill } from '../../shared/l10n/text'

export interface Refusal {
  readonly reason: ConnectorReason
  readonly message: string
}

export function refusal(reason: ConnectorReason, message: string): Refusal {
  return { reason, message }
}

function forbidden(detail: string): Refusal {
  return refusal('forbidden', fill(CONNECTOR_MODEL_TEXT.forbidden, { reason: detail }))
}

export interface Admission {
  readonly workspace: ConnectorWorkspaceGrant | undefined
}

/**
 * The grant's answer for one call. `workspaceId` is the client's selector;
 * it resolves only inside the grant. Content needs the workspace's (or the
 * user library's) content flag; a confidential workspace shares nothing.
 */
export function admit(
  grant: ConnectorGrant | undefined,
  tool: ConnectorToolSpec,
  input: {
    readonly workspaceId?: string | undefined
    readonly userLibrary?: boolean
  },
  isConfidential: (root: string) => boolean | undefined,
): Admission | Refusal {
  if (grant === undefined || grant.revoked) return forbidden(CONNECTOR_MODEL_TEXT.noGrant)
  for (const scope of tool.scopes)
    if (!grant.scopes.includes(scope))
      return forbidden(fill(CONNECTOR_MODEL_TEXT.reasonScope, { scope }))
  if (input.userLibrary === true)
    return grant.userLibrary
      ? { workspace: undefined }
      : forbidden(CONNECTOR_MODEL_TEXT.reasonUserLibrary)
  if (input.workspaceId === undefined) return { workspace: undefined }
  const workspace = grant.workspaces.find((candidate) => candidate.id === input.workspaceId)
  if (workspace === undefined) return forbidden(CONNECTOR_MODEL_TEXT.reasonWorkspace)
  // Unknown policy (an unreadable settings file) refuses like confidential.
  if (isConfidential(workspace.root) !== false && tool.toolClass !== 'stop')
    return forbidden(CONNECTOR_MODEL_TEXT.reasonConfidential)
  const requiresContent = tool.scopes.includes('content:read')
  return requiresContent && !workspace.content
    ? forbidden(CONNECTOR_MODEL_TEXT.reasonContent)
    : { workspace }
}

export function isRefusal(value: Admission | Refusal): value is Refusal {
  return 'reason' in value
}

/** Write families imply Stop and status, so permitted work stays stoppable. */
export function grantScopes(requested: readonly ConnectorScope[]): ConnectorScope[] {
  const scopes = new Set(requested)
  if (requested.some((scope) => scope.endsWith(':write') || scope.endsWith(':run'))) {
    scopes.add('operations:read')
    scopes.add('control:stop')
  }
  return [...scopes]
}

/** A connection's shared limit state: its token bucket and its leases. */
export interface LimitState {
  readonly tokens: number
  readonly last: number
  readonly leases: readonly LimitLease[]
}
export interface LimitLease {
  readonly id: string
  readonly kind: 'read' | 'pending'
  readonly until: number
}

/**
 * The saved state behind every server process of one connection (store.ts
 * holds it in a locked file), so a second process or a restart gets no
 * fresh allowance. `update` applies one change atomically or throws.
 */
export interface LimitsPort {
  readonly update: <T>(change: (state: LimitState | undefined) => [LimitState, T]) => Promise<T>
}

const LEASE_MAX = { read: CONNECTOR_LIMITS.activeReads, pending: CONNECTOR_LIMITS.pendingApprovals }

/**
 * The grant's limits: a token bucket (`burst` at once, `callsPerMinute`
 * refill) and bounded leases for active reads and pending approvals. A
 * lease expires on its own, so a crashed process never holds a slot. An
 * unreadable state refuses (fail closed). Stop never comes here.
 */
export class SharedLimits {
  public constructor(
    private readonly port: LimitsPort,
    private readonly now: () => number,
  ) {}

  private async apply(change: (state: LimitState, at: number) => LimitState | undefined) {
    const at = this.now()
    try {
      return await this.port.update((saved) => {
        const state: LimitState = {
          tokens: Math.min(
            CONNECTOR_LIMITS.burst,
            saved === undefined
              ? CONNECTOR_LIMITS.burst
              : saved.tokens +
                  (Math.max(0, at - saved.last) * CONNECTOR_LIMITS.callsPerMinute) /
                    CONNECTOR_LIMITS.minuteMs,
          ),
          last: Math.max(at, saved?.last ?? at),
          leases: (saved?.leases ?? []).filter((lease) => lease.until > at),
        }
        const next = change(state, at)
        return [next ?? state, next !== undefined]
      })
    } catch {
      return false
    }
  }

  public take(): Promise<boolean> {
    return this.apply((state) =>
      state.tokens < 1 ? undefined : { ...state, tokens: state.tokens - 1 },
    )
  }

  public enter(kind: LimitLease['kind'], id: string, ttlMs: number): Promise<boolean> {
    return this.apply((state, at) =>
      state.leases.filter((lease) => lease.kind === kind).length >= LEASE_MAX[kind]
        ? undefined
        : { ...state, leases: [...state.leases, { id, kind, until: at + ttlMs }] },
    )
  }

  public async leave(id: string): Promise<void> {
    await this.apply((state) => ({
      ...state,
      leases: state.leases.filter((lease) => lease.id !== id),
    }))
  }
}
