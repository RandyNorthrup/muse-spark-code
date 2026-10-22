// @vitest-environment jsdom
// RLTESTDRIVE item 1: a finished agent reads one true status on its card
// and its detail page, never the stale raw status beside the derived one
// ("Running · Inactive · Ended, Unverified" for a closed Muse Code child
// whose status field never moved off inProgress).
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AgentMapContent, { type SubagentEntry } from '../../src/webview/components/AgentMapContent'

function finishedAgent(): SubagentEntry {
  return {
    kind: 'subagent',
    id: 'agent-1',
    seq: 1,
    objective: 'Explore theAuth flow',
    status: 'inProgress',
    controlStatus: 'closed',
    subagentId: 'subagent-1',
  }
}

function renderMap(selected: string | undefined) {
  const noop = () => undefined
  render(
    <AgentMapContent
      backend="museCode"
      title="Agent map"
      modelId={undefined}
      contextUsedTokens={undefined}
      agents={[finishedAgent()]}
      backgroundTasks={[]}
      delegationMode={undefined}
      isDelegationEnabled={false}
      childTranscripts={{}}
      selectedAgentId={selected}
      onSelectAgent={noop}
      onReadChild={noop}
      onControl={noop}
      onMessage={noop}
      onStopTask={noop}
      onStopAllTasks={noop}
      onOpenMuseSettings={noop}
      onClose={noop}
      workflows={[]}
      workflowTriggerMode={undefined}
      team={undefined}
      teamActions={undefined}
    />,
  )
}

describe('Agent map single status', () => {
  it('a finished agent card reads its derived status once, never the stale raw one', () => {
    renderMap(undefined)
    const metas = screen.getAllByText(/Inactive · Ended, Unverified/)
    expect(metas.length).toBeGreaterThan(0)
    expect(screen.queryByText(/Running/)).toBeNull()
  })

  it('the detail page reads the same single status', () => {
    renderMap('agent-1')
    expect(screen.getAllByText(/Inactive · Ended, Unverified/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/Running/)).toBeNull()
  })
})
