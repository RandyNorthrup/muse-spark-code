// @vitest-environment jsdom
// RLF-M47: the workflow card's owner controls. Entries come from the
// recorded revisions through the real reducer, never hand-built: the
// pause fixture's running run, the retry fixture's rescheduled child,
// the cancel fixture's settled run.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { itemSnapshotSchema, type ItemSnapshot } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import {
  initialUiState,
  uiReducer,
  type UiState,
  type WorkflowChild,
  type WorkflowEntry,
} from '../../src/webview/state/uiState'
import { WorkflowRunView } from '../../src/webview/components/WorkflowRun'

function revision(name: string, key: string): ItemSnapshot {
  const frame = JSON.parse(readFileSync(path.join('test', 'fixtures', 'm47', name), 'utf8')) as {
    outcome: Record<string, { item: unknown }>
  }
  return itemSnapshotSchema.parse(frame.outcome[key]?.item)
}

function host(message: HostToWebviewMessage, state: UiState): UiState {
  return uiReducer(state, { type: 'hostMessage', message, at: 1000 })
}

function entryFor(item: ItemSnapshot): WorkflowEntry {
  const start: UiState = { ...initialUiState, sessionId: 'session-1' }
  const state = host({ type: 'agentEvent', event: { type: 'itemStarted', item } }, start)
  const entry: WorkflowEntry | undefined = state.transcript.find(
    (row): row is WorkflowEntry => row.kind === 'workflow',
  )
  if (entry === undefined) {
    throw new Error('the recorded item built no workflow entry')
  }
  return entry
}

function paused(entry: WorkflowEntry): WorkflowEntry {
  return { ...entry, pausedByUser: true }
}

describe('the workflow card’s owner controls', () => {
  it('drives a live run with Pause and Cancel', () => {
    const entry = entryFor(revision('workflow-pause-accepted.json', 'before'))
    const calls: unknown[][] = []
    render(
      <WorkflowRunView
        entry={entry}
        onWorkflowControl={(...args) => {
          calls.push(args)
        }}
      />,
    )
    fireEvent.click(screen.getByText(UI_TEXT.workflowPause))
    fireEvent.click(screen.getByText(UI_TEXT.workflowCancel))
    expect(calls).toEqual([
      [entry.workflowRunId, 'pause'],
      [entry.workflowRunId, 'cancel'],
    ])
  })

  it('offers Resume on a paused run and says so', () => {
    const entry = paused(entryFor(revision('workflow-pause-accepted.json', 'before')))
    const calls: unknown[][] = []
    render(
      <WorkflowRunView
        entry={entry}
        onWorkflowControl={(...args) => {
          calls.push(args)
        }}
      />,
    )
    expect(screen.queryByText(UI_TEXT.workflowPause)).toBeNull()
    expect(screen.getByText(UI_TEXT.workflowPaused, { exact: false })).not.toBeNull()
    fireEvent.click(screen.getByText(UI_TEXT.agentResume))
    expect(calls).toEqual([[entry.workflowRunId, 'resume']])
  })

  it('drives a running agent with Skip and Retry', () => {
    const entry = entryFor(revision('workflow-pause-accepted.json', 'before'))
    const calls: unknown[][] = []
    render(
      <WorkflowRunView
        entry={entry}
        onWorkflowControl={(...args) => {
          calls.push(args)
        }}
      />,
    )
    const running: WorkflowChild | undefined = entry.children.find(
      (child) => child.terminal === undefined && child.status === 'started',
    )
    if (running === undefined) throw new Error('the recorded run has no running agent')
    fireEvent.click(screen.getAllByText(UI_TEXT.workflowSkip)[0]!)
    fireEvent.click(screen.getAllByText(UI_TEXT.agentRetry)[0]!)
    // The revision omits the running row's label, so the card numbers it.
    expect(calls[0]?.slice(0, 3)).toEqual([entry.workflowRunId, 'skip', running.childId])
    expect(calls[0]?.[3]).toBe(fill(UI_TEXT.workflowChildUntitled, { number: 1 }))
    expect(calls[1]?.slice(0, 3)).toEqual([entry.workflowRunId, 'retry', running.childId])
  })

  it('renders both attempts of a retried child, driving the running one', () => {
    const entry = entryFor(revision('workflow-childControl-retry.json', 'attemptRunning'))
    const calls: unknown[][] = []
    render(
      <WorkflowRunView
        entry={entry}
        onWorkflowControl={(...args) => {
          calls.push(args)
        }}
      />,
    )
    // Five rows: three terminal first attempts, one scheduled, the
    // retried child beside its terminal first attempt. Only attempt 2 is
    // numbered (a first attempt shows no number).
    expect(document.querySelectorAll('.workflow-agent')).toHaveLength(5)
    expect(
      screen.getByText(fill(UI_TEXT.workflowAttempt, { attempt: 2 }), { exact: false }),
    ).not.toBeNull()
    // Only the in-flight attempt offers controls: the terminal one is silent.
    const skips = screen.getAllByText(UI_TEXT.workflowSkip)
    expect(skips).toHaveLength(1)
    fireEvent.click(skips[0]!)
    const second: WorkflowChild | undefined = entry.children.find((child) => child.attempt === 2)
    expect(calls[0]?.slice(0, 3)).toEqual([entry.workflowRunId, 'skip', second?.childId])
  })

  it('offers nothing on a settled run or without a driver', () => {
    const settled = entryFor(revision('workflow-cancel-accepted.json', 'terminal'))
    const { unmount } = render(
      <WorkflowRunView
        entry={settled}
        onWorkflowControl={() => {
          throw new Error('a settled run drives nothing')
        }}
      />,
    )
    expect(screen.queryByText(UI_TEXT.workflowPause)).toBeNull()
    expect(screen.queryByText(UI_TEXT.workflowCancel)).toBeNull()
    expect(screen.queryByText(UI_TEXT.workflowSkip)).toBeNull()
    unmount()
    const live = entryFor(revision('workflow-pause-accepted.json', 'before'))
    render(<WorkflowRunView entry={live} />)
    expect(screen.queryByText(UI_TEXT.workflowPause)).toBeNull()
    expect(screen.queryByText(UI_TEXT.workflowCancel)).toBeNull()
    expect(screen.queryByText(UI_TEXT.workflowSkip)).toBeNull()
  })
})
