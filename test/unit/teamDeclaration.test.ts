// Lane T: the declaration rule and the team tools at call admission, driven
// through the real `ModelApiHost` (the golden test covers the bytes).
// - a team conversation declares the five team tools and none of M48's six;
// - `roster` answers the stable part with the live numbers;
// - `dry_run` plans without starting or spending anything;
// - a `command_id` retry replays, and a reused id with other tasks is refused;
// - `delegate` is refused once the last ready entry goes away;
// - without the runner the tools name it instead of succeeding emptily;
// - while an `in-place` task runs, the orchestrator's writing tools wait;
// - a user's MCP server may not be named `team`.

import { describe, expect, it } from 'vitest'
import * as z from 'zod/mini'
import { UI_TEXT, type PaidFeature } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { responseOutputsByCall } from './helpers/fakeModelApi'
import { memorySessionStore } from './helpers/fakeSessionStore'
import { planMcpServers } from '../../src/core/backends/modelapi/mcp/servers'
import { readMcpServerEntries } from '../../src/core/backends/musecode/museConfigView'
import { parseStoredSession } from '../../src/core/backends/modelapi/sessionStore'
import { watchSessionTurns } from './helpers/sessionTurns'
import { TEAM_COLLECT_WAIT_MAX_SECONDS } from '../../src/core/team/teamConstants'
import { delegateArgs, TEAM_TOOL_NAMES } from '../../src/core/team/teamTools'
import type {
  TeamCustomEntryRef,
  TeamDecisionSource,
  TeamToolRunner,
} from '../../src/core/team/teamSeams'
import { teamHostHarness, type TeamHostHarness } from './helpers/teamHostHarness'

const OTHER_MODEL = 'opus-5.5'

function entry(
  entryId: string,
  modelId: string,
  options: Partial<TeamCustomEntryRef> = {},
): TeamCustomEntryRef {
  return { entryId, modelId, kind: 'engine', billsKey: false, isAvailable: true, ...options }
}

function teamSource(options: Partial<TeamDecisionSource> = {}): TeamDecisionSource {
  return {
    teamSwitchOn: true,
    soloTemplate: false,
    orchestratorModelId: 'muse-spark-1.3',
    customEntries: [entry('e1', OTHER_MODEL)],
    isSameModel: (a, b) => a === b,
    isEntryReady: () => true,
    teamWorkersOn: false,
    ...options,
  }
}

const ROLES = [
  {
    roleId: 'research',
    workspaceMode: 'read-only' as const,
    toolGroups: ['read'],
    pool: [
      {
        entryId: 'e1',
        agentLabel: 'opus (key)',
        modelId: OTHER_MODEL,
        kind: 'engine' as const,
        caps: [],
      },
    ],
    exhaustedPolicy: 'ask' as const,
    whenToUse: 'Reading.',
  },
]

const TASK = {
  role: 'research',
  brief: 'Read the docs.',
  reason: { code: 'specialty', detail: 'It needs the research tools.' },
}

function runnerStub(calls: string[]): TeamToolRunner {
  const answer = (tool: string) => {
    calls.push(tool)
    return Promise.resolve({
      output: JSON.stringify({ ran: tool }),
      visibleOutput: `${tool} shown`,
    })
  }
  return {
    preview: (args) => {
      const parsed = delegateArgs.parse(args)
      return Promise.resolve({
        output: JSON.stringify({
          dry_run: true,
          delegated: parsed.tasks.map((task) => ({ role: task.role, reason: task.reason })),
          kept: (parsed.plan ?? []).map((item) => ({ what: item.what, reason: item.reason })),
        }),
        visibleOutput: '',
      })
    },
    delegate: (args) => answer(`delegate:${String(JSON.stringify(args).length)}`),
    collect: () => answer('collect'),
    cancel: () => answer('cancel'),
    merge: () => answer('merge'),
  }
}

async function delegateTurn(
  h: TeamHostHarness,
  started: Awaited<ReturnType<TeamHostHarness['startSession']>>,
): Promise<void> {
  h.api.script(
    { calls: [{ name: 'delegate', arguments: JSON.stringify({ tasks: [TASK] }), callId: 'd1' }] },
    { text: 'done' },
  )
  await started.session.sendTurn([{ type: 'text', text: 'go' }])
  await started.turnDone()
}

function runningTeam(calls: string[]): TeamHostHarness {
  return teamHostHarness({
    teamSource: () => teamSource(),
    roster: ROLES,
    runner: runnerStub(calls),
  })
}

async function declaredFor(h: TeamHostHarness): Promise<readonly string[]> {
  const { session, turnDone } = await h.startSession('allowAll')
  h.api.script({ text: 'noted' })
  await session.sendTurn([{ type: 'text', text: 'hi' }])
  await turnDone()
  return declaredNames(h)
}

function declaredNames(h: TeamHostHarness): readonly string[] {
  const first = z
    .object({ tools: z.array(z.object({ name: z.string() })) })
    .parse(h.api.responseBodies()[0])
  return first.tools.map((tool) => tool.name)
}

describe('team declaration', () => {
  it('declares the five team tools and none of M48’s six', async () => {
    const h = teamHostHarness({ teamSource: () => teamSource(), roster: ROLES })
    const names = await declaredFor(h)
    for (const tool of TEAM_TOOL_NAMES) {
      expect(names).toContain(tool)
    }
    expect(names.some((name) => name.startsWith('subagent_'))).toBe(false)
  })

  it('keeps M48’s tools in a single-model conversation', async () => {
    const paid: PaidFeature[] = ['subagents']
    const h = teamHostHarness({ paid, teamSource: () => teamSource({ customEntries: [] }) })
    const names = await declaredFor(h)
    expect(names).toContain('subagent_spawn')
    expect(
      names.some((name) => ['roster', 'delegate', 'collect', 'cancel', 'merge'].includes(name)),
    ).toBe(false)
  })
})

describe('runTeamTool', () => {
  it('answers roster with the stable part and the live numbers', async () => {
    const h = teamHostHarness({
      teamSource: () => teamSource(),
      roster: ROLES,
      live: {
        entries: [{ entryId: 'e1', roleId: 'research', headroom: '3/5 free', state: 'ready' }],
        queueDepth: 0,
        unmergedTasks: 0,
        budgetLeft: '$10.00 left today',
      },
    })
    const { session, turnDone } = await h.startSession('allowAll')
    h.api.script(
      { calls: [{ name: 'roster', arguments: '{}', callId: 'roster-1' }] },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'who is on the team?' }])
    await turnDone()
    const outputs = responseOutputsByCall(h.api, 1)
    const answer = outputs.get('roster-1') ?? ''
    expect(answer).toContain('# Team')
    expect(answer).toContain('research e1: 3/5 free (ready)')
  })

  it('plans a dry run without starting or spending anything', async () => {
    const calls: string[] = []
    const h = runningTeam(calls)
    const { session, turnDone } = await h.startSession('allowAll')
    h.api.script(
      {
        calls: [
          {
            name: 'delegate',
            arguments: JSON.stringify({
              tasks: [TASK],
              plan: [
                {
                  what: 'Review it.',
                  reason: { code: 'asked_you', detail: 'You own integration.' },
                },
              ],
              dry_run: true,
            }),
            callId: 'dry-1',
          },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'plan it' }])
    await turnDone()
    expect(calls).toEqual([])
    const outputs = responseOutputsByCall(h.api, 1)
    expect(JSON.parse(outputs.get('dry-1') ?? '')).toEqual({
      dry_run: true,
      delegated: [{ role: 'research', reason: TASK.reason }],
      kept: [{ what: 'Review it.', reason: { code: 'asked_you', detail: 'You own integration.' } }],
    })
  })

  it('replays a retried command_id and refuses a reused one', async () => {
    const calls: string[] = []
    const h = runningTeam(calls)
    const args = { tasks: [TASK], command_id: 'cmd-1' }
    const first = await h.startSession('allowAll')
    h.api.script(
      { calls: [{ name: 'delegate', arguments: JSON.stringify(args), callId: 'd1' }] },
      { text: 'done' },
    )
    await first.session.sendTurn([{ type: 'text', text: 'go' }])
    await first.turnDone()
    expect(calls).toHaveLength(1)
    // The same id with the same tasks starts nothing new.
    h.api.script(
      { calls: [{ name: 'delegate', arguments: JSON.stringify(args), callId: 'd2' }] },
      { text: 'done' },
    )
    await first.session.sendTurn([{ type: 'text', text: 'retry' }])
    await first.turnDone()
    expect(calls).toHaveLength(1)
    expect(responseOutputsByCall(h.api, 3).get('d2')).toBe(
      responseOutputsByCall(h.api, 1).get('d1'),
    )
    // The same id with other tasks is refused whole.
    h.api.script(
      {
        calls: [
          {
            name: 'delegate',
            arguments: JSON.stringify({
              tasks: [{ ...TASK, brief: 'Other work.' }],
              command_id: 'cmd-1',
            }),
            callId: 'd3',
          },
        ],
      },
      { text: 'done' },
    )
    await first.session.sendTurn([{ type: 'text', text: 'retry differently' }])
    await first.turnDone()
    expect(calls).toHaveLength(1)
    expect(responseOutputsByCall(h.api, 5).get('d3')).toContain('command_id was already used')
  })

  it('refuses delegate from the next turn once the last ready entry goes away', async () => {
    const ready = { current: true }
    const calls: string[] = []
    const h = teamHostHarness({
      teamSource: () =>
        teamSource({
          customEntries: [entry('e1', OTHER_MODEL)],
          isEntryReady: () => ready.current,
        }),
      roster: ROLES,
      runner: runnerStub(calls),
    })
    const { session, turnDone } = await h.startSession('allowAll')
    h.api.script({ text: 'noted' })
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await turnDone()
    // The conversation keeps its declared tools...
    expect(declaredNames(h)).toContain('delegate')
    // ...but from the next turn delegate is refused at call admission, with the reason.
    ready.current = false
    await delegateTurn(h, { session, turnDone })
    expect(calls).toEqual([])
    expect(responseOutputsByCall(h.api, 2).get('d1')).toContain('Only one model is ready')
    expect(JSON.stringify(session.history())).toContain(UI_TEXT.teamSingleModelAgain)
  })

  it.each([
    {
      name: 'missing runner',
      entries: [entry('e1', OTHER_MODEL)],
      reason: 'team runner is not loaded',
    },
    { name: 'undeclared tool', entries: [], reason: 'unknown tool delegate' },
  ])('refuses $name with an explicit reason', async ({ entries, reason }) => {
    const h = teamHostHarness({
      teamSource: () => teamSource({ customEntries: entries }),
      roster: ROLES,
    })
    const { session, turnDone } = await h.startSession('allowAll')
    await delegateTurn(h, { session, turnDone })
    expect(responseOutputsByCall(h.api, 1).get('d1')).toContain(reason)
    if (entries.length > 0) {
      expect(JSON.stringify(session.history())).toContain(
        fill(UI_TEXT.teamRunnerUnavailable, { tool: 'delegate' }),
      )
    }
  })
})

describe('in-place admission', () => {
  it.each([true, false])(
    'refuses writing while a worker writes in place (team=%s)',
    async (hasTeam) => {
      const h = teamHostHarness({
        files: { 'a.txt': 'alpha\n' },
        teamSource: () => teamSource({ customEntries: hasTeam ? [entry('e1', OTHER_MODEL)] : [] }),
        roster: ROLES,
        runner: runnerStub([]),
        isTeamInPlaceActive: () => true,
      })
      const { session, turnDone } = await h.startSession('allowAll')
      h.api.script(
        {
          calls: [
            {
              name: 'edit_file',
              arguments: '{"path":"a.txt","find":"alpha","replace":"beta"}',
              callId: 'e1',
            },
            { name: 'bash', arguments: '{"command":"ls","description":"list"}', callId: 's1' },
            {
              name: 'merge',
              arguments: '{"task_id":"t1"}',
              callId: 'm1',
            },
            {
              name: 'write_file',
              arguments: '{"path":"a.txt","content":"forbidden"}',
              callId: 'w1',
            },
            { name: 'rename_symbol', arguments: '{}', callId: 'n1' },
            { name: 'run_checks', arguments: '{}', callId: 'v1' },
            { name: 'read_file', arguments: '{"path":"a.txt"}', callId: 'r1' },
          ],
        },
        { text: 'done' },
      )
      await session.sendTurn([{ type: 'text', text: 'work' }])
      await turnDone()
      const outputs = responseOutputsByCall(h.api, 1)
      expect(outputs.get('e1')).toContain('writing in place')
      expect(outputs.get('s1')).toContain('writing in place')
      expect(outputs.get('m1')).toContain('writing in place')
      expect(outputs.get('w1')).toContain('writing in place')
      expect(outputs.get('n1')).toContain('writing in place')
      expect(outputs.get('v1')).toContain('writing in place')
      // The transcript's visible line is the translated refusal.
      const history = JSON.stringify(session.history().items)
      expect(history).toContain(UI_TEXT.teamInPlaceOrchestratorRefused)
      // Reads still run.
      expect(outputs.get('r1')).toContain('alpha')
    },
  )

  it('lets the same calls through once the worker ends', async () => {
    let isActive = true
    const h = teamHostHarness({
      files: { 'a.txt': 'alpha\n' },
      teamSource: () => teamSource(),
      roster: ROLES,
      runner: runnerStub([]),
      isTeamInPlaceActive: () => isActive,
    })
    const { session, turnDone } = await h.startSession('allowAll')
    isActive = false
    h.api.script(
      {
        calls: [
          {
            name: 'edit_file',
            arguments: '{"path":"a.txt","find":"alpha","replace":"beta"}',
            callId: 'e1',
          },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'work' }])
    await turnDone()
    expect(responseOutputsByCall(h.api, 1).get('e1')).not.toContain('writing in place')
  })
})

describe('team server name', () => {
  it('refuses a user MCP server named team', () => {
    const plan = planMcpServers(
      readMcpServerEntries(JSON.stringify({ mcpServers: { team: { command: 'x' } } })),
      () => undefined,
    )
    if (plan.kind !== 'servers') {
      throw new Error('expected servers')
    }
    expect(plan.specs[0]?.launch).toEqual({
      ok: false,
      reason: "the name team is the extension's own team server; rename this entry",
    })
  })
})

describe('team storage', () => {
  it('keeps the declared set and command claims on disk and replays after resume', async () => {
    const store = memorySessionStore()
    const calls: string[] = []
    const h = teamHostHarness({
      teamSource: () => teamSource(),
      roster: ROLES,
      runner: runnerStub(calls),
      store,
    })
    const { session, turnDone } = await h.startSession('allowAll')
    h.api.script(
      {
        calls: [
          {
            name: 'delegate',
            arguments: JSON.stringify({ tasks: [TASK], command_id: 'cmd-9' }),
            callId: 'd1',
          },
        ],
      },
      { text: 'done' },
    )
    await session.sendTurn([{ type: 'text', text: 'go' }])
    await turnDone()
    expect(calls).toHaveLength(1)
    const stored = await store.load(session.sessionId)
    expect(stored?.teamMode).toBe('team')
    expect(Object.keys(stored?.teamCommands ?? {})).toEqual(['cmd-9'])
    const parsed = parseStoredSession(stored)
    if (!parsed.ok) throw new Error(parsed.reason)
    expect(parsed.session.teamMode).toBe('team')
    expect(parsed.session.teamRoster).toBe(stored?.teamRoster)
    expect(parsed.session.teamCommands).toEqual(stored?.teamCommands)
    await h.host.flush()
    await store.save(parsed.session)
    const next = teamHostHarness({
      teamSource: () => teamSource(),
      roster: ROLES,
      runner: runnerStub(calls),
      store,
    })
    await next.host.load()
    const revived = await next.host.resumeSession(session.sessionId, OTHER_MODEL)
    const watching = watchSessionTurns(revived.session)
    next.api.script(
      {
        calls: [
          {
            name: 'delegate',
            arguments: JSON.stringify({ tasks: [TASK], command_id: 'cmd-9' }),
            callId: 'd2',
          },
        ],
      },
      { text: 'done' },
    )
    await revived.session.sendTurn([{ type: 'text', text: 'retry after reopening' }])
    await watching.turnDone()
    expect(calls).toHaveLength(1)
    expect(responseOutputsByCall(next.api, 1).get('d2')).toBe(
      responseOutputsByCall(h.api, 1).get('d1'),
    )
    await next.host.close()
    await h.host.close()
  })
})

describe('team request stability and authority', () => {
  it('keeps instructions fixed, shows current roster in results and sends changes only at the tail', async () => {
    const roles = structuredClone(ROLES)
    let hasChanges = false
    const h = teamHostHarness({
      teamSource: () => teamSource(),
      roster: roles,
      takeTeamChanges: () => {
        if (!hasChanges) return { states: [], edits: [] }
        hasChanges = false
        return {
          states: [{ roleId: 'research', entryId: 'e1', from: 'ready', to: 'capped' }],
          edits: ['research pool changed'],
        }
      },
    })
    const { session, turnDone } = await h.startSession('allowAll')
    h.api.script({ text: 'First.' })
    await session.sendTurn([{ type: 'text', text: 'first' }])
    await turnDone()
    roles[0]?.pool.push({
      entryId: 'e2',
      agentLabel: 'new-model',
      modelId: 'new-model',
      kind: 'engine',
      caps: [],
    })
    hasChanges = true
    h.api.script({ calls: [{ name: 'roster', arguments: '{}', callId: 'r1' }] }, { text: 'Done.' })
    await session.sendTurn([{ type: 'text', text: 'next' }])
    await turnDone()
    const first = h.api.responseBodies()[0]
    expect(h.api.responseBodies()[1]?.['instructions']).toBe(first?.['instructions'])
    expect(h.api.responseBodies()[2]?.['instructions']).toBe(first?.['instructions'])
    const input = h.api.responseBodies()[1]?.['input']
    expect(JSON.stringify(input)).toContain('ready to capped')
    expect(JSON.stringify(input)).toContain('research pool changed')
    expect(responseOutputsByCall(h.api, 2).get('r1')).toContain('new-model')
  })

  it.each(['{"wait_seconds":999}', '{}'])(
    'passes caller authority and bounds collect (%s)',
    async (argumentsJson) => {
      const calls: string[] = []
      const runner = runnerStub(calls)
      let context: unknown
      let collected: unknown
      const h = teamHostHarness({
        teamSource: () => teamSource(),
        roster: ROLES,
        runner: {
          ...runner,
          collect: (args, caller) => {
            collected = args
            context = caller
            return Promise.resolve({ output: 'ready', visibleOutput: '' })
          },
        },
      })
      const { session, turnDone } = await h.startSession('allowAll')
      h.api.script(
        { calls: [{ name: 'collect', arguments: argumentsJson, callId: 'c1' }] },
        { text: 'Done.' },
      )
      await session.sendTurn([{ type: 'text', text: 'collect' }])
      await turnDone()
      expect(collected).toEqual({ wait_seconds: TEAM_COLLECT_WAIT_MAX_SECONDS })
      expect(context).toMatchObject({
        sessionId: session.sessionId,
        approvalMode: 'allowAll',
        signal: expect.any(AbortSignal),
      })
    },
  )

  it('refuses starting and merging in Plan while a dry run still plans', async () => {
    const calls: string[] = []
    const h = runningTeam(calls)
    const { session, turnDone } = await h.startSession('denyUnmatched')
    h.api.script(
      {
        calls: [
          { name: 'delegate', arguments: JSON.stringify({ tasks: [TASK] }), callId: 'd1' },
          { name: 'merge', arguments: '{"task_id":"t1"}', callId: 'm1' },
          {
            name: 'delegate',
            arguments: JSON.stringify({ tasks: [TASK], dry_run: true }),
            callId: 'p1',
          },
        ],
      },
      { text: 'Done.' },
    )
    await session.sendTurn([{ type: 'text', text: 'plan' }])
    await turnDone()
    expect(calls).toEqual([])
    const outputs = responseOutputsByCall(h.api, 1)
    expect(outputs.get('d1')).toContain('refused')
    expect(outputs.get('m1')).toContain('refused')
    expect(outputs.get('p1')).toContain('dry_run')
  })
})
