import { describe, expect, it } from 'vitest'
import {
  isBindingCovered,
  evaluateVaultPolicy,
  isGrantCovered,
  vaultCommandDigest,
} from '../../../src/core/vault/broker/policy'
import { vaultUseDigest } from '../../../src/core/vault/useDigest'
import { type VaultBinding, type VaultUse } from '../../../src/shared/vault'
import { grant, metadata, requester, use } from '../helpers/vault/fixtures'

const taint = { tainted: false, reasons: [] }
function context() {
  const item = metadata(),
    who = requester(),
    actual = use(),
    standing = grant()
  standing.target = {
    kind: 'environment',
    commandDigest: vaultCommandDigest(actual.command),
    names: actual.names,
  }
  item.bindings = [standing.target]
  item.policy.mode = 'alwaysAllow'
  return { item, who, actual, standing }
}
describe('vault policy', () => {
  it('never and ceilings deny despite a standing grant', () => {
    const { item, who, actual, standing } = context()
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'none', 1, new Set())).toEqual(
      { kind: 'denied', reason: 'ceiling' },
    )
    expect(
      evaluateVaultPolicy(
        item,
        who,
        actual,
        taint,
        [standing],
        ['secret://different'],
        1,
        new Set(),
      ),
    ).toEqual({ kind: 'denied', reason: 'ceiling' })
    item.policy.mode = 'never'
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'policy',
    })
  })
  it('all modes preserve ask and exact session scope; Always requires a grant', () => {
    const { item, who, actual, standing } = context()
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()).kind,
    ).toBe('allow')
    expect(evaluateVaultPolicy(item, who, actual, taint, [], 'ask', 1, new Set()).kind).toBe('ask')
    item.policy.mode = 'askEveryTime'
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()).kind,
    ).toBe('ask')
    item.policy.mode = 'askOncePerSession'
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [], 'ask', 1, new Set([vaultUseDigest(actual)]))
        .kind,
    ).toBe('allow')
    who.sessionId = null
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [], 'ask', 1, new Set([vaultUseDigest(actual)]))
        .kind,
    ).toBe('ask')
  })
  it.each([
    'roles',
    'workspaces',
    'target',
    'maxUses',
    'expiresAt',
    'window',
    'sessionId',
    'taskId',
    'ceiling',
  ] as const)('enforces the grant %s scope', (field) => {
    const { item, who, actual, standing } = context()
    const now = new Date(2026, 9, 5, 12).getTime()
    expect(isGrantCovered(standing, item, who, actual, now)).toBe(true)
    switch (field) {
      case 'roles': {
        standing.roles = [{ kind: 'subagent' }]
        break
      }
      case 'workspaces': {
        standing.workspaces = ['other']
        break
      }
      case 'target': {
        standing.target = {
          kind: 'environment',
          commandDigest: '0'.repeat(64),
          names: actual.names,
        }
        break
      }
      case 'maxUses': {
        standing.uses = standing.maxUses!
        break
      }
      case 'expiresAt': {
        standing.expiresAt = now
        break
      }
      case 'window': {
        standing.window = { days: [new Date(now).getDay()], startHour: 0, endHour: 1 }
        break
      }
      case 'sessionId': {
        standing.sessionId = 'f'.repeat(32)
        break
      }
      case 'taskId': {
        standing.taskId = 'other'
        break
      }
      case 'ceiling': {
        standing.ceiling = 'none'
        break
      }
    }
    expect(isGrantCovered(standing, item, who, actual, now)).toBe(false)
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', now, new Set()).kind,
    ).toBe('ask')
  })
  it('item bindings refuse a widened environment target even when a grant exists', () => {
    const { item, who, actual, standing } = context()
    const widened = { ...actual, names: [...actual.names, 'OTHER'] }
    expect(evaluateVaultPolicy(item, who, widened, taint, [standing], 'ask', 1, new Set())).toEqual(
      { kind: 'denied', reason: 'scope' },
    )
  })
  it('taint forces an ask over Always and never inherits a session answer', () => {
    const { item, who, actual, standing } = context()
    expect(
      evaluateVaultPolicy(
        item,
        who,
        actual,
        { tainted: true, reasons: [{ source: 'web', label: 'page' }] },
        [standing],
        'ask',
        1,
        new Set([vaultUseDigest(actual)]),
      ).kind,
    ).toBe('ask')
  })
  it('unattended needs both flags and a matching grant; taint and presence fail closed', () => {
    const { item, who, actual, standing } = context()
    who.unattended = true
    item.policy.unattendedAllowed = true
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'unattended',
    })
    standing.unattendedAllowed = true
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()).kind,
    ).toBe('allow')
    expect(
      evaluateVaultPolicy(
        item,
        who,
        actual,
        { tainted: true, reasons: [] },
        [standing],
        'ask',
        1,
        new Set(),
      ),
    ).toEqual({ kind: 'denied', reason: 'tainted' })
    item.requirePresence = true
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'presence',
    })
  })
  it('disclosure is separately enabled and always asks', () => {
    const { item, who, standing } = context()
    const actual: VaultUse = { kind: 'disclosure', recipient: 'person' }
    item.bindings = [{ kind: 'disclosure', recipient: 'person' }]
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'disclosure',
    })
    item.policy.allowDisclosure = true
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()).kind,
    ).toBe('ask')
  })
  it('sudo bindings include exact executable argv cwd and sudo path', () => {
    const command = use().command
    const target: VaultBinding = {
      kind: 'sudo',
      command,
      commandDigest: vaultCommandDigest(command),
      sudoPath: '/usr/bin/sudo',
    }
    const actual: VaultUse = { kind: 'sudo', command, sudoPath: '/usr/bin/sudo' }
    expect(isBindingCovered(target, actual)).toBe(true)
    expect(isBindingCovered(target, { ...actual, sudoPath: '/tmp/sudo' })).toBe(false)
    expect(isBindingCovered(target, { ...actual, command: { ...command, argv: [] } })).toBe(false)
    expect(
      isBindingCovered(target, { ...actual, command: { ...command, cwd: '/elsewhere' } }),
    ).toBe(false)
  })
  it('SSH destination and forwarding and exact OAuth issuer/resource cannot widen', () => {
    const target: VaultBinding = {
      kind: 'ssh',
      host: 'host',
      hostKeyFingerprint: `SHA256:${'a'.repeat(43)}`,
      remoteUser: 'deploy',
      forwarding: false,
    }
    const actual: VaultUse = { ...target, sessionId: 'YQ==' }
    expect(isBindingCovered(target, actual)).toBe(true)
    expect(isBindingCovered(target, { ...actual, hostKeyFingerprint: null, sessionId: null })).toBe(
      false,
    )
    expect(isBindingCovered(target, { ...actual, forwarding: true })).toBe(false)
    const oauth: VaultBinding = {
      kind: 'oauth',
      origin: 'https://example.test',
      issuer: 'https://issuer.test/path',
      resource: 'https://example.test/resource',
    }
    expect(isBindingCovered(oauth, oauth)).toBe(true)
    expect(isBindingCovered(oauth, { ...oauth, issuer: `${oauth.issuer}/` })).toBe(false)
  })
  it('hidden first-party and expired items remain unavailable despite an Always grant', () => {
    const { item, who, actual, standing } = context()
    item.hidden = true
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'policy',
    })
    item.hidden = false
    item.firstParty = true
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'policy',
    })
    item.firstParty = false
    item.dates.expiresAt = 1
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'expired',
    })
  })
  it('hooks require a standing environment grant and never prompt; devices cannot receive environment material', () => {
    const { item, who, actual, standing } = context()
    who.role = { kind: 'hook', name: 'check' }
    standing.roles = [who.role]
    expect(evaluateVaultPolicy(item, who, actual, taint, [], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'policy',
    })
    expect(
      evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()).kind,
    ).toBe('allow')
    const hookTaint = { tainted: true, reasons: [] }
    expect(
      evaluateVaultPolicy(item, who, actual, hookTaint, [standing], 'ask', 1, new Set()),
    ).toEqual({ kind: 'denied', reason: 'tainted' })
    who.role = { kind: 'orchestrator' }
    who.deviceId = 'device'
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'remoteUse',
    })
    who.deviceId = null
    who.unattended = true
    standing.roles = [who.role]
    standing.unattendedAllowed = true
    expect(evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set())).toEqual({
      kind: 'denied',
      reason: 'unattended',
    })
  })
  it('grant item identity and local day and hour bounds narrow access', () => {
    const { item, who, actual, standing } = context()
    const local = new Date(2026, 9, 5, 12),
      now = local.getTime()
    standing.itemId = 'other'
    expect(isGrantCovered(standing, item, who, actual, now)).toBe(false)
    standing.itemId = item.id
    standing.window = { days: [local.getDay()], startHour: 12, endHour: 13 }
    expect(isGrantCovered(standing, item, who, actual, now)).toBe(true)
    standing.window.startHour = 13
    expect(isGrantCovered(standing, item, who, actual, now)).toBe(false)
    standing.window.startHour = 0
    standing.window.days = []
    expect(isGrantCovered(standing, item, who, actual, now)).toBe(false)
  })
  it('MCP server names, git paths, origins and command input bindings stay exact', () => {
    const command = use().command,
      commandDigest = vaultCommandDigest(command)
    const mcp: VaultBinding = { kind: 'mcp', server: 'one', commandDigest, names: ['TOKEN'] }
    const mcpUse: VaultUse = { kind: 'mcp', server: 'one', command, names: ['TOKEN'] }
    expect(isBindingCovered(mcp, mcpUse)).toBe(true)
    expect(isBindingCovered(mcp, { ...mcpUse, server: 'two' })).toBe(false)
    const git: VaultBinding = { kind: 'git', protocol: 'https', host: 'example.test', path: 'one' }
    expect(isBindingCovered(git, { ...git, command })).toBe(true)
    expect(isBindingCovered(git, { ...git, path: 'two', command })).toBe(false)
    const origin: VaultBinding = { kind: 'origin', origin: 'https://example.test' }
    expect(
      isBindingCovered(origin, {
        kind: 'header',
        origin: origin.origin,
        headerName: 'Authorization',
      }),
    ).toBe(true)
    expect(
      isBindingCovered(origin, {
        kind: 'header',
        origin: 'https://other.test',
        headerName: 'Authorization',
      }),
    ).toBe(false)
    expect(isBindingCovered({ kind: 'stdin', commandDigest }, { kind: 'stdin', command })).toBe(
      true,
    )
    expect(isBindingCovered({ kind: 'totp', commandDigest }, { kind: 'totp', command })).toBe(true)
  })
})
