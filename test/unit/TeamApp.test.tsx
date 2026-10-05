// @vitest-environment jsdom
// The team through the real App (M96 lane U2): the host's `teamTree`
// message shows the header pill and the Agent map's tree, transcript items
// become the cards, and the tree's and cards' buttons post the protocol
// messages lanes T/A/W answer. This mirrors the harness scenarios
// `team-tree` and `team-cards`, which need a browser to run.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, setUiText } from '../../src/shared/l10n/text'
import type { HostToWebviewMessage, WebviewToHostMessage } from '../../src/shared/protocol'
import { App } from '../../src/webview/App'
import type { TeamTreeData } from '../../src/shared/teamView'
import { initialUiState, uiReducer } from '../../src/webview/state/uiState'
import { testSettings } from './helpers/fakes'

function deliver(data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }))
  })
}

const init = {
  type: 'init',
  emptyStateHint: 'Type /model to pick the right tool for the job.',
  composerPlaceholder: 'ctrl esc to focus or unfocus Muse',
  settings: testSettings,
} satisfies HostToWebviewMessage

const tree: TeamTreeData = {
  orchestrator: { model: 'muse-spark-1.3', backend: 'modelApi', slot: 'default' },
  roles: [
    {
      id: 'engineering',
      name: 'engineering',
      mode: 'own-branch',
      toolGroups: ['edit'],
      entries: [
        {
          id: 'e1',
          provider: 'Meta',
          model: 'muse-spark-1.3',
          payKind: 'key',
          caps: [],
          running: 1,
          state: 'ready',
          warnings: [],
          workers: [{ taskId: 't1', brief: 'Add the retry', status: 'running' }],
        },
      ],
      queued: [],
      unmerged: [],
      interrupted: [],
    },
  ],
}

function renderSignedIn() {
  setUiText(EN, BASE_LOCALE)
  const postMessage = vi.fn<(message: WebviewToHostMessage) => void>()
  render(<App postMessage={postMessage} newLocalId={() => 'local-1'} />)
  deliver(init)
  deliver({ type: 'authState', status: 'signedIn', backend: 'modelApi' })
  return postMessage
}

describe('Team through the App (M96 lane U2)', () => {
  afterEach(() => {
    setUiText(EN, BASE_LOCALE)
  })

  it('shows no team UI before the host sends a team', () => {
    renderSignedIn()
    expect(screen.queryByRole('button', { name: /team tasks/ })).toBeNull()
  })

  it('shows the pill and the map’s tree once the host sends one', async () => {
    renderSignedIn()
    deliver({ type: 'teamTree', tree })
    expect(screen.getByRole('button', { name: '1 team task' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '1 team task' }))
    expect(await screen.findByRole('tree', { name: 'Team' })).toBeDefined()
    expect(
      screen.getByRole('treeitem', {
        name: 'engineering, Entry 1, muse-spark-1.3, Meta, 1 running',
      }),
    ).toBeDefined()
  })

  it('posts the tree’s Stop through the protocol', async () => {
    const postMessage = renderSignedIn()
    deliver({ type: 'teamTree', tree })
    fireEvent.click(screen.getByRole('button', { name: '1 team task' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    expect(postMessage).toHaveBeenCalledWith({ type: 'stopTeamTask', taskId: 't1' })
  })

  it('turns a waiting item into an answering card', async () => {
    const postMessage = renderSignedIn()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemStarted',
        item: {
          itemId: 'w1',
          kind: 'teamWaiting',
          status: 'inProgress',
          teamWaiting: { waitingId: 'wait-1', roleId: 'qa' },
        },
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Queue it' }))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'answerTeamWaiting',
      waitingId: 'wait-1',
      choice: 'queue',
    })
  })

  it('turns a merge item into a deciding card', async () => {
    const postMessage = renderSignedIn()
    deliver({
      type: 'agentEvent',
      event: {
        type: 'itemStarted',
        item: {
          itemId: 'm1',
          kind: 'teamMerge',
          status: 'inProgress',
          teamMerge: {
            taskId: 't9',
            roleId: 'engineering',
            brief: 'Add the retry',
            branch: 'agents/engineering/t9',
            review: 'reviewed',
            affectedFiles: ['src/retry.ts'],
            protectedPaths: [],
          },
        },
      },
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Merge' }))
    expect(postMessage).toHaveBeenCalledWith({
      type: 'decideTeamMerge',
      taskId: 't9',
      decision: 'merge',
    })
  })
})

describe('RVM96B App regressions', () => {
  it('17 announces each worker completion politely once, including movement to unmerged', () => {
    renderSignedIn()
    deliver({ type: 'teamTree', tree })
    const live = document.querySelector('[aria-live="polite"]')!
    expect(live.textContent).toBe('')
    const finished: TeamTreeData = {
      ...tree,
      roles: tree.roles.map((role) => ({
        ...role,
        entries: role.entries.map((entry) => ({ ...entry, workers: [], running: 0 })),
        unmerged: [{ taskId: 't1', brief: 'Add the retry', status: 'done' }],
      })),
    }
    deliver({ type: 'teamTree', tree: finished })
    expect(live.textContent).toBe('Team task Add the retry: completed.')
    const completed = uiReducer(
      { ...initialUiState, teamTree: tree },
      { type: 'hostMessage', message: { type: 'teamTree', tree: finished }, at: 0 },
    )
    const repeated = uiReducer(completed, {
      type: 'hostMessage',
      message: { type: 'teamTree', tree: finished },
      at: 1,
    })
    expect(repeated.announcement).toBe(completed.announcement)
    deliver({ type: 'teamTree', tree: finished })
    expect(live.textContent).toBe(completed.announcement?.text)
    expect(document.querySelectorAll('[aria-live="polite"]')).toHaveLength(1)
  })

  it('18 removes a supplied team with the validated clearTeamTree protocol message', () => {
    renderSignedIn()
    deliver({ type: 'teamTree', tree })
    expect(screen.getByRole('button', { name: '1 team task' })).toBeDefined()
    deliver({ type: 'clearTeamTree' })
    expect(screen.queryByRole('button', { name: /team task/ })).toBeNull()
    deliver({ type: 'teamTree', tree })
    expect(screen.getByRole('button', { name: '1 team task' })).toBeDefined()
  })
})
