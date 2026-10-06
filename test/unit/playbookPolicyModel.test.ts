import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLAYBOOK_LAUNDER_WINDOW_MS } from '../../src/shared/constants'
import type { PlaybookLease, PlaybookModule } from '../../src/shared/playbook'
import { moduleStates } from '../../src/core/orchestration/playbook/modules'
import { OrchestratorPlaybook } from '../../src/core/orchestration/playbook/policy'
import { FAKE_PLAYBOOK_MODULE as MODULE, FakePlaybookBoard } from './helpers/playbook/fakes'
import {
  answerAll,
  completeReview,
  policyFixture,
  reviewBlock,
  REVIEW_AGENTS,
  strike,
} from './playbookPolicyFixture'

const ORDERS = [
  ['old', 'new', 'merge'],
  ['old', 'merge', 'new'],
  ['new', 'old', 'merge'],
  ['new', 'merge', 'old'],
  ['merge', 'old', 'new'],
  ['merge', 'new', 'old'],
] as const

function lease(decision: ReturnType<OrchestratorPlaybook['beforeFixRound']>): PlaybookLease {
  if (decision.kind !== 'allow' || !decision.lease) throw new Error('Expected admitted generation')
  return decision.lease
}
const CHILD: PlaybookModule = {
  ...MODULE,
  id: 'child',
  key: 'src/child',
  files: ['src/child/a.ts'],
  lineage: { splitFrom: MODULE.id },
}
const OTHER: PlaybookModule = {
  ...MODULE,
  id: 'other',
  key: 'src/other',
  files: ['src/other/a.ts'],
}
const MERGED: PlaybookModule = {
  ...MODULE,
  id: 'merged',
  key: 'src/merged',
  files: ['src/merged/a.ts'],
  lineage: { mergedFrom: [MODULE.id, OTHER.id] },
}

describe('M116 serialized policy model', () => {
  for (const winner of ['L1', 'L2']) {
    for (const member of [MODULE, CHILD]) {
      it.each(ORDERS)(`${winner} on ${member.id}: completion order %s → %s → %s`, (...order) => {
        const fixture = policyFixture()
        completeReview(fixture.policy, MODULE, reviewBlock(), REVIEW_AGENTS)
        answerAll(fixture.policy)
        fixture.policy.declareModule(CHILD)
        fixture.policy.declareModule(OTHER)
        const board = new FakePlaybookBoard().readBoard()
        const lane = (id: string) => ({
          ...board.lanes[0]!,
          id,
          module: MODULE,
          starts: [],
          kind: 'contracts' as const,
        })
        const first = fixture.policy.beforeDispatch(lane(winner), board)
        const old = lease(first)
        const loser = winner === 'L1' ? 'L2' : 'L1'
        expect(fixture.policy.beforeDispatch(lane(loser), board).kind).toBe('refuse')
        expect(fixture.policy.beforeReview(MODULE, REVIEW_AGENTS).kind).toBe('refuse')
        fixture.advance(PLAYBOOK_LAUNDER_WINDOW_MS)
        const replacement = new OrchestratorPlaybook({ ...fixture.options, laneId: 'replacement' })
        const current = lease(replacement.beforeFixRound(member))
        expect(current.generation).not.toBe(old.generation)
        const prior = new Map<string, number>()
        for (const event of order) {
          if (event === 'old')
            expect(
              fixture.policy.afterReview(
                MODULE,
                { findings: [], coverage: reviewBlock().coverage },
                REVIEW_AGENTS,
                old,
              ).kind,
            ).toBe('refuse')
          else if (event === 'new') {
            expect(
              replacement.afterReview(member, reviewBlock(), REVIEW_AGENTS, current).kind,
            ).toBe('allow')
            answerAll(replacement, member)
          } else expect(replacement.declareModule(MERGED).kind).toBe('allow')
          const states = moduleStates(fixture.policy.getRecord())
          for (const [id, state] of states) {
            expect(state.strikes).toBeGreaterThanOrEqual(prior.get(id) ?? 0)
            prior.set(id, state.strikes)
          }
          const active = []
          for (const state of states.values())
            for (const item of state.leases.values())
              if (
                item.status === 'held' &&
                item.at + PLAYBOOK_LAUNDER_WINDOW_MS > fixture.options.now()
              )
                active.push(item)
          expect(active).toHaveLength(
            event === 'new' || order.indexOf('new') < order.indexOf(event) ? 0 : 1,
          )
          const family = [
            MODULE.id,
            CHILD.id,
            ...(states.has(MERGED.id) ? [MERGED.id, OTHER.id] : []),
          ]
          const strikes = family.map((id) => states.get(id)?.strikes)
          expect(new Set(strikes).size).toBe(1)
          const counts = family.map((id) => states.get(id)?.counts.get(undefined) ?? 0)
          expect(new Set(counts).size).toBe(1)
        }
        const restarted = new OrchestratorPlaybook(fixture.options)
        expect(restarted.afterReview(member, reviewBlock(), REVIEW_AGENTS, current).kind).toBe(
          'refuse',
        )
        expect(moduleStates(restarted.getRecord()).get(OTHER.id)?.strikes).toBe(2)
      })
    }
  }

  it('refuses a review from an old generation after replacement on the same orchestrator', () => {
    const fixture = policyFixture()
    const old = lease(fixture.policy.beforeFixRound(MODULE))
    fixture.advance(PLAYBOOK_LAUNDER_WINDOW_MS)
    const current = lease(fixture.policy.beforeFixRound(MODULE))
    expect(current.ownerId).toBe(old.ownerId)
    expect(current.laneId).toBe(old.laneId)
    expect(current.generation).not.toBe(old.generation)
    expect(fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS, old).kind).toBe(
      'refuse',
    )
    expect(fixture.policy.afterReview(MODULE, reviewBlock(), REVIEW_AGENTS, current).kind).toBe(
      'allow',
    )
    answerAll(fixture.policy)
    expect(
      fixture.policy.afterReview(
        MODULE,
        { findings: [], coverage: reviewBlock().coverage },
        REVIEW_AGENTS,
        old,
      ).kind,
    ).toBe('refuse')
  })

  it.each([
    [MODULE, OTHER],
    [OTHER, MODULE],
  ])('refuses merging two held families until a holder releases: %j', (first, second) => {
    const fixture = policyFixture()
    const a = lease(fixture.policy.beforeFixRound(first, 'first'))
    const b = lease(fixture.policy.beforeFixRound(second, 'second'))
    expect(fixture.policy.declareModule(MERGED).kind).toBe('refuse')
    expect(fixture.policy.releasePatch(first, a).kind).toBe('allow')
    expect(fixture.policy.declareModule(MERGED).kind).toBe('allow')
    expect(fixture.policy.beforeFixRound(first, 'third').kind).toBe('refuse')
    expect(fixture.policy.releasePatch(second, b).kind).toBe('allow')
    expect(fixture.policy.beforeFixRound(first, 'third').kind).toBe('allow')
  })

  it('publishes claimed lineage on an unchanged declaration before admitting inherited strikes', () => {
    const fixture = policyFixture()
    const old = path.join(fixture.options.workspaceFolder, MODULE.files[0]!)
    const dest = path.join(fixture.options.workspaceFolder, OTHER.files[0]!)
    mkdirSync(path.dirname(old), { recursive: true })
    mkdirSync(path.dirname(dest), { recursive: true })
    const content = 'export const claim = () => "atomic"\nexport const version = 1\n'
    writeFileSync(old, content)
    writeFileSync(dest, 'unrelated content\n')
    fixture.policy.declareModule(MODULE)
    fixture.policy.declareModule(OTHER)
    strike(fixture.policy)
    writeFileSync(dest, content)
    expect(fixture.policy.beforeFixRound(OTHER).note.code).toBe('lineageRequired')
    const linked = { ...OTHER, lineage: { splitFrom: MODULE.id } }
    expect(fixture.policy.declareModule(linked).kind).toBe('allow')
    expect(
      fixture.policy
        .getRecord()
        .findLast((record) => record.kind === 'module' && record.value.module.id === OTHER.id),
    ).toMatchObject({ value: { module: { lineage: { splitFrom: MODULE.id } } } })
    expect(new OrchestratorPlaybook(fixture.options).beforeFixRound(linked).note.code).toBe(
      'redesignRequired',
    )
  })

  it.each(['untracked', 'staged globs', 'committed'])(
    'inherits edited moves in %s state with Windows selectors',
    (stage) => {
      const fixture = policyFixture()
      const workspace = fixture.options.workspaceFolder
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: workspace, encoding: 'utf8', stdio: 'pipe' })
      git(['init'])
      const oldFile = path.join(workspace, 'src/old/a.ts')
      const newFile = path.join(workspace, 'src/new/a.ts')
      mkdirSync(path.dirname(oldFile), { recursive: true })
      mkdirSync(path.dirname(newFile), { recursive: true })
      const source = Array.from(
        { length: 30 },
        (_, i) => `export const claim${String(i)} = ${String(i)};`,
      ).join('\n')
      writeFileSync(oldFile, source)
      git(['add', '.'])
      git([
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '-m',
        'baseline',
      ])
      const original = { ...MODULE, files: [String.raw`src\old\**`], key: 'src/old' }
      fixture.policy.declareModule(original)
      strike(fixture.policy, original)
      renameSync(oldFile, newFile)
      writeFileSync(newFile, `${source}\n// edited move\n`)
      if (stage !== 'untracked') git(['add', '.'])
      if (stage === 'committed')
        git([
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.invalid',
          'commit',
          '-m',
          'moved',
        ])
      const moved = { ...OTHER, files: [String.raw`src\new\**`], key: 'src/new' }
      expect(new OrchestratorPlaybook(fixture.options).declareModule(moved).note.code).toBe(
        'lineageRequired',
      )
      const linked = { ...moved, lineage: { splitFrom: MODULE.id } }
      expect(fixture.policy.declareModule(linked).kind).toBe('allow')
      expect(fixture.policy.beforeFixRound(linked).note.code).toBe('redesignRequired')
    },
  )

  it('reconciles maximum predecessor strikes and lifetime counts into every merge member', () => {
    const fixture = policyFixture()
    strike(fixture.policy)
    fixture.policy.declareModule(OTHER)
    expect(fixture.policy.declareModule(MERGED).kind).toBe('allow')
    const states = moduleStates(fixture.policy.getRecord())
    for (const id of [MODULE.id, OTHER.id, MERGED.id]) {
      expect(states.get(id)?.strikes).toBe(3)
      expect(states.get(id)?.counts.get(undefined)).toBe(3)
      expect(
        new OrchestratorPlaybook(fixture.options).beforeFixRound(states.get(id)!.module).note.code,
      ).toBe('redesignRequired')
    }
    expect(
      completeReview(
        fixture.policy,
        OTHER,
        { findings: [], coverage: reviewBlock().coverage },
        REVIEW_AGENTS,
      ).kind,
    ).toBe('refuse')
    expect(moduleStates(fixture.policy.getRecord()).get(MODULE.id)?.strikes).toBe(3)
  })
})
