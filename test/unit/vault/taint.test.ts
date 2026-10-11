import { describe, expect, it, onTestFinished } from 'vitest'
import {
  VaultTaintSession,
  combineVaultTaint,
  vaultProvenance,
} from '../../../src/core/vault/taint'
import { brokerFixture } from './brokerFixture'
import { VAULT_LIMITS } from '../../../src/shared/constants'
import { use } from '../helpers/vault/fixtures'

describe('vault taint', () => {
  it.each(['web', 'search', 'browser', 'mcp', 'issue', 'pullRequest', 'agent', 'device'] as const)(
    'forces an ask after %s despite an Always grant and denies unattended use',
    async (source) => {
      const fixture = await brokerFixture()
      onTestFinished(() => fixture.broker.dispose())
      await fixture.change({
        policy: { ...fixture.stored.metadata.policy, mode: 'alwaysAllow', unattendedAllowed: true },
      })
      fixture.standing().unattendedAllowed = true
      const session = new VaultTaintSession('modelApi')
      const taint = session.beginRequest([vaultProvenance(source, 'outside.example')], true)
      const allowed = await fixture.broker.request(
        fixture.identity,
        fixture.stored.metadata.handle,
        use(),
        taint,
      )
      expect(allowed.kind).toBe('approval')
      if (allowed.kind !== 'approval') throw new Error('expected forced approval')
      expect(allowed.request.taint.reasons).toEqual([{ source, label: 'outside.example' }])
      await fixture.broker.endRequester(fixture.identity.id)
      fixture.identity.unattended = true
      fixture.identity.source = 'headless'
      await fixture.broker.register(fixture.peer, fixture.identity, 'ask')
      expect(
        await fixture.broker.request(
          fixture.identity,
          fixture.stored.metadata.handle,
          use(),
          taint,
        ),
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
