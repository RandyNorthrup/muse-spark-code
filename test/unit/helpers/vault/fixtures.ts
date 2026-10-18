import {
  type VaultBinding,
  type VaultGrant,
  type VaultItemMetadata,
  type VaultRequester,
  type VaultUse,
} from '../../../../src/shared/vault'

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
export function use(): Extract<VaultUse, { kind: 'environment' }> {
  return {
    kind: 'environment',
    command: { executable: '/usr/bin/tool', argv: ['--check'], cwd: '/workspace' },
    names: ['SERVICE_TOKEN'],
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
