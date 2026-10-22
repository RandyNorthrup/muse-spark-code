// The VS Code panel's channel to its window's playbook (M116, C-M116-6): what
// the Agent map's page and rows are answered, and what is never answered.
import { describe, expect, it } from 'vitest'

/** A function that runs `impl` and keeps the calls it saw, in order. */
function keepCalls<T extends unknown[], R>(
  impl: (...args: T) => R,
): ((...args: T) => R) & {
  calls: T[]
} {
  const calls: T[] = []
  const fn = (...args: T): R => {
    calls.push(args)
    return impl(...args)
  }
  return Object.assign(fn, { calls })
}
import { createPlaybookPanel, type PlaybookPanelGap } from '../../src/host/playbook/playbookPanel'
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
/** How long the hello waits for its conversation's answer in these tests. */
const HELLO_TIMEOUT_MS = 40

function unused(): Promise<never> {
  return Promise.reject(new Error('the panel never asks for this'))
}

function nothing(): void {
  // A subscription or disposal the panel never makes.
}

/** A log sink that keeps nothing: the scenes assert on replies, not log lines. */
const noopLog = (_message: string): void => undefined

function unsubscribed(): () => void {
  return nothing
}

function panelOver(overrides: Partial<PlaybookWindow> = {}, hasWorkspace = true) {
  const surface = surfacePort(surfaceSnapshot())
  const agents = keepCalls(() => Promise.resolve({ [ROW.itemId]: [surfaceRound(1)] }))
  const window: PlaybookWindow = {
    surface,
    agents,
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
  // The scenes assert on replies, not log lines.
  const log = { trace: noopLog, info: noopLog, warn: noopLog, error: noopLog }
  const panel = createPlaybookPanel(window, hasWorkspace, log, HELLO_TIMEOUT_MS)
  const ask = async (message: unknown, hasSpawnGap?: PlaybookPanelGap) => {
    await panel(
      message,
      (reply) => {
        replies.push(reply)
      },
      hasSpawnGap,
    )
    return replies.at(-1)
  }
  // What the default agents stub was asked, in order. An overridden agents
  // port answers instead, and is not recorded here.
  return { window, surface, replies, ask, agentCalls: agents.calls }
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

  it('tells the map of subagents the playbook is not asked about, only where the conversation says so', async () => {
    const setup = panelOver()
    expect(await setup.ask({ type: 'playbookHello' }, () => Promise.resolve(true))).toMatchObject({
      type: 'playbookHello',
      spawnGap: true,
    })
    // A conversation that is owed no such line, one that has no playbook, and no conversation at all.
    for (const hasSpawnGap of [() => Promise.resolve(false), () => undefined, undefined])
      expect(await setup.ask({ type: 'playbookHello' }, hasSpawnGap)).toEqual({
        type: 'playbookHello',
        workspaceId: await workspaceOf(setup),
      })
  })

  it('answers a hello it cannot answer as a failure, never as a window with nothing to say', async () => {
    const setup = panelOver()
    // The journal could not say, the conversation's playbook could not load, or nothing came in time.
    for (const hasSpawnGap of [
      () => Promise.reject(new Error('private detail')),
      (): never => {
        throw new Error('private detail')
      },
      () => new Promise<boolean>(() => undefined),
    ]) {
      const answer = await setup.ask({ type: 'playbookHello' }, hasSpawnGap)
      expect(answer).toEqual({ type: 'playbookFailed' })
      expect(JSON.stringify(answer)).not.toContain('private detail')
    }
    // The next hello is asked afresh: a failure is not remembered as the window's state.
    expect(await setup.ask({ type: 'playbookHello' }, () => Promise.resolve(false))).toMatchObject({
      type: 'playbookHello',
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

  it('gives the map’s rows their records, and says so when they cannot be read', async () => {
    const setup = panelOver()
    const scope = { bridgeId: BRIDGE, workspaceId: await workspaceOf(setup) }
    const answer = playbookAgentsSchema.parse(
      await setup.ask({ type: 'playbookAgents', ...scope, requestId: 7, children: [ROW] }),
    )
    expect(answer).toMatchObject({ ...scope, requestId: 7 })
    expect(Object.keys(answer.records)).toEqual([ROW.itemId])
    expect(setup.agentCalls).toEqual([[[ROW]]])
    // A journal that holds nothing for the rows is a read that succeeded.
    const empty = panelOver({ agents: () => Promise.resolve({}) })
    const emptyScope = { bridgeId: BRIDGE, workspaceId: await workspaceOf(empty) }
    expect(
      await empty.ask({ type: 'playbookAgents', ...emptyScope, requestId: 8, children: [ROW] }),
    ).toEqual({
      type: 'playbookAgents',
      ...emptyScope,
      requestId: 8,
      records: {},
    })
    // One that could not be read is not: nothing is said about what the rows hold.
    const broken = panelOver({ agents: () => Promise.reject(new Error('private detail')) })
    const brokenScope = { bridgeId: BRIDGE, workspaceId: await workspaceOf(broken) }
    expect(
      await broken.ask({ type: 'playbookAgents', ...brokenScope, requestId: 9, children: [ROW] }),
    ).toEqual({
      type: 'playbookAgentsFailed',
      ...brokenScope,
      requestId: 9,
    })
  })

  it('answers another journal’s rows as a failure of the bridge that asked', async () => {
    const setup = panelOver()
    const scope = { bridgeId: BRIDGE, workspaceId: 'another-window', requestId: 10 }
    expect(await setup.ask({ type: 'playbookAgents', ...scope, children: [ROW] })).toEqual({
      type: 'playbookAgentsFailed',
      ...scope,
    })
    expect(setup.agentCalls).toHaveLength(0)
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
    expect(setup.agentCalls).toHaveLength(0)
    expect(setup.surface.snapshot()).toEqual(surfaceSnapshot())
  })
})
