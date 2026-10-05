// MCP elicitation on a live Model API session (M91 lane M): the form in
// every approval mode including Bypass, accept/decline/cancel, refused
// answers, declined schemas, the hook seam, timeouts and stops, and values
// reaching nothing but the server's own result.

import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '../../src/shared/agentEvents'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { ModelApiHost, ModelApiSession } from '../../src/core/backends/modelapi/ModelApiHost'
import type { McpToolSource } from '../../src/core/backends/modelapi/mcp/pool'
import type {
  ElicitationHookSeam,
  ElicitationHookVerdict,
} from '../../src/core/backends/modelapi/mcp/elicitation'
import { FAKE_MODEL_API_ACCOUNT_ID, fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryContextIo } from './helpers/fakeContextIo'
import { memoryToolIo } from './helpers/fakeToolIo'
import { FakeLogOutputChannel } from './helpers/fakes'
import { countLogged, logLines } from './helpers/logText'
import { watchSessionTurns } from './helpers/sessionTurns'

const ROOT = '/ws'
const TOOL = 'mcp__srv__ask'

function schemaOf(properties: Record<string, unknown>, required: readonly string[] = []) {
  return {
    message: 'Who goes there?',
    requestedSchema: { type: 'object', properties, required: [...required] },
  }
}

const NAME_SCHEMA = schemaOf({ name: { type: 'string', title: 'Name' } }, ['name'])
const NAME_ANSWER = { action: 'accept', content: { name: 'Ada' } }

interface Setup {
  readonly api: ReturnType<typeof fakeModelApi>
  readonly log: FakeLogOutputChannel
  readonly host: ModelApiHost
  readonly outcomes: unknown[]
  readonly seamInputs: unknown[]
  readonly resultInputs: unknown[]
  readonly hasSubagentForm: boolean
}

function setup(
  options: {
    elicit?: unknown
    verdict?: ElicitationHookVerdict
    timeoutMs?: number
    areHooksEnabled?: boolean
    hasSubagentForm?: boolean
  } = {},
): Setup {
  const api = fakeModelApi()
  const log = new FakeLogOutputChannel()
  const io = memoryToolIo({}, ROOT)
  const outcomes: unknown[] = []
  const seamInputs: unknown[] = []
  const resultInputs: unknown[] = []
  const source: McpToolSource = {
    start: () => Promise.resolve(),
    snapshot: () => ({ isStarted: true, fault: undefined, servers: [] }),
    definitions: () => [
      {
        type: 'function',
        name: TOOL,
        description: 'ask',
        parameters: { type: 'object' },
        strict: false,
      },
    ],
    find: (name) => (name === TOOL ? { server: 'srv', tool: 'ask', isReadOnly: false } : undefined),
    call: async (_name, _args, signal, onElicitation) => {
      if (onElicitation !== undefined && options.elicit !== undefined) {
        outcomes.push(await onElicitation({ server: 'srv', params: options.elicit, signal }))
      }
      return { output: 'tool done', visibleOutput: 'tool done' }
    },
    close: () => Promise.resolve(),
  }
  const seam: ElicitationHookSeam = {
    fireElicitation: (input) => {
      seamInputs.push(input)
      return Promise.resolve(options.verdict ?? { decision: 'proceed' })
    },
    fireElicitationResult: (input) => {
      resultInputs.push(input)
      return Promise.resolve()
    },
  }
  let ids = 0
  const host = new ModelApiHost({
    client: fakeModelApiClient(api, log),
    workspaceRoot: ROOT,
    platform: 'linux',
    io,
    contextIo: memoryContextIo(io.files),
    newId: () => {
      ids += 1
      return `id${String(ids)}`
    },
    now: () => 1_000_000,
    log,
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    isPaidFeatureOn: (feature) => feature === 'subagents' && options.hasSubagentForm === true,
    notePaidUse: vi.fn(),
    promptCacheRetention: () => 'in_memory',
    sessionBudgetUsd: () => 0,
    showReplyUsage: () => false,
    getAccountId: () => Promise.resolve(FAKE_MODEL_API_ACCOUNT_ID),
    allowsPaidUse: () => Promise.resolve(true),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: vi.fn(),
    noteReviewerUsage: vi.fn(),
    loadHooks: () => Promise.resolve([]),
    isHooksEnabled: () => options.areHooksEnabled ?? true,
    memory: undefined,
    mcpServers: source,
    elicitationHooks: seam,
    ...(options.timeoutMs !== undefined && { elicitationTimeoutMs: options.timeoutMs }),
  })
  return {
    api,
    log,
    host,
    outcomes,
    seamInputs,
    resultInputs,
    hasSubagentForm: options.hasSubagentForm === true,
  }
}

async function startTurn(
  t: Setup,
  approvalMode: string,
): Promise<{ session: ModelApiSession; events: AgentEvent[]; turnDone: () => Promise<void> }> {
  const session = await t.host.startSession({
    workspaceRoot: ROOT,
    modelId: 'muse-spark-1.3',
    approvalMode,
  })
  if (!(session instanceof ModelApiSession)) throw new Error('expected a Model API session')
  const watched = watchSessionTurns(session)
  const asking = { calls: [{ name: TOOL, arguments: '{}', callId: 'call_1' }] }
  if (t.hasSubagentForm) {
    t.api.script(
      {
        calls: [
          {
            name: 'subagent_spawn',
            arguments: '{"role":"helper","objective":"Ask the server"}',
            callId: 'spawn1',
          },
        ],
      },
      { text: 'all done' },
      asking,
      { text: 'child done' },
    )
  } else {
    t.api.script(asking, { text: 'all done' })
  }
  await session.sendTurn([{ type: 'text', text: 'ask the server' }])
  // Capture this turn's promise before a timeout can finish the turn and
  // rotate the shared watcher's promise to the next turn.
  const done = watched.turnDone()
  return { session, events: watched.events, turnDone: () => done }
}

async function elicitationOf(events: readonly AgentEvent[]) {
  await vi.waitFor(() => {
    expect(events.filter((event) => event.type === 'elicitationRequested')).toHaveLength(1)
  })
  const event = events.find((candidate) => candidate.type === 'elicitationRequested')
  if (event?.type !== 'elicitationRequested') {
    throw new Error('expected an elicitation request')
  }
  return event
}

function answerName(session: ModelApiSession, id: string) {
  return session.settleElicitation(id, { kind: 'accepted', values: { name: 'Ada' } })
}

async function finishedHookTurn(t: Setup) {
  const running = await startTurn(t, 'allowAll')
  await running.turnDone()
  return running.events
}

async function askingName() {
  const t = setup({ elicit: NAME_SCHEMA })
  const running = await startTurn(t, 'allowAll')
  const requested = await elicitationOf(running.events)
  return { t, ...running, requested }
}

describe('the elicitation form on a session (M91 lane M)', () => {
  it('forwards a child form to the panel and routes its answer back to that child', async () => {
    const t = setup({ elicit: NAME_SCHEMA, hasSubagentForm: true })
    const { session, events } = await startTurn(t, 'allowAll')
    const requested = await elicitationOf(events)
    const row = events.find(
      (event) => event.type === 'itemStarted' && event.item.itemId === requested.itemId,
    )
    const parentTurn = events.find((event) => event.type === 'turnStarted')
    if (row?.type !== 'itemStarted' || parentTurn?.type !== 'turnStarted')
      throw new Error('expected tool and parent turn')
    expect(row.item.turnId).not.toBe(parentTurn.turnId)
    await answerName(session, requested.elicitationId)
    await session.settled()
    expect(t.outcomes).toEqual([NAME_ANSWER])
  })
  it('asks in Bypass instead of auto-accepting, and accepts a valid answer', async () => {
    const { t, session, events, turnDone, requested } = await askingName()
    // The form is under the tool call's row, and nothing answered itself.
    expect(requested.itemId).toBeDefined()
    expect(requested.fields).toHaveLength(1)
    expect(events.some((event) => event.type === 'approvalRequested')).toBe(false)
    expect(t.outcomes).toEqual([])
    await answerName(session, requested.elicitationId)
    await turnDone()
    expect(t.outcomes).toEqual([NAME_ANSWER])
    expect(events.find((event) => event.type === 'elicitationSettled')).toMatchObject({
      elicitationId: requested.elicitationId,
      action: 'accept',
    })
    // Values reach the server's own result only: no event and no log holds them.
    expect(JSON.stringify(events)).not.toContain('Ada')
    expect(logLines(t.log).join('\n')).not.toContain('Ada')
  })

  it('declines and cancels from the form', async () => {
    for (const kind of ['declined', 'cancelled'] as const) {
      const t = setup({ elicit: NAME_SCHEMA })
      const { session, events, turnDone } = await startTurn(t, 'allowAll')
      const requested = await elicitationOf(events)
      await session.settleElicitation(requested.elicitationId, { kind })
      await turnDone()
      expect(t.outcomes).toEqual([{ action: kind === 'declined' ? 'decline' : 'cancel' }])
    }
  })

  it('refuses an answer outside the schema and keeps the form open', async () => {
    const { t, session, events, turnDone, requested } = await askingName()
    await expect(
      session.settleElicitation(requested.elicitationId, {
        kind: 'accepted',
        values: { name: 3 },
      }),
    ).rejects.toThrow(fill(UI_TEXT.elicitationInvalid, { field: 'name', server: 'srv' }))
    expect(events.some((event) => event.type === 'elicitationSettled')).toBe(false)
    expect(t.outcomes).toEqual([])
    await answerName(session, requested.elicitationId)
    await turnDone()
    expect(t.outcomes).toEqual([NAME_ANSWER])
  })

  it('reports a settled form as gone', async () => {
    const t = setup({ elicit: NAME_SCHEMA })
    const { session, turnDone } = await startTurn(t, 'allowAll')
    await expect(session.settleElicitation('id-missing', { kind: 'cancelled' })).rejects.toThrow(
      UI_TEXT.elicitationExpired,
    )
    await session.cancel()
    await turnDone()
  })

  it('times a waiting form out as a cancel', { timeout: 15_000 }, async () => {
    const t = setup({ elicit: NAME_SCHEMA, timeoutMs: 20 })
    const { events, turnDone } = await startTurn(t, 'allowAll')
    await elicitationOf(events)
    await turnDone()
    expect(t.outcomes).toEqual([{ action: 'cancel' }])
    expect(events.find((event) => event.type === 'elicitationSettled')).toMatchObject({
      action: 'cancel',
    })
  })

  it('cancels the form when the turn stops', async () => {
    const t = setup({ elicit: NAME_SCHEMA })
    const { session, events, turnDone } = await startTurn(t, 'allowAll')
    await elicitationOf(events)
    await session.cancel()
    await turnDone()
    expect(t.outcomes).toEqual([{ action: 'cancel' }])
  })

  it('cancels when the panel releases its session', async () => {
    const t = setup({ elicit: NAME_SCHEMA })
    const { session, events } = await startTurn(t, 'allowAll')
    await elicitationOf(events)
    session.dispose()
    await session.settled()
    expect(t.outcomes).toEqual([{ action: 'cancel' }])
  })

  it('uses the form without dispatching hooks while hooks are off', async () => {
    const t = setup({ elicit: NAME_SCHEMA, areHooksEnabled: false })
    const { session, events, turnDone } = await startTurn(t, 'allowAll')
    const requested = await elicitationOf(events)
    await session.settleElicitation(requested.elicitationId, { kind: 'declined' })
    await turnDone()
    expect(t.seamInputs).toEqual([])
    expect(t.resultInputs).toEqual([])
  })
})

describe('invalid schemas and the hook seam (M91 lane M)', () => {
  it('declines a schema outside the subset without rendering it', async () => {
    const t = setup({
      elicit: schemaOf({ nested: { type: 'object', properties: {} } }),
    })
    const events = await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'decline' }])
    expect(events.some((event) => event.type === 'elicitationRequested')).toBe(false)
    expect(t.seamInputs).toEqual([])
    expect(t.resultInputs).toEqual([{ server: 'srv', fieldNames: [], action: 'decline' }])
  })

  it('never accepts an invalid schema through a user hook', async () => {
    const t = setup({
      elicit: schemaOf({ nested: { type: 'object' } }),
      verdict: { decision: 'answer', source: 'user', values: {} },
    })
    await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'decline' }])
    expect(t.seamInputs).toEqual([])
  })

  it('refuses a hook answer without explicit user scope', async () => {
    const t = setup({ elicit: NAME_SCHEMA, verdict: { decision: 'answer', values: { name: 'A' } } })
    await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'decline' }])
  })

  it('a project hook declines with its reason, and the server sees only the action', async () => {
    const t = setup({
      elicit: NAME_SCHEMA,
      verdict: { decision: 'decline', source: 'project', reason: 'no forms today' },
    })
    const events = await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'decline' }])
    expect(events.some((event) => event.type === 'elicitationRequested')).toBe(false)
    const notice = events.find((event) => event.type === 'backendNotice')
    expect(notice).toMatchObject({ text: expect.stringContaining('no forms today') })
    expect(t.resultInputs).toEqual([{ server: 'srv', fieldNames: ['name'], action: 'decline' }])
  })

  it('a project hook cancels silently', async () => {
    const t = setup({
      elicit: NAME_SCHEMA,
      verdict: { decision: 'cancel', source: 'project' },
    })
    const events = await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'cancel' }])
    expect(events.some((event) => event.type === 'elicitationRequested')).toBe(false)
  })

  it('a user hook answers without the form', async () => {
    const t = setup({
      elicit: NAME_SCHEMA,
      verdict: { decision: 'answer', source: 'user', values: { name: 'Grace' } },
    })
    const events = await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'accept', content: { name: 'Grace' } }])
    expect(events.some((event) => event.type === 'elicitationRequested')).toBe(false)
    expect(
      events.find(
        (event) =>
          event.type === 'backendNotice' && JSON.stringify(event).includes('hooks answered'),
      ),
    ).toBeDefined()
    expect(t.resultInputs).toEqual([{ server: 'srv', fieldNames: ['name'], action: 'accept' }])
    expect(JSON.stringify(events)).not.toContain('Grace')
  })

  it('refuses a project hook answer', async () => {
    const t = setup({
      elicit: NAME_SCHEMA,
      verdict: { decision: 'answer', source: 'project', values: { name: 'Mallory' } },
    })
    const events = await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'decline' }])
    expect(events.some((event) => event.type === 'elicitationRequested')).toBe(false)
    expect(countLogged(t.log, "a project hook's answer is refused")).toBe(1)
    expect(t.resultInputs).toEqual([{ server: 'srv', fieldNames: ['name'], action: 'decline' }])
    expect(JSON.stringify(t.resultInputs)).not.toContain('Mallory')
  })

  it('refuses a user hook answer outside the schema', async () => {
    const t = setup({
      elicit: NAME_SCHEMA,
      verdict: { decision: 'answer', source: 'user', values: { name: 3 } },
    })
    await finishedHookTurn(t)
    expect(t.outcomes).toEqual([{ action: 'decline' }])
  })

  it('fires the seam with field names only, never values', async () => {
    const { t, session, turnDone, requested } = await askingName()
    await answerName(session, requested.elicitationId)
    await turnDone()
    expect(t.seamInputs).toEqual([
      { server: 'srv', message: 'Who goes there?', fieldNames: ['name'], requiredNames: ['name'] },
    ])
    expect(JSON.stringify(t.seamInputs)).not.toContain('Ada')
  })
})
