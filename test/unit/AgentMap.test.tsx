// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import { agentStatusLabel, formatDurationMs } from '../../src/webview/agentFormat'
import type { WorkflowEntry } from '../../src/webview/state/uiState'
import {
  AgentMap,
  type AgentMapProps,
  controlsFor,
  type SubagentEntry,
  type ToolEntry,
} from '../../src/webview/components/AgentMap'

const explorer: SubagentEntry = {
  kind: 'subagent',
  id: 'sa1',
  seq: 1,
  role: 'explorer',
  objective: 'Map the workspace',
  status: 'completed',
  controlStatus: 'closed',
  subagentId: 'sub-1',
  childSessionId: 'child-1',
  depth: 1,
  durationMs: 90_000,
  usage: { inputTokens: 70_000, outputTokens: 7600, cachedTokens: 0, reasoningTokens: 0 },
  resultSummary: 'Mapped 12 files',
  resultText: undefined,
}
const reviewer: SubagentEntry = {
  ...explorer,
  id: 'sa2',
  role: 'reviewer',
  objective: 'Review the diff',
  status: 'inProgress',
  controlStatus: 'running',
  childSessionId: undefined,
  durationMs: undefined,
  usage: undefined,
  resultSummary: undefined,
}
const task: ToolEntry = {
  kind: 'tool',
  id: 'bg1',
  tool: 'powershell',
  // The arguments of the shell call captured live when it was moved (M46).
  args: '{"command":"Start-Sleep -Seconds 40; Write-Output done-m46","description":"Run delayed output command"}',
  status: 'inProgress',
  output: '',
  failureReason: undefined,
  patchSummary: undefined,
  patchRef: undefined,
  outputRef: undefined,
  isBackground: true,
  backgroundInitiator: 'user',
  approval: undefined,
  approvalOutcome: undefined,
  question: undefined,
  questionOutcome: undefined,
  completedSeq: undefined,
}

function renderMap(overrides: Partial<AgentMapProps> = {}) {
  const props: AgentMapProps = {
    title: 'Chrome control update',
    modelId: 'muse-spark-1.3',
    contextUsedTokens: 705_900,
    agents: [explorer, reviewer],
    backgroundTasks: [task],
    delegationMode: 'auto',
    isDelegationEnabled: true,
    childTranscripts: {},
    selectedAgentId: undefined,
    onSelectAgent: vi.fn(),
    onReadChild: vi.fn(),
    onControl: vi.fn(),
    onMessage: vi.fn(),
    onStopTask: vi.fn(),
    onStopAllTasks: vi.fn(),
    onOpenMuseSettings: vi.fn(),
    onClose: vi.fn(),
    workflows: [],
    workflowTriggerMode: undefined,
    ...overrides,
  }
  render(<AgentMap {...props} />)
  return props
}

describe('formatDurationMs', () => {
  it('reads seconds and minutes', () => {
    expect(formatDurationMs(45_000)).toBe('45s')
    expect(formatDurationMs(90_000)).toBe('1m 30s')
  })
})

describe('AgentMap', () => {
  it('draws the conversation, its agents with duration and tokens, and the background tasks', () => {
    const props = renderMap()
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(map).toHaveTextContent('2 agents · click an agent for details')
    expect(map).toHaveTextContent('Chrome control update')
    expect(map).toHaveTextContent('muse-spark-1.3 · 705.9K tokens in context')
    expect(screen.getByRole('button', { name: /Map the workspace/ })).toHaveTextContent(
      '1m 30s · 77.6K tokens · closed',
    )
    expect(screen.getByRole('button', { name: /Review the diff/ })).toHaveTextContent('running')
    expect(map).toHaveTextContent('1 background task')
    expect(screen.getByRole('list', { name: 'Background tasks' })).toHaveTextContent(
      'PowerShellRun delayed output command · runningStop',
    )
    fireEvent.click(screen.getByRole('button', { name: /Map the workspace/ }))
    expect(props.onSelectAgent).toHaveBeenCalledWith('sa1')
    expect(props.onReadChild).toHaveBeenCalledWith('child-1')
    // An agent without a child session has no transcript to read.
    fireEvent.click(screen.getByRole('button', { name: /Review the diff/ }))
    expect(props.onReadChild).toHaveBeenCalledTimes(1)
  })

  it('stops one background task or all of them, and only running ones (M46)', () => {
    const done: ToolEntry = { ...task, id: 'bg2', status: 'cancelled' }
    const props = renderMap({ agents: [], backgroundTasks: [task, done] })
    expect(screen.getByRole('dialog', { name: 'Agent map' })).not.toHaveTextContent('No subagents')
    const list = screen.getByRole('list', { name: 'Background tasks' })
    // Only the running one has a Stop, named for what it stops.
    const stops = screen.getAllByRole('button', { name: /^Stop: / })
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveAccessibleName('Stop: PowerShell Run delayed output command')
    expect(list).toHaveTextContent('cancelled')
    fireEvent.click(screen.getByRole('button', { name: /^Stop: / }))
    expect(props.onStopTask).toHaveBeenCalledWith('bg1')
    fireEvent.click(screen.getByRole('button', { name: 'Stop all' }))
    expect(props.onStopAllTasks).toHaveBeenCalledOnce()
  })

  it('waits on a Stop already asked (M46)', () => {
    renderMap({ agents: [], backgroundTasks: [{ ...task, taskRequest: 'stop' }] })
    expect(screen.getByRole('button', { name: /^Stop: / })).toBeDisabled()
  })

  it('offers no Stop all when every background task has ended (M46)', () => {
    renderMap({ agents: [], backgroundTasks: [{ ...task, status: 'completed' }] })
    expect(screen.queryByRole('button', { name: 'Stop all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Stop: / })).not.toBeInTheDocument()
  })

  it('shows an agent’s details and transcript, and a running one without a transcript', () => {
    renderMap({
      selectedAgentId: 'sa1',
      childTranscripts: {
        'child-1': {
          name: 'Explorer',
          entries: [
            {
              kind: 'user',
              seq: 0,
              id: 'u',
              text: 'Map the workspace',
              status: 'sent',
              attachments: [],
            },
            { kind: 'assistant', id: 'a', text: 'Mapped 12 files', isStreaming: false },
          ],
        },
      },
    })
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(map).toHaveTextContent('Role: explorer · 1m 30s · 77.6K tokens · closed')
    expect(map).toHaveTextContent('Mapped 12 files')
    expect(screen.getByRole('list', { name: 'Agent transcript' })).toHaveTextContent(
      'userMap the workspace',
    )
    renderMap({ selectedAgentId: 'sa2' })
    expect(screen.getAllByText('No transcript for this agent.')).toHaveLength(1)
  })

  it('explains delegation being off and opens the settings file', () => {
    const props = renderMap({
      agents: [],
      backgroundTasks: [],
      delegationMode: 'off',
      isDelegationEnabled: false,
    })
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(map).toHaveTextContent('No subagents in this conversation.')
    expect(map).toHaveTextContent('subagent delegation is off')
    fireEvent.click(screen.getByText('Open the Muse Code settings file'))
    expect(props.onOpenMuseSettings).toHaveBeenCalledTimes(1)
  })

  it('says nothing about delegation on the Model API backend', () => {
    renderMap({
      agents: [],
      backgroundTasks: [],
      delegationMode: undefined,
      isDelegationEnabled: false,
    })
    expect(screen.queryByText('Open the Muse Code settings file')).toBeNull()
  })
})

describe('AgentMap owner controls (M18)', () => {
  it('offers interrupt and stop with a note while an agent runs, close and a follow-up once done, nothing when closed', () => {
    const running = {
      ...explorer,
      id: 'r',
      subagentId: 'sub-r',
      status: 'inProgress',
      controlStatus: 'running',
    }
    const done = {
      ...explorer,
      id: 'd',
      subagentId: 'sub-d',
      status: 'completed',
      controlStatus: 'resultReady',
      resultSummary: 'ALPHA',
      resultText: 'ALPHA, as asked.',
    }
    const closed = {
      ...explorer,
      id: 'c',
      subagentId: 'sub-c',
      status: 'completed',
      controlStatus: 'closed',
    }
    expect(controlsFor(running)).toEqual(['interrupt', 'stop'])
    expect(controlsFor(done)).toEqual(['close'])
    expect(controlsFor(closed)).toEqual([])
    expect(controlsFor({ ...running, controlStatus: 'interrupted' })).toEqual(['resume', 'stop'])
    const onControl = vi.fn()
    const onMessage = vi.fn()
    renderMap({ agents: [running, done], selectedAgentId: 'r', onControl, onMessage })
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    expect(onControl).toHaveBeenCalledWith('sub-r', 'interrupt')
    const note = screen.getByLabelText('Send message')
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled()
    fireEvent.change(note, { target: { value: '  also check tests ' } })
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(onMessage).toHaveBeenCalledWith('sub-r', 'also check tests', false)
    expect(note).toHaveValue('')
    renderMap({ agents: [done], selectedAgentId: 'd', onControl, onMessage })
    expect(screen.getByText('ALPHA, as asked.')).toHaveClass('agent-result-text')
    fireEvent.change(screen.getByLabelText('Follow-up task'), { target: { value: 'now BETA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Follow-up task' }))
    expect(onMessage).toHaveBeenCalledWith('sub-d', 'now BETA', true)
    fireEvent.click(screen.getByRole('button', { name: 'Close agent' }))
    expect(onControl).toHaveBeenCalledWith('sub-d', 'close')
  })
})

describe('AgentMap workflows (M47)', () => {
  const run: WorkflowEntry = {
    kind: 'workflow',
    id: 'w1',
    status: 'inProgress',
    workflowRunId: 'run-1',
    entryId: 'generated.model-chosen',
    triggerSource: 'guidanceAuto',
    children: [{ childId: 'c1', attempt: 1, status: 'started', label: 'ping' }],
  }

  it('lists the runs and agents read-only, and notes the trigger mode beside delegation', () => {
    const props = renderMap({
      agents: [],
      backgroundTasks: [],
      delegationMode: 'off',
      isDelegationEnabled: false,
      workflows: [run],
      workflowTriggerMode: 'auto',
    })
    const map = screen.getByRole('dialog', { name: 'Agent map' })
    expect(map).toHaveTextContent('1 workflow')
    // A map with a run in it is not "empty", though it has no subagents.
    expect(map).not.toHaveTextContent('No subagents')
    const runs = screen.getByRole('list', { name: 'Workflows' })
    expect(runs).toHaveTextContent('Written for this task')
    expect(runs).toHaveTextContent('ping')
    expect(screen.queryByRole('button', { name: 'Cancel workflow' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Skip ping|Retry ping/ })).toBeNull()
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('subagent delegation is off')
    expect(note).toHaveTextContent('Muse Code’s workflows are on auto')
    expect(note).toHaveTextContent('Set run.workflow_trigger_mode')
    // One way to the settings file, whatever the note says.
    fireEvent.click(screen.getByRole('button', { name: 'Open the Muse Code settings file' }))
    expect(props.onOpenMuseSettings).toHaveBeenCalledTimes(1)
  })

  it('notes the trigger mode alone when delegation needs no word', () => {
    renderMap({ workflowTriggerMode: 'off' })
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('Muse Code’s workflows are off')
    expect(note).not.toHaveTextContent('delegation')
    expect(screen.queryByRole('list', { name: 'Workflows' })).toBeNull()
  })
})

describe('agentStatusLabel (M40)', () => {
  it('says a known status in the installed table and shows an unknown one as it came', () => {
    expect(agentStatusLabel('inProgress')).toBe('running')
    expect(agentStatusLabel('resultReady')).toBe('result ready')
    expect(agentStatusLabel('paused')).toBe('paused')
    expect(agentStatusLabel('toString')).toBe('toString')
    setUiText({ ...EN, agentStatuses: { ...EN.agentStatuses, completed: 'abgeschlossen' } }, 'de')
    try {
      expect(agentStatusLabel('completed')).toBe('abgeschlossen')
    } finally {
      setUiText(EN, BASE_LOCALE)
    }
  })
})
