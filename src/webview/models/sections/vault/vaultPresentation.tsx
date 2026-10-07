import { UI_TEXT } from '../../../../shared/constants'
import { formatDateTime, formatNumber } from '../../../../shared/l10n/text'
import { type VaultUse, type VaultApprovalRequest } from '../../../../shared/vault'

export function vaultUseLabel(kind: VaultUse['kind']): string {
  switch (kind) {
    case 'ssh': {
      return UI_TEXT.vault.sshUse
    }
    case 'sshSign': {
      return UI_TEXT.vault.sshSignUse
    }
    case 'sudo': {
      return UI_TEXT.vault.sudoUse
    }
    case 'askpass': {
      return UI_TEXT.vault.askpassUse
    }
    case 'git': {
      return UI_TEXT.vault.gitUse
    }
    case 'environment': {
      return UI_TEXT.vault.environmentUse
    }
    case 'stdin': {
      return UI_TEXT.vault.stdinUse
    }
    case 'totp': {
      return UI_TEXT.vault.totp
    }
    case 'mcp': {
      return UI_TEXT.vault.mcpUse
    }
    case 'header': {
      return UI_TEXT.vault.headerUse
    }
    case 'oauth': {
      return UI_TEXT.vault.oauth
    }
    case 'fill': {
      return UI_TEXT.vault.fillUse
    }
    case 'session': {
      return UI_TEXT.vault.session
    }
    case 'disclosure': {
      return UI_TEXT.vault.disclosureUse
    }
  }
}
/** The sentence's target is the exact destination or argv/cwd; details retain every field. */
export function vaultUseTarget(use: VaultUse): string {
  if ('command' in use)
    return `${JSON.stringify([use.command.executable, ...use.command.argv])} (${use.command.cwd})`
  switch (use.kind) {
    case 'ssh': {
      return `${use.remoteUser}@${use.host} (${use.hostKeyFingerprint ?? UI_TEXT.vault.noDestination})`
    }
    case 'sshSign': {
      return `${use.namespace} (${use.keyFingerprint})`
    }
    case 'header': {
      return `${use.headerName} (${use.origin})`
    }
    case 'oauth': {
      return `${use.resource} (${use.issuer})`
    }
    case 'fill': {
      return `${use.origin} (${use.frameId}: ${use.field})`
    }
    case 'session': {
      return `${use.origin} (${use.browserId})`
    }
    case 'disclosure': {
      return UI_TEXT.vault.disclosureUse
    }
  }
}
export function isSessionAllowed(request: VaultApprovalRequest): boolean {
  return (
    request.item.policy.mode === 'askOncePerSession' &&
    request.requester.sessionId !== null &&
    !request.taint.tainted &&
    request.use.kind !== 'disclosure'
  )
}

function label(key: string): string {
  const labels: Readonly<Record<string, string>> = {
    policy: UI_TEXT.vault.policy,
    roles: UI_TEXT.vault.roles,
    workspaces: UI_TEXT.vault.workspaces,
    target: UI_TEXT.vault.target,
    command: UI_TEXT.vault.command,
    cwd: UI_TEXT.vault.cwd,
    names: UI_TEXT.vault.environmentNames,
    maxUses: UI_TEXT.vault.useCount,
    expiresAt: UI_TEXT.vault.expires,
    window: UI_TEXT.vault.timeWindow,
    days: UI_TEXT.vault.days,
    remoteUser: UI_TEXT.vault.remoteUser,
    hostKeyFingerprint: UI_TEXT.vault.hostKey,
    origin: UI_TEXT.vault.origin,
    resource: UI_TEXT.vault.resource,
    requester: UI_TEXT.vault.requester,
    outcome: UI_TEXT.vault.outcome,
    requirePresence: UI_TEXT.vault.requirePresence,
    unattendedAllowed: UI_TEXT.vault.unattended,
    ceiling: UI_TEXT.vault.ceiling,
    createdAt: UI_TEXT.vault.created,
    lastUsedAt: UI_TEXT.vault.lastUsed,
    sessionId: UI_TEXT.vault.sessionScope,
    taskId: UI_TEXT.vault.taskScope,
    forwarding: UI_TEXT.vault.forwarding,
    kind: UI_TEXT.vault.kind,
  }
  return labels[key] ?? key
}
function display(value: unknown, key: string): string {
  if (value === null)
    return ['maxUses', 'expiresAt', 'window'].includes(key) ? UI_TEXT.vault.unlimited : '—'
  if (typeof value === 'number')
    return key === 'time' || key.endsWith('At') ? formatDateTime(value) : formatNumber(value)
  if (typeof value === 'boolean') return value ? UI_TEXT.toggleOn : UI_TEXT.toggleOff
  if (Array.isArray(value))
    return `[${value.map((entry: unknown) => (typeof entry === 'string' ? JSON.stringify(entry) : display(entry, key))).join(', ')}]`
  if (typeof value === 'object')
    return `{${Object.entries(value)
      .map(([field, entry]) => `${field}: ${display(entry, field)}`)
      .join(', ')}}`
  return typeof value === 'string' ? value : '—'
}

/** Exact technical fields remain visible, including argv boundaries and every grant scope. */
export function VaultDetails({ value }: { readonly value: Readonly<Record<string, unknown>> }) {
  return (
    <dl className="vault-details">
      {Object.entries(value).map(([key, detail]) => (
        <div key={key}>
          <dt>{label(key)}</dt>
          <dd>{display(detail, key)}</dd>
        </div>
      ))}
    </dl>
  )
}
