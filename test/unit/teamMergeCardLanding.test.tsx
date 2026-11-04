/** @vitest-environment jsdom */
// The merge card after a landing that did not finish (CC-WINLAND): it says what happened, in the
// person's words, and what is left to do, and only the card that needs Undo Merge offers it.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TeamMergeCard, type TeamMergeEntry } from '../../src/webview/components/TeamCards'
import { UI_TEXT } from '../../src/shared/constants'
import { plural } from '../../src/shared/l10n/text'

afterEach(cleanup)

function entry(fields: Partial<TeamMergeEntry>): TeamMergeEntry {
  return {
    kind: 'teamMerge',
    id: 'team-merge-t1',
    status: 'completed',
    taskId: 't1',
    roleId: 'engineering',
    brief: 'The work',
    branch: 'agents/engineering/t1',
    affectedFiles: ['a.txt', 'b.txt'],
    protectedPaths: [],
    review: 'reviewed',
    ...fields,
  }
}

describe('the merge card after a landing stopped', () => {
  it('names what changed and offers Undo Merge', () => {
    const decided: string[] = []
    render(
      <ul>
        <TeamMergeCard
          entry={entry({ teamDecision: 'merge', changedDuringLanding: ['b.txt'] })}
          onDecide={(_taskId, decision) => {
            decided.push(decision)
          }}
        />
      </ul>,
    )
    expect(
      screen.getByText(plural(UI_TEXT.teamChangedDuringLanding, 1, { count: 1, files: 'b.txt' }), {
        exact: false,
      }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: UI_TEXT.teamUndoMerge }))
    expect(decided).toEqual(['undo'])
  })

  it('offers no Undo on a landing that went through, and says a refusal in words', () => {
    const words = 'A program is holding c.txt.'
    render(
      <ul>
        <TeamMergeCard entry={entry({ teamDecision: words })} onDecide={() => undefined} />
      </ul>,
    )
    expect(screen.getByText(words)).toBeTruthy()
    expect(screen.queryByRole('button', { name: UI_TEXT.teamUndoMerge })).toBeNull()
  })

  it('does not print a plain answer as a sentence', () => {
    render(
      <ul>
        <TeamMergeCard entry={entry({ teamDecision: 'merge' })} onDecide={() => undefined} />
      </ul>,
    )
    expect(screen.queryByText('merge')).toBeNull()
  })
})
