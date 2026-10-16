// RVCM1091D P3 (mounted frames): the harness draws every vault state the
// lane added, and the locked frame is a real locked snapshot. The browser
// run itself (run-mounted.mjs) stays reviewer-run; this pins the fixture
// shapes it paints and keeps its scene and theme lists in sync.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { vaultPanelStateSchema } from '../../../src/shared/vaultPanel'
import { VAULT_MOUNTED_SCENARIOS, vaultScenarioState } from '../../harness/vault/scenarios'

describe('RVCM1091D mounted vault scenes', () => {
  it('covers the states the lane added, and the locked frame holds no items', () => {
    expect([...VAULT_MOUNTED_SCENARIOS]).toEqual([
      'mounted',
      'mounted-locked',
      'mounted-connecting',
      'mounted-uncreated',
      'mounted-setup-pending',
      'mounted-unavailable',
      'mounted-unreachable',
      'mounted-busy',
      'mounted-transient-timeout',
      'mounted-watch-lost',
      'mounted-first-party-only',
    ])
    for (const scenario of VAULT_MOUNTED_SCENARIOS) {
      const state = vaultScenarioState(scenario, 1000)
      if (scenario === 'mounted-connecting') {
        expect(state).toBeUndefined()
        continue
      }
      // Every painted frame is a shape the host could really publish.
      expect(vaultPanelStateSchema.safeParse(state).success).toBe(true)
    }
    const locked = vaultScenarioState('mounted-locked', 1000)
    expect(locked?.status).toMatchObject({
      state: 'locked',
      tier: null,
      provider: null,
      itemCount: 0,
      reason: 'locked',
    })
    expect(locked?.items).toEqual([])
  })

  it('the added states match the snapshots the management side serves', () => {
    expect(vaultScenarioState('mounted-uncreated', 1000)?.status).toMatchObject({
      state: 'uncreated',
      reason: 'locked',
    })
    expect(vaultScenarioState('mounted-setup-pending', 1000)?.status).toMatchObject({
      state: 'setupPending',
    })
    expect(vaultScenarioState('mounted-unavailable', 1000)?.status).toMatchObject({
      state: 'unavailable',
      reason: 'vaultLost',
    })
    // RVCM1091G: the host's no-snapshot state is unavailable with the
    // operation-failed sentence and the person's own Retry, never the
    // repair message, never Reset, and no item labels.
    expect(vaultScenarioState('mounted-unreachable', 1000)?.status).toMatchObject({
      state: 'unavailable',
      reason: 'unreachable',
      tier: null,
      provider: null,
      itemCount: 0,
    })
    // RVCM1091G: the transient scenes carry their own true reason, each
    // with the person's own Retry.
    expect(vaultScenarioState('mounted-busy', 1000)?.status).toMatchObject({
      state: 'unavailable',
      reason: 'busy',
    })
    expect(vaultScenarioState('mounted-transient-timeout', 1000)?.status).toMatchObject({
      state: 'unavailable',
      reason: 'timeout',
    })
    expect(vaultScenarioState('mounted-watch-lost', 1000)?.status).toMatchObject({
      state: 'unavailable',
      reason: 'watchLost',
    })
    expect(vaultScenarioState('mounted-first-party-only', 1000)?.status).toMatchObject({
      state: 'firstPartyOnly',
      reason: 'brokerBlocked',
    })
    for (const scenario of [
      'mounted-uncreated',
      'mounted-setup-pending',
      'mounted-unavailable',
      'mounted-unreachable',
      'mounted-busy',
      'mounted-transient-timeout',
      'mounted-watch-lost',
      'mounted-first-party-only',
    ] as const) {
      expect(vaultScenarioState(scenario, 1000)?.items).toEqual([])
    }
  })

  it('the runner paints every scenario across all six theme files', () => {
    const runner = readFileSync('test/harness/vault/run-mounted.mjs', 'utf8')
    for (const scenario of VAULT_MOUNTED_SCENARIOS) {
      expect(runner).toContain(`'${scenario}'`)
    }
    for (const theme of ['light', 'dark', 'hc-light', 'hc-dark', 'dracula', 'one-dark-pro']) {
      expect(runner).toContain(`'${theme}'`)
      expect(() => readFileSync(`test/harness/themes/${theme}.json`, 'utf8')).not.toThrow()
    }
  })
})
