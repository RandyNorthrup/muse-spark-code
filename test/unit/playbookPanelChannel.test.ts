// The VS Code panel's channel to its window's playbook (M116, C-M116-6): what
// the Agent map's page and rows are answered, and what is never answered.
import { describe, expect, it, vi } from 'vitest'
import { createPlaybookPanel } from '../../src/host/playbook/playbookPanel'
import type { PlaybookWindow } from '../../src/host/playbook/playbookWindow'
import {
  playbookAgentsSchema,
  playbookHelloSchema,
  playbookResponseSchema,
  type PlaybookPanelResponse,
} from '../../src/runtime/playbook/panelWire'
import { OFFLOAD_REASON, offloadOffRequest, PANEL_BRIDGE } from './helpers/playbook/panelRequests'
import { surfacePort, surfaceRound, surfaceSnapshot } from './playbookSurfaceFixtures'

const BRIDGE = PANEL_BRIDGE
const ROW = { itemId: 'row-1', agentId: 'subagent-1', sessionId: 'child-1' }

function unused(): Promise<never> {
  return Promise.reject(new Error('the panel never asks for this'))
}

function nothing(): void {
  // A subscription or disposal the panel never makes.
}

function unsubscribed(): () => void {
  return nothing
}

function panelOver(overrides: Partial<PlaybookWindow> = {}, hasWorkspace = true) {
  const surface = surfacePort(surfaceSnapshot())
  const window: PlaybookWindow = {
    surface,
    agents: vi.fn(() => Promise.resolve({ [ROW.itemId]: [surfaceRound(1)] })),
    standing: unused,
    openReview: unused,
    dispatch: unused,
    answer: unused,
    recordDesign: unused,
    subscribe: unsubscribed,
    dispose: nothing,
    ...overrides,
  }
  const replies: PlaybookPanelResponse[] = []
  const panel = createPlaybookPanel(window, hasWorkspace)
  const ask = async (message: unknown) => {
    await panel(message, (reply) => {
      replies.push(reply)
    })
    return replies.at(-1)
  }
  return { window, surface, replies, ask }
}

/** The journal this window reads, as the panel is told. */
async function workspaceOf(setup: ReturnType<typeof panelOver>): Promise<string> {
  const hello = playbookHelloSchema.parse(await setup.ask({ type: 'playbookHello' }))
  if (hello.workspaceId === undefined) throw new Error('This window has a journal')
  return hello.workspaceId
}

describe('the panel’s playbook channel', () => {
  it('names the window’s journal by an id that says nothing about the folder', async () => {
    const setup = panelOver()
    const workspaceId = await workspaceOf(setup)
    expect(workspaceId).toMatch(/^[\da-f-]{36}$/u)
    // The same journal for the life of the window.
    expect(await workspaceOf(setup)).toBe(workspaceId)
    // Another window is another scope, though it may read the same folder.
    expect(await workspaceOf(panelOver())).not.toBe(workspaceId)
  })

  it('has no journal to name without a folder, and answers nothing from one', async () => {
    const setup = panelOver({}, false)
    expect(await setup.ask({ type: 'playbookHello' })).toEqual({ type: 'playbookHello' })
    const scope = { bridgeId: BRIDGE, workspaceId: 'any', requestId: 1 }
    expect(await setup.ask({ type: 'playbookRead', ...scope })).toEqual({
      type: 'playbookUnavailable',
      ...scope,
    })
  })

  it('reads and changes the journal through the window, answering the bridge that asked', async () => {
    const setup = panelOver()
    const scope = { bridgeId: BRIDGE, workspaceId: await workspaceOf(setup) }
    const read = playbookResponseSchema.parse(
      await setup.ask({ type: 'playbookRead', ...scope, requestId: 1 }),
    )
    expect(read).toMatchObject({ type: 'playbookState', ...scope, requestId: 1 })
    const changed = playbookResponseSchema.parse(
      await setup.ask(offloadOffRequest(scope.workspaceId, 2)),
    )
    expect(changed).toMatchObject({ type: 'playbookState', ...scope, requestId: 2 })
    expect(setup.surface.snapshot().settings.rules.offload).toMatchObject({
      enabled: false,
      reason: OFFLOAD_REASON,
    })
  })

  it('answers unavailable for another journal’s request, and for a journal it cannot read', async () => {
    const setup = panelOver()
    const stale = { bridgeId: BRIDGE, workspaceId: 'another-window', requestId: 3 }
    expect(await setup.ask({ type: 'playbookRead', ...stale })).toEqual({
      type: 'playbookUnavailable',
      ...stale,
    })
    const broken = panelOver({
      surface: {
        read: () => Promise.reject(new Error('private detail')),
        change: () => Promise.reject(new Error('private detail')),
      },
    })
    const scope = { bridgeId: BRIDGE, workspaceId: await workspaceOf(broken), requestId: 4 }
    const answer = await broken.ask({ type: 'playbookRead', ...scope })
    expect(answer).toEqual({ type: 'playbookUnavailable', ...scope })
    expect(JSON.stringify(answer)).not.toContain('private detail')
  })

  it('never passes on a journal answer that is not a snapshot', async () => {
    const setup = panelOver({
      surface: {
        read: () => Promise.resolve({ settings: 'all rules off' }),
        change: () => Promise.resolve('changed'),
      },
    })
    const scope = { bridgeId: BRIDGE, workspaceId: await workspaceOf(setup), requestId: 5 }
    expect(await setup.ask({ type: 'playbookRead', ...scope })).toEqual({
      type: 'playbookUnavailable',
      ...scope,
    })
  })

  it('gives the map’s rows their records, and none when they cannot be read', async () => {
    const setup = panelOver()
    const answer = playbookAgentsSchema.parse(
      await setup.ask({ type: 'playbookAgents', requestId: 7, children: [ROW] }),
    )
    expect(answer.requestId).toBe(7)
    expect(Object.keys(answer.records)).toEqual([ROW.itemId])
    expect(setup.window.agents).toHaveBeenCalledWith([ROW])
    const broken = panelOver({ agents: () => Promise.reject(new Error('private detail')) })
    expect(await broken.ask({ type: 'playbookAgents', requestId: 8, children: [ROW] })).toEqual({
      type: 'playbookAgents',
      requestId: 8,
      records: {},
    })
  })

  it('answers nothing it cannot read, and does nothing for it', async () => {
    const setup = panelOver()
    for (const message of [
      undefined,
      'playbookRead',
      { type: 'playbookRead' },
      { type: 'playbookRead', bridgeId: 'short', workspaceId: 'w', requestId: 1 },
      { type: 'playbookChange', bridgeId: BRIDGE, workspaceId: 'w', requestId: 1 },
      { type: 'playbookAgents', requestId: 0, children: [] },
      { type: 'playbookAgents', requestId: 1, children: [{ itemId: 'row-1' }] },
      { type: 'playbookSettings', enabled: false },
    ])
      await setup.ask(message)
    expect(setup.replies).toEqual([])
    expect(setup.window.agents).not.toHaveBeenCalled()
    expect(setup.surface.snapshot()).toEqual(surfaceSnapshot())
  })
})
