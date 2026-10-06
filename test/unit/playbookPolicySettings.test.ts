import { describe, expect, it } from 'vitest'
import { PLAYBOOK_CONFIGURABLE_RULES } from '../../src/shared/constants'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import {
  FAKE_PLAYBOOK_MODULE as MODULE,
  FakePlaybookBoard,
  fakePlaybookLanes,
} from './helpers/playbook/fakes'
import { policyFixture, REVIEW_AGENTS, reviewBlock, strike } from './playbookPolicyFixture'

describe('M116 settings policy', () => {
  it('ignores a forged opt-out actor and requires the real user authority', () => {
    const fixture = policyFixture()
    strike(fixture.policy)
    const settings = fixture.policy.getSettings()
    settings.rules.threeStrikes = {
      enabled: false,
      actor: 'owner',
      reason: 'Forged consent.',
      at: 100,
    }
    expect(fixture.policy.updateSettings(settings)).toMatchObject({
      kind: 'refuse',
      note: { needsUser: true },
    })
    expect(fixture.authority).toHaveBeenCalledOnce()
    const restarted = new OrchestratorPlaybook(fixture.options)
    expect(restarted.beforeFixRound(MODULE).kind).toBe('refuse')
    fixture.authority.mockReturnValue(true)
    settings.rules.threeStrikes = {
      enabled: false,
      actor: 'agent-claim',
      reason: 'User consent.',
      at: 1,
    }
    expect(restarted.updateSettings(settings).kind).toBe('allow')
    expect(new OrchestratorPlaybook(fixture.options).getSettings().rules.threeStrikes).toEqual({
      enabled: false,
      actor: 'owner',
      reason: 'User consent.',
      at: 100,
    })
  })

  it('defaults on, persists team-local reasons, and refuses foreign or malformed settings', () => {
    const fixture = policyFixture()
    fixture.authority.mockReturnValue(true)
    expect(Object.values(fixture.policy.getSettings().rules).every((rule) => rule.enabled)).toBe(
      true,
    )
    for (const rule of PLAYBOOK_CONFIGURABLE_RULES) {
      const settings = fixture.policy.getSettings()
      settings.rules[rule] = {
        enabled: false,
        actor: 'owner',
        reason: 'A documented team exception.',
        at: 100,
      }
      expect(fixture.policy.updateSettings(settings).kind).toBe('allow')
    }
    expect(new OrchestratorPlaybook(fixture.options).getSettings()).toEqual(
      fixture.policy.getSettings(),
    )
    expect(
      new OrchestratorPlaybook({ ...fixture.options, teamId: 'other' }).getSettings().rules
        .threeStrikes.enabled,
    ).toBe(true)
    expect(() =>
      fixture.policy.updateSettings({ ...fixture.policy.getSettings(), teamId: 'other' }),
    ).toThrow()
    expect(() =>
      fixture.policy.updateSettings({ ...fixture.policy.getSettings(), patchRoundsMax: 3 }),
    ).toThrow()
    const settings = fixture.policy.getSettings()
    settings.rules.threeStrikes = { enabled: false, actor: 'owner', reason: ' ', at: 100 }
    expect(() => fixture.policy.updateSettings(settings)).toThrow()
  })

  it('can lower the patch limit or audit disabled policy without disabling safety', () => {
    const fixture = policyFixture()
    fixture.authority.mockReturnValue(true)
    const settings = fixture.policy.getSettings()
    settings.patchRoundsMax = 1
    fixture.policy.updateSettings(settings)
    fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS)
    const round = fixture.policy
      .getRecord()
      .findLast((record) => record.kind === 'round' && record.value.class === undefined)!
    if (round.kind !== 'round') throw new Error('Expected round')
    fixture.policy.answerFindings(
      MODULE,
      round.value.findings.map((finding) => ({ findingId: finding.id, status: 'fixed' })),
    )
    fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS)
    expect(fixture.policy.beforeFixRound(MODULE).kind).toBe('refuse')
    const disabled = fixture.policy.getSettings()
    disabled.rules.threeStrikes = {
      enabled: false,
      actor: 'owner',
      at: 100,
      reason: 'Temporary migration.',
    }
    fixture.policy.updateSettings(disabled)
    expect(fixture.policy.beforeFixRound(MODULE)).toMatchObject({
      kind: 'allow',
      note: { code: 'ruleDisabled', actor: 'owner', reason: 'Temporary migration.' },
    })
    expect(
      fixture.policy.beforeCommand(
        { kind: 'shell', effect: 'commit', subject: 'repo', command: 'git commit --no-verify' },
        { agentId: 'lead', teamId: 'panel' },
      ).kind,
    ).toBe('refuse')
  })

  it('honors configurable contracts, coverage, ordering, offload, drills, integration and loud-first rules', () => {
    const { policy, authority } = policyFixture()
    authority.mockReturnValue(true)
    const settings = policy.getSettings()
    for (const rule of PLAYBOOK_CONFIGURABLE_RULES)
      settings.rules[rule] = {
        enabled: false,
        actor: 'owner',
        reason: 'A documented exception.',
        at: 100,
      }
    policy.updateSettings(settings)
    const lanes = fakePlaybookLanes()
    const board = new FakePlaybookBoard().readBoard()
    expect(policy.beforeDispatch(lanes[0]!, board).kind).toBe('allow')
    expect(policy.afterReview(MODULE, { findings: [] }, REVIEW_AGENTS).kind).toBe('allow')
    expect(policy.beforeMerge(lanes[0]!).kind).toBe('allow')
    expect(policy.order(lanes)).toMatchObject({ queue: lanes, notes: [{ code: 'ruleDisabled' }] })
    expect(policy.beforeCheck({ id: 'heavy', heavy: true, fullGate: true }, board)).toMatchObject({
      target: { kind: 'local' },
      note: { code: 'ruleDisabled' },
    })
    const items = [
      { id: 'progress', needsUser: false, failing: false },
      { id: 'owner', needsUser: true, failing: true },
    ]
    expect(policy.orderReport(items)).toMatchObject({ items, note: { code: 'ruleDisabled' } })
  })

  it('keeps raised limits invalid even with three-strikes off and leaves counters intact on toggles', () => {
    const { policy, authority } = policyFixture()
    authority.mockReturnValue(true)
    strike(policy)
    const settings = policy.getSettings()
    settings.rules.threeStrikes = {
      enabled: false,
      actor: 'owner',
      reason: 'Temporary exception.',
      at: 100,
    }
    expect(() => policy.updateSettings({ ...settings, patchRoundsMax: 3 })).toThrow()
    policy.updateSettings(settings)
    expect(policy.beforeFixRound(MODULE).kind).toBe('allow')
    settings.rules.threeStrikes = { enabled: true }
    policy.updateSettings(settings)
    expect(policy.beforeFixRound(MODULE).kind).toBe('refuse')
  })

  it('retains every opt-out reason, actor and time after the rule is turned back on', () => {
    const fixture = policyFixture()
    fixture.authority.mockReturnValue(true)
    const settings = fixture.policy.getSettings()
    settings.rules.threeStrikes = {
      enabled: false,
      actor: 'owner',
      reason: 'A recorded migration exception.',
      at: 100,
    }
    fixture.policy.updateSettings(settings)
    settings.rules.threeStrikes = { enabled: true }
    fixture.policy.updateSettings(settings)
    const policy = new OrchestratorPlaybook(fixture.options)
    expect(policy.getSettings().rules.threeStrikes.enabled).toBe(true)
    expect(policy.getRecord().filter((record) => record.kind === 'settings')).toContainEqual(
      expect.objectContaining({
        value: expect.objectContaining({
          rules: expect.objectContaining({
            threeStrikes: {
              enabled: false,
              actor: 'owner',
              reason: 'A recorded migration exception.',
              at: 100,
            },
          }),
        }),
      }),
    )
  })
})
