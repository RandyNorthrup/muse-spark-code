import { describe, expect, it } from 'vitest'
import { vaultExecEnvelopeDigest } from '../../../src/core/vault/exec/envelopeDigest'
import {
  vaultExecEnvelopeSchema,
  type VaultExecEnvelope,
} from '../../../src/core/vault/exec/schema'

// D216: the delegation binds pid + start time + this digest, computed
// by the host before spawn and by the feeder from the pipe bytes. The
// two computations must agree across a JSON round trip with shuffled
// key order, and must separate different commands.

const envelope = (argv: readonly string[]): VaultExecEnvelope => ({
  run: {
    command: { executable: '/bin/sh', argv: [...argv], cwd: '/work' },
    secrets: { env: { B_NAME: 'secret://service-key', A_NAME: 'secret://service-key' } },
  },
  approvals: [
    {
      ticket: {
        id: 'a'.repeat(32),
        requestId: 'b'.repeat(32),
        requesterId: 'c'.repeat(32),
        itemId: 'd'.repeat(32),
        digest: 'e'.repeat(64),
        nonce: 'f'.repeat(32),
        issuedAt: 1,
        expiresAt: null,
        lockEpoch: 0,
        maxUses: 1,
      },
      use: {
        kind: 'environment',
        command: { executable: '/bin/sh', argv: [...argv], cwd: '/work' },
        names: ['A_NAME', 'B_NAME'],
      },
    },
  ],
})

describe('vault exec envelope digest (D216)', () => {
  it('agrees across the host-to-feeder JSON round trip', () => {
    const host = envelope(['-c', 'true'])
    const bytes = JSON.stringify(vaultExecEnvelopeSchema.parse(host))
    const feeder = vaultExecEnvelopeSchema.parse(JSON.parse(bytes))
    expect(vaultExecEnvelopeDigest(feeder)).toBe(vaultExecEnvelopeDigest(host))
    expect(vaultExecEnvelopeDigest(host)).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('separates different commands and env name sets', () => {
    const base = vaultExecEnvelopeDigest(envelope(['-c', 'true']))
    expect(vaultExecEnvelopeDigest(envelope(['-c', 'false']))).not.toBe(base)
    const fewer = envelope(['-c', 'true'])
    if (fewer.run.secrets.env) delete fewer.run.secrets.env['A_NAME']
    expect(vaultExecEnvelopeDigest(fewer)).not.toBe(base)
  })
})
