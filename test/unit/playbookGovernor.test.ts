// The panel's governor (M116, C-M116-6) over the real policy, a real journal
// file, a real git repository and its real hooks. What counts, what is left
// alone, and what the third strike does to a conversation's next dispatch.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, symlinkSync } from 'node:fs'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import type { PlaybookRecord } from '../../src/shared/playbook'
import type { ReviewBlock } from '../../src/shared/reviewFindings'
import { reviewedChanges, type PanelChild } from '../../src/core/orchestration/panelLanes'
import {
  PanelGovernor,
  type PanelModuleSummary,
  type PanelReviewProgress,
} from '../../src/runtime/playbook/governor'
import { parsePlaybookCommand, playbookSnapshotSchema } from '../../src/runtime/playbook/command'
import {
  coveredReview,
  GOVERNED_ROUND_TIMEOUT_MS,
  PANEL_FILES,
  panelRepository,
  panelRepositoryTemplate,
  recordedPanelEvents,
  reviewReply,
  turnEnd,
  type PanelRepository,
} from './helpers/playbook/panelRepository'

const SESSION = 'conversation-1'
const CHILD: PanelChild = {
  agentId: 'subagent-1',
  sessionId: `${SESSION}:subagent-1`,
  files: [PANEL_FILES.store, PANEL_FILES.clock],
}
const RACE = {
  file: PANEL_FILES.store,
  line: 3,
  severity: 'high',
  title: 'The claim is read and written in two steps',
  class: 'concurrency',
}
const SCHEDULES = 'src/core/schedules'

const template: { made?: ReturnType<typeof panelRepositoryTemplate> } = {}
const open: PanelRepository[] = []

beforeAll(() => {
  template.made = panelRepositoryTemplate()
})
afterEach(() => {
  for (const repository of open.splice(0)) repository.remove()
})
afterAll(() => {
  template.made?.remove()
})

function governed() {
  if (template.made === undefined) throw new Error('The repository template was not made')
  const repository = panelRepository(template.made.directory)
  open.push(repository)
  const events = recordedPanelEvents()
  let now = 1_700_000_000_000
  const governor = new PanelGovernor({
    agentDataFolder: repository.dataFolder,
    workspaceFolder: repository.workspace,
    hookAdmission: repository.hookAdmission,
    events,
    // Each decision is a later moment, as real ones are.
    now: () => {
      now += 1000
      return now
    },
  })
  return { repository, events, governor }
}

type Governed = ReturnType<typeof governed>

/** One whole review of `files`: opened, replied, ended and bound, as the controller drives it. */
function review(
  setup: Governed,
  block: ReviewBlock,
  files: readonly string[] = [PANEL_FILES.store, PANEL_FILES.clock],
  children: readonly PanelChild[] = [CHILD],
): PanelReviewProgress {
  const reviewId = randomUUID()
  const turnId = `turn-${reviewId}`
  expect(setup.governor.openReview(reviewId, SESSION, files, children).kind).toBe('playbook')
  setup.governor.observeReview(reviewId, reviewReply(turnId, block))
  setup.governor.observeReview(reviewId, turnEnd(turnId))
  return setup.governor.bindReview(reviewId, turnId)
}

function answerAll(setup: Governed, rounds: readonly PanelModuleSummary[]): void {
  for (const round of rounds) {
    if (round.findings.length === 0) continue
    expect(
      setup.governor.answer(
        SESSION,
        round.moduleId,
        round.findings.map((finding) => ({ findingId: finding.id, status: 'fixed' as const })),
      ),
    ).toBe(true)
  }
}

/** Three counted reviews of the same module, each still finding the race, each answered. */
function struck(setup: Governed): PanelModuleSummary {
  let last: PanelModuleSummary | undefined
  for (let round = 1; round <= 3; round += 1) {
    const progress = review(setup, coveredReview([RACE]))
    expect(progress.isClosed).toBe(true)
    ;[last] = progress.rounds
    expect(last?.round).toBe(round)
    answerAll(setup, progress.rounds)
  }
  if (last === undefined) throw new Error('No round was counted')
  return last
}

function rounds(records: readonly PlaybookRecord[]) {
  return records.flatMap((record) =>
    record.kind === 'round' && record.value.class === undefined ? [record.value] : [],
  )
}

function thrownBy(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

async function journal(setup: Governed): Promise<readonly PlaybookRecord[]> {
  return playbookSnapshotSchema.parse(await setup.governor.read()).records
}

const callbacks = (effect = vi.fn(() => Promise.resolve())) => ({
  effect,
  completion: vi.fn((_signal: AbortSignal) => Promise.resolve()),
})

describe('what a review counts in', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('leaves a review of files no child changed alone: no journal, no git call', () => {
    const setup = governed()
    for (const children of [
      [],
      // The conversation is nobody's child, least of all its own.
      [{ ...CHILD, sessionId: SESSION }],
      [{ ...CHILD, files: [PANEL_FILES.notes] }],
    ])
      expect(
        setup.governor.openReview(randomUUID(), SESSION, [PANEL_FILES.store], children),
      ).toEqual({ kind: 'ordinary' })
    expect(existsSync(setup.repository.dataFolder)).toBe(false)
    expect(setup.repository.effects).toEqual([])
    expect(setup.events.notes).toEqual([])
  })

  it('counts one round per directory a child changed, with the child as implementer', async () => {
    const setup = governed()
    const second: PanelChild = {
      agentId: 'subagent-2',
      sessionId: `${SESSION}:subagent-2`,
      files: [PANEL_FILES.panel],
    }
    const files = Object.values(PANEL_FILES)
    const reviewId = randomUUID()
    const opening = setup.governor.openReview(reviewId, SESSION, files, [CHILD, second])
    expect(opening).toEqual({
      kind: 'playbook',
      modules: [
        expect.objectContaining({ moduleKey: SCHEDULES, prior: undefined, design: undefined }),
        expect.objectContaining({ moduleKey: 'src/webview/panel', prior: undefined }),
      ],
    })
    const block = coveredReview([
      RACE,
      // Nobody's child changed the notes: this finding is counted nowhere.
      { file: PANEL_FILES.notes, severity: 'low', title: 'A stale paragraph', class: 'docs' },
    ])
    setup.governor.observeReview(reviewId, reviewReply('turn', block))
    setup.governor.observeReview(reviewId, turnEnd('turn'))
    const progress = setup.governor.bindReview(reviewId, 'turn')
    expect(progress.isClosed).toBe(true)
    expect(progress.rounds.map((round) => [round.moduleKey, round.round, round.phase])).toEqual([
      [SCHEDULES, 1, 'build'],
      ['src/webview/panel', 1, 'build'],
    ])
    expect(progress.rounds[0]?.findings).toEqual([
      expect.objectContaining({
        file: PANEL_FILES.store,
        line: 3,
        severity: 'P2',
        class: 'concurrency',
        title: RACE.title,
        isAnswered: false,
      }),
    ])
    expect(progress.rounds[1]?.findings).toEqual([])
    const counted = rounds(await journal(setup))
    expect(
      counted.map((round) => [round.module.key, round.implementerId, round.reviewerId]),
    ).toEqual([
      [SCHEDULES, 'subagent-1', `conversation:${SESSION}`],
      ['src/webview/panel', 'subagent-2', `conversation:${SESSION}`],
    ])
    expect(counted.every((round) => round.reviewerSessionId === SESSION)).toBe(true)
    expect(counted.map((round) => round.implementerSessionId)).toEqual([
      CHILD.sessionId,
      second.sessionId,
    ])
  })

  it('keeps a module and its count when the next round changes more of its files', async () => {
    const setup = governed()
    const first = review(
      setup,
      coveredReview([RACE]),
      [PANEL_FILES.store],
      [{ ...CHILD, files: [PANEL_FILES.store] }],
    )
    answerAll(setup, first.rounds)
    const second = review(setup, coveredReview([RACE]))
    expect(second.rounds[0]?.moduleId).toBe(first.rounds[0]?.moduleId)
    expect(second.rounds[0]?.round).toBe(2)
    const records = await journal(setup)
    const modules = records.flatMap((record) =>
      record.kind === 'module' ? [record.value.module] : [],
    )
    expect(modules.at(-1)).toMatchObject({
      key: SCHEDULES,
      files: [PANEL_FILES.clock, PANEL_FILES.store],
      lineage: { renamedFrom: first.rounds[0]?.moduleId },
    })
  })

  it('carries a module’s strikes to the directory its code was moved to', () => {
    const setup = governed()
    const first = review(setup, coveredReview([RACE]))
    answerAll(setup, first.rounds)
    mkdirSync(path.join(setup.repository.workspace, 'src/core/timers'))
    setup.repository.git(['mv', PANEL_FILES.store, 'src/core/timers/store.ts'])
    const moved = 'src/core/timers/store.ts'
    const progress = review(
      setup,
      coveredReview([{ ...RACE, file: moved }]),
      [moved],
      [{ ...CHILD, files: [moved] }],
    )
    expect(progress.rounds).toEqual([
      expect.objectContaining({ moduleKey: 'src/core/timers', round: 2, phase: 'fix' }),
    ])
    expect(progress.rounds[0]?.moduleId).not.toBe(first.rounds[0]?.moduleId)
  })

  it('refuses the next review until every finding of the last one is answered', () => {
    const setup = governed()
    const [first] = review(setup, coveredReview([RACE, { ...RACE, line: 9 }])).rounds
    if (first === undefined) throw new Error('No round was counted')
    expect(
      thrownBy(() =>
        setup.governor.openReview(randomUUID(), SESSION, [PANEL_FILES.store], [CHILD]),
      ),
    ).toMatchObject({ name: 'PlaybookRefusedError' })
    expect(setup.events.notes.at(-1)?.note).toMatchObject({
      code: 'answersPending',
      module: SCHEDULES,
    })
    // One answer of two is not an answer to the review.
    const [one, two] = first.findings
    if (one === undefined || two === undefined) throw new Error('Two findings were expected')
    expect(
      setup.governor.answer(SESSION, first.moduleId, [{ findingId: one.id, status: 'fixed' }]),
    ).toBe(false)
    // A dispute waives nothing above the lowest severity.
    expect(
      setup.governor.answer(SESSION, first.moduleId, [
        { findingId: one.id, status: 'fixed' },
        { findingId: two.id, status: 'disputed', reason: 'It cannot happen in practice.' },
      ]),
    ).toBe(false)
    expect(
      setup.governor.standing(SESSION)[0]?.findings.every((finding) => !finding.isAnswered),
    ).toBe(true)
    answerAll(setup, [first])
    expect(
      setup.governor.standing(SESSION)[0]?.findings.every((finding) => finding.isAnswered),
    ).toBe(true)
    expect(review(setup, coveredReview([])).rounds[0]?.round).toBe(2)
  })

  it('counts nothing for a reply it cannot certify', async () => {
    const setup = governed()
    for (const reply of ['{"findings": "none"}', '{}']) {
      const reviewId = randomUUID()
      setup.governor.openReview(reviewId, SESSION, [PANEL_FILES.store], [CHILD])
      expect(() => setup.governor.observeReview(reviewId, reviewReply('bad', reply))).toThrow(
        UI_TEXT.playbookUnavailable,
      )
      // The failed review let go of its lease: the next one is admitted.
    }
    const cancelled = randomUUID()
    setup.governor.openReview(cancelled, SESSION, [PANEL_FILES.store], [CHILD])
    setup.governor.observeReview(cancelled, reviewReply('stopped', coveredReview([RACE])))
    expect(setup.governor.observeReview(cancelled, turnEnd('stopped', 'cancelled')).isClosed).toBe(
      false,
    )
    expect(setup.governor.bindReview(cancelled, 'stopped')).toEqual({ isClosed: true, rounds: [] })
    const partial = randomUUID()
    setup.governor.openReview(partial, SESSION, [PANEL_FILES.store], [CHILD])
    setup.governor.observeReview(
      partial,
      reviewReply('partial', { findings: [RACE], coverage: ['concurrency'] }),
    )
    setup.governor.observeReview(partial, turnEnd('partial'))
    expect(setup.governor.bindReview(partial, 'partial')).toEqual({ isClosed: true, rounds: [] })
    expect(setup.events.notes.at(-1)?.note.code).toBe('coverageIncomplete')
    expect(rounds(await journal(setup))).toEqual([])
  })
})

/** A second way to the same directory, as a relocated folder or a junction gives. */
function linked(setup: Governed): string {
  const { workspace } = setup.repository
  symlinkSync(path.join(workspace, 'src', 'core'), path.join(workspace, 'alias'), 'junction')
  return 'alias/schedules/store.ts'
}

describe('which file a path names', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('counts a child’s file reviewed through a link to it, under the file’s own name', () => {
    const setup = governed()
    const through = linked(setup)
    const progress = review(setup, coveredReview([{ ...RACE, file: through }]), [through], [CHILD])
    expect(progress.rounds).toEqual([
      expect.objectContaining({
        moduleKey: SCHEDULES,
        round: 1,
        findings: [expect.objectContaining({ file: PANEL_FILES.store })],
      }),
    ])
  })

  it('counts it when the host recorded the child’s change through the link', () => {
    const setup = governed()
    const through = path.join(setup.repository.workspace, linked(setup))
    // An absolute path through the link, as a backend may report a change.
    const child = { ...CHILD, files: [through] }
    expect(review(setup, coveredReview([RACE]), [PANEL_FILES.store], [child]).rounds).toEqual([
      expect.objectContaining({ moduleKey: SCHEDULES, round: 1 }),
    ])
  })

  it('counts it in another case where the file system has no case, and only there', () => {
    const setup = governed()
    const shouted = PANEL_FILES.store.replace('src', 'SRC')
    const opening = setup.governor.openReview(randomUUID(), SESSION, [shouted], [CHILD])
    // One file under two spellings is one file; two files stay two.
    expect(opening.kind).toBe(
      existsSync(path.join(setup.repository.workspace, shouted)) ? 'playbook' : 'ordinary',
    )
  })

  it('classifies a review once, for the window and the governor alike', () => {
    const setup = governed()
    const { workspace } = setup.repository
    const through = linked(setup)
    const outside = path.join(setup.repository.root, 'elsewhere.ts')
    const changes = (files: readonly string[], children: readonly PanelChild[]) =>
      reviewedChanges(workspace, SESSION, files, children).map((change) => change.file)
    // Each reviewed file a child changed, once, under the journal's name for it.
    expect(
      changes(
        [through, PANEL_FILES.store, PANEL_FILES.notes, outside],
        [{ ...CHILD, files: [PANEL_FILES.store, through, PANEL_FILES.clock, outside] }],
      ),
    ).toEqual([PANEL_FILES.store])
    // No overlap, no child, or only the conversation's own session: an ordinary review.
    expect(changes([PANEL_FILES.notes], [CHILD])).toEqual([])
    expect(changes([PANEL_FILES.store], [])).toEqual([])
    expect(changes([PANEL_FILES.store], [{ ...CHILD, sessionId: SESSION }])).toEqual([])
    expect(changes([], [CHILD])).toEqual([])
  })

  it('knows a file that is gone by its spelling, without regard to case on Windows alone', () => {
    const setup = governed()
    const shouted = 'src/core/schedules/REMOVED.ts'
    const changes = reviewedChanges(
      setup.repository.workspace,
      SESSION,
      [shouted],
      [{ ...CHILD, files: [shouted.toLowerCase()] }],
    )
    // Nothing on disk can say whether the two are one file; Windows names files without case.
    expect(changes.map((change) => change.file)).toEqual(
      process.platform === 'win32' ? [shouted] : [],
    )
  })
})

describe('what the third strike does', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('offers a redesign and refuses the next dispatch on that module, saying why', async () => {
    const setup = governed()
    const third = struck(setup)
    expect(setup.events.offers.map((offer) => [offer.sessionId, offer.module.key])).toContainEqual([
      SESSION,
      SCHEDULES,
    ])
    expect(setup.events.notes.map((entry) => entry.note.code)).toContain('redesignRequired')
    const fourth = callbacks()
    await expect(
      setup.governor.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId, isTrusted: true },
        fourth,
      ),
    ).rejects.toMatchObject({
      name: 'PlaybookRefusedError',
      note: { rule: 'threeStrikes', code: 'redesignRequired', module: SCHEDULES, round: 3 },
    })
    expect(fourth.effect).not.toHaveBeenCalled()
    expect(fourth.completion).not.toHaveBeenCalled()
    // The patch rounds are spent and no decision is recorded: one is due, and the panel asks for it.
    expect(setup.governor.standing(SESSION)).toEqual([
      expect.objectContaining({
        moduleId: third.moduleId,
        round: 3,
        design: undefined,
        isRedesignDue: true,
      }),
    ])
    // The refusal is in the record, for the Agent map and the page.
    expect(setup.governor.agentRecords([{ itemId: 'row-1', ...CHILD }])['row-1']).toContainEqual(
      expect.objectContaining({
        kind: 'note',
        value: expect.objectContaining({ code: 'redesignRequired', module: SCHEDULES }),
      }),
    )
  })

  it('says a redesign is due by the journal’s own settings: the limit as lowered, and the rule as switched', async () => {
    const setup = governed()
    const first = review(setup, coveredReview([RACE]))
    // One strike, with two fix rounds allowed: nothing is due.
    expect(setup.governor.standing(SESSION)[0]).toMatchObject({ round: 1, isRedesignDue: false })
    answerAll(setup, first.rounds)
    // The team allows one fix round only: the second strike spends it.
    await setup.governor.change({ patchRoundsMax: 1 })
    review(setup, coveredReview([RACE]))
    expect(setup.governor.standing(SESSION)[0]).toMatchObject({ round: 2, isRedesignDue: true })
    // With the rule turned off nothing is asked for.
    await setup.governor.change({ rule: 'threeStrikes', enabled: false, reason: 'A spike.' })
    expect(setup.governor.standing(SESSION)[0]).toMatchObject({ round: 2, isRedesignDue: false })
  })

  it('runs the redesign once its decision is recorded, and closes only on impossible', async () => {
    const setup = governed()
    const third = struck(setup)
    const decision = {
      failureClass: 'concurrency',
      whyPatchesFailed: 'Each patch kept the read and the write apart.',
      structuralChange: 'One atomic claim replaces the two steps.',
      planLocation: 'PLAN.md#D200',
    }
    expect(setup.governor.recordDesign(SESSION, third.moduleId, decision)).toBe(true)
    // A decision that waits for its review is not asked for again.
    expect(setup.governor.standing(SESSION)[0]).toMatchObject({
      design: 'pending',
      isRedesignDue: false,
    })
    const redesign = callbacks()
    await expect(
      setup.governor.dispatch(
        { kind: 'subagent', sessionId: SESSION, targetId: undefined, isTrusted: true },
        redesign,
      ),
    ).resolves.toBe('completed')
    expect(redesign.effect).toHaveBeenCalledOnce()
    expect(redesign.completion).toHaveBeenCalledOnce()
    // The redesign's review is given the prior ids and the decision it must judge.
    const reviewId = randomUUID()
    const opening = setup.governor.openReview(reviewId, SESSION, [PANEL_FILES.store], [CHILD])
    if (opening.kind !== 'playbook') throw new Error('A playbook review was expected')
    const [target] = opening.modules
    expect(target?.prior?.findings.map((finding) => finding.id)).toEqual(
      third.findings.map((finding) => finding.id),
    )
    expect(target?.design).toMatchObject({ ...decision, outcome: 'pending' })
    setup.governor.observeReview(
      reviewId,
      reviewReply(
        'redesign',
        coveredReview(
          [],
          third.findings.map((finding) => ({
            findingId: finding.id,
            outcome: 'impossible' as const,
            reason: 'The claim is one atomic operation now.',
          })),
        ),
      ),
    )
    setup.governor.observeReview(reviewId, turnEnd('redesign'))
    const closed = setup.governor.bindReview(reviewId, 'redesign')
    expect(closed.rounds).toEqual([
      expect.objectContaining({ phase: 'redesign', round: 4, findings: [], design: 'impossible' }),
    ])
    expect(setup.governor.standing(SESSION)).toEqual([])
    const after = callbacks()
    await expect(
      setup.governor.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId, isTrusted: true },
        after,
      ),
    ).resolves.toBe('ungoverned')
    expect(after.effect).not.toHaveBeenCalled()
  })

  it('puts a redesign that only catches the failure in front of the person', () => {
    const setup = governed()
    const third = struck(setup)
    const decision = {
      failureClass: 'concurrency',
      whyPatchesFailed: 'Each patch kept the read and the write apart.',
      structuralChange: 'A check now detects the interleaving.',
      planLocation: 'PLAN.md#D201',
    }
    setup.governor.recordDesign(SESSION, third.moduleId, decision)
    const caught = review(
      setup,
      coveredReview(
        [],
        third.findings.map((finding) => ({
          findingId: finding.id,
          outcome: 'caught' as const,
          reason: 'A test fails when the steps interleave.',
        })),
      ),
    )
    expect(caught.rounds[0]).toMatchObject({ design: 'caught', isEscalated: true })
    expect(setup.events.notes.at(-1)?.note).toMatchObject({
      code: 'redesignEscalated',
      needsUser: true,
    })
    // Only the person's own decision in the panel opens another redesign.
    expect(
      setup.governor.recordDesign(SESSION, third.moduleId, {
        ...decision,
        structuralChange: 'One atomic claim replaces the two steps.',
        planLocation: 'PLAN.md#D202',
      }),
    ).toBe(true)
    expect(setup.governor.standing(SESSION)[0]).toMatchObject({
      design: 'pending',
      isEscalated: false,
    })
  })
})

describe('a governed dispatch', { timeout: GOVERNED_ROUND_TIMEOUT_MS }, () => {
  it('is not the playbook’s while the conversation has no module under review', async () => {
    const setup = governed()
    const dispatch = callbacks()
    for (const isTrusted of [true, false])
      await expect(
        setup.governor.dispatch(
          { kind: 'bestOfN', sessionId: SESSION, targetId: undefined, isTrusted },
          dispatch,
        ),
      ).resolves.toBe('ungoverned')
    expect(dispatch.effect).not.toHaveBeenCalled()
    expect(existsSync(setup.repository.dataFolder)).toBe(false)
    expect(setup.repository.effects).toEqual([])
  })

  it('admits before the work, waits for the child, then verifies what it committed', async () => {
    const setup = governed()
    answerAll(setup, review(setup, coveredReview([RACE])).rounds)
    const order: string[] = []
    let committed = ''
    const dispatch = {
      effect: vi.fn(() => {
        order.push('effect')
        return Promise.resolve()
      }),
      completion: vi.fn((_signal: AbortSignal) => {
        setup.repository.write(PANEL_FILES.store, 'export const claim = "atomic"\n')
        committed = setup.repository.commit('fix: one atomic claim')
        order.push('completion')
        return Promise.resolve()
      }),
    }
    const before = setup.repository.effects.length
    await expect(
      setup.governor.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId, isTrusted: true },
        dispatch,
      ),
    ).resolves.toBe('completed')
    expect(order).toEqual(['effect', 'completion'])
    const records = await journal(setup)
    expect(records).toContainEqual(
      expect.objectContaining({
        kind: 'verification',
        value: expect.objectContaining({ commit: committed, scope: 'commit', result: 'pass' }),
      }),
    )
    // The repository's own hooks ran, natively, on that commit.
    expect(
      setup.repository.effects.slice(before).filter((effect) => effect.kind === 'hook'),
    ).toHaveLength(2)
    // The lease was let go: the module's next round can be admitted.
    expect(
      records.flatMap((record) => (record.kind === 'lease' ? [record.value.status] : [])).at(-1),
    ).toBe('released')
  })

  it('refuses completion when a commit skipped the repository’s hook, and shows its output', async () => {
    const setup = governed()
    answerAll(setup, review(setup, coveredReview([RACE])).rounds)
    setup.repository.hook('pre-commit', 'echo "lint failed on the claim" >&2; exit 1')
    const dispatch = {
      effect: vi.fn(() => Promise.resolve()),
      completion: vi.fn((_signal: AbortSignal) => {
        setup.repository.write(PANEL_FILES.store, 'export const claim = "racy"\n')
        setup.repository.git(['add', '.'])
        setup.repository.git(['commit', '--no-verify', '-m', 'fix: skip the hook'])
        return Promise.resolve()
      }),
    }
    await expect(
      setup.governor.dispatch(
        { kind: 'subagent', sessionId: SESSION, targetId: undefined, isTrusted: true },
        dispatch,
      ),
    ).rejects.toMatchObject({
      name: 'PlaybookRefusedError',
      note: { rule: 'neverAround', needsUser: true },
    })
    expect(setup.events.hookOutputs.join('\n')).toContain('lint failed on the claim')
    expect(await journal(setup)).toContainEqual(
      expect.objectContaining({
        kind: 'verification',
        value: expect.objectContaining({ result: 'fail' }),
      }),
    )
  })

  it('never reads git or runs a hook in a workspace that is not trusted', async () => {
    const setup = governed()
    answerAll(setup, review(setup, coveredReview([RACE])).rounds)
    const before = setup.repository.effects.length
    const dispatch = callbacks()
    await expect(
      setup.governor.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId, isTrusted: false },
        dispatch,
      ),
    ).rejects.toThrow(UI_TEXT.playbookUnavailable)
    expect(dispatch.effect).not.toHaveBeenCalled()
    expect(setup.repository.effects).toHaveLength(before)
  })

  it('ends the round without certifying it when the work cannot start', async () => {
    const setup = governed()
    answerAll(setup, review(setup, coveredReview([RACE])).rounds)
    const failing = {
      effect: vi.fn(() => Promise.reject(new Error('the child could not start'))),
      completion: vi.fn((_signal: AbortSignal) => Promise.resolve()),
    }
    await expect(
      setup.governor.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId, isTrusted: true },
        failing,
      ),
    ).rejects.toThrow('the child could not start')
    expect(failing.completion).not.toHaveBeenCalled()
    await expect(
      setup.governor.dispatch(
        { kind: 'delegate', sessionId: SESSION, targetId: CHILD.agentId, isTrusted: true },
        callbacks(),
      ),
    ).resolves.toBe('completed')
  })
})

describe('the journal surface', () => {
  it('is the one the CLI and the ACP agent read, with rule nine unswitchable', async () => {
    const setup = governed()
    const snapshot = playbookSnapshotSchema.parse(
      await setup.governor.change({
        rule: 'offload',
        enabled: false,
        reason: 'One machine only.',
      }),
    )
    expect(snapshot.settings.rules.offload).toMatchObject({
      enabled: false,
      reason: 'One machine only.',
      actor: 'owner',
    })
    expect(playbookSnapshotSchema.parse(await setup.governor.read()).settings).toEqual(
      snapshot.settings,
    )
    // The safety rule is not a change the grammar has, off or on.
    expect(parsePlaybookCommand(['settings', 'neverAround', 'off', 'Never.'])).toBeUndefined()
    expect(parsePlaybookCommand(['settings', 'offload', 'on'])).toEqual({
      view: 'settings',
      change: { rule: 'offload', enabled: true },
    })
  })

  it('gives a child’s rows only the records of its own modules', () => {
    const setup = governed()
    review(setup, coveredReview([RACE]))
    const records = setup.governor.agentRecords([
      { itemId: 'row-1', agentId: CHILD.agentId, sessionId: CHILD.sessionId },
      { itemId: 'row-2', agentId: 'subagent-2', sessionId: `${SESSION}:subagent-2` },
      // The same agent id under another session is another agent.
      { itemId: 'row-3', agentId: CHILD.agentId, sessionId: 'another-conversation:subagent-1' },
    ])
    expect(Object.keys(records)).toEqual(['row-1'])
    expect(records['row-1']?.filter((record) => record.kind === 'round').length).toBeGreaterThan(0)
  })
})
