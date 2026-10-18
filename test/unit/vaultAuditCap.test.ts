// The audit consumer contract: terminal, ACP and panel views carry at most
// VAULT_LIMITS.items records, so the paged client keeps the newest ones.
// Records are built through the real audit schema, so a shape drift fails
// here instead of silently testing malformed rows.
import { describe, expect, it } from 'vitest'
import { capAuditRecords } from '../../src/core/vault/broker/manageClient'
import { VAULT_LIMITS } from '../../src/shared/constants'
import { vaultAuditRecordSchema, type VaultAuditRecord } from '../../src/shared/vault'

function record(generation: number): VaultAuditRecord {
  return vaultAuditRecordSchema.parse({
    v: 1,
    id: generation.toString(16).padStart(32, '0'),
    generation,
    time: generation,
    requester: {
      id: '1'.repeat(32),
      hostId: '2'.repeat(32),
      conversationId: null,
      taskId: null,
      role: { kind: 'orchestrator' },
      workspaceId: null,
      deviceId: null,
      peerProcessId: 1,
      sessionId: null,
      unattended: false,
      source: 'conversation',
    },
    handle: 'secret://item',
    kind: 'session',
    target: 'item',
    digest: '3'.repeat(64),
    decision: 'allow',
    authority: 'user',
    grantId: null,
    outcome: 'succeeded',
    previousHash: '4'.repeat(64),
    hash: '5'.repeat(64),
    mac: '6'.repeat(64),
  })
}

function generations(count: number): VaultAuditRecord[] {
  return Array.from({ length: count }, (_, index) => record(index))
}

describe('audit consumer cap', () => {
  it('passes a short log through untouched', () => {
    const records = generations(3)
    expect(capAuditRecords(records)).toBe(records)
  })
  it('keeps the newest records once the log outgrows the consumer cap', () => {
    const capped = capAuditRecords(generations(VAULT_LIMITS.items + 2))
    expect(capped).toHaveLength(VAULT_LIMITS.items)
    expect(capped[0]?.generation).toBe(2)
    expect(capped.at(-1)?.generation).toBe(VAULT_LIMITS.items + 1)
  })
})
