import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { onTestFinished, describe, expect, it, vi } from 'vitest'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { PlaybookIntegration } from '../../src/core/orchestration/playbookIntegration'
import { collectResidualRegister } from '../../src/core/orchestration/playbookReports'
import { renderPlaybookBrief } from '../../src/core/orchestration/playbookBrief'
import { withoutCredentials } from '../../src/core/credentialEnvironment'
import {
  FAKE_PLAYBOOK_MODULE as MODULE,
  FakePlaybookBoard,
  fakePlaybookLanes,
} from './helpers/playbook/fakes'
import {
  completeReview,
  design,
  latestRound,
  policyFixture,
  REVIEW_AGENTS,
  reviewBlock,
} from './playbookPolicyFixture'
import {
  changedPlaybookSettings,
  parsePlaybookCommand,
  runPlaybookCommand,
} from '../../src/runtime/playbook/command'
import { playbookRecordText, playbookText } from '../../src/runtime/playbook/text'
import type { PlaybookBrief } from '../../src/shared/playbook'

const BRIEF: PlaybookBrief = {
  objective: 'Dispatch lane W',
  scope: ['wiring, docs and gates'],
  acceptance: ['full gate green'],
  baseCommit: '8c6351d73',
}

function events() {
  return {
    note: vi.fn(),
    offerRedesign: vi.fn(),
    hookOutput: vi.fn(),
    failure: vi.fn(),
  }
}

describe('M116 D100 amendments (W)', () => {
  it('G3 renders briefs structurally: placeholders refuse, `#` text passes, hashes record', () => {
    const rendered = renderPlaybookBrief({
      ...BRIEF,
      scope: ['wire #116 and the 50% diet'],
    })
    expect(rendered.baseCommit).toBe('8c6351d73')
    expect(rendered.sha256).toMatch(/^[a-f\d]{64}$/u)
    expect(renderPlaybookBrief({ ...BRIEF, scope: ['wire #116 and the 50% diet'] }).sha256).toBe(
      rendered.sha256,
    )
    expect(renderPlaybookBrief(BRIEF).sha256).not.toBe(rendered.sha256)
    expect(() =>
      renderPlaybookBrief({ ...BRIEF, scope: ['wire {{scope}} and {{acceptance}}'] }),
    ).toThrow()
    expect(() => renderPlaybookBrief({ ...BRIEF, acceptance: [] })).toThrow()
  })

  it('G3 records the brief hash before dispatch and reuses an unchanged brief', () => {
    const fixture = policyFixture()
    const { policy } = fixture
    policy.declareModule(MODULE)
    const first = policy.recordBrief(MODULE, BRIEF)
    if (first.kind !== 'allow') throw new Error('Expected brief admission')
    expect(first.note.code).toBe('briefRecorded')
    const second = policy.recordBrief(MODULE, BRIEF)
    expect(second.kind).toBe('allow')
    const notes = policy
      .getRecord()
      .filter((record) => record.kind === 'note' && record.value.code === 'briefRecorded')
    expect(notes).toHaveLength(1)
    expect(first.note.reason).toContain('8c6351d73')
    expect(() => policy.recordBrief(MODULE, { ...BRIEF, scope: ['{{scope}}'] })).toThrow()
  })

  it('G3 integration start fails a bad brief before any lease is granted', () => {
    const fixture = policyFixture()
    const board = new FakePlaybookBoard()
    const integration = new PlaybookIntegration(fixture.policy, board, events())
    const work = {
      id: 'w',
      module: MODULE,
      refs: [],
      requester: { agentId: 'a', teamId: 'panel' },
      brief: { ...BRIEF, scope: ['{{scope}}'] },
      commands: [],
    }
    expect(() => integration.start(work)).toThrow()
    expect(fixture.policy.getRecord().some((record) => record.kind === 'lease')).toBe(false)
  })

  it('G17 stores the shared-config snapshot at dispatch and reports drift by name', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'm116w-drift-'))
    onTestFinished(() => {
      rmSync(directory, { recursive: true, force: true })
    })
    const env = {
      ...withoutCredentials(process.env),
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
    }
    const git = (args: string[]) =>
      execFileSync('git', args, { cwd: directory, env, stdio: 'pipe' })
    git(['init', '--initial-branch=main'])
    git(['config', 'commit.gpgsign', 'false'])
    writeFileSync(path.join(directory, 'file.txt'), 'baseline\n')
    git(['add', 'file.txt'])
    git(['commit', '-m', 'baseline'])
    const fixture = policyFixture(directory)
    const { policy } = fixture
    policy.declareModule(MODULE)
    const workId = policy.beginWork(MODULE, ['refs/heads/main'])
    const stored = policy
      .getRecord()
      .find((record) => record.kind === 'work' && record.value.id === workId)
    if (stored?.kind !== 'work') throw new Error('Expected stored work')
    expect(Array.isArray(stored.value.config?.files)).toBe(true)
    writeFileSync(path.join(directory, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n')
    const verified = policy.verifyWork(workId)
    expect(verified.decision.kind).toBe('refuse')
    const drift = policy
      .getRecord()
      .find((record) => record.kind === 'note' && record.value.code === 'configDrift')
    if (drift?.kind !== 'note') throw new Error('Expected drift report')
    expect(drift.value.needsUser).toBe(true)
    expect(drift.value.reason).toContain('pre-commit')
  })

  it('G20 names the fallback reviewer only by user authority and applies it to the blocked action', () => {
    const fixture = policyFixture()
    const { policy } = fixture
    const action = { effect: 'review', subject: 'store' }
    const requester = { agentId: 'implementer', teamId: 'panel' }
    policy.recordRefusal(action, requester, 'classifier')
    // No named fallback: the suggested agents return unchanged.
    expect(policy.applyFallbackReviewer(MODULE, REVIEW_AGENTS, action)).toEqual({
      agents: REVIEW_AGENTS,
      note: undefined,
    })
    // A forged actor never grants the fallback.
    const forged = policy.getSettings()
    forged.fallbackReviewer = { reviewerId: 'fallback', actor: 'owner', reason: 'Agent.', at: 1 }
    expect(policy.updateSettings(forged).kind).toBe('refuse')
    expect(fixture.authority).toHaveBeenCalledOnce()
    // The user's decision records the fallback, stamped owner whatever the claim.
    fixture.authority.mockReturnValue(true)
    const named = policy.getSettings()
    named.fallbackReviewer = { reviewerId: 'fallback', actor: 'lead', reason: 'Owner.', at: 1 }
    expect(policy.updateSettings(named).kind).toBe('allow')
    expect(new OrchestratorPlaybook(fixture.options).getSettings().fallbackReviewer).toEqual({
      reviewerId: 'fallback',
      actor: 'owner',
      reason: 'Owner.',
      at: 100,
    })
    // The blocked action routes to the fallback with a shown, recorded note.
    const applied = policy.applyFallbackReviewer(MODULE, REVIEW_AGENTS, action)
    expect(applied.agents.reviewerId).toBe('fallback')
    expect(applied.note?.code).toBe('fallbackReviewer')
    expect(applied.note?.actor).toBe('fallback')
    expect(
      policy
        .getRecord()
        .some((record) => record.kind === 'note' && record.value.code === 'fallbackReviewer'),
    ).toBe(true)
    // Another action, or a conflict with the implementer, stays unchanged.
    expect(
      policy.applyFallbackReviewer(MODULE, REVIEW_AGENTS, { effect: 'review', subject: 'other' })
        .note,
    ).toBe(undefined)
    expect(
      policy.applyFallbackReviewer(MODULE, { ...REVIEW_AGENTS, implementerId: 'fallback' }, action)
        .note,
    ).toBe(undefined)
  })

  it('G20 parses the fallback grammar and renders it in settings text', () => {
    expect(parsePlaybookCommand(['settings', 'fallbackReviewer', 'r1', 'owner', 'names'])).toEqual({
      view: 'settings',
      change: { fallbackReviewer: 'r1', reason: 'owner names' },
    })
    expect(parsePlaybookCommand(['settings', 'fallbackReviewer', 'off'])).toEqual({
      view: 'settings',
      change: { fallbackReviewer: 'off' },
    })
    expect(parsePlaybookCommand(['settings', 'fallbackReviewer'])).toBe(undefined)
    expect(parsePlaybookCommand(['settings', 'fallbackReviewer', 'off', 'extra'])).toBe(undefined)
    const fixture = policyFixture()
    fixture.authority.mockReturnValue(true)
    const settings = {
      ...fixture.policy.getSettings(),
      fallbackReviewer: { reviewerId: 'r1', actor: 'owner' as const, reason: 'Owner.', at: 7 },
    }
    expect(fixture.policy.updateSettings(settings).kind).toBe('allow')
    const snapshot = {
      settings: new OrchestratorPlaybook(fixture.options).getSettings(),
      records: [],
    }
    expect(playbookText('settings', snapshot)).toContain('r1')
  })

  it('G24 refuses release while residuals are open and allows after acceptance', () => {
    const fixture = policyFixture()
    const { policy } = fixture
    const lanes = fakePlaybookLanes()
    expect(policy.releaseReady('M116', lanes).kind).toBe('allow')
    completeReview(policy, MODULE, reviewBlock('concurrency', 'high'), REVIEW_AGENTS)
    const findingId = latestRound(policy).findings[0]!.id
    const residual = {
      findingId,
      status: 'residual' as const,
      name: 'hook-drift-follow-up',
      whySafe: 'The caller serializes the claim for now.',
      followUp: 'Replace it in lane R.',
    }
    policy.recordDesignDecision(design())
    expect(policy.answerFindings(MODULE, [residual]).kind).toBe('allow')
    const register = collectResidualRegister(policy.getRecord(), lanes, 'M116')
    expect(register.open.map((entry) => entry.name)).toEqual(['hook-drift-follow-up'])
    expect(collectResidualRegister(policy.getRecord(), lanes, 'M999').open).toEqual([])
    const refused = policy.releaseReady('M116', lanes)
    if (refused.kind !== 'refuse') throw new Error('Expected release refusal')
    expect(refused.note.code).toBe('residualOpen')
    expect(refused.note.missing).toEqual(['hook-drift-follow-up'])
    // Acceptance needs the user: denied authority refuses, unknown names throw.
    expect(
      policy.acceptResidual('M116', 'hook-drift-follow-up', 'Accepted for now.', lanes).kind,
    ).toBe('refuse')
    expect(() => policy.acceptResidual('M116', 'no-such-residual', 'Accepted.', lanes)).toThrow()
    fixture.authority.mockReturnValue(true)
    expect(
      policy.acceptResidual('M116', 'hook-drift-follow-up', 'Accepted for now.', lanes).kind,
    ).toBe('allow')
    expect(policy.releaseReady('M116', lanes).kind).toBe('allow')
    expect(
      collectResidualRegister(policy.getRecord(), lanes, 'M116').accepted.map(
        (entry) => entry.name,
      ),
    ).toEqual(['hook-drift-follow-up'])
  })

  it('G24 acceptance binds to the residual instance, not its reused name', () => {
    // A name-only acceptance would silently authorize a later, different
    // residual under the same name. The acceptance binds to the open
    // instance's safety rationale, follow-up and module instead.
    const fixture = policyFixture()
    const { policy } = fixture
    const other = {
      ...MODULE,
      id: 'module-worker-9',
      key: 'src/core/schedules/worker',
      files: ['src/core/schedules/worker.ts'],
    }
    const lanes = [...fakePlaybookLanes(), { ...fakePlaybookLanes()[0]!, id: 'Z', module: other }]
    const otherBlock = {
      ...reviewBlock('concurrency', 'high'),
      findings: [
        {
          file: 'src/core/schedules/worker.ts',
          title: 'An actual finding',
          severity: 'high',
          class: 'concurrency',
        },
      ],
    }
    policy.declareModule(other)
    completeReview(policy, MODULE, reviewBlock('concurrency', 'high'), REVIEW_AGENTS)
    const firstId = latestRound(policy).findings[0]!.id
    policy.recordDesignDecision(design())
    expect(
      policy.answerFindings(MODULE, [
        {
          findingId: firstId,
          status: 'residual',
          name: 'native-binding',
          whySafe: 'Module A serializes the claim for now.',
          followUp: 'Replace it in lane R.',
        },
      ]).kind,
    ).toBe('allow')
    completeReview(policy, other, otherBlock, REVIEW_AGENTS)
    const secondId = latestRound(policy, other).findings[0]!.id
    policy.recordDesignDecision({ ...design(other), id: 'atomic-claim-worker' })
    expect(
      policy.answerFindings(other, [
        {
          findingId: secondId,
          status: 'residual',
          name: 'native-binding',
          whySafe: 'Module B retries on its own worker.',
          followUp: 'Harden it in lane Z.',
        },
      ]).kind,
    ).toBe('allow')
    fixture.authority.mockReturnValue(true)
    expect(policy.acceptResidual('M116', 'native-binding', 'Accepted A.', lanes).kind).toBe('allow')
    // B's different residual under the reused name stays open and refuses release.
    const register = collectResidualRegister(policy.getRecord(), lanes, 'M116')
    expect(register.open.map((entry) => entry.moduleId)).toEqual(['module-worker-9'])
    expect(policy.releaseReady('M116', lanes).kind).toBe('refuse')
    expect(policy.acceptResidual('M116', 'native-binding', 'Accepted B.', lanes).kind).toBe('allow')
    expect(policy.releaseReady('M116', lanes).kind).toBe('allow')
    // A later residual under the same name needs a fresh acceptance even
    // though an older instance was accepted.
    fixture.advance(50)
    completeReview(policy, other, otherBlock, REVIEW_AGENTS)
    const thirdId = latestRound(policy, other).findings[0]!.id
    expect(
      policy.answerFindings(other, [
        {
          findingId: thirdId,
          status: 'residual',
          name: 'native-binding',
          whySafe: 'Module B retries with backoff now.',
          followUp: 'Harden it in lane Z.',
        },
      ]).kind,
    ).toBe('allow')
    expect(collectResidualRegister(policy.getRecord(), lanes, 'M116').open).toHaveLength(1)
    expect(policy.releaseReady('M116', lanes).kind).toBe('refuse')
  })

  it('G24 a legacy name-only acceptance never authorizes a residual answered after it', () => {
    // RVF116I P2: the review's timestamp (t=120) predates the acceptance
    // (t=140) but the answer is published after it (t=160). Coverage binds to
    // the answer's journal position, so the later instance stays open.
    const fixture = policyFixture()
    const { policy } = fixture
    const other = {
      ...MODULE,
      id: 'module-worker-9',
      key: 'src/core/schedules/worker',
      files: ['src/core/schedules/worker.ts'],
    }
    const lanes = [...fakePlaybookLanes(), { ...fakePlaybookLanes()[0]!, id: 'Z', module: other }]
    const otherBlock = {
      ...reviewBlock('concurrency', 'high'),
      findings: [
        {
          file: 'src/core/schedules/worker.ts',
          title: 'An actual finding',
          severity: 'high',
          class: 'concurrency',
        },
      ],
    }
    policy.declareModule(other)
    completeReview(policy, MODULE, reviewBlock('concurrency', 'high'), REVIEW_AGENTS)
    const firstId = latestRound(policy).findings[0]!.id
    policy.recordDesignDecision(design())
    expect(
      policy.answerFindings(MODULE, [
        {
          findingId: firstId,
          status: 'residual',
          name: 'native-binding',
          whySafe: 'Module A serializes the claim for now.',
          followUp: 'Replace it in lane R.',
        },
      ]).kind,
    ).toBe('allow')
    // B's review is recorded at t=120 but answers nothing yet.
    fixture.advance(20)
    completeReview(policy, other, otherBlock, REVIEW_AGENTS)
    // The owner accepts A at t=140 with the pre-binding journal shape: a
    // name, no instance evidence.
    fixture.advance(20)
    fixture.tamper([
      ...policy.getRecord(),
      {
        kind: 'residual',
        value: {
          milestoneId: 'M116',
          name: 'native-binding',
          status: 'accepted',
          actor: 'owner',
          reason: 'Accepted A.',
          at: 140,
        },
      },
    ])
    // B answers at t=160 with a different instance under the same name. Its
    // round keeps the review's timestamp (t=120): only journal position tells
    // it was answered after the acceptance.
    fixture.advance(20)
    const secondId = latestRound(policy, other).findings[0]!.id
    policy.recordDesignDecision({ ...design(other), id: 'atomic-claim-worker' })
    expect(
      policy.answerFindings(other, [
        {
          findingId: secondId,
          status: 'residual',
          name: 'native-binding',
          whySafe: 'Module B retries on its own worker.',
          followUp: 'Harden it in lane Z.',
        },
      ]).kind,
    ).toBe('allow')
    const register = collectResidualRegister(policy.getRecord(), lanes, 'M116')
    expect(register.open.map((entry) => entry.moduleId)).toEqual(['module-worker-9'])
    const refused = policy.releaseReady('M116', lanes)
    if (refused.kind !== 'refuse') throw new Error('Expected release refusal')
    expect(refused.note.code).toBe('residualOpen')
    expect(refused.note.missing).toEqual(['native-binding'])
  })

  it('G24 a legacy acceptance with no preceding answer is unbound, never accepted', () => {
    const fixture = policyFixture()
    const { policy } = fixture
    const lanes = fakePlaybookLanes()
    // A pre-binding record names a residual nothing answered before it.
    fixture.tamper([
      ...policy.getRecord(),
      {
        kind: 'residual',
        value: {
          milestoneId: 'M116',
          name: 'hook-drift-follow-up',
          status: 'accepted',
          actor: 'owner',
          reason: 'Accepted for now.',
          at: 100,
        },
      },
    ])
    const register = collectResidualRegister(policy.getRecord(), lanes, 'M116')
    expect(register.open).toEqual([])
    expect(register.accepted).toEqual([])
    expect(register.unbound.map((entry) => entry.name)).toEqual(['hook-drift-follow-up'])
    // Nothing is open, so release still allows: the stale record blocks
    // nothing, and a fresh acceptance names whatever later opens.
    expect(policy.releaseReady('M116', lanes).kind).toBe('allow')
  })

  it('G24 integration release runs only with an empty or accepted register', () => {
    const fixture = policyFixture()
    const board = new FakePlaybookBoard()
    const laneEvents = events()
    const integration = new PlaybookIntegration(fixture.policy, board, laneEvents)
    const effect = vi.fn()
    completeReview(fixture.policy, MODULE, reviewBlock('concurrency', 'high'), REVIEW_AGENTS)
    const findingId = latestRound(fixture.policy).findings[0]!.id
    fixture.policy.recordDesignDecision(design())
    expect(
      fixture.policy.answerFindings(MODULE, [
        {
          findingId,
          status: 'residual',
          name: 'hook-drift-follow-up',
          whySafe: 'Safe for now.',
          followUp: 'Lane R.',
        },
      ]).kind,
    ).toBe('allow')
    expect(() => {
      integration.release('M116', effect)
    }).toThrow()
    expect(effect).not.toHaveBeenCalled()
    fixture.authority.mockReturnValue(true)
    expect(
      fixture.policy.acceptResidual(
        'M116',
        'hook-drift-follow-up',
        'Accepted for now.',
        board.readBoard().lanes,
      ).kind,
    ).toBe('allow')
    integration.release('M116', effect)
    expect(effect).toHaveBeenCalledOnce()
  })

  it('renders lease, work, verification and residual records in the record view', () => {
    const fixture = policyFixture()
    const { policy } = fixture
    policy.declareModule(MODULE)
    const decision = policy.beforeFixRound(MODULE)
    expect(decision.kind).toBe('allow')
    const records = policy.getRecord()
    const lease = records.find((record) => record.kind === 'lease')
    if (lease?.kind !== 'lease') throw new Error('Expected lease')
    expect(playbookRecordText(lease)).toContain('Patch lease held')
    expect(
      playbookRecordText({
        kind: 'work',
        value: {
          id: 'w',
          moduleId: MODULE.id,
          refs: ['refs/heads/main'],
          baseline: ['c0ffee'],
          hookDigest: 'digest',
          at: 100,
        },
      }),
    ).toContain('baseline commits')
    expect(
      playbookRecordText({
        kind: 'verification',
        value: {
          workId: 'w',
          moduleId: MODULE.id,
          commit: 'c0ffee',
          hookDigest: 'digest',
          scope: 'commit',
          result: 'pass',
          at: 100,
        },
      }),
    ).toContain('Hook verification pass')
    expect(
      playbookRecordText({
        kind: 'residual',
        value: {
          milestoneId: 'M116',
          name: 'hook-drift-follow-up',
          status: 'accepted',
          actor: 'owner',
          reason: 'Accepted for now.',
          at: 100,
        },
      }),
    ).toContain('Residual accepted')
  })

  it('runs fallback settings through the shared CLI runner text', async () => {
    const fixture = policyFixture()
    fixture.authority.mockReturnValue(true)
    const { policy } = fixture
    const port = {
      read: () => Promise.resolve({ settings: policy.getSettings(), records: policy.getRecord() }),
      change: (change: unknown) => {
        const next = changedPlaybookSettings(policy.getSettings(), change, 'owner', 100)
        const updated = policy.updateSettings(next)
        if (updated.kind !== 'allow') throw new Error('change refused')
        return Promise.resolve({ settings: policy.getSettings(), records: policy.getRecord() })
      },
    }
    const parsed = parsePlaybookCommand(['settings', 'fallbackReviewer', 'r1', 'owner names'])
    if (parsed === undefined || !('change' in parsed)) throw new Error('Expected a change')
    const result = await runPlaybookCommand(parsed, port)
    expect(result.ok).toBe(true)
    expect(result.text).toContain('r1')
  })
})
