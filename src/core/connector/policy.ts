// M124 (D106, design §§5–6): what a connection may do. The grant decides
// scopes, workspaces, content and the user library; client hints never do.
// No fixed call budget stands beside the grant: with no limit the person
// set, nothing is reserved or locked (Codex on PR #227). Stop has its own
// path and never meets the kill switch or the approval queue.
import { CONNECTOR_MODEL_TEXT } from '../../shared/constants'
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
The grant's answer for one call. `workspaceId` is the client's selector;
it resolves only inside the grant. Content needs the workspace's (or the
user library's) content flag; a confidential workspace shares nothing.
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
