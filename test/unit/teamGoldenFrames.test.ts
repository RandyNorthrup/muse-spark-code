// M96c acceptance 1's frame half (RLF-M96CREC): the four golden MSP
// session frames in test/fixtures/golden-frames/ had no consumer. They
// record the session/start and session/resume parameters Muse Code
// receives, single-model beside team. This suite consumes them against
// the production pieces that still own those bytes: the server names
// (IDE_MCP_SERVER_NAME / TEAM_MCP_SERVER_NAME), the profile rule that
// keeps denyUnmatched frames free of a permissionProfile member, and
// the single/team delta itself — the team frame differs from the
// single-model frame by exactly the team MCP server entry, nothing
// else. The live byte proof that single-model sessions mint no team
// endpoint stays teamMcpWiring's and teamKillDrill's.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IDE_MCP_SERVER_NAME, TEAM_MCP_SERVER_NAME } from '../../src/shared/constants'
import { mspPermissionProfile } from '../../src/shared/permissionModes'
import * as z from 'zod/mini'

const serverSchema = z.strictObject({
  transport: z.literal('streamableHttp'),
  url: z.string(),
  headers: z.record(z.string(), z.string()),
  mode: z.literal('optional'),
})

interface Frame {
  readonly params: Record<string, unknown>
  readonly servers: Record<string, unknown>
}

function frame(name: string): Frame {
  const raw: unknown = JSON.parse(
    readFileSync(path.join('test', 'fixtures', 'golden-frames', name), 'utf8'),
  )
  if (typeof raw !== 'string') throw new TypeError(`golden frame ${name} is not a wire string`)
  const params = JSON.parse(raw.trimEnd()) as Record<string, unknown>
  const config = params['config'] as Record<string, unknown>
  return { params, servers: config['mcpServers'] as Record<string, unknown> }
}

describe('M96 golden session frames', () => {
  it('start frames differ only by the team server entry, under the production names', () => {
    const single = frame('musecode-session-start-single.json')
    const team = frame('musecode-session-start-team.json')
    expect(Object.keys(single.servers)).toEqual([IDE_MCP_SERVER_NAME])
    expect(Object.keys(team.servers)).toEqual([IDE_MCP_SERVER_NAME, TEAM_MCP_SERVER_NAME])
    for (const parsed of [single, team]) {
      expect(Object.keys(parsed.params)).toEqual([
        'workspaceRoot',
        'modelId',
        'approvalMode',
        'config',
        'commandId',
      ])
      for (const server of Object.values(parsed.servers)) serverSchema.parse(server)
    }
    // denyUnmatched selects no native profile, so no frame carries one.
    expect(single.params['approvalMode']).toBe('denyUnmatched')
    expect(mspPermissionProfile('denyUnmatched')).toBeUndefined()
    const withoutTeam = structuredClone(team.params)
    const config = withoutTeam['config'] as Record<string, unknown>
    const servers = config['mcpServers'] as Record<string, unknown>
    Reflect.deleteProperty(servers, TEAM_MCP_SERVER_NAME)
    expect(withoutTeam).toEqual(single.params)
  })

  it('resume frames differ only by the team server entry and keep the snapshot history', () => {
    const single = frame('musecode-session-resume-single.json')
    const team = frame('musecode-session-resume-team.json')
    for (const parsed of [single, team]) {
      expect(Object.keys(parsed.params)).toEqual(['sessionId', 'history', 'config', 'commandId'])
      expect(parsed.params['history']).toBe('snapshot')
      for (const server of Object.values(parsed.servers)) serverSchema.parse(server)
    }
    expect(Object.keys(single.servers)).toEqual([IDE_MCP_SERVER_NAME])
    expect(Object.keys(team.servers)).toEqual([IDE_MCP_SERVER_NAME, TEAM_MCP_SERVER_NAME])
    const withoutTeam = structuredClone(team.params)
    const config = withoutTeam['config'] as Record<string, unknown>
    const servers = config['mcpServers'] as Record<string, unknown>
    Reflect.deleteProperty(servers, TEAM_MCP_SERVER_NAME)
    expect(withoutTeam).toEqual(single.params)
  })
})
