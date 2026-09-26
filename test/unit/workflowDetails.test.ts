import { describe, expect, it } from 'vitest'
import type { WorkflowChild, WorkflowEntry } from '../../src/webview/state/uiState'
import {
  childName,
  childStatusLabel,
  isChildRunning,
  triggerSourceLabel,
  workflowLaunch,
  workflowName,
  workflowOutcome,
  workflowTokens,
  workflowTriggerText,
} from '../../src/webview/workflowDetails'
import {
  WORKFLOW_MESSAGE,
  WORKFLOW_SCRIPT,
  WORKFLOW_SCRIPT_PATH,
  WORKFLOW_TOOL_ITEM,
} from './helpers/workflowFixtures'

const child = (extra: Partial<WorkflowChild> = {}): WorkflowChild => ({
  childId: 'c',
  attempt: 1,
  status: 'started',
  ...extra,
})

const entry = (extra: Partial<WorkflowEntry> = {}): WorkflowEntry => ({
  kind: 'workflow',
  id: 'w',
  status: 'inProgress',
  children: [],
  ...extra,
})

const reconciled = (report: unknown) =>
  `<workflow-launch-reconciled>${JSON.stringify(report)}</workflow-launch-reconciled>`

describe('workflowOutcome (M47)', () => {
  it('reads the summary Muse Code sent at the end of the captured run', () => {
    expect(workflowOutcome(WORKFLOW_MESSAGE)).toEqual({ summary: 'pong', failure: undefined })
  })

  it('shows a failure as it came: text as text, anything else as indented JSON', () => {
    expect(
      workflowOutcome(reconciled({ final_summary: null, latest_failure: 'agent ping crashed' })),
    ).toEqual({ summary: undefined, failure: 'agent ping crashed' })
    expect(workflowOutcome(reconciled({ latest_failure: { kind: 'childFailed' } }))).toEqual({
      summary: undefined,
      failure: '{\n  "kind": "childFailed"\n}',
    })
  })

  it('shows a message that is not the report as it came, and nothing before one arrives', () => {
    expect(workflowOutcome('All three reviews agree.')).toEqual({
      summary: 'All three reviews agree.',
      failure: undefined,
    })
    const broken = '<workflow-launch-reconciled>{not json</workflow-launch-reconciled>'
    expect(workflowOutcome(broken)).toEqual({ summary: broken, failure: undefined })
    expect(workflowOutcome(undefined)).toBeUndefined()
    expect(workflowOutcome('  ')).toBeUndefined()
  })
})

describe('workflowLaunch (M47)', () => {
  it('reads the captured call: the script, and a launch with its saved script', () => {
    expect(workflowLaunch(WORKFLOW_TOOL_ITEM.args, WORKFLOW_TOOL_ITEM.visibleOutput)).toEqual({
      script: WORKFLOW_SCRIPT,
      isLaunched: true,
      scriptPath: WORKFLOW_SCRIPT_PATH,
    })
  })

  it('does not interpret an unobserved input path as a resume source', () => {
    const unknownArgs = JSON.stringify({ scriptPath: 'run.js' })
    expect(workflowLaunch(unknownArgs, 'workflow launch disabled')).toEqual({
      script: undefined,
      isLaunched: false,
      scriptPath: undefined,
    })
    expect(workflowLaunch('', '')).toEqual({
      script: undefined,
      isLaunched: false,
      scriptPath: undefined,
    })
  })
})

describe('the words of a workflow run (M47)', () => {
  it('names the captured generated run and shows other entry IDs verbatim', () => {
    expect(workflowName(entry({ entryId: 'generated.model-chosen' }))).toBe('Written for this task')
    expect(workflowName(entry({ entryId: 'generated.future-kind' }))).toBe('generated.future-kind')
    expect(workflowName(entry({ entryId: 'review-change' }))).toBe('review-change')
    expect(workflowName(entry({ fallbackText: 'Workflow: nightly audit' }))).toBe(
      'Workflow: nightly audit',
    )
    expect(workflowName(entry())).toBe('Workflow')
  })

  it('says what started it, and a source it does not know as it came', () => {
    expect(triggerSourceLabel('guidanceAuto')).toBe('started by the model')
    expect(triggerSourceLabel('cliHeadless')).toBe('cliHeadless')
    expect(triggerSourceLabel('toString')).toBe('toString')
  })

  it('says an agent’s state: its outcome once it ended, else its status', () => {
    expect(childStatusLabel(child({ status: 'scheduled' }))).toBe('queued')
    expect(childStatusLabel(child({ status: 'started' }))).toBe('running')
    expect(childStatusLabel(child({ status: 'usage' }))).toBe('running')
    expect(childStatusLabel(child({ status: 'completed' }))).toBe('completed')
    expect(childStatusLabel(child({ status: 'terminal', terminal: 'completed' }))).toBe('completed')
    expect(childStatusLabel(child({ status: 'terminal', terminal: 'failed' }))).toBe('failed')
    expect(childStatusLabel(child({ status: 'terminal' }))).toBe('finished')
    expect(childStatusLabel(child({ status: 'waiting' }))).toBe('waiting')
  })

  it('offers the controls only for an agent that runs and has not ended', () => {
    expect(isChildRunning(child({ status: 'started' }))).toBe(true)
    expect(isChildRunning(child({ status: 'usage' }))).toBe(true)
    expect(isChildRunning(child({ status: 'scheduled' }))).toBe(false)
    expect(isChildRunning(child({ status: 'completed' }))).toBe(false)
    expect(isChildRunning(child({ status: 'started', terminal: 'cancelled' }))).toBe(false)
  })

  it('numbers an agent the workflow did not label, and sums the tokens reported', () => {
    expect(childName(child({ label: 'ping' }), 0)).toBe('ping')
    expect(childName(child(), 1)).toBe('Agent 2')
    const usage = { inputTokens: 1000, outputTokens: 200, cachedTokens: 0, reasoningTokens: 0 }
    expect(workflowTokens(entry({ children: [child({ usage }), child(), child({ usage })] }))).toBe(
      2400,
    )
    expect(workflowTokens(entry({ children: [child()] }))).toBeUndefined()
  })

  it('explains each trigger mode and how to change it, and one it does not know as it came', () => {
    const howTo = 'Set run.workflow_trigger_mode to "auto", "explicit" or "off"'
    expect(workflowTriggerText('auto')).toContain('are on auto')
    expect(workflowTriggerText('explicit')).toContain('only when you ask')
    expect(workflowTriggerText('off')).toContain('no workflow tool')
    expect(workflowTriggerText('off')).toContain(howTo)
    expect(workflowTriggerText('sometimes')).toBe(
      `Muse Code’s workflow setting is sometimes. ${howTo} in the Muse Code settings file to change it; the extension never edits that file.`,
    )
  })
})
