import {
  playbookModuleSchema,
  type PlaybookBoard,
  type PlaybookCommand,
  type PlaybookDecision,
  type PlaybookLane,
  type PlaybookModule,
  type PlaybookPlanPort,
  type PlaybookPolicy,
  type PlaybookRequester,
  type PlaybookReviewAgents,
} from '../../../../src/shared/playbook'
import { parseReviewBlock, type ReviewBlock } from '../../../../src/shared/reviewFindings'
import { PLAYBOOK_FINDING_CLASSES } from '../../../../src/shared/constants'

export const FAKE_PLAYBOOK_MODULE = playbookModuleSchema.parse({
  id: 'module-store-17',
  key: 'src/core/schedules/store',
  files: ['src/core/schedules/store.ts'],
  source: 'lane',
})

export interface ScriptedPlaybookReview {
  readonly module: string
  readonly review: ReviewBlock
}

/** The sequence is per module, so interleaved reviews cannot consume another's round. */
export class ScriptedPlaybookReviewer {
  private readonly nextRound = new Map<string, number>()
  constructor(private readonly script: readonly ScriptedPlaybookReview[]) {}

  next(module: PlaybookModule): ReviewBlock {
    const index = this.nextRound.get(module.id) ?? 0
    const entry = this.script.filter((round) => round.module === module.id)[index]
    if (!entry)
      throw new Error(`No scripted review for ${module.key} at round ${String(index + 1)}`)
    const review = parseReviewBlock(JSON.stringify(entry.review))
    if (!review) throw new Error('Invalid scripted review block')
    this.nextRound.set(module.id, index + 1)
    return review
  }
}

/** No policy double in production: P and I inject the real policy into this loop. */
export class FakePlaybookReviewLoop {
  constructor(
    private readonly policy: PlaybookPolicy,
    private readonly reviewer: ScriptedPlaybookReviewer,
  ) {}

  review(
    module: PlaybookModule,
    agents: PlaybookReviewAgents,
  ):
    | { readonly kind: 'refused'; readonly decision: PlaybookDecision }
    | {
        readonly kind: 'reviewed'
        readonly review: ReviewBlock
        readonly decision: PlaybookDecision
      } {
    const admission = this.policy.beforeReview(module, agents)
    if (admission.kind === 'refuse') return { kind: 'refused', decision: admission }
    const review = this.reviewer.next(module)
    return {
      kind: 'reviewed',
      review,
      decision: this.policy.afterReview(module, review, agents, admission.lease),
    }
  }
}

/** Three concurrency rounds, then the requested structural answers for the old id. */
export function threeStrikesScript(
  outcome: 'impossible' | 'caught' | 'remains',
  findingId: string,
): ScriptedPlaybookReview[] {
  const finding = { file: 'src/core/schedules/store.ts', title: 'Racy claim', class: 'concurrency' }
  const reviews: ReviewBlock[] = Array.from({ length: 3 }, () => ({
    findings: [finding],
    coverage: [...PLAYBOOK_FINDING_CLASSES],
  }))
  reviews.push({
    findings: outcome === 'impossible' ? [] : [finding],
    coverage: [...PLAYBOOK_FINDING_CLASSES],
    resolution: [
      {
        findingId,
        outcome,
        reason:
          outcome === 'impossible'
            ? 'The claim is one atomic operation.'
            : 'The multi-step claim still exists.',
      },
    ],
  })
  return reviews.map((review) => ({ module: FAKE_PLAYBOOK_MODULE.id, review }))
}

/** M116's dependency graph and estimates, intentionally unsorted. */
export function fakePlaybookLanes(): PlaybookLane[] {
  const lanes: Pick<PlaybookLane, 'id' | 'starts' | 'estimateHours' | 'kind'>[] = [
    { id: 'W', starts: ['P', 'K', 'U', 'I'], estimateHours: 4, kind: 'docs' },
    { id: 'I', starts: ['P'], estimateHours: 10, kind: 'patch' },
    { id: 'U', starts: ['0'], estimateHours: 12, kind: 'patch' },
    { id: 'P', starts: ['0'], estimateHours: 20, kind: 'patch' },
    { id: 'K', starts: ['0'], estimateHours: 8, kind: 'patch' },
    { id: '0', starts: [], estimateHours: 6, kind: 'contracts' },
  ]
  return lanes.map((entry): PlaybookLane => ({
    ...entry,
    milestoneId: 'M116',
    module: structuredClone(FAKE_PLAYBOOK_MODULE),
    merged: false,
    reviewed: false,
    addsTestsOrGates: true,
    drills: [],
    integrationTrunk: 'feature/m116-playbook',
    mergedTrunks: [],
  }))
}

export class FakePlaybookBoard implements PlaybookPlanPort {
  private board: PlaybookBoard
  constructor(board?: PlaybookBoard) {
    this.board = structuredClone(
      board ?? {
        lanes: fakePlaybookLanes(),
        mergedPrerequisites: [],
        workers: [{ id: 'macmini', available: true }],
        hasCi: true,
      },
    )
  }

  readBoard(): PlaybookBoard {
    return structuredClone(this.board)
  }

  merge(id: string, isReviewed: boolean): void {
    if (this.board.lanes.every((lane) => lane.id !== id)) throw new Error(`Unknown lane ${id}`)
    this.board = {
      ...this.board,
      lanes: this.board.lanes.map((lane) =>
        lane.id === id ? { ...lane, merged: true, reviewed: isReviewed } : lane,
      ),
      mergedPrerequisites: [...new Set([...this.board.mergedPrerequisites, id])],
    }
  }
}

export interface FakePlaybookPlan {
  readonly milestoneId: string
  readonly deliveryOrder: readonly string[]
  readonly port: PlaybookPlanPort
}
export function fakePlaybookPlan(
  port: PlaybookPlanPort = new FakePlaybookBoard(),
): FakePlaybookPlan {
  return { milestoneId: 'M116', deliveryOrder: ['0', 'K', 'U', 'P', 'I', 'W'], port }
}

/** Same effect/subject through a different requester: the laundering acceptance fixture. */
export class FakePlaybookDelegate {
  constructor(private readonly policy: PlaybookPolicy) {}

  reask(
    command: PlaybookCommand,
    refused: PlaybookRequester,
    delegate: PlaybookRequester,
    source: 'permission' | 'classifier' = 'permission',
  ): PlaybookDecision {
    this.policy.recordRefusal(command, refused, source)
    return this.policy.beforeCommand(command, delegate)
  }
}
