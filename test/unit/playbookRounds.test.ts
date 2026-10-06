import { completeReview } from './playbookPolicyFixture'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../src/shared/constants'
import { afterEach, describe, expect, it } from 'vitest'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { newPlaybookModule } from '../../src/core/orchestration/playbook/modules'
import {
  FAKE_PLAYBOOK_MODULE as MODULE,
  FakePlaybookBoard,
  FakePlaybookReviewLoop,
  ScriptedPlaybookReviewer,
  threeStrikesScript,
} from './helpers/playbook/fakes'
import {
  answerAll,
  design,
  latestRound,
  policyFixture,
  REVIEW_AGENTS,
  reviewBlock,
  strike,
} from './playbookPolicyFixture'

const diskWorkspaces: string[] = []
afterEach(() => {
  for (const folder of diskWorkspaces.splice(0)) rmSync(folder, { recursive: true, force: true })
})
function diskPolicyFixture() {
  const folder = mkdtempSync(path.join(tmpdir(), 'm116p-lineage-'))
  diskWorkspaces.push(folder)
  return policyFixture(folder)
}

describe('M116 three strikes and durable identity', () => {
  it('permits the build and two fixes, then refuses a fourth patch and requires a design', () => {
    const { policy } = policyFixture()
    const script = threeStrikesScript('impossible', 'host-id')
    const loop = new FakePlaybookReviewLoop(policy, new ScriptedPlaybookReviewer(script))
    for (let round = 0; round < 3; round += 1) {
      expect(policy.beforeFixRound(MODULE).kind).toBe('allow')
      const result = loop.review(MODULE, REVIEW_AGENTS)
      expect(result.kind).toBe('reviewed')
      expect(latestRound(policy).round).toBe(round + 1)
      expect(answerAll(policy).kind).toBe('allow')
    }
    expect(policy.beforeFixRound(MODULE)).toMatchObject({
      kind: 'refuse',
      note: { code: 'redesignRequired', round: 3, classes: ['concurrency'] },
    })
    expect(policy.beforeReview(MODULE, REVIEW_AGENTS).note.code).toBe('designRequired')
    const board = new FakePlaybookBoard()
    board.merge('0', true)
    const drill = {
      guard: 'rounds',
      mutation: 'Raise the limit.',
      test: 'rounds',
      observedFailure: 'Expected refusal.',
      beforeSha256: 'a'.repeat(64),
      restoredSha256: 'a'.repeat(64),
    }
    const mergeLane = {
      ...board.readBoard().lanes[0]!,
      drills: [drill],
      mergedTrunks: ['feature/m116-playbook'],
    }
    expect(policy.beforeMerge(mergeLane)).toMatchObject({
      kind: 'refuse',
      note: { code: 'redesignRequired', module: MODULE.key, round: 3, classes: ['concurrency'] },
    })
    for (const kind of ['patch', 'docs', 'contracts'] as const)
      expect(
        policy.beforeDispatch(
          { ...board.readBoard().lanes[0]!, kind, starts: [] },
          board.readBoard(),
        ).kind,
      ).toBe('refuse')
    const lane = {
      ...board.readBoard().lanes[0]!,
      id: 'R',
      kind: 'redesign' as const,
      starts: [],
      designDecisionId: 'atomic-claim',
    }
    expect(policy.beforeDispatch(lane, board.readBoard()).note.code).toBe('designRequired')
    expect(policy.recordDesignDecision(design()).kind).toBe('allow')
    expect(policy.beforeDispatch(lane, board.readBoard()).kind).toBe('allow')
    expect(policy.beforeFixRound(MODULE).kind).toBe('refuse')
  })

  it.each(['impossible', 'caught', 'remains'] as const)(
    'closes a redesign only on impossible, including %s after restart',
    (outcome) => {
      const fixture = policyFixture()
      strike(fixture.policy)
      const priorId = latestRound(fixture.policy).findings[0]!.id
      fixture.policy.recordDesignDecision(design())
      const review = threeStrikesScript(outcome, priorId).at(-1)!.review
      const result = completeReview(fixture.policy, MODULE, review, REVIEW_AGENTS)
      const policy = new OrchestratorPlaybook(fixture.options)
      expect(result.kind).toBe(outcome === 'impossible' ? 'allow' : 'refuse')
      expect(result.note.needsUser).toBe(outcome !== 'impossible')
      expect(policy.beforeFixRound(MODULE).kind).toBe(outcome === 'impossible' ? 'allow' : 'refuse')
      expect(policy.resolveRedesign(MODULE, review.resolution!).kind).toBe(
        outcome === 'impossible' ? 'allow' : 'refuse',
      )
      expect(
        policy.resolveRedesign(MODULE, [
          { ...review.resolution![0]!, findingId: 'not-the-persisted-answer' },
        ]).kind,
      ).toBe('refuse')
      expect(policy.getRecord().findLast((record) => record.kind === 'design')).toMatchObject({
        value: { outcome },
      })
      if (outcome !== 'impossible')
        expect(latestRound(policy).findings.some((finding) => finding.id === priorId)).toBe(true)
    },
  )

  it('does not close old findings through standalone, duplicate, missing or unknown resolutions', () => {
    const { policy } = policyFixture()
    strike(policy)
    policy.recordDesignDecision(design())
    const id = latestRound(policy).findings[0]!.id
    const valid = { findingId: id, outcome: 'impossible' as const, reason: 'Atomic claim.' }
    expect(policy.resolveRedesign(MODULE, [valid]).kind).toBe('refuse')
    for (const resolution of [[], [valid, valid], [{ ...valid, findingId: 'unknown' }]]) {
      expect(
        completeReview(
          policy,
          MODULE,
          { findings: [], coverage: reviewBlock().coverage, resolution },
          REVIEW_AGENTS,
        ).kind,
      ).toBe('refuse')
      expect(latestRound(policy).round).toBe(3)
    }
  })

  it('keeps caught prior findings even when the redesign review omits its findings array entries', () => {
    const { policy } = policyFixture()
    strike(policy)
    policy.recordDesignDecision(design())
    const findingId = latestRound(policy).findings[0]!.id
    expect(
      completeReview(
        policy,
        MODULE,
        {
          findings: [],
          coverage: reviewBlock().coverage,
          resolution: [
            {
              findingId,
              outcome: 'caught',
              reason: 'The gate catches it but the cause is present.',
            },
          ],
        },
        REVIEW_AGENTS,
      ),
    ).toMatchObject({ kind: 'refuse', note: { code: 'redesignEscalated', needsUser: true } })
    expect(latestRound(policy).findings).toContainEqual(expect.objectContaining({ id: findingId }))
  })

  it('keeps counts per module and class; unknown classes count only in the aggregate', () => {
    const { policy } = policyFixture()
    completeReview(policy, MODULE, reviewBlock(), REVIEW_AGENTS)
    answerAll(policy)
    completeReview(policy, MODULE, reviewBlock('security'), REVIEW_AGENTS)
    answerAll(policy)
    completeReview(policy, MODULE, reviewBlock('future-class'), REVIEW_AGENTS)
    const counts = policy
      .getRecord()
      .filter((entry) => entry.kind === 'round')
      .map((entry) => [entry.value.class, entry.value.round])
    expect(counts).toContainEqual(['concurrency', 1])
    expect(counts).toContainEqual(['security', 1])
    expect(counts).toContainEqual([undefined, 3])
    expect(counts).not.toContainEqual(['future-class', 1])
    const other = newPlaybookModule(['src/host/jobs/a.ts'])
    completeReview(
      policy,
      other,
      { ...reviewBlock(undefined), findings: [{ file: other.files[0]!, title: 'Unclassified' }] },
      REVIEW_AGENTS,
    )
    expect(latestRound(policy, other).round).toBe(1)
    expect(newPlaybookModule(['src/core/schedules/store.ts']).key).toBe('src/core/schedules')
  })

  it('preserves strikes on restart and rename, and refuses new lane/branch identities over the same files', () => {
    const fixture = policyFixture()
    strike(fixture.policy)
    const policy = new OrchestratorPlaybook({
      ...fixture.options,
      teamId: 'new-lane-on-new-branch',
    })
    expect(policy.beforeFixRound(MODULE).kind).toBe('refuse')
    const renamed = {
      ...MODULE,
      key: 'src/core/jobs/claims',
      files: ['src/core/jobs/claims.ts'],
      lineage: { renamedFrom: MODULE.id },
    }
    expect(policy.declareModule(renamed).kind).toBe('allow')
    expect(new OrchestratorPlaybook(fixture.options).beforeFixRound(renamed).kind).toBe('refuse')
    expect(
      policy.declareModule({ ...renamed, id: 'another-lane', lineage: undefined }).note.code,
    ).toBe('lineageRequired')
    expect(
      policy.declareModule({ ...renamed, key: 'different-key', lineage: undefined }).kind,
    ).toBe('refuse')
  })

  it('inherits the maximum aggregate and each class across splits and merges', () => {
    const { policy } = policyFixture()
    strike(policy)
    const split = {
      ...MODULE,
      id: 'split',
      files: ['src/core/schedules/sub.ts'],
      lineage: { splitFrom: MODULE.id },
    }
    expect(policy.declareModule(split).kind).toBe('allow')
    expect(policy.beforeFixRound(split).kind).toBe('refuse')
    const other = newPlaybookModule(['src/host/other/a.ts'])
    completeReview(
      policy,
      other,
      {
        ...reviewBlock('security'),
        findings: [{ file: other.files[0]!, title: 'Other', severity: 'P3', class: 'security' }],
      },
      REVIEW_AGENTS,
    )
    answerAll(policy, other)
    const merged = {
      ...MODULE,
      id: 'merged',
      key: 'src/merged',
      files: ['src/merged/a.ts'],
      lineage: { mergedFrom: [MODULE.id, other.id] },
    }
    expect(policy.declareModule(merged).kind).toBe('allow')
    expect(policy.beforeFixRound(merged).kind).toBe('refuse')
    policy.recordDesignDecision(design(merged))
    const result = completeReview(policy, merged, reviewBlock('security'), REVIEW_AGENTS)
    expect(result.kind).toBe('refuse') // every inherited id needs a resolution
    expect(
      policy
        .getRecord()
        .some((entry) => entry.kind === 'module' && entry.value.module.id === 'merged'),
    ).toBe(true)
    const resolution = [latestRound(policy), latestRound(policy, other)].flatMap((round) =>
      round.findings.map((finding) => ({
        findingId: finding.id,
        outcome: 'impossible' as const,
        reason: 'Replaced structurally.',
      })),
    )
    expect(
      completeReview(
        policy,
        merged,
        { findings: [], coverage: reviewBlock().coverage, resolution },
        REVIEW_AGENTS,
      ).kind,
    ).toBe('allow')
    completeReview(
      policy,
      merged,
      {
        ...reviewBlock('concurrency'),
        findings: [{ ...reviewBlock().findings[0]!, file: merged.files[0]! }],
      },
      REVIEW_AGENTS,
    )
    expect(latestRound(policy, merged).round).toBe(5)
    expect(
      policy
        .getRecord()
        .findLast(
          (entry) =>
            entry.kind === 'round' &&
            entry.value.module.id === merged.id &&
            entry.value.class === 'concurrency',
        ),
    ).toMatchObject({ value: { round: 4 } })
    answerAll(policy, merged)
    completeReview(
      policy,
      merged,
      {
        ...reviewBlock('security'),
        findings: [{ ...reviewBlock('security').findings[0]!, file: merged.files[0]! }],
      },
      REVIEW_AGENTS,
    )
    expect(
      policy
        .getRecord()
        .findLast(
          (entry) =>
            entry.kind === 'round' &&
            entry.value.module.id === merged.id &&
            entry.value.class === 'security',
        ),
    ).toMatchObject({ value: { round: 2 } })
  })

  it('rejects invalid predecessor ids, identity-changing renames and overlapping globs; audits only authorized overrides', () => {
    const fixture = policyFixture()
    strike(fixture.policy)
    for (const lineage of [
      { splitFrom: 'missing' },
      { renamedFrom: MODULE.id },
      { mergedFrom: [MODULE.id, MODULE.id] },
    ])
      expect(fixture.policy.declareModule({ ...MODULE, id: 'replacement', lineage }).kind).toBe(
        'refuse',
      )
    expect(
      fixture.policy.declareModule({
        ...MODULE,
        id: 'unrelated',
        key: 'src/unrelated',
        files: ['src/unrelated/a.ts'],
        lineage: { splitFrom: 'missing' },
      }).note.code,
    ).toBe('lineageRequired')
    const replacement = {
      ...MODULE,
      id: 'replacement',
      key: 'src/core/schedules',
      files: ['src/core/schedules/**'],
    }
    const override = { actor: 'owner' as const, reason: 'A deliberate replacement.', at: 100 }
    expect(fixture.policy.declareModule(replacement, override).kind).toBe('refuse')
    fixture.authority.mockReturnValue(true)
    expect(fixture.policy.declareModule(replacement, override).kind).toBe('refuse')
    expect(
      fixture.policy.declareModule({ ...replacement, lineage: { splitFrom: MODULE.id } }, override)
        .kind,
    ).toBe('allow')
    expect(fixture.policy.getRecord().findLast((entry) => entry.kind === 'module')).toMatchObject({
      value: { override },
    })
  })

  it('starts a fresh patch epoch after a structurally closed redesign without erasing lifetime counts', () => {
    const { policy } = policyFixture()
    strike(policy)
    policy.recordDesignDecision(design())
    const resolution = [
      {
        findingId: latestRound(policy).findings[0]!.id,
        outcome: 'impossible' as const,
        reason: 'Atomic claim.',
      },
    ]
    completeReview(
      policy,
      MODULE,
      { findings: [], coverage: reviewBlock().coverage, resolution },
      REVIEW_AGENTS,
    )
    completeReview(policy, MODULE, reviewBlock('docs', 'P3'), REVIEW_AGENTS)
    expect(latestRound(policy)).toMatchObject({ round: 5, phase: 'build' })
    expect(policy.beforeFixRound(MODULE).kind).toBe('allow')
  })

  it('requires lineage before predeclaring overlaps and shares subsequent strikes after restart', () => {
    const fixture = policyFixture()
    expect(fixture.policy.declareModule(MODULE).kind).toBe('allow')
    const alias = { ...MODULE, id: 'predeclared', key: 'src/another-module' }
    expect(fixture.policy.declareModule(alias)).toMatchObject({
      kind: 'refuse',
      note: { code: 'lineageRequired' },
    })
    const linked = { ...alias, lineage: { splitFrom: MODULE.id } }
    expect(fixture.policy.declareModule(linked).kind).toBe('allow')
    strike(fixture.policy)
    const restarted = new OrchestratorPlaybook({ ...fixture.options, teamId: 'other' })
    expect(restarted.beforeFixRound(linked)).toMatchObject({
      kind: 'refuse',
      note: { code: 'redesignRequired' },
    })
    const board = new FakePlaybookBoard()
    board.merge('0', true)
    expect(
      restarted.beforeDispatch(
        { ...board.readBoard().lanes[0]!, module: linked, starts: [] },
        board.readBoard(),
      ).kind,
    ).toBe('refuse')
    const renamed = {
      ...MODULE,
      files: ['src/core/new/store.ts'],
      key: 'src/core/new',
      lineage: { renamedFrom: MODULE.id },
    }
    expect(restarted.declareModule(renamed).kind).toBe('allow')
    expect(restarted.declareModule({ ...alias, id: 'historical-overlap' }).note.code).toBe(
      'lineageRequired',
    )
  })

  it('requires lineage for moved content hashes without trusting the new module id', () => {
    const fixture = diskPolicyFixture()
    const oldPath = path.join(fixture.options.workspaceFolder, MODULE.files[0]!)
    const newFile = 'src/core/claims/store.ts'
    const newPath = path.join(fixture.options.workspaceFolder, newFile)
    mkdirSync(path.dirname(oldPath), { recursive: true })
    mkdirSync(path.dirname(newPath), { recursive: true })
    writeFileSync(oldPath, 'export const claim = () => "atomic"\n')
    fixture.policy.declareModule(MODULE)
    strike(fixture.policy)
    renameSync(oldPath, newPath)
    const moved = {
      ...MODULE,
      id: 'fresh-id',
      key: 'src/core/claims',
      files: [String.raw`src\core\claims\store.ts`],
    }
    const restarted = new OrchestratorPlaybook(fixture.options)
    expect(restarted.declareModule(moved).note.code).toBe('lineageRequired')
    const linked = { ...moved, lineage: { splitFrom: MODULE.id } }
    expect(restarted.declareModule(linked).kind).toBe('allow')
    expect(restarted.beforeFixRound(linked).kind).toBe('refuse')
    expect(JSON.stringify(restarted.getRecord())).not.toContain('export const')
    const unrelated = newPlaybookModule(['src/independent/new.ts'])
    expect(restarted.declareModule(unrelated).kind).toBe('allow')
  })

  it('uses trusted Git rename detection when moved code has a different content hash', () => {
    const fixture = diskPolicyFixture()
    const workspace = fixture.options.workspaceFolder
    const git = (args: string[]) => execFileSync('git', args, { cwd: workspace, stdio: 'pipe' })
    git(['init'])
    const oldPath = path.join(workspace, MODULE.files[0]!)
    mkdirSync(path.dirname(oldPath), { recursive: true })
    const source = Array.from(
      { length: 30 },
      (_, i) => `export const claim${String(i)} = ${String(i)};`,
    ).join('\n')
    writeFileSync(oldPath, source)
    git(['add', '--', '.'])
    git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '-m',
      'Fixture baseline',
    ])
    fixture.policy.declareModule(MODULE)
    strike(fixture.policy)
    const file = 'src/core/claims/store.ts'
    const destination = path.join(workspace, file)
    mkdirSync(path.dirname(destination), { recursive: true })
    renameSync(oldPath, destination)
    writeFileSync(destination, `${source}\nexport const changed = true;\n`)
    git(['add', '--', '.'])
    const moved = { ...MODULE, id: 'new-identity', key: 'src/core/claims', files: [file] }
    expect(new OrchestratorPlaybook(fixture.options).declareModule(moved).note.code).toBe(
      'lineageRequired',
    )
  })

  it('keeps a failed redesign escalated until a recorded real user decision', () => {
    const fixture = policyFixture()
    strike(fixture.policy)
    fixture.policy.recordDesignDecision(design())
    const review = threeStrikesScript('remains', latestRound(fixture.policy).findings[0]!.id).at(
      -1,
    )!.review
    expect(completeReview(fixture.policy, MODULE, review, REVIEW_AGENTS).note.needsUser).toBe(true)
    answerAll(fixture.policy)
    const replacement = { ...design(), id: 'renamed-design', redesignLane: 'R2' }
    const restarted = new OrchestratorPlaybook(fixture.options)
    expect(restarted.recordDesignDecision(replacement)).toMatchObject({
      kind: 'refuse',
      note: { code: 'redesignEscalated', needsUser: true },
    })
    const board = new FakePlaybookBoard()
    board.merge('0', true)
    const lane = {
      ...board.readBoard().lanes[0]!,
      id: 'R2',
      kind: 'redesign' as const,
      starts: [],
      designDecisionId: replacement.id,
    }
    expect(restarted.beforeDispatch(lane, board.readBoard()).note.needsUser).toBe(true)
    fixture.authority.mockReturnValue(true)
    expect(restarted.recordDesignDecision(replacement).kind).toBe('allow')
    const approved = new OrchestratorPlaybook(fixture.options)
    expect(approved.beforeDispatch(lane, board.readBoard()).kind).toBe('allow')
    expect(approved.getRecord()).toContainEqual(
      expect.objectContaining({
        kind: 'note',
        value: expect.objectContaining({
          actor: 'owner',
          laneId: 'playbook-redesign-user-decision',
        }),
      }),
    )
  })

  it('reserves a patch durably across orchestrators through complete review publication', () => {
    const fixture = policyFixture()
    for (let round = 0; round < 2; round += 1) {
      completeReview(fixture.policy, MODULE, reviewBlock(), REVIEW_AGENTS)
      answerAll(fixture.policy)
    }
    const other = new OrchestratorPlaybook({ ...fixture.options, teamId: 'other' })
    expect(fixture.policy.beforeFixRound(MODULE).kind).toBe('allow')
    expect(other.beforeFixRound(MODULE)).toMatchObject({
      kind: 'refuse',
      note: { missing: ['patchReservation'] },
    })
    expect(completeReview(other, MODULE, reviewBlock(), REVIEW_AGENTS).kind).toBe('refuse')
    expect(other.releasePatch(MODULE).kind).toBe('refuse')
    const board = new FakePlaybookBoard()
    board.merge('0', true)
    const lane = { ...board.readBoard().lanes[0]!, starts: [] }
    expect(other.beforeDispatch(lane, board.readBoard()).kind).toBe('refuse')
    fixture.advance(PLAYBOOK_LAUNDER_WINDOW_MS - 1)
    expect(fixture.policy.renewPatch(MODULE).kind).toBe('allow')
    fixture.advance(1)
    expect(new OrchestratorPlaybook(fixture.options).beforeFixRound(MODULE).kind).toBe('refuse')
    expect(completeReview(fixture.policy, MODULE, reviewBlock(), REVIEW_AGENTS).note.code).toBe(
      'redesignRequired',
    )
    answerAll(fixture.policy)
    expect(other.beforeFixRound(MODULE).note.code).toBe('redesignRequired')
  })

  it('releases canceled work, expires a crashed holder, and refuses its stale review', () => {
    const fixture = policyFixture()
    fixture.policy.beforeFixRound(MODULE)
    const other = new OrchestratorPlaybook(fixture.options)
    expect(other.beforeFixRound(MODULE).kind).toBe('refuse')
    expect(fixture.policy.releasePatch(MODULE).kind).toBe('allow')
    const expiredAdmission = other.beforeFixRound(MODULE)
    expect(expiredAdmission.kind).toBe('allow')
    fixture.advance(PLAYBOOK_LAUNDER_WINDOW_MS)
    expect(other.renewPatch(MODULE).kind).toBe('refuse')
    expect(
      other.afterReview(
        MODULE,
        reviewBlock(),
        REVIEW_AGENTS,
        expiredAdmission.kind === 'allow' ? expiredAdmission.lease : undefined,
      ).kind,
    ).toBe('refuse')
    expect(fixture.policy.beforeFixRound(MODULE).kind).toBe('allow')
    expect(other.beforeFixRound(MODULE).kind).toBe('refuse')
    expect(completeReview(fixture.policy, MODULE, reviewBlock(), REVIEW_AGENTS).kind).toBe('allow')
    answerAll(fixture.policy)
    expect(other.beforeFixRound(MODULE).kind).toBe('allow')
  })

  it('rejects path traversal and absolute module selectors and validates all design fields', () => {
    const { policy } = policyFixture()
    for (const file of ['../outside.ts', '/absolute.ts', String.raw`C:\repo\a.ts`, 'src/../a.ts'])
      expect(() => newPlaybookModule([file])).toThrow()
    expect(() => newPlaybookModule([])).toThrow()
    expect(
      newPlaybookModule([String.raw`src\core\jobs\a.ts`], { source: 'team', key: 'src/core/jobs' }),
    ).toMatchObject({ source: 'team', files: ['src/core/jobs/a.ts'] })
    completeReview(policy, MODULE, reviewBlock(), REVIEW_AGENTS)
    for (const field of [
      'failureClass',
      'whyPatchesFailed',
      'structuralChange',
      'planLocation',
      'redesignLane',
    ] as const)
      expect(() => policy.recordDesignDecision({ ...design(), [field]: ' ' })).toThrow()
    expect(policy.recordDesignDecision({ ...design(), outcome: 'impossible' }).kind).toBe('refuse')
  })
})
