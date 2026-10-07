import { describe, expect, it } from 'vitest'
import {
  VaultTaintSession,
  combineVaultTaint,
  vaultProvenance,
} from '../../../src/core/vault/taint'
import { evaluateVaultPolicy, vaultCommandDigest } from '../../../src/core/vault/broker/policy'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { grant, metadata, requester, use } from '../helpers/vault/fixtures'

describe('vault taint', () => {
  it.each(['web', 'search', 'browser', 'mcp', 'issue', 'pullRequest', 'agent', 'device'] as const)(
    'forces an ask after %s despite an Always grant and denies unattended use',
    (source) => {
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
      item.policy.unattendedAllowed = true
      standing.unattendedAllowed = true
      const session = new VaultTaintSession('modelApi')
      const taint = session.beginRequest([vaultProvenance(source, 'outside.example')], true)
      expect(
        evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()),
      ).toEqual({ kind: 'ask' })
      expect(taint.reasons).toEqual([{ source, label: 'outside.example' }])
      who.unattended = true
      who.source = 'headless'
      expect(
        evaluateVaultPolicy(item, who, actual, taint, [standing], 'ask', 1, new Set()),
      ).toEqual({ kind: 'denied', reason: 'tainted' })
    },
  )
  it('tracks actual Model API context and propagates summaries without poisoning an independent request', () => {
    const session = new VaultTaintSession('modelApi')
    session.beginRequest([vaultProvenance('web', 'page')], true)
    const summary = session.derived()
    expect(session.beginRequest([summary], true).tainted).toBe(true)
    expect(session.beginRequest([], true)).toEqual({ tainted: false, reasons: [] })
  })
  it('keeps Muse Code taint through later requests and refuses mutation of snapshots', () => {
    const session = new VaultTaintSession('museCode')
    const page = vaultProvenance('mcp', 'foreign server')
    session.observe(page)
    page.reasons.length = 0
    const snapshot = session.beginRequest([], true)
    snapshot.tainted = false
    snapshot.reasons.length = 0
    expect(session.beginRequest([], true)).toEqual(vaultProvenance('mcp', 'foreign server'))
    expect(new VaultTaintSession('museCode').current().tainted).toBe(false)
  })
  it('Restricted Mode taints either backend, and Muse Code retains it after trust changes', () => {
    for (const backend of ['museCode', 'modelApi'] as const) {
      const session = new VaultTaintSession(backend)
      expect(session.beginRequest([], false)).toEqual(
        vaultProvenance('restrictedWorkspace', 'workspace'),
      )
      expect(session.beginRequest([], true).tainted).toBe(backend === 'museCode')
    }
  })
  it('bounds and deduplicates reasons without clearing taint, including unspecified provenance', () => {
    const contexts = Array.from({ length: VAULT_LIMITS.reasons + 1 }, (_, at) =>
      vaultProvenance('web', String(at)),
    )
    expect(
      combineVaultTaint([...contexts, contexts[0] ?? vaultProvenance('web', 'fallback')]).reasons,
    ).toHaveLength(VAULT_LIMITS.reasons)
    expect(combineVaultTaint([{ tainted: true, reasons: [] }]).tainted).toBe(true)
    expect(() =>
      combineVaultTaint([{ tainted: false, reasons: [{ source: 'web', label: 'forged' }] }]),
    ).toThrow()
  })
})
