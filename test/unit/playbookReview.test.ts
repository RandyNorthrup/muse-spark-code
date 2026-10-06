import { describe, expect, it } from 'vitest'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { FAKE_PLAYBOOK_MODULE as MODULE } from './helpers/playbook/fakes'
import {
  answerAll,
  design,
  latestRound,
  policyFixture,
  REVIEW_AGENTS,
  reviewBlock,
} from './playbookPolicyFixture'

describe('M116 one-pass review', () => {
  it('does not count missing coverage and asks again for exactly the missing classes', () => {
    const { policy } = policyFixture()
    expect(
      policy.afterReview(MODULE, { ...reviewBlock(), coverage: ['concurrency'] }, REVIEW_AGENTS),
    ).toMatchObject({
      kind: 'refuse',
      note: {
        code: 'coverageIncomplete',
        classes: ['validation', 'security', 'failure', 'honesty', 'lifecycle', 'tests', 'docs'],
      },
    })
    expect(policy.getRecord().some((record) => record.kind === 'round')).toBe(false)
    expect(policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS).kind).toBe('allow')
    expect(latestRound(policy).round).toBe(1)
  })

  it('waits for every prior finding, rejects partial/duplicate/unknown answers, and persists all answers together', () => {
    const fixture = policyFixture()
    fixture.policy.afterReview(
      MODULE,
      {
        ...reviewBlock(),
        findings: [...reviewBlock().findings, { ...reviewBlock().findings[0]!, severity: 'P3' }],
      },
      REVIEW_AGENTS,
    )
    const answers = latestRound(fixture.policy).findings.map((finding) => ({
      findingId: finding.id,
      status: 'fixed' as const,
    }))
    expect(fixture.policy.beforeReview(MODULE, REVIEW_AGENTS).note.code).toBe('answersPending')
    for (const invalid of [
      answers.slice(0, 1),
      [answers[0]!, answers[0]!],
      [answers[0]!, { ...answers[1]!, findingId: 'unknown' }],
    ])
      expect(fixture.policy.answerFindings(MODULE, invalid).kind).toBe('refuse')
    expect(fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS).kind).toBe('refuse')
    expect(latestRound(fixture.policy).round).toBe(1)
    expect(fixture.policy.answerFindings(MODULE, answers).kind).toBe('allow')
    expect(new OrchestratorPlaybook(fixture.options).beforeReview(MODULE, REVIEW_AGENTS).kind).toBe(
      'allow',
    )
  })

  it.each(['agent', 'session'] as const)(
    'refuses a shared %s before and after review, independently of settings',
    (conflict) => {
      const { policy } = policyFixture()
      const settings = policy.getSettings()
      settings.rules.onePassReview = {
        enabled: false,
        actor: 'owner',
        at: 1,
        reason: 'Legacy review format.',
      }
      policy.updateSettings(settings)
      const agents =
        conflict === 'agent'
          ? { ...REVIEW_AGENTS, reviewerId: REVIEW_AGENTS.implementerId }
          : { ...REVIEW_AGENTS, reviewerSessionId: REVIEW_AGENTS.implementerSessionId }
      expect(policy.beforeReview(MODULE, agents).note.code).toBe('reviewerConflict')
      expect(policy.afterReview(MODULE, reviewBlock(), agents).kind).toBe('refuse')
      expect(policy.getRecord().some((record) => record.kind === 'round')).toBe(false)
    },
  )

  it.each(['P1', 'critical', 'unknown', ''] as const)(
    'treats %s as P1 and allows only a fix or trusted override',
    (severity) => {
      const fixture = policyFixture()
      fixture.policy.afterReview(MODULE, reviewBlock('security', severity), REVIEW_AGENTS)
      const finding = latestRound(fixture.policy).findings[0]!
      expect(finding.severity).toBe('P1')
      const disputed = {
        findingId: finding.id,
        status: 'disputed' as const,
        reason: 'The implementer disagrees.',
      }
      expect(fixture.policy.answerFindings(MODULE, [disputed]).kind).toBe('refuse')
      const override = {
        findingId: finding.id,
        status: 'override' as const,
        actor: 'lead' as const,
        reason: 'Explicit release exception.',
        at: 100,
      }
      expect(fixture.policy.answerFindings(MODULE, [override]).kind).toBe('refuse')
      fixture.authority.mockReturnValue(true)
      expect(fixture.policy.answerFindings(MODULE, [override]).kind).toBe('allow')
      expect(latestRound(new OrchestratorPlaybook(fixture.options)).answers).toEqual([override])
    },
  )

  it('allows a P2 named residual only with a redesign, and a P3 explained dispute', () => {
    const { policy } = policyFixture()
    policy.afterReview(MODULE, reviewBlock('concurrency', 'high'), REVIEW_AGENTS)
    const findingId = latestRound(policy).findings[0]!.id
    const residual = {
      findingId,
      status: 'residual' as const,
      name: 'atomic-claim-follow-up',
      whySafe: 'The caller currently serializes the claim.',
      followUp: 'Replace it in lane R.',
    }
    expect(
      policy.answerFindings(MODULE, [{ findingId, status: 'disputed', reason: 'Not accepted.' }])
        .kind,
    ).toBe('refuse')
    expect(policy.answerFindings(MODULE, [residual]).kind).toBe('refuse')
    policy.recordDesignDecision(design())
    expect(policy.answerFindings(MODULE, [residual]).kind).toBe('allow')
    expect(latestRound(policy).answers).toEqual([residual])
    const other = { ...MODULE, id: 'docs', key: 'docs', files: ['docs/guide.md'] }
    policy.afterReview(
      other,
      {
        findings: [{ file: 'docs/guide.md', title: 'Typo', severity: 'low' }],
        coverage: reviewBlock().coverage,
      },
      REVIEW_AGENTS,
    )
    expect(
      policy.answerFindings(other, [
        {
          findingId: latestRound(policy, other).findings[0]!.id,
          status: 'disputed',
          reason: 'The quoted text is intentional.',
        },
      ]).kind,
    ).toBe('allow')
  })

  it('persists trusted identities and strips raw review titles and detail', () => {
    const { policy } = policyFixture()
    policy.afterReview(
      MODULE,
      {
        ...reviewBlock(),
        findings: [
          {
            ...reviewBlock().findings[0]!,
            title: 'Never journal this title',
            detail: 'Never journal these file contents',
          },
        ],
      },
      REVIEW_AGENTS,
    )
    expect(latestRound(policy)).toMatchObject(REVIEW_AGENTS)
    expect(JSON.stringify(policy.getRecord())).not.toContain('Never journal')
    expect(answerAll(policy).kind).toBe('allow')
  })

  it('does not let disabled coverage waive P1/P2 dispositions or whitespace disguise a shared reviewer', () => {
    const { policy } = policyFixture()
    const settings = policy.getSettings()
    settings.rules.onePassReview = {
      enabled: false,
      actor: 'owner',
      reason: 'Legacy coverage format.',
      at: 100,
    }
    policy.updateSettings(settings)
    const agents = { ...REVIEW_AGENTS, reviewerId: ` ${REVIEW_AGENTS.implementerId} ` }
    expect(policy.beforeReview(MODULE, agents).kind).toBe('refuse')
    policy.afterReview(MODULE, reviewBlock('security', 'P1'), REVIEW_AGENTS)
    expect(policy.beforeReview(MODULE, REVIEW_AGENTS).note.code).toBe('answersPending')
  })
})
