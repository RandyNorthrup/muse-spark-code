import { randomBytes } from 'node:crypto'
import {
  type VaultApprovalRequest,
  type VaultAuditRecord,
  type VaultBinding,
  type VaultGrant,
  type VaultItem,
  type VaultItemMetadata,
  type VaultRequester,
  type VaultUse,
} from '../../../../src/shared/vault'
import { type VaultPanelState } from '../../../../src/shared/modelsPanel'

export function requester(): VaultRequester {
  return {
    id: 'a'.repeat(32),
    hostId: 'b'.repeat(32),
    conversationId: 'conversation',
    taskId: null,
    role: { kind: 'orchestrator' },
    workspaceId: 'workspace',
    deviceId: null,
    peerProcessId: 100,
    sessionId: 'c'.repeat(32),
    unattended: false,
    source: 'conversation',
  }
}
export function metadata(): VaultItemMetadata {
  return {
    id: 'd'.repeat(32),
    name: 'test-secret',
    handle: 'secret://test-secret',
    label: 'Generated test item',
    kind: 'secret',
    bindings: [],
    requirePresence: false,
    hidden: false,
    firstParty: false,
    policy: { mode: 'askEveryTime', unattendedAllowed: false, allowDisclosure: false },
    dates: { createdAt: 0, rotatedAt: null, expiresAt: null, lastUsedAt: null },
    publicKey: null,
    fingerprint: null,
  }
}
export function item(): VaultItem {
  return { metadata: metadata(), material: { kind: 'secret', value: randomBytes(32) } }
}
export function use(): Extract<VaultUse, { kind: 'environment' }> {
  return {
    kind: 'environment',
    command: { executable: '/usr/bin/tool', argv: ['--check'], cwd: '/workspace' },
    names: ['SERVICE_TOKEN'],
  }
}
export function approval(): VaultApprovalRequest {
  return {
    id: 'a'.repeat(32),
    requester: requester(),
    item: metadata(),
    use: use(),
    digest: 'b'.repeat(64),
    nonce: 'c'.repeat(32),
    createdAt: 0,
    expiresAt: 120_000,
    lockEpoch: 0,
    taint: { tainted: false, reasons: [] },
  }
}
export function grant(): VaultGrant {
  const target: VaultBinding = {
    kind: 'environment',
    commandDigest: 'f'.repeat(64),
    names: ['SERVICE_TOKEN'],
  }
  return {
    id: 'e'.repeat(32),
    itemId: metadata().id,
    roles: [{ kind: 'orchestrator' }],
    workspaces: ['workspace'],
    target,
    maxUses: 2,
    uses: 0,
    expiresAt: null,
    window: null,
    unattendedAllowed: false,
    sessionId: null,
    taskId: null,
    ceiling: 'ask',
    createdAt: 0,
    createdBy: 'vaultPanel',
  }
}
export function audit(): VaultAuditRecord {
  return {
    v: 1,
    id: 'f'.repeat(32),
    generation: 1,
    time: 0,
    requester: requester(),
    handle: metadata().handle,
    kind: 'environment',
    target: 'redacted target',
    digest: 'a'.repeat(64),
    decision: 'ask',
    authority: 'user',
    grantId: null,
    outcome: 'pending',
    previousHash: '0'.repeat(64),
    hash: '1'.repeat(64),
    mac: '2'.repeat(64),
  }
}
export function panel(): VaultPanelState {
  return {
    status: {
      state: 'unlocked',
      lockEpoch: 0,
      tier: 'osStore',
      provider: 'test-only',
      silentUnlock: true,
      itemCount: 1,
      reason: null,
    },
    items: [metadata()],
    grants: [grant()],
    audit: [audit()],
    pending: [],
    ambientFiles: [],
  }
}
