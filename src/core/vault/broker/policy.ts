import { createHash } from 'node:crypto'
import { vaultUseDigest } from '../useDigest'
import {
  type VaultBinding,
  type VaultGrant,
  type VaultItemMetadata,
  type VaultRequester,
  type VaultTaint,
  type VaultUse,
} from '../../../shared/vault'
import { type VaultApprovalResult } from '../../../shared/vaultProtocol'

export type VaultCeiling = VaultGrant['ceiling']
export type PolicyDecision =
  | Extract<VaultApprovalResult, { kind: 'denied' }>
  | { kind: 'allow'; grant: VaultGrant | null }
  | { kind: 'ask' }

/** Command-only scope is independent of the route. Full use digests still bind every route field. */
export function vaultCommandDigest(
  command: Extract<VaultUse, { kind: 'environment' }>['command'],
): string {
  return createHash('sha256')
    .update(JSON.stringify([command.executable, command.argv, command.cwd]))
    .digest('hex')
}
function areNamesCovered(allowed: readonly string[], actual: readonly string[]): boolean {
  return actual.every((name) => allowed.includes(name))
}
export function isBindingCovered(binding: VaultBinding, use: VaultUse): boolean {
  switch (binding.kind) {
    case 'ssh': {
      return (
        use.kind === 'ssh' &&
        use.host === binding.host &&
        use.hostKeyFingerprint === binding.hostKeyFingerprint &&
        use.remoteUser === binding.remoteUser &&
        (!use.forwarding || binding.forwarding)
      )
    }
    case 'sshAnyHost': {
      return (
        use.kind === 'ssh' &&
        use.remoteUser === binding.remoteUser &&
        (!use.forwarding || binding.forwarding)
      )
    }
    case 'sshSign': {
      return use.kind === 'sshSign' && use.keyFingerprint === binding.keyFingerprint
    }
    case 'sudo':
    case 'askpass': {
      return (
        use.kind === binding.kind &&
        use.sudoPath === binding.sudoPath &&
        vaultCommandDigest(use.command) === binding.commandDigest &&
        vaultCommandDigest(binding.command) === binding.commandDigest
      )
    }
    case 'environment': {
      return (
        use.kind === 'environment' &&
        vaultCommandDigest(use.command) === binding.commandDigest &&
        areNamesCovered(binding.names, use.names)
      )
    }
    case 'mcp': {
      return (
        use.kind === 'mcp' &&
        use.server === binding.server &&
        vaultCommandDigest(use.command) === binding.commandDigest &&
        areNamesCovered(binding.names, use.names)
      )
    }
    case 'stdin':
    case 'totp': {
      return use.kind === binding.kind && vaultCommandDigest(use.command) === binding.commandDigest
    }
    case 'git': {
      return use.kind === 'git' && use.host === binding.host && use.path === binding.path
    }
    case 'origin': {
      return (
        ['header', 'fill', 'session'].includes(use.kind) &&
        'origin' in use &&
        use.origin === binding.origin
      )
    }
    case 'oauth': {
      return (
        use.kind === 'oauth' &&
        use.origin === binding.origin &&
        use.issuer === binding.issuer &&
        use.resource === binding.resource
      )
    }
    case 'disclosure': {
      // Both schemas literal-type the only recipient as 'person', so kinds
      // alone decide, like the 'git' case above (RVM109T lane note).
      return use.kind === 'disclosure'
    }
  }
}
export function isCeilingCovered(ceiling: VaultCeiling, handle: string): boolean {
  return ceiling === 'ask' || (Array.isArray(ceiling) && ceiling.includes(handle))
}
export function isGrantCovered(
  grant: VaultGrant,
  item: VaultItemMetadata,
  requester: VaultRequester,
  use: VaultUse,
  now: number,
): boolean {
  const local = new Date(now)
  return (
    grant.itemId === item.id &&
    isCeilingCovered(grant.ceiling, item.handle) &&
    (grant.roles === 'any' ||
      grant.roles.some((role) => JSON.stringify(role) === JSON.stringify(requester.role))) &&
    (grant.workspaces === 'any' ||
      (requester.workspaceId !== null && grant.workspaces.includes(requester.workspaceId))) &&
    (grant.sessionId === null || grant.sessionId === requester.sessionId) &&
    (grant.taskId === null || grant.taskId === requester.taskId) &&
    (grant.maxUses === null || grant.uses < grant.maxUses) &&
    (grant.expiresAt === null || now < grant.expiresAt) &&
    (grant.window === null ||
      (grant.window.days.includes(local.getDay()) &&
        local.getHours() >= grant.window.startHour &&
        local.getHours() < grant.window.endHour)) &&
    (!requester.unattended || grant.unattendedAllowed) &&
    isBindingCovered(grant.target, use)
  )
}

export function evaluateVaultPolicy(
  item: VaultItemMetadata,
  requester: VaultRequester,
  use: VaultUse,
  taint: VaultTaint,
  grants: readonly VaultGrant[],
  ceiling: VaultCeiling,
  now: number,
  sessionDigests: ReadonlySet<string>,
): PolicyDecision {
  const deny = (
    reason: Extract<VaultApprovalResult, { kind: 'denied' }>['reason'],
  ): PolicyDecision => ({ kind: 'denied', reason })
  if (!isCeilingCovered(ceiling, item.handle)) return deny('ceiling')
  if (item.hidden || item.firstParty || item.policy.mode === 'never') return deny('policy')
  if (item.dates.expiresAt !== null && now >= item.dates.expiresAt) return deny('expired')
  if (use.kind === 'disclosure' && !item.policy.allowDisclosure) return deny('disclosure')
  if (item.bindings.every((binding) => !isBindingCovered(binding, use))) return deny('scope')
  if (requester.unattended && item.requirePresence) return deny('presence')
  if (requester.unattended && taint.tainted) return deny('tainted')
  if (requester.unattended && (!item.policy.unattendedAllowed || use.kind === 'disclosure'))
    return deny('unattended')
  if (requester.deviceId !== null && !['ssh', 'totp'].includes(use.kind)) return deny('remoteUse')
  if (requester.role.kind === 'hook' && taint.tainted) return deny('tainted')
  if (taint.tainted || use.kind === 'disclosure' || requester.deviceId !== null)
    return requester.unattended ? deny('unattended') : { kind: 'ask' }
  const grant = grants.find((candidate) => isGrantCovered(candidate, item, requester, use, now))
  if (requester.unattended) return grant ? { kind: 'allow', grant } : deny('unattended')
  // Hooks cannot ask and require a standing, exact-command grant, regardless of mode.
  if (requester.role.kind === 'hook')
    return grant?.sessionId === null && use.kind === 'environment'
      ? { kind: 'allow', grant }
      : deny('policy')
  if (item.policy.mode === 'askEveryTime') return { kind: 'ask' }
  if (item.policy.mode === 'askOncePerSession')
    return requester.sessionId !== null && sessionDigests.has(vaultUseDigest(use))
      ? { kind: 'allow', grant: null }
      : { kind: 'ask' }
  return grant ? { kind: 'allow', grant } : { kind: 'ask' }
}
