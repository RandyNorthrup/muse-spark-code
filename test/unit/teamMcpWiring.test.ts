// The `team` MCP server binding (M96 lane T): the window binding mints a
// per-conversation endpoint only for a team-mode Muse Code conversation,
// and the real loopback server answers that conversation's calls through
// the real team host bundle while refusing every other token. Real code
// throughout: the binding, the bundle's `createTeamHost`, the engine ports
// and the HTTP server; the workspace state is the memory-backed map the
// availability rig shares. No worker runs: the roster call never reaches one.
import { describe, expect, it } from 'vitest'
import { TeamHostBinding } from '../../src/host/teamHostBinding'
import { TeamMcpServer } from '../../src/host/team/teamMcpServer'
import { createTeamHost, teamRosterAnswer } from '../../src/host/team/teamHostEntry'
import { UI_TEXT } from '../../src/shared/constants'
import { TEAM_WORKSPACE_KEYS } from '../../src/shared/teamConversation'
import { availabilityState } from './helpers/teamAvailabilityRig'

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

const STORED_TEAM = {
  roles: [
    {
      role: 'engineering',
      workspace: 'own-branch',
      pool: [
        {
          id: 'e1',
          concurrent: 2,
          caps: [],
          agent: { kind: 'engine', agentId: 'agent-e1', model: 'other-model-7', pays: 'local' },
        },
      ],
    },
  ],
  intensity: 'balanced',
}

/** The window binding over the bundle's real factory and the real MCP server. */
function makeBinding(stored: unknown): TeamHostBinding {
  const store = new Map<string, unknown>()
  if (stored !== undefined) store.set(TEAM_WORKSPACE_KEYS.team, stored)
  return new TeamHostBinding({
    ports: {
      state: availabilityState(store),
      settings: {
        isTeamOn: () => true,
        isTeamWorkersOn: () => true,
        maxWorkers: () => 2,
        isTrusted: () => true,
      },
      orchestrator: { modelId: () => 'muse-spark-1.3', backend: () => 'museCode' },
      paid: { allowKeyTasks: () => Promise.resolve(false) },
      cards: { show: () => undefined },
      newId: () => 'id-1',
      now: () => 0,
      log: silent,
      engine: {
        repositoryRoot: () => undefined,
        storageRoot: '',
        platform: process.platform,
        isTrusted: () => true,
        // The declared setup probe finds the stored entry's model served.
        listModels: () => Promise.resolve(['other-model-7']),
        // No worker is wanted here: a start is the failure the roster call must not cause.
        startWorker: () => Promise.reject(new Error('the roster call must not start a worker')),
        now: () => 0,
        log: silent,
      },
    },
    canRunKind: (kind) => kind === 'engine',
    loadFactory: () => Promise.resolve(createTeamHost),
    loadTeamMcp: () =>
      Promise.resolve({ server: new TeamMcpServer(silent), rosterAnswer: teamRosterAnswer }),
    uiText: () => UI_TEXT,
    uiLocale: () => 'en',
    showTree: () => undefined,
    openRoles: () => Promise.resolve(),
    showDiff: () => Promise.resolve(),
  })
}

describe('the team MCP server binding', () => {
  it('serves the five tools to its own conversation over real HTTP and refuses other tokens', async () => {
    const bound = makeBinding(STORED_TEAM)
    try {
      await bound.open()
      expect(bound.teamMcp.modeForNewConversation()).toBe('team')
      const endpoint = await bound.teamMcp.endpointForConversation()
      expect(endpoint?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//u)
      if (endpoint === undefined) throw new Error('endpoint missing')
      await bound.teamMcp.rememberMode('s1', 'team')
      expect(bound.teamMcp.modeForSession('s1')).toBe('team')
      expect(bound.teamMcp.modeForSession('other')).toBe('single-model')
      // A resume re-presents the same endpoint for the same conversation.
      expect(await bound.teamMcp.endpointForConversation('s1')).toEqual(endpoint)

      const call = async (body: unknown, headers: Record<string, string>) =>
        await fetch(endpoint.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify(body),
        })
      const list = await call({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, endpoint.headers)
      expect(list.status).toBe(200)
      const listed = (await list.json()) as { result: { tools: { name: string }[] } }
      expect(listed.result.tools.map((tool) => tool.name)).toEqual([
        'roster',
        'delegate',
        'collect',
        'cancel',
        'merge',
      ])
      // No token and a wrong token are refused before any tool runs.
      const anonymous = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, {})
      expect(anonymous.status).toBe(401)
      const forged = await call(
        { jsonrpc: '2.0', id: 3, method: 'tools/list' },
        { Authorization: `Bearer ${'0'.repeat(64)}` },
      )
      expect(forged.status).toBe(401)
      // The roster call reaches the real runner's roster data.
      const roster = await call(
        {
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: { name: 'roster', arguments: {} },
        },
        endpoint.headers,
      )
      expect(roster.status).toBe(200)
      const answered = (await roster.json()) as {
        result: { content: { text: string }[]; isError?: boolean }
      }
      expect(answered.result.isError).toBeFalsy()
      expect(answered.result.content[0]?.text).toContain('engineering')
    } finally {
      await bound.dispose()
    }
  })

  it('stays single-model without a stored runnable team: no endpoint is minted', async () => {
    const bound = makeBinding(undefined)
    try {
      expect(bound.teamMcp.modeForNewConversation()).toBe('single-model')
      expect(await bound.teamMcp.endpointForConversation()).toBeUndefined()
    } finally {
      await bound.dispose()
    }
  })
})
