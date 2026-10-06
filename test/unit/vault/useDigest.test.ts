import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { canonicalVaultUse, vaultUseDigest } from '../../../src/core/vault/useDigest'
import { vaultUseSchema, type VaultUse } from '../../../src/shared/vault'
import { use } from '../helpers/vault/fixtures'

describe('canonical vault uses', () => {
  it('is insertion-order independent, SHA-256 and does not mutate its input', () => {
    const a = use()
    a.names = ['Z_VALUE', 'A_VALUE']
    const b = {
      names: ['A_VALUE', 'Z_VALUE'],
      command: { cwd: a.command.cwd, argv: a.command.argv, executable: a.command.executable },
      kind: a.kind,
    }
    const before = structuredClone(a)
    expect(vaultUseDigest(a)).toBe(vaultUseDigest(b))
    expect(a).toEqual(before)
    expect(vaultUseDigest(a)).toBe(createHash('sha256').update(canonicalVaultUse(a)).digest('hex'))
    expect(canonicalVaultUse(a)).toBe(
      '{"use":{"command":{"argv":["--check"],"cwd":"/workspace","executable":"/usr/bin/tool"},"kind":"environment","names":["A_VALUE","Z_VALUE"]},"v":1}',
    )
  })
  it('V2 V11 V15 binds every command, cwd, sudo path and environment field', () => {
    const base = use()
    const changes: VaultUse[] = [
      { ...base, command: { ...base.command, executable: '/other/tool' } },
      { ...base, command: { ...base.command, argv: ['--other'] } },
      { ...base, command: { ...base.command, cwd: '/other' } },
      { ...base, names: ['OTHER_TOKEN'] },
      { ...base, command: { ...base.command, argv: ['a', 'b'] } },
      { ...base, command: { ...base.command, argv: ['b', 'a'] } },
    ]
    const digests = new Set([
      vaultUseDigest(base),
      ...changes.map((change) => vaultUseDigest(change)),
    ])
    expect(digests.size).toBe(changes.length + 1)
    const sudo: VaultUse = { kind: 'sudo', command: base.command, sudoPath: '/usr/bin/sudo' }
    expect(vaultUseDigest(sudo)).not.toBe(vaultUseDigest({ ...sudo, sudoPath: '/malicious/sudo' }))
    expect(vaultUseDigest(sudo)).not.toBe(vaultUseDigest({ ...sudo, kind: 'askpass' }))
  })
  it('V13 binds the SSH destination, host key, user, session and forwarding', () => {
    const base: VaultUse = {
      kind: 'ssh',
      host: 'example.test',
      hostKeyFingerprint: `SHA256:${'A'.repeat(43)}`,
      remoteUser: 'deploy',
      sessionId: 'YWJj',
      forwarding: false,
    }
    for (const changed of [
      { ...base, host: 'other.test' },
      { ...base, hostKeyFingerprint: `SHA256:${'B'.repeat(43)}` },
      { ...base, remoteUser: 'root' },
      { ...base, sessionId: 'ZGVm' },
      { ...base, forwarding: true },
    ])
      expect(vaultUseDigest(base)).not.toBe(vaultUseDigest(changed))
    expect(vaultUseSchema.safeParse({ ...base, sessionId: null }).success).toBe(false)
    expect(vaultUseSchema.safeParse({ ...base, hostKeyFingerprint: null }).success).toBe(false)
    expect(
      vaultUseSchema.safeParse({ ...base, sessionId: null, hostKeyFingerprint: null }).success,
    ).toBe(true)
  })
  it('V14 binds browser, frame, origin and field', () => {
    const base: VaultUse = {
      kind: 'fill',
      origin: 'https://example.test',
      topOrigin: 'https://example.test',
      frameOrigin: 'https://example.test',
      frameId: 'frame',
      browserId: 'a'.repeat(32),
      certificateValid: true,
      field: 'password',
    }
    for (const changed of [
      { ...base, frameId: 'other' },
      { ...base, browserId: 'b'.repeat(32) },
      { ...base, field: 'totp' },
      {
        ...base,
        origin: 'https://other.test',
        topOrigin: 'https://other.test',
        frameOrigin: 'https://other.test',
      },
    ])
      expect(vaultUseDigest(base)).not.toBe(vaultUseDigest(vaultUseSchema.parse(changed)))
  })
  it('rejects unvalidated uses before hashing them', () => {
    const invalid = { ...use(), command: { ...use().command, cwd: '.' } }
    expect(() => canonicalVaultUse(invalid)).toThrow()
  })
  it('RVM109L0 P2 issuer: OAuth digests distinguish tenants and exact issuer spellings', () => {
    const oauth: Extract<VaultUse, { kind: 'oauth' }> = {
      kind: 'oauth',
      origin: 'https://mcp.example.test',
      issuer: 'https://auth.example.test/realms/team',
      resource: 'https://mcp.example.test/server',
    }
    const issuers = [
      oauth.issuer,
      'https://auth.example.test/realms/other',
      'https://auth.example.test/realms/team/',
      'https://auth.example.test/realms/%74eam',
      'https://AUTH.example.test/realms/team',
      'https://auth.example.test:443/realms/team',
      'https://auth.example.test',
      'https://auth.example.test/',
    ]
    expect(new Set(issuers.map((issuer) => vaultUseDigest({ ...oauth, issuer }))).size).toBe(
      issuers.length,
    )
  })
  it('covers all brokered routes with different digest domains', () => {
    const command = use().command
    const routes: VaultUse[] = [
      { kind: 'stdin', command },
      { kind: 'totp', command },
      { kind: 'mcp', command, server: 'server', names: ['TOKEN'] },
      { kind: 'git', command, protocol: 'https', host: 'example.test', path: 'owner/repo' },
      { kind: 'header', origin: 'https://example.test', headerName: 'Authorization' },
      {
        kind: 'oauth',
        origin: 'https://example.test',
        issuer: 'https://issuer.test',
        resource: 'https://example.test/mcp',
      },
      { kind: 'session', origin: 'https://example.test', browserId: 'a'.repeat(32) },
      { kind: 'disclosure', recipient: 'model/provider' },
      {
        kind: 'sshSign',
        namespace: 'git',
        keyFingerprint: `SHA256:${'A'.repeat(43)}`,
        dataDigest: 'a'.repeat(64),
      },
    ]
    expect(new Set(routes.map((route) => vaultUseDigest(route))).size).toBe(routes.length)
  })
})
