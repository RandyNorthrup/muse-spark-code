import { describe, expect, it, vi } from 'vitest'
import {
  PLAYBOOK_CONFIGURABLE_RULES,
  PLAYBOOK_FINDING_CLASSES,
  PLAYBOOK_LAUNDER_WINDOW_MS,
  PLAYBOOK_PATCH_ROUNDS_MAX,
  PLAYBOOK_RECORD_MAX,
  PLAYBOOK_SAFETY_RULE,
  PLAYBOOK_ID_MAX_CHARS,
  REVIEW_FINDING_PATH_MAX_CHARS,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  REVIEW_FINDINGS_MAX,
} from '../../src/shared/constants'
import {
  defaultPlaybookSettings,
  knownFindingClass,
  playbookDesignDecisionSchema,
  playbookModuleSchema,
  playbookRecordFile,
  playbookRecordSchema,
  playbookRoundSchema,
  playbookSettingsSchema,
  playbookWhyNoteSchema,
  type PlaybookAction,
  type PlaybookCheck,
  type PlaybookCheckDecision,
  type PlaybookConfigurableRule,
  type PlaybookDecision,
  type PlaybookDesignDecision,
  type PlaybookDrill,
  type PlaybookFindingClass,
  type PlaybookOrderDecision,
  type PlaybookLane,
  type PlaybookPolicy,
  type PlaybookRecord,
  type PlaybookReportItem,
  type PlaybookRound,
  type PlaybookRule,
  type PlaybookSettings,
  type PlaybookWhyNote,
} from '../../src/shared/playbook'
import {
  FAKE_PLAYBOOK_MODULE,
  FakePlaybookBoard,
  FakePlaybookDelegate,
  FakePlaybookReviewLoop,
  ScriptedPlaybookReviewer,
  fakePlaybookLanes,
  fakePlaybookPlan,
  threeStrikesScript,
  type FakePlaybookPlan,
  type ScriptedPlaybookReview,
} from './helpers/playbook/fakes'

const NOTE: PlaybookWhyNote = {
  rule: 'threeStrikes',
  code: 'checksPassed',
  module: FAKE_PLAYBOOK_MODULE.key,
  at: 0,
  needsUser: false,
}
const ALLOW: PlaybookDecision = { kind: 'allow', note: NOTE }
const REFUSE: PlaybookDecision = { kind: 'refuse', note: { ...NOTE, code: 'answersPending' } }
const REVIEW_AGENTS = {
  implementerId: 'implementer-1',
  reviewerId: 'reviewer-2',
  implementerSessionId: 'session-1',
  reviewerSessionId: 'session-2',
}
const ROUND: PlaybookRound = {
  module: FAKE_PLAYBOOK_MODULE,
  ...REVIEW_AGENTS,
  class: 'concurrency',
  round: 3,
  phase: 'fix',
  findings: [
    {
      id: 'store-claim',
      file: 'src/core/schedules/store.ts',
      class: 'concurrency',
      severity: 'P2',
    },
  ],
  answers: [{ findingId: 'store-claim', status: 'disputed', reason: 'Requires an atomic claim.' }],
  at: 0,
}
const DESIGN: PlaybookDesignDecision = {
  id: 'D96-store',
  module: FAKE_PLAYBOOK_MODULE,
  class: 'concurrency',
  failureClass: 'Multi-step claim',
  whyPatchesFailed: 'Checks and writes still raced.',
  structuralChange: 'Use one atomic claim.',
  planLocation: 'PLAN.md#d96-store',
  redesignLane: 'R',
  outcome: 'pending',
  at: 0,
}

/** Forwarding spies only; they deliberately do not implement lane P's policy. */
function policySpies(): PlaybookPolicy {
  return {
    beforeDispatch: vi.fn(() => ALLOW),
    beforeReview: vi.fn(() => ALLOW),
    afterReview: vi.fn(() => ALLOW),
    beforeFixRound: vi.fn(() => ALLOW),
    beforeMerge: vi.fn(() => ALLOW),
    beforeCommand: vi.fn(() => ALLOW),
    order: vi.fn((queue: readonly PlaybookLane[]): PlaybookOrderDecision => ({
      kind: 'allow',
      queue,
      notes: [NOTE],
    })),
    beforeCheck: vi.fn((_check: PlaybookCheck): PlaybookCheckDecision => ({
      kind: 'allow',
      target: { kind: 'local' },
      note: NOTE,
    })),
    orderReport: vi.fn((items: readonly PlaybookReportItem[]) => ({ items, note: NOTE })),
    answerFindings: vi.fn(() => ALLOW),
    recordDesignDecision: vi.fn(() => ALLOW),
    resolveRedesign: vi.fn(() => ALLOW),
    recordRefusal: vi.fn(),
  }
}

describe('M116 contracts', () => {
  it('pins the two-fix ceiling, one-hour laundering window, bounded journal and eight classes', () => {
    expect(PLAYBOOK_PATCH_ROUNDS_MAX).toBe(2)
    expect(PLAYBOOK_LAUNDER_WINDOW_MS).toBe(3_600_000)
    expect(PLAYBOOK_RECORD_MAX).toBe(5000)
    const classes: readonly PlaybookFindingClass[] = PLAYBOOK_FINDING_CLASSES
    expect(classes).toEqual([
      'validation',
      'security',
      'failure',
      'honesty',
      'concurrency',
      'lifecycle',
      'tests',
      'docs',
    ])
    expect(knownFindingClass('Concurrency')).toBe('concurrency')
    expect(knownFindingClass('future')).toBeUndefined()
    expect(knownFindingClass(undefined)).toBeUndefined()
  })
  it('starts every rule on, with no safety switch, and isolates each team', () => {
    const first: PlaybookSettings = defaultPlaybookSettings('team-a')
    const second = defaultPlaybookSettings('team-b')
    const safety: PlaybookRule = PLAYBOOK_SAFETY_RULE
    expect(Object.keys(first.rules)).toEqual(PLAYBOOK_CONFIGURABLE_RULES)
    expect(first.rules).not.toHaveProperty(safety)
    expect(Object.values(first.rules).every((rule) => rule.enabled)).toBe(true)
    first.rules.threeStrikes = {
      enabled: false,
      reason: 'A migration needs one review.',
      actor: 'owner',
      at: 1,
    }
    expect(second.rules.threeStrikes).toEqual({ enabled: true })
    expect(second.teamId).toBe('team-b')
  })
  it.each(PLAYBOOK_CONFIGURABLE_RULES)(
    'requires reason, actor and time to disable %s',
    (rule: PlaybookConfigurableRule) => {
      const settings = defaultPlaybookSettings('panel')
      const rules = {
        ...settings.rules,
        [rule]: { enabled: false, reason: 'A bounded exception.', actor: 'owner', at: 1 },
      }
      expect(playbookSettingsSchema.parse({ ...settings, rules }).rules[rule]).toEqual(rules[rule])
      for (const change of [
        { enabled: false },
        { enabled: false, reason: ' ', actor: 'owner', at: 1 },
        { enabled: false, reason: 'r', actor: '', at: 1 },
        { enabled: false, reason: 'r', actor: 'owner', at: -1 },
      ])
        expect(
          playbookSettingsSchema.safeParse({ ...settings, rules: { ...rules, [rule]: change } })
            .success,
        ).toBe(false)
    },
  )
  it('rejects rule 9 anywhere in settings, missing rules and a raised or zero ceiling', () => {
    const settings = defaultPlaybookSettings('panel')
    for (const patchRoundsMax of [0, 3, 1.5])
      expect(playbookSettingsSchema.safeParse({ ...settings, patchRoundsMax }).success).toBe(false)
    expect(playbookSettingsSchema.safeParse({ ...settings, patchRoundsMax: 1 }).success).toBe(true)
    expect(playbookSettingsSchema.safeParse({ ...settings, neverAround: false }).success).toBe(
      false,
    )
    expect(
      playbookSettingsSchema.safeParse({
        ...settings,
        rules: { ...settings.rules, neverAround: { enabled: false } },
      }).success,
    ).toBe(false)
    expect(playbookSettingsSchema.safeParse({ ...settings, rules: {} }).success).toBe(false)
  })
  it('names the versioned per-workspace journal without accepting path injection', () => {
    expect(playbookRecordFile('workspace-123')).toBe('playbook/v1/workspace-123.jsonl')
    for (const key of ['', '..', '../outside', 'a/b', String.raw`a\b`, '/absolute'])
      expect(() => playbookRecordFile(key)).toThrow()
  })
  it('validates module, round, design and note records without accepting raw review text or output', () => {
    const records: PlaybookRecord[] = [
      { kind: 'round', value: ROUND },
      { kind: 'design', value: DESIGN },
      { kind: 'note', value: NOTE },
      { kind: 'settings', value: defaultPlaybookSettings('panel') },
    ]
    for (const record of records) expect(playbookRecordSchema.parse(record)).toEqual(record)
    expect(
      playbookRoundSchema.safeParse({
        ...ROUND,
        findings: [{ ...ROUND.findings[0], detail: 'Raw file contents' }],
      }).success,
    ).toBe(false)
    expect(
      playbookRecordSchema.safeParse({
        kind: 'note',
        value: { ...NOTE, commandOutput: 'Raw output' },
      }).success,
    ).toBe(false)
    expect(playbookModuleSchema.safeParse({ ...FAKE_PLAYBOOK_MODULE, files: [] }).success).toBe(
      false,
    )
    expect(playbookRoundSchema.safeParse({ ...ROUND, round: 0 }).success).toBe(false)
    expect(
      playbookRoundSchema.safeParse({
        ...ROUND,
        answers: [{ findingId: 'a', status: 'disputed', reason: ' ' }],
      }).success,
    ).toBe(false)
    for (const key of [
      'failureClass',
      'whyPatchesFailed',
      'structuralChange',
      'planLocation',
      'redesignLane',
    ]) {
      expect(playbookDesignDecisionSchema.safeParse({ ...DESIGN, [key]: ' ' }).success).toBe(false)
    }
    expect(playbookWhyNoteSchema.safeParse({ ...NOTE, rule: 'made-up' }).success).toBe(false)
    expect(playbookDesignDecisionSchema.safeParse({ ...DESIGN, outcome: 'fixed' }).success).toBe(
      false,
    )
  })
  it('persists stable module snapshots and typed rename, split and merge lineage', () => {
    const priorId = 'module-store-17'
    for (const lineage of [
      { renamedFrom: priorId },
      { splitFrom: priorId },
      { mergedFrom: [priorId, 'module-jobs-18'] },
    ]) {
      const value = {
        module: {
          ...FAKE_PLAYBOOK_MODULE,
          id: lineage.renamedFrom ?? 'module-successor-19',
          key: 'src/core/jobs/claims',
          files: ['src/core/jobs/claims.ts'],
          lineage,
        },
        at: 1,
      }
      const record = { kind: 'module', value }
      expect(playbookRecordSchema.parse(record)).toEqual(record)
    }
    const { id: _id, ...withoutId } = { ...FAKE_PLAYBOOK_MODULE, id: priorId }
    expect(playbookModuleSchema.safeParse(withoutId).success).toBe(false)
    for (const lineage of [
      { renamedFrom: '' },
      { splitFrom: ' ' },
      { mergedFrom: [] },
      { mergedFrom: [priorId] },
      { mergedFrom: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => priorId) },
      { renamedFrom: priorId, splitFrom: priorId },
      { previousKeys: ['src/core/schedules/store'] },
    ])
      expect(playbookModuleSchema.safeParse({ ...FAKE_PLAYBOOK_MODULE, lineage }).success).toBe(
        false,
      )
    expect(playbookModuleSchema.safeParse({ ...FAKE_PLAYBOOK_MODULE, id: ' ' }).success).toBe(false)
  })
  it('records a lead or owner overlap override with its reason and time', () => {
    for (const actor of ['lead', 'owner']) {
      const record = {
        kind: 'module',
        value: {
          module: FAKE_PLAYBOOK_MODULE,
          override: { actor, reason: 'Independent replacement approved.', at: 1 },
          at: 1,
        },
      }
      expect(playbookRecordSchema.parse(record)).toEqual(record)
      for (const override of [
        { actor, at: 1 },
        { actor, reason: ' ', at: 1 },
        { actor, reason: 'Approved.' },
        { actor: 'worker', reason: 'Approved.', at: 1 },
        { actor, reason: 'Approved.', at: -1 },
      ])
        expect(
          playbookRecordSchema.safeParse({
            ...record,
            value: { ...record.value, override },
          }).success,
        ).toBe(false)
    }
  })
  it('requires trusted implementer and reviewer agent and session identities in round records', () => {
    expect(playbookRoundSchema.parse(ROUND)).toMatchObject(REVIEW_AGENTS)
    for (const field of Object.keys(REVIEW_AGENTS)) {
      const incomplete = Object.fromEntries(Object.entries(ROUND).filter(([key]) => key !== field))
      expect(playbookRoundSchema.safeParse(incomplete).success).toBe(false)
      expect(playbookRoundSchema.safeParse({ ...ROUND, [field]: ' ' }).success).toBe(false)
    }
  })
  it('retains P1 to P3 priority and each finding disposition after journal replay', () => {
    const dispositions = [
      { findingId: 'store-claim', status: 'fixed' },
      { findingId: 'store-claim', status: 'disputed', reason: 'Needs an atomic claim.' },
      {
        findingId: 'store-claim',
        status: 'residual',
        name: 'claim-redesign',
        whySafe: 'The caller serializes claims for now.',
        followUp: 'Replace the multi-step claim in the redesign lane.',
      },
      {
        findingId: 'store-claim',
        status: 'override',
        actor: 'owner',
        reason: 'Approved for this release.',
        at: 1,
      },
    ]
    for (const severity of ['P1', 'P2', 'P3'])
      for (const disposition of dispositions) {
        const record = {
          kind: 'round',
          value: {
            ...ROUND,
            findings: [{ ...ROUND.findings[0], severity }],
            answers: [disposition],
          },
        }
        const journalLine = JSON.stringify(record)
        const replay: unknown = JSON.parse(journalLine)
        expect(playbookRecordSchema.parse(replay)).toEqual(record)
      }
    for (const severity of [undefined, '', 'P0', 'critical'])
      expect(
        playbookRoundSchema.safeParse({
          ...ROUND,
          findings: [{ ...ROUND.findings[0], severity }],
        }).success,
      ).toBe(false)
    for (const invalid of [
      { status: 'residual', whySafe: 'Safe.', followUp: 'Redesign.' },
      { status: 'residual', name: 'r', followUp: 'Redesign.' },
      { status: 'residual', name: 'r', whySafe: 'Safe.' },
      { status: 'residual', name: '', whySafe: 'Safe.', followUp: 'Redesign.' },
      { status: 'residual', name: 'r', whySafe: '', followUp: 'Redesign.' },
      { status: 'residual', name: 'r', whySafe: 'Safe.', followUp: '' },
      { status: 'override', actor: 'reviewer', reason: 'Approved.', at: 1 },
      { status: 'override', reason: 'Approved.', at: 1 },
      { status: 'override', actor: 'lead', at: 1 },
      { status: 'override', actor: 'lead', reason: '', at: 1 },
      { status: 'override', actor: 'lead', reason: 'Approved.' },
      { status: 'override', actor: 'lead', reason: 'Approved.', at: -1 },
    ])
      expect(
        playbookRoundSchema.safeParse({
          ...ROUND,
          answers: [{ findingId: 'store-claim', ...invalid }],
        }).success,
      ).toBe(false)
  })
  it.each(['impossible', 'caught', 'remains'] as const)(
    'keeps each prior finding’s %s reason in the redesign round record',
    (outcome) => {
      const round = {
        ...ROUND,
        phase: 'redesign',
        resolution: [{ findingId: 'store-claim', outcome, reason: 'One atomic claim.' }],
      }
      expect(playbookRecordSchema.parse({ kind: 'round', value: round })).toEqual({
        kind: 'round',
        value: round,
      })
      expect(
        playbookRoundSchema.safeParse({
          ...round,
          resolution: [{ findingId: 'store-claim', outcome, reason: '' }],
        }).success,
      ).toBe(false)
      expect(
        playbookRoundSchema.safeParse({
          ...round,
          resolution: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => round.resolution[0]),
        }).success,
      ).toBe(false)
    },
  )
  it('bounds identifiers, paths, reasons and record arrays at their boundaries', () => {
    expect(() => defaultPlaybookSettings('x'.repeat(PLAYBOOK_ID_MAX_CHARS + 1))).toThrow()
    expect(
      playbookModuleSchema.safeParse({
        ...FAKE_PLAYBOOK_MODULE,
        key: 'x'.repeat(REVIEW_FINDING_PATH_MAX_CHARS + 1),
      }).success,
    ).toBe(false)
    expect(
      playbookModuleSchema.safeParse({
        ...FAKE_PLAYBOOK_MODULE,
        files: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => 'src/a.ts'),
      }).success,
    ).toBe(false)
    expect(
      playbookRoundSchema.safeParse({
        ...ROUND,
        findings: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => ROUND.findings[0]),
      }).success,
    ).toBe(false)
    expect(
      playbookRoundSchema.safeParse({
        ...ROUND,
        answers: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => ROUND.answers[0]),
      }).success,
    ).toBe(false)
    expect(
      playbookWhyNoteSchema.safeParse({
        ...NOTE,
        missing: Array.from({ length: REVIEW_FINDINGS_MAX + 1 }, () => 'P'),
      }).success,
    ).toBe(false)
    expect(
      playbookWhyNoteSchema.safeParse({ ...NOTE, classes: [...PLAYBOOK_FINDING_CLASSES] }).success,
    ).toBe(true)
    expect(
      playbookWhyNoteSchema.safeParse({
        ...NOTE,
        classes: [...PLAYBOOK_FINDING_CLASSES, 'validation'],
      }).success,
    ).toBe(false)
    expect(
      playbookDesignDecisionSchema.safeParse({
        ...DESIGN,
        structuralChange: 'x'.repeat(REVIEW_FINDING_TEXT_MAX_CHARS + 1),
      }).success,
    ).toBe(false)
  })
})

describe('M116 acceptance fakes', () => {
  it.each(['impossible', 'caught', 'remains'] as const)(
    'scripts three concurrency rounds and the %s redesign answer',
    (outcome) => {
      const findingId = 'host-generated-17'
      const reviewer = new ScriptedPlaybookReviewer(threeStrikesScript(outcome, findingId))
      for (let round = 0; round < 3; round += 1) {
        expect(reviewer.next(FAKE_PLAYBOOK_MODULE)).toMatchObject({
          findings: [{ class: 'concurrency' }],
          coverage: PLAYBOOK_FINDING_CLASSES,
        })
      }
      expect(reviewer.next(FAKE_PLAYBOOK_MODULE).resolution).toEqual([
        {
          findingId,
          outcome,
          reason:
            outcome === 'impossible'
              ? 'The claim is one atomic operation.'
              : 'The multi-step claim still exists.',
        },
      ])
      expect(() => reviewer.next(FAKE_PLAYBOOK_MODULE)).toThrow('No scripted review')
    },
  )
  it('keeps rounds per module, preserves unclassified findings, and returns fresh blocks', () => {
    const other = { ...FAKE_PLAYBOOK_MODULE, id: 'module-jobs-18', key: 'src/host/jobs' }
    const script: ScriptedPlaybookReview[] = [
      ...threeStrikesScript('impossible', 'store-claim'),
      {
        module: other.id,
        review: { findings: [{ file: 'src/host/jobs/a.ts', title: 'Unclassified' }] },
      },
    ]
    const reviewer = new ScriptedPlaybookReviewer(script)
    const first = reviewer.next(FAKE_PLAYBOOK_MODULE)
    first.findings.length = 0
    expect(reviewer.next(other)).toEqual(script.at(-1)?.review)
    expect(reviewer.next(FAKE_PLAYBOOK_MODULE).findings).toHaveLength(1)
    const bad = new ScriptedPlaybookReviewer([
      { module: other.id, review: { findings: [{ file: '', title: '' }] } },
    ])
    expect(() => bad.next(other)).toThrow('Invalid scripted review')
  })
  it('keeps the same module review sequence across renamed keys', () => {
    const reviewer = new ScriptedPlaybookReviewer(threeStrikesScript('impossible', 'prior-id'))
    const renamed = {
      ...FAKE_PLAYBOOK_MODULE,
      key: 'src/core/jobs/claims',
      files: ['src/core/jobs/claims.ts'],
      lineage: { renamedFrom: FAKE_PLAYBOOK_MODULE.id },
    }
    for (let round = 0; round < 3; round += 1) reviewer.next(FAKE_PLAYBOOK_MODULE)
    expect(reviewer.next(renamed).resolution?.[0]?.findingId).toBe('prior-id')
    expect(() => reviewer.next(renamed)).toThrow('No scripted review')
  })
  it('does not consume a review after refusal and forwards the entire admitted block', () => {
    const policy = policySpies()
    const reviewer = new ScriptedPlaybookReviewer(threeStrikesScript('caught', 'store-claim'))
    const next = vi.spyOn(reviewer, 'next')
    const loop = new FakePlaybookReviewLoop(policy, reviewer)
    vi.mocked(policy.beforeReview).mockReturnValueOnce(REFUSE)
    expect(loop.review(FAKE_PLAYBOOK_MODULE, REVIEW_AGENTS)).toEqual({
      kind: 'refused',
      decision: REFUSE,
    })
    expect(next).not.toHaveBeenCalled()
    expect(policy.afterReview).not.toHaveBeenCalled()
    const admitted = loop.review(FAKE_PLAYBOOK_MODULE, REVIEW_AGENTS)
    expect(policy.beforeReview).toHaveBeenCalledWith(FAKE_PLAYBOOK_MODULE, REVIEW_AGENTS)
    expect(admitted.kind).toBe('reviewed')
    if (admitted.kind !== 'reviewed') throw new Error('Expected review')
    expect(policy.afterReview).toHaveBeenCalledWith(
      FAKE_PLAYBOOK_MODULE,
      admitted.review,
      REVIEW_AGENTS,
    )
    expect(admitted.decision).toEqual(ALLOW)
  })
  it('detaches module data between lanes, fixture calls and new boards', () => {
    const lanes = fakePlaybookLanes()
    const other = fakePlaybookLanes()
    const board = new FakePlaybookBoard()
    const source = board.readBoard()
    const supplied = new FakePlaybookBoard(source)
    source.lanes[0]!.module.files.push('src/supplied.ts')
    expect(supplied.readBoard().lanes[0]?.module.files).toEqual(['src/core/schedules/store.ts'])
    lanes[0]!.module.files.push('src/changed.ts')
    expect(lanes[1]?.module.files).toEqual(['src/core/schedules/store.ts'])
    expect(other[0]?.module.files).toEqual(['src/core/schedules/store.ts'])
    expect(new FakePlaybookBoard().readBoard().lanes[0]?.module.files).toEqual([
      'src/core/schedules/store.ts',
    ])
    expect(board.readBoard().lanes[0]?.module.files).toEqual(['src/core/schedules/store.ts'])
    expect(FAKE_PLAYBOOK_MODULE.files).toEqual(['src/core/schedules/store.ts'])
  })
  it('supplies the acceptance board dependency graph and estimates independently of plan order', () => {
    const board = new FakePlaybookBoard().readBoard()
    expect(
      Object.fromEntries(
        board.lanes.map(({ id, starts, estimateHours }) => [id, { starts, estimateHours }]),
      ),
    ).toEqual({
      '0': { starts: [], estimateHours: 6 },
      P: { starts: ['0'], estimateHours: 20 },
      K: { starts: ['0'], estimateHours: 8 },
      U: { starts: ['0'], estimateHours: 12 },
      I: { starts: ['P'], estimateHours: 10 },
      W: { starts: ['P', 'K', 'U', 'I'], estimateHours: 4 },
    })
  })
  it('offers a mutable board through an isolated plan snapshot, including unreviewed contracts', () => {
    const board = new FakePlaybookBoard()
    const plan: FakePlaybookPlan = fakePlaybookPlan(board)
    expect(fakePlaybookPlan().port.readBoard().lanes).toHaveLength(6)
    expect(plan.deliveryOrder).toEqual(['0', 'K', 'U', 'P', 'I', 'W'])
    expect(plan.milestoneId).toBe('M116')
    board.merge('0', false)
    const snapshot = plan.port.readBoard()
    expect(snapshot.lanes.find((lane) => lane.id === '0')).toMatchObject({
      merged: true,
      reviewed: false,
    })
    expect(snapshot.mergedPrerequisites).toEqual(['0'])
    snapshot.lanes[0]!.module.files.length = 0
    expect(board.readBoard().lanes[0]?.module.files).toHaveLength(1)
    board.merge('0', true)
    expect(board.readBoard().lanes.find((lane) => lane.id === '0')?.reviewed).toBe(true)
    expect(() => {
      board.merge('unknown', true)
    }).toThrow('Unknown lane')
    const drill: PlaybookDrill = {
      guard: 'contractsFirst',
      mutation: 'Dispatch before merge.',
      test: 'prerequisites',
      observedFailure: 'Expected refuse.',
      beforeSha256: 'a'.repeat(64),
      restoredSha256: 'a'.repeat(64),
    }
    expect({ ...snapshot.lanes[0], drills: [drill] }.drills[0]?.restoredSha256).toBe(
      drill.beforeSha256,
    )
  })
  it.each(['permission', 'classifier'] as const)(
    're-asks the same refused %s effect through a different agent',
    (source) => {
      const policy = policySpies()
      const delegate = new FakePlaybookDelegate(policy)
      const action: PlaybookAction = { effect: 'push', subject: 'repo:main' }
      const command = { ...action, kind: 'shell' as const, command: 'git push origin main' }
      const requester = { agentId: 'lead', teamId: 'team' }
      const nextRequester = { agentId: 'delegate', teamId: 'team' }
      vi.mocked(policy.beforeCommand).mockReturnValue(REFUSE)
      expect(delegate.reask(command, requester, nextRequester, source)).toEqual(REFUSE)
      expect(policy.recordRefusal).toHaveBeenCalledWith(command, requester, source)
      expect(policy.beforeCommand).toHaveBeenCalledWith(command, nextRequester)
      expect(vi.mocked(policy.recordRefusal).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(policy.beforeCommand).mock.invocationCallOrder[0]!,
      )
      delegate.reask(command, requester, nextRequester)
      expect(policy.recordRefusal).toHaveBeenLastCalledWith(command, requester, 'permission')
    },
  )
})
