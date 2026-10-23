import {
  NODE_AUDIT_MAX_BYTES,
  NODE_AUDIT_RETENTION_DAYS,
  NODE_SESSION_IDLE_MS,
  NODE_SESSION_MAX_MS,
} from '../../../../src/shared/constants'
import type {
  NodeAudit,
  NodeConfig,
  NodeDashboard,
  NodeEvent,
  NodeState,
} from '../../../../src/shared/node'
import type {
  NodeAuthentication,
  NodeAuthChallenge,
  NodeSession,
  NodeStepUp,
} from '../../../../src/shared/nodeAuth'

export const nodeHash = 'a'.repeat(64)
export const nodeBearer = 'x'.repeat(43)
export function nodeConfig(): NodeConfig {
  return {
    v: 1,
    mode: 'home',
    label: 'Home',
    browserNames: ['home.local'],
    listener: null,
    workspaceRoot: '/workspaces',
    audit: { maxBytes: NODE_AUDIT_MAX_BYTES, retentionDays: NODE_AUDIT_RETENTION_DAYS },
  }
}
export function nodeSession(): NodeSession {
  return {
    v: 1,
    id: 'session-1',
    ownerId: 'owner',
    surface: 'web',
    createdAt: 0,
    lastSeenAt: 1,
    idleExpiresAt: NODE_SESSION_IDLE_MS,
    absoluteExpiresAt: NODE_SESSION_MAX_MS,
  }
}
export function nodeAuthentication(): NodeAuthentication {
  return { session: nodeSession(), bearer: nodeBearer }
}
export function nodeChallenge(): NodeAuthChallenge {
  return {
    v: 1,
    id: 'challenge-1',
    purpose: 'signin',
    challenge: nodeBearer,
    rpId: 'home.local',
    origin: 'https://home.local:7443',
    issuedAt: 0,
    expiresAt: 60_000,
  }
}
export function nodeStepUp(): NodeStepUp {
  return {
    id: 'proof-1',
    sessionId: 'session-1',
    action: 'terminal.open',
    actionDigest: nodeHash,
    verifiedAt: 0,
    expiresAt: 60_000,
  }
}
export function nodeAudit(): NodeAudit {
  return {
    v: 1,
    seq: 1,
    time: 0,
    nodeId: nodeHash,
    sessionId: 'session-1',
    previousHash: nodeHash,
    hash: nodeHash,
    outcome: 'allowed',
    kind: 'node',
    action: 'stop',
  }
}
export function nodeState(): NodeState {
  return {
    v: 1,
    nodeId: nodeHash,
    ownerId: 'owner',
    generation: 1,
    config: nodeConfig(),
    setup: { codeHash: nodeHash, issuedAt: 0, expiresAt: 60_000 },
    passkeys: [],
    workspaces: [],
    auditHead: { seq: 0, hash: nodeHash },
  }
}
export function nodeDashboard(): NodeDashboard {
  return {
    nodeId: nodeHash,
    version: '0.14.0',
    uptimeMs: 0,
    sandbox: 'shared',
    locked: false,
    keyStoreSealed: true,
    attendance: 'attended',
    sessions: [nodeSession()],
    pendingChallenges: 0,
    cpuPercent: 0,
    memory: { usedBytes: 1, totalBytes: 2 },
    disk: { freeBytes: 1, totalBytes: 2 },
    workspaces: [],
  }
}
export function nodeEvent(): NodeEvent {
  return { v: 1, seq: 1, time: 0, nodeId: nodeHash, type: 'stopped' }
}
