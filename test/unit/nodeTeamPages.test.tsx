// @vitest-environment jsdom
// M110c lane U3: the node's team and nodes pages show the orchestrator's
// tree, the merge queue positions and every worker's liveness, and say
// plainly when the queue and the fleet are empty.
import { render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import type { TeamTreeData } from '../../src/shared/teamView'
import { NodeTeamPage } from '../../src/webview/node/team/TeamPage'
import { NodeNodesPage } from '../../src/webview/node/nodes/NodesPage'

afterEach(() => {
  setUiText(EN, 'en')
})

const tree: TeamTreeData = {
  orchestrator: { model: 'muse-spark-1.3-contributor', backend: 'model-api', slot: 'default' },
  roles: [],
}

describe('node team page', () => {
  it('shows the merge queue positions beside the team tree', () => {
    render(
      <NodeTeamPage
        tree={tree}
        queue={[
          { id: 'a', position: 1, reason: 'urgent' },
          { id: 'b', position: 2, reason: 'normal' },
        ]}
      />,
    )
    expect(screen.getByRole('region', { name: 'Team' })).toBeVisible()
    const queue = screen.getByRole('region', { name: 'Merge Queue' })
    const rows = within(queue).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Queue position 1: urgent')
    expect(rows[1]).toHaveTextContent('Queue position 2: normal')
  })

  it('says the board is empty instead of showing a bare list', () => {
    render(<NodeTeamPage tree={tree} queue={[]} />)
    expect(
      within(screen.getByRole('region', { name: 'Merge Queue' })).getByText(
        'No tasks on the board',
      ),
    ).toBeVisible()
    expect(UI_TEXT.teamTraffic.noTasks).toBe('No tasks on the board')
  })
})

describe('node nodes page', () => {
  it('names every worker with its liveness and capabilities', () => {
    render(
      <NodeNodesPage
        nodes={[
          { nodeId: 'node-a', capabilities: ['gpu'], liveness: 'live' },
          { nodeId: 'node-b', capabilities: [], liveness: 'gone' },
        ]}
      />,
    )
    const page = screen.getByRole('region', { name: 'Nodes' })
    const rows = within(page).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('node-a · Live · Capabilities: gpu')
    expect(rows[1]).toHaveTextContent('node-b · Gone')
    expect(rows[1]?.textContent).not.toContain('Capabilities')
  })

  it('says no node has joined instead of showing a bare list', () => {
    render(<NodeNodesPage nodes={[]} />)
    expect(
      within(screen.getByRole('region', { name: 'Nodes' })).getByText('No nodes have joined'),
    ).toBeVisible()
  })
})
