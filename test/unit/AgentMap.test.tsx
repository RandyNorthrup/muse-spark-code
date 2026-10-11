// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import type { PlaybookRecord } from '../../src/shared/playbook'
import { playbookPanelRequestSchema } from '../../src/runtime/playbook/panelWire'
import { surfacePort, surfaceSnapshot } from './playbookSurfaceFixtures'
import { agentStatusLabel, formatDurationMs } from '../../src/webview/agentFormat'
import type { WorkflowEntry } from '../../src/webview/state/uiState'
import AgentMap, {
  type AgentMapProps,
  controlsFor,
  type SubagentEntry,
  type ToolEntry,
} from '../../src/webview/components/AgentMapContent'
import { agentMapProps } from './helpers/transcriptFixtures'

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
    ...agentMapProps(),
    contextUsedTokens: 705_900,
    agents: [explorer, reviewer],
    backgroundTasks: [task],
    delegationMode: 'auto',
    isDelegationEnabled: true,
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
  it('keeps the lazy team tree and opens a failed agent with recovery controls', async () => {
    const agent: SubagentEntry = {
      ...explorer,
      status: 'failed',
      agentEvidence: { stopReason: 'error' },
    }
    const props = agentMapProps({
      agents: [agent],
      onControl: vi.fn(),
      team: {
        orchestrator: { model: 'muse-spark-1.3', backend: 'modelApi', slot: 'default' },
        roles: [],
      },
    })
    const view = render(<AgentMap {...props} />)
    expect(await screen.findByRole('tree', { name: EN.teamTreeLabel })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Map the workspace/ })).toHaveTextContent(
      'Inactive · Failed',
    )
    fireEvent.click(screen.getByRole('button', { name: /Map the workspace/ }))
    expect(props.onSelectAgent).toHaveBeenCalledWith(agent.id)
    view.rerender(<AgentMap {...props} selectedAgentId={agent.id} />)
    expect(screen.getByRole('region', { name: 'Agent Receipt' })).toHaveTextContent('Error')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(props.onControl).toHaveBeenCalledWith('sub-1', 'continue')
  })

  it('offers recovery for a background task whose reported final exit is nonzero', () => {
    const onControl = vi.fn()
    renderMap({
      agents: [],
      backgroundTasks: [{ ...task, status: 'completed', exitCode: 1 }],
      onControl,
    })
    expect(screen.getByText(/Inactive · Failed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onControl).toHaveBeenCalledWith(task.id, 'continue')
  })
  it('shows an incomplete receipt, linked files and requested recovery controls', () => {
    const agent: SubagentEntry = {
      ...explorer,
      agentEvidence: { stopReason: 'budget', unfinished: ['Run Checks'] },
    }
    const props = renderMap({
      agents: [agent],
      selectedAgentId: agent.id,
      onOpenFile: vi.fn(),
      childTranscripts: {
        'child-1': {
          entries: [
            {
              ...task,
              id: 'c',
              isBackground: false,
              status: 'completed',
              exitCode: 1,
              durationMs: 1000,
              changedFiles: [{ path: String.raw`src\app.ts`, added: 2, removed: 1 }],
            },
          ],
        },
      },
    })
    expect(screen.getByRole('region', { name: 'Agent Receipt' })).toHaveTextContent(
      'Budget Exhausted',
    )
    expect(screen.getByText(/Inactive · Incomplete/)).toHaveAttribute('aria-live', 'polite')
    fireEvent.click(screen.getByRole('button', { name: 'src/app.ts' }))
    expect(props.onOpenFile).toHaveBeenCalledWith('src/app.ts', undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(props.onControl).toHaveBeenCalledWith('sub-1', 'continue')
    expect(props.onControl).toHaveBeenCalledWith('sub-1', 'retry')
  })

  it('shows trusted per-agent strike facts and opens the shared settings surface', async () => {
    const snapshot = surfaceSnapshot()
    renderMap({ playbookPort: surfacePort(snapshot), playbookRecords: { sa1: snapshot.records } })
    const badge = await screen.findByText(/Concurrency: 3 review rounds/u)
    expect(badge.closest('button')).toHaveTextContent('Map the workspace')
    expect(screen.getByRole('button', { name: /Review the diff/u })).not.toHaveTextContent(
      'review rounds',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Playbook Settings' }))
    expect(
      await screen.findByRole('heading', { name: 'Orchestrator Playbook', level: 1 }),
    ).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the Map' }))
    expect(screen.getByRole('dialog', { name: 'Agent Map' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Playbook Settings' })).toHaveFocus()
  })

  it('shows policy why-notes in the selected agent details', async () => {
    renderMap({ selectedAgentId: 'sa1', playbookRecords: { sa1: surfaceSnapshot().records } })
    expect(await screen.findByText(/Needs you: a safety classifier blocked/u)).toBeInTheDocument()
    expect(screen.getByText(/requires a redesign/u)).toHaveTextContent('Concurrency')
  })
  it('labels a billed Model API child in the map', () => {
    renderMap({ backend: 'modelApi', agents: [{ ...explorer, paid: 'subagents' }] })
    expect(screen.getByRole('button', { name: /Map the workspace/ })).toHaveTextContent('Paid')
  })

  it('draws the conversation, its agents with duration and tokens, and the background tasks', () => {
    const props = renderMap()
    const map = screen.getByRole('dialog', { name: 'Agent Map' })
    expect(map).toHaveTextContent('2 Agents · click an agent for details')
    expect(map).toHaveTextContent('Chrome control update')
    expect(map).toHaveTextContent('muse-spark-1.3 · 705.9K tokens in context')
    expect(screen.getByRole('button', { name: /Map the workspace/ })).toHaveTextContent(
      '1m 30s · 77.6K tokens · Closed',
    )
    expect(screen.getByRole('button', { name: /Review the diff/ })).toHaveTextContent('Running')
    expect(map).toHaveTextContent('1 Background Task')
    expect(screen.getByRole('list', { name: 'Background Tasks' })).toHaveTextContent(
      'PowerShellRun delayed output command · Running · ActiveStop',
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
    expect(screen.getByRole('dialog', { name: 'Agent Map' })).not.toHaveTextContent('No subagents')
    const list = screen.getByRole('list', { name: 'Background Tasks' })
    // Only the running one has a Stop, named for what it stops.
    const stops = screen.getAllByRole('button', { name: /^Stop: / })
    expect(stops).toHaveLength(1)
    expect(stops[0]).toHaveAccessibleName('Stop: PowerShell Run delayed output command')
    expect(list).toHaveTextContent('Cancelled')
    fireEvent.click(screen.getByRole('button', { name: /^Stop: / }))
    expect(props.onStopTask).toHaveBeenCalledWith('bg1')
    fireEvent.click(screen.getByRole('button', { name: 'Stop All' }))
    expect(props.onStopAllTasks).toHaveBeenCalledOnce()
  })

  it('waits on a Stop already asked (M46)', () => {
    renderMap({ agents: [], backgroundTasks: [{ ...task, taskRequest: 'stop' }] })
    expect(screen.getByRole('button', { name: /^Stop: / })).toBeDisabled()
  })

  it('offers no Stop All when every background task has ended (M46)', () => {
    renderMap({ agents: [], backgroundTasks: [{ ...task, status: 'completed' }] })
    expect(screen.queryByRole('button', { name: 'Stop All' })).not.toBeInTheDocument()
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
    const map = screen.getByRole('dialog', { name: 'Agent Map' })
    expect(map).toHaveTextContent('Role: explorer · 1m 30s · 77.6K tokens · Closed')
    expect(map).toHaveTextContent('Mapped 12 files')
    expect(screen.getByRole('list', { name: 'Agent Transcript' })).toHaveTextContent(
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
    const map = screen.getByRole('dialog', { name: 'Agent Map' })
    expect(map).toHaveTextContent('No subagents in this conversation.')
    expect(map).toHaveTextContent('subagent delegation is off')
    fireEvent.click(screen.getByText('Open the Muse Code Settings File'))
    expect(props.onOpenMuseSettings).toHaveBeenCalledTimes(1)
  })

  it('says nothing about delegation on the Model API backend', () => {
    renderMap({
      agents: [],
      backgroundTasks: [],
      delegationMode: undefined,
      isDelegationEnabled: false,
    })
    expect(screen.queryByText('Open the Muse Code Settings File')).toBeNull()
  })
})

describe('AgentMap owner controls (M18, M48)', () => {
  it('keeps Muse Code owner controls on the captured verbs and reserves read/reopen for Model API', () => {
    const done = {
      ...explorer,
      subagentId: 'sub-d',
      status: 'completed',
      controlStatus: 'resultReady',
    }
    const closed = { ...done, controlStatus: 'closed' }
    expect(controlsFor(done, 'museCode')).toEqual(['close'])
    expect(controlsFor(closed, 'museCode')).toEqual([])
    expect(controlsFor(done, 'modelApi')).toEqual(['readResult', 'close'])
    expect(controlsFor(closed, 'modelApi')).toEqual(['reopen'])
  })

  it('offers interrupt and stop while running, result consumption when ready, and reopen when closed', () => {
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
    expect(controlsFor(running, 'modelApi')).toEqual(['interrupt', 'stop'])
    expect(controlsFor(done, 'modelApi')).toEqual(['readResult', 'close'])
    expect(controlsFor(closed, 'modelApi')).toEqual(['reopen'])
    expect(controlsFor({ ...running, controlStatus: 'interrupted' }, 'modelApi')).toEqual([
      'resume',
      'stop',
    ])
    const onControl = vi.fn()
    const onMessage = vi.fn()
    renderMap({
      backend: 'modelApi',
      agents: [running, done],
      selectedAgentId: 'r',
      onControl,
      onMessage,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Interrupt' }))
    expect(onControl).toHaveBeenCalledWith('sub-r', 'interrupt')
    const note = screen.getByLabelText('Send Message')
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeDisabled()
    fireEvent.change(note, { target: { value: '  also check tests ' } })
    fireEvent.keyDown(note, { key: 'Enter' })
    expect(onMessage).toHaveBeenCalledWith('sub-r', 'also check tests', false)
    expect(note).toHaveValue('')
    renderMap({ backend: 'modelApi', agents: [done], selectedAgentId: 'd', onControl, onMessage })
    expect(screen.getByText('ALPHA, as asked.')).toHaveClass('agent-result-text')
    fireEvent.change(screen.getByLabelText('Follow-Up Task'), { target: { value: 'now BETA' } })
    fireEvent.click(screen.getByRole('button', { name: 'Follow-Up Task' }))
    expect(onMessage).toHaveBeenCalledWith('sub-d', 'now BETA', true)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Result Read' }))
    expect(onControl).toHaveBeenCalledWith('sub-d', 'readResult')
    fireEvent.click(screen.getByRole('button', { name: 'Close Agent' }))
    expect(onControl).toHaveBeenCalledWith('sub-d', 'close')
    renderMap({ backend: 'modelApi', agents: [closed], selectedAgentId: 'c', onControl, onMessage })
    fireEvent.click(screen.getByRole('button', { name: 'Reopen Agent' }))
    expect(onControl).toHaveBeenCalledWith('sub-c', 'reopen')
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
    const map = screen.getByRole('dialog', { name: 'Agent Map' })
    expect(map).toHaveTextContent('1 workflow')
    // A map with a run in it is not "empty", though it has no subagents.
    expect(map).not.toHaveTextContent('No subagents')
    const runs = screen.getByRole('list', { name: 'Workflows' })
    expect(runs).toHaveTextContent('Written for This Task')
    expect(runs).toHaveTextContent('ping')
    expect(screen.queryByRole('button', { name: 'Cancel workflow' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Skip ping|Retry ping/ })).toBeNull()
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('subagent delegation is off')
    expect(note).toHaveTextContent('Muse Code’s workflows are on auto')
    expect(note).toHaveTextContent('Set run.workflow_trigger_mode')
    // One way to the settings file, whatever the note says.
    fireEvent.click(screen.getByRole('button', { name: 'Open the Muse Code Settings File' }))
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

/** One answer of the host, as the window receives it. */
function deliver(message: unknown): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'playbook', message } }))
  })
}

/**
 * The window's playbook as VS Code's host answers the map: every answer in
 * the `playbook` envelope, on a later turn. `workspaceId` undefined is a
 * window with no folder open.
 */
function hostPlaybook(
  workspaceId: string | undefined,
  records: Record<string, PlaybookRecord[]> = {},
  hasSpawnGap = false,
) {
  const journal = surfacePort(surfaceSnapshot())
  const requests: unknown[] = []
  const answer = async (raw: unknown) => {
    const request = playbookPanelRequestSchema.parse(raw)
    if (request.type === 'playbookHello') {
      deliver({
        type: 'playbookHello',
        ...(workspaceId !== undefined && { workspaceId }),
        ...(hasSpawnGap && { spawnGap: true }),
      })
      return
    }
    if (request.type === 'playbookAgents') {
      deliver({ type: 'playbookAgents', requestId: request.requestId, records })
      return
    }
    deliver({
      type: 'playbookState',
      bridgeId: request.bridgeId,
      workspaceId: request.workspaceId,
      requestId: request.requestId,
      snapshot:
        request.type === 'playbookRead'
          ? await journal.read()
          : await journal.change(request.change),
    })
  }
  const post = vi.fn((raw: unknown) => {
    requests.push(raw)
    setTimeout(() => {
      void answer(raw)
    }, 0)
  })
  return { post, requests, journal }
}

const typesOf = (requests: readonly unknown[]) =>
  requests.map((request) => playbookPanelRequestSchema.parse(request).type)

describe('AgentMap and its window’s playbook (M116)', () => {
  it('asks which journal the window reads, then offers its page and reads it', async () => {
    const host = hostPlaybook('journal-1')
    renderMap({ onPlaybook: host.post })
    fireEvent.click(await screen.findByRole('button', { name: 'Playbook Settings' }))
    expect(
      await screen.findByRole('heading', { name: 'Orchestrator Playbook', level: 1 }),
    ).toBeInTheDocument()
    expect(host.requests[0]).toEqual({ type: 'playbookHello' })
    expect(host.requests).toContainEqual(
      expect.objectContaining({ type: 'playbookRead', workspaceId: 'journal-1' }),
    )
  })

  it('is the map it always was while the window says nothing, or has no journal', async () => {
    const silent = vi.fn()
    const first = render(
      <AgentMap {...agentMapProps()} agents={[explorer, reviewer]} onPlaybook={silent} />,
    )
    await waitFor(() => {
      expect(silent).toHaveBeenCalledWith({ type: 'playbookHello' })
    })
    expect(screen.queryByRole('button', { name: 'Playbook Settings' })).toBeNull()
    expect(silent).toHaveBeenCalledOnce()
    first.unmount()
    // A window with no folder open answers, and names no journal.
    const host = hostPlaybook(undefined)
    renderMap({ onPlaybook: host.post })
    await waitFor(() => {
      expect(host.post).toHaveBeenCalledOnce()
    })
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })
    })
    expect(screen.queryByRole('button', { name: 'Playbook Settings' })).toBeNull()
    expect(typesOf(host.requests)).toEqual(['playbookHello'])
    expect(screen.getByRole('button', { name: /Map the workspace/u })).toBeInTheDocument()
  })

  it('reads its rows’ records by the ids the host recorded the agents under', async () => {
    const host = hostPlaybook('journal-1', { sa1: surfaceSnapshot().records })
    renderMap({ onPlaybook: host.post })
    const badge = await screen.findByText(/Concurrency: 3 review rounds/u)
    expect(badge.closest('button')).toHaveTextContent('Map the workspace')
    // The reviewer's row has no child session the host recorded: it is not asked about.
    expect(host.requests).toContainEqual({
      type: 'playbookAgents',
      requestId: 1,
      children: [{ itemId: 'sa1', agentId: 'sub-1', sessionId: 'child-1' }],
    })
    expect(screen.getByRole('button', { name: /Review the diff/u })).not.toHaveTextContent(
      'review rounds',
    )
  })

  it('asks about its rows again only when the rows themselves change', async () => {
    const host = hostPlaybook('journal-1')
    const props = { ...agentMapProps(), onPlaybook: host.post }
    const view = render(<AgentMap {...props} agents={[explorer, reviewer]} />)
    await screen.findByRole('button', { name: 'Playbook Settings' })
    const asked = () => typesOf(host.requests).filter((type) => type === 'playbookAgents').length
    await waitFor(() => {
      expect(asked()).toBe(1)
    })
    // The same rows in a new array, as every render of the panel hands them.
    view.rerender(<AgentMap {...props} agents={[{ ...explorer }, { ...reviewer }]} />)
    view.rerender(<AgentMap {...props} agents={[{ ...explorer, status: 'failed' }, reviewer]} />)
    expect(asked()).toBe(1)
    view.rerender(
      <AgentMap
        {...props}
        agents={[explorer, { ...reviewer, subagentId: 'sub-2', childSessionId: 'child-2' }]}
      />,
    )
    await waitFor(() => {
      expect(asked()).toBe(2)
    })
  })

  it('says in one plain line when the window reports subagents the playbook is not asked about', async () => {
    const host = hostPlaybook('journal-1', {}, true)
    renderMap({ onPlaybook: host.post })
    const line = await screen.findByText(
      'Playbook: Muse Code starts subagents here without asking (Auto mode, Bypass Permissions mode, or an allow rule of yours), so the playbook does not admit them. What they change is counted at the next review.',
    )
    expect(line).toHaveAttribute('role', 'note')
    expect(screen.getByRole('button', { name: 'Playbook Settings' })).toBeInTheDocument()
  })

  it('says nothing of the kind while the window reports no such thing', async () => {
    const host = hostPlaybook('journal-1')
    renderMap({ onPlaybook: host.post })
    await screen.findByRole('button', { name: 'Playbook Settings' })
    expect(screen.queryByText(/starts subagents without asking/u)).toBeNull()
  })

  it('leaves a host that hands the map its own port alone', async () => {
    const post = vi.fn()
    renderMap({ playbookPort: surfacePort(surfaceSnapshot()), onPlaybook: post })
    await screen.findByRole('button', { name: 'Playbook Settings' })
    expect(post).not.toHaveBeenCalled()
  })

  it('takes nothing that is not in the playbook’s own envelope', async () => {
    const post = vi.fn()
    renderMap({ onPlaybook: post })
    await waitFor(() => {
      expect(post).toHaveBeenCalledOnce()
    })
    act(() => {
      // The same words outside the envelope, and an envelope of another channel.
      for (const data of [
        { type: 'playbookHello', workspaceId: 'journal-1' },
        { type: 'schedulesMessage', message: { type: 'playbookHello', workspaceId: 'journal-1' } },
        { type: 'playbook', message: { type: 'playbookHello', workspaceId: '' } },
        { type: 'playbook' },
      ])
        window.dispatchEvent(new MessageEvent('message', { data }))
    })
    expect(screen.queryByRole('button', { name: 'Playbook Settings' })).toBeNull()
    expect(post).toHaveBeenCalledOnce()
  })
})

describe('agentStatusLabel (M40)', () => {
  it('says a known status in the installed table and shows an unknown one as it came', () => {
    expect(agentStatusLabel('inProgress')).toBe('Running')
    expect(agentStatusLabel('resultReady')).toBe('Result Ready')
    expect(agentStatusLabel('queued')).toBe('Queued')
    expect(agentStatusLabel('closed')).toBe('Closed')
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
