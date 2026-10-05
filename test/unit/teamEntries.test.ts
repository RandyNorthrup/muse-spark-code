// The team item-to-row mapping (M96 lane U2): every card kind maps with
// its fields, a team kind without its payload stays today's `item` row, and
// updates refresh the card in place.
import { describe, expect, it } from 'vitest'
import { itemSnapshotSchema, type ItemSnapshot } from '../../src/shared/agentEvents'
import { transcriptEntrySchema } from '../../src/webview/state/transcriptEntries'
import { mergeTeamEntry, teamEntryForItem } from '../../src/webview/state/teamEntries'

function item(overrides: Partial<ItemSnapshot>): ItemSnapshot {
  return itemSnapshotSchema.parse({
    itemId: 'x1',
    kind: 'teamSwitch',
    status: 'completed',
    ...overrides,
  })
}

describe('teamEntryForItem', () => {
  it('maps a delegation plan with each item and its dry-run mark', () => {
    const entry = teamEntryForItem(
      item({
        kind: 'teamPlan',
        teamPlan: {
          items: [
            {
              disposition: 'delegated',
              role: 'engineering',
              brief: 'Add the retry',
              reason: 'parallel-work',
              entry: 'entry 1',
            },
            { disposition: 'kept', role: 'engineering', reason: 'small-task' },
          ],
          dryRun: true,
        },
      }),
    )
    expect(entry).toMatchObject({
      kind: 'teamPlan',
      id: 'x1',
      dryRun: true,
      items: [
        { disposition: 'delegated', role: 'engineering', reason: 'parallel-work' },
        { disposition: 'kept', role: 'engineering', reason: 'small-task' },
      ],
    })
  })

  it('maps a switch row with the role, from and to, and the reason', () => {
    const entry = teamEntryForItem(
      item({
        teamSwitch: {
          roleId: 'engineering',
          fromEntry: 'entry 1',
          toEntry: 'entry 2',
          reason: 'cap',
        },
      }),
    )
    expect(entry).toMatchObject({
      kind: 'teamSwitch',
      roleId: 'engineering',
      fromEntry: 'entry 1',
      toEntry: 'entry 2',
      reason: 'cap',
    })
  })

  it('maps a waiting card with its waiting id and role', () => {
    const entry = teamEntryForItem(
      item({
        kind: 'teamWaiting',
        teamWaiting: {
          waitingId: 'w1',
          roleId: 'qa',
          brief: 'Run the suite',
          reasonText: 'every entry is capped',
        },
      }),
    )
    expect(entry).toMatchObject({
      kind: 'teamWaiting',
      waitingId: 'w1',
      roleId: 'qa',
      brief: 'Run the suite',
    })
  })

  it('maps a merge card with review state, branch move and conflicts', () => {
    const entry = teamEntryForItem(
      item({
        kind: 'teamMerge',
        teamMerge: {
          taskId: 't3',
          roleId: 'engineering',
          brief: 'Add the retry',
          branch: 'agents/engineering/t3',
          filesChanged: 4,
          review: 'same-model',
          branchMoved: true,
          conflicted: true,
        },
      }),
    )
    expect(entry).toMatchObject({
      kind: 'teamMerge',
      taskId: 't3',
      branch: 'agents/engineering/t3',
      filesChanged: 4,
      review: 'same-model',
      branchMoved: true,
      conflicted: true,
    })
  })

  it('maps a report row with its summary', () => {
    const entry = teamEntryForItem(
      item({
        kind: 'teamReport',
        teamReport: {
          taskId: 't3',
          roleId: 'engineering',
          brief: 'Add the retry',
          summary: 'Added retry with backoff; 4 files changed.',
        },
      }),
    )
    expect(entry).toMatchObject({
      kind: 'teamReport',
      taskId: 't3',
      summary: 'Added retry with backoff; 4 files changed.',
    })
  })

  it('leaves a team kind without its payload to today’s item row', () => {
    expect(teamEntryForItem(item({ kind: 'teamMerge' }))).toBeUndefined()
    expect(teamEntryForItem(item({ kind: 'teamPlan' }))).toBeUndefined()
  })

  it('ignores kinds it does not know', () => {
    expect(teamEntryForItem(item({ kind: 'subagent' }))).toBeUndefined()
    expect(teamEntryForItem(item({ kind: 'compaction' }))).toBeUndefined()
  })
})

describe('mergeTeamEntry', () => {
  it('refreshes the card from the host’s latest payload and status', () => {
    const first = teamEntryForItem(
      item({
        kind: 'teamMerge',
        status: 'inProgress',
        teamMerge: {
          taskId: 't3',
          roleId: 'engineering',
          brief: 'Add the retry',
          branch: 'agents/engineering/t3',
          review: 'reviewed',
        },
      }),
    )
    expect(first?.kind).toBe('teamMerge')
    const merged = mergeTeamEntry(
      first!,
      item({
        kind: 'teamMerge',
        status: 'completed',
        teamMerge: {
          taskId: 't3',
          roleId: 'engineering',
          brief: 'Add the retry',
          branch: 'agents/engineering/t3',
          filesChanged: 4,
          review: 'reviewed',
          conflicted: true,
        },
      }),
    )
    expect(merged).toMatchObject({ kind: 'teamMerge', status: 'completed', conflicted: true })
  })

  it('keeps the card and moves its status when the payload is absent', () => {
    const first = teamEntryForItem(
      item({
        teamSwitch: {
          roleId: 'engineering',
          fromEntry: 'entry 1',
          toEntry: 'entry 2',
          reason: 'cap',
        },
      }),
    )
    const merged = mergeTeamEntry(first!, item({ kind: 'teamSwitch', status: 'completed' }))
    expect(merged).toMatchObject({
      kind: 'teamSwitch',
      status: 'completed',
      fromEntry: 'entry 1',
      reason: 'cap',
    })
  })

  it('leaves other rows alone', () => {
    const assistant = transcriptEntrySchema.parse({
      kind: 'assistant',
      id: 'a1',
      text: 'hi',
      isStreaming: false,
    })
    expect(mergeTeamEntry(assistant, item({}))).toBeUndefined()
  })
})

describe('team wire fields', () => {
  it('a tool item keeps the worker label the panel draws', () => {
    const parsed = itemSnapshotSchema.parse({
      itemId: 'c1',
      kind: 'toolCall',
      status: 'inProgress',
      tool: 'edit',
      teamWorker: { roleId: 'engineering', agentLabel: 'Codex', taskId: 't3' },
    })
    expect(parsed.teamWorker).toEqual({
      roleId: 'engineering',
      agentLabel: 'Codex',
      taskId: 't3',
    })
  })

  it('a tool entry keeps the worker label through validation', () => {
    const parsed = transcriptEntrySchema.parse({
      kind: 'tool',
      id: 'c1',
      tool: 'edit',
      args: '{}',
      status: 'inProgress',
      output: '',
      isBackground: false,
      teamWorker: { roleId: 'engineering', agentLabel: 'Codex', taskId: 't3' },
    })
    expect(parsed.kind === 'tool' && parsed.teamWorker?.agentLabel).toBe('Codex')
  })
})

describe('RVM96B boundary regressions', () => {
  it('13 preserves the confirmed decision through mapping, partial updates and saved-state validation', () => {
    const source = item({
      kind: 'teamWaiting',
      status: 'inProgress',
      teamWaiting: { waitingId: 'w1', roleId: 'qa' },
      teamDecision: 'queue',
    })
    const mapped = teamEntryForItem(source)
    expect(mapped).toMatchObject({ teamDecision: 'queue' })
    expect(transcriptEntrySchema.parse(mapped)).toMatchObject({ teamDecision: 'queue' })
    expect(
      mergeTeamEntry(mapped!, item({ kind: 'teamWaiting', status: 'inProgress' })),
    ).toMatchObject({ teamDecision: 'queue' })
  })

  it('22 carries merge approval details through both validated boundaries', () => {
    const details = {
      affectedFiles: ['src/a.ts'],
      protectedPaths: ['.muse/team.json'],
      conflictPaths: ['src/a.ts'],
      reviewVerdict: 'fail',
      reviewerFindings: ['P1: wrong output'],
    }
    const mapped = teamEntryForItem(
      item({
        kind: 'teamMerge',
        teamMerge: {
          taskId: 't1',
          roleId: 'engineering',
          brief: 'Fix',
          branch: 'agents/t1',
          review: 'reviewed',
          ...details,
        },
      }),
    )
    expect(transcriptEntrySchema.parse(mapped)).toMatchObject(details)
    expect(
      itemSnapshotSchema.safeParse({
        itemId: 'bad',
        kind: 'teamMerge',
        status: 'inProgress',
        teamMerge: {
          taskId: 't1',
          roleId: 'engineering',
          brief: 'Fix',
          branch: 'agents/t1',
          review: 'reviewed',
          affectedFiles: [42],
        },
      }).success,
    ).toBe(false)
  })
})
