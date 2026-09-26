// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowEntry } from '../../src/webview/state/uiState'
import { renderTranscript, tool } from './helpers/transcriptFixtures'
import {
  WORKFLOW_CHILD_ID,
  WORKFLOW_ITEM_ID,
  WORKFLOW_MESSAGE,
  WORKFLOW_RUN_ID,
  WORKFLOW_SCRIPT_PATH,
  WORKFLOW_TOOL_ITEM,
} from './helpers/workflowFixtures'

const USAGE = { inputTokens: 9995, outputTokens: 135, cachedTokens: 5105, reasoningTokens: 70 }

/** The captured run as the state keeps it once it completed (M47). */
const completedRun: WorkflowEntry = {
  kind: 'workflow',
  id: WORKFLOW_ITEM_ID,
  status: 'completed',
  workflowRunId: WORKFLOW_RUN_ID,
  entryId: 'generated.model-chosen',
  scriptId: 'generated.workflow.generated.model-chosen',
  triggerSource: 'guidanceAuto',
  fallbackText: 'Workflow: model-chosen generated workflow',
  children: [
    {
      childId: WORKFLOW_CHILD_ID,
      attempt: 1,
      status: 'terminal',
      label: 'ping',
      terminal: 'completed',
      durationMs: 2183,
      usage: USAGE,
    },
  ],
  message: WORKFLOW_MESSAGE,
}

const runningRun: WorkflowEntry = {
  ...completedRun,
  status: 'inProgress',
  message: undefined,
  children: [
    { childId: WORKFLOW_CHILD_ID, attempt: 2, status: 'usage', label: 'ping', usage: USAGE },
    { childId: 'queued', attempt: 1, status: 'scheduled' },
  ],
}

describe('a workflow run’s card (M47)', () => {
  it('shows the captured run: its name, status, agent, tokens, what started it and its result', () => {
    renderTranscript([completedRun], {
      onCancelWorkflow: vi.fn(),
      onControlWorkflowChild: vi.fn(),
    })
    const row = document.querySelector('.workflow')
    expect(row).toHaveAttribute('data-entry-id', WORKFLOW_ITEM_ID)
    expect(row).toHaveAttribute('data-status', 'completed')
    expect(row).toHaveTextContent('WorkflowWritten for this task')
    expect(row).toHaveTextContent('completed · 1 agent · 10.1K tokens · started by the model')
    const agents = screen.getByRole('list', { name: 'Workflow agents' })
    expect(agents).toHaveTextContent('ping2s · 10.1K tokens · completed')
    expect(row).toHaveTextContent('Resultpong')
    // A finished run offers no control.
    expect(screen.queryByRole('button', { name: 'Cancel workflow' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull()
  })

  it('cancels a running run and skips or retries a running agent by its current attempt', () => {
    const props = renderTranscript([runningRun], {
      onCancelWorkflow: vi.fn(),
      onControlWorkflowChild: vi.fn(),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel workflow' }))
    expect(props.onCancelWorkflow).toHaveBeenCalledWith(WORKFLOW_RUN_ID)
    fireEvent.click(screen.getByRole('button', { name: 'Skip ping' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry ping' }))
    expect(props.onControlWorkflowChild).toHaveBeenNthCalledWith(
      1,
      WORKFLOW_RUN_ID,
      WORKFLOW_CHILD_ID,
      2,
      'skip',
    )
    expect(props.onControlWorkflowChild).toHaveBeenNthCalledWith(
      2,
      WORKFLOW_RUN_ID,
      WORKFLOW_CHILD_ID,
      2,
      'retry',
    )
    // The queued agent, unnamed, is numbered and has nothing to skip yet.
    const queued = within(screen.getByRole('list', { name: 'Workflow agents' }))
      .getByText('Agent 2')
      .closest('li')
    expect(queued).toHaveTextContent('queued')
    expect(within(queued ?? document.body).queryByRole('button')).toBeNull()
    expect(screen.getByRole('list', { name: 'Workflow agents' })).toHaveTextContent(
      'attempt 2 · 10.1K tokens · running',
    )
  })

  it('offers no control without the run’s handle or the callbacks, and shows a failure', () => {
    renderTranscript([
      { ...runningRun, id: 'a', workflowRunId: undefined },
      {
        ...completedRun,
        id: 'b',
        status: 'failed',
        entryId: 'review-change',
        message:
          '<workflow-launch-reconciled>{"final_summary":null,"latest_failure":"agent lint crashed"}</workflow-launch-reconciled>',
      },
    ])
    expect(screen.queryByRole('button', { name: 'Cancel workflow' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull()
    const failed = document.querySelector('[data-entry-id="b"]')
    expect(failed).toHaveTextContent('review-change')
    expect(failed).toHaveTextContent('Failed: agent lint crashed')
  })

  it('keeps an unknown future run and agent status verbatim without falsely marking failure', () => {
    renderTranscript([
      {
        ...completedRun,
        id: 'future-run',
        status: 'pausedForBudget',
        children: [
          {
            childId: 'future-child',
            attempt: 1,
            status: 'terminal',
            terminal: 'usageLimited',
          },
        ],
        message: undefined,
      },
      {
        ...completedRun,
        id: 'failed-run',
        status: 'failed',
        children: [{ childId: 'failed-child', attempt: 1, status: 'terminal', terminal: 'failed' }],
        message: undefined,
      },
      {
        ...completedRun,
        id: 'cancelled-run',
        status: 'cancelled',
        children: [
          { childId: 'cancelled-child', attempt: 1, status: 'terminal', terminal: 'cancelled' },
        ],
        message: undefined,
      },
    ])
    const future = document.querySelector('[data-entry-id="future-run"]')
    expect(future).toHaveTextContent('pausedForBudget')
    expect(future).toHaveTextContent('usageLimited')
    expect(future?.querySelector(':scope .workflow-header .tool-dot')).not.toHaveClass(
      'tool-dot-failed',
    )
    expect(future?.querySelector(':scope .workflow-agent .tool-dot')).not.toHaveClass(
      'tool-dot-failed',
    )
    const failed = document.querySelector('[data-entry-id="failed-run"]')
    expect(failed?.querySelector(':scope .workflow-header .tool-dot')).toHaveClass(
      'tool-dot-failed',
    )
    expect(failed?.querySelector(':scope .workflow-agent .tool-dot')).toHaveClass('tool-dot-failed')
    const cancelled = document.querySelector('[data-entry-id="cancelled-run"]')
    expect(cancelled?.querySelector(':scope .workflow-header .tool-dot')).toHaveClass(
      'tool-dot-failed',
    )
    expect(cancelled?.querySelector(':scope .workflow-agent .tool-dot')).toHaveClass(
      'tool-dot-failed',
    )
  })

  it('shows the Workflow tool’s script and its launch in the row before the card', () => {
    renderTranscript([
      tool({
        id: WORKFLOW_TOOL_ITEM.itemId,
        tool: 'workflow',
        args: WORKFLOW_TOOL_ITEM.args,
        output: WORKFLOW_TOOL_ITEM.visibleOutput,
      }),
    ])
    const toggle = screen.getByRole('button', { name: /Workflow/ })
    fireEvent.click(toggle)
    const row = toggle.closest('li')
    expect(row).toHaveAttribute('data-entry-id', WORKFLOW_TOOL_ITEM.itemId)
    expect(row).toHaveTextContent('export default async function workflow(host)')
    expect(row).toHaveTextContent(
      'Launched: it runs in the background and reports back to this conversation.',
    )
    expect(row).toHaveTextContent(`Script saved at ${WORKFLOW_SCRIPT_PATH}`)
  })

  it('names the file a resumed run starts from, and shows a result that is not a launch', () => {
    renderTranscript([
      tool({
        id: 'resume',
        tool: 'workflow',
        args: JSON.stringify({ scriptPath: 'run.js', resumeFromRunId: WORKFLOW_RUN_ID }),
        output: 'workflow_launch_rejected: workflows are disabled for this run',
      }),
    ])
    fireEvent.click(screen.getByRole('button', { name: /Workflow/ }))
    const row = document.querySelector('[data-entry-id="resume"]')
    expect(row).toHaveTextContent('Resumes an earlier run from run.js')
    expect(row).toHaveTextContent('workflows are disabled for this run')
    expect(row).not.toHaveTextContent('Launched')
  })
})
