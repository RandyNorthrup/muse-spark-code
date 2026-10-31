// What each external agent preset does to leave out the person's own MCP
// servers (RLF-TEAMWORKERS2, docs/certification/rlf-teamworkers2.md): the
// arguments it starts with and the `session/new` request it opens with, from
// the real preset table and the real request builder. A preset with no
// switch captured refuses to start, whatever else the caller passes.
import { describe, expect, it } from 'vitest'
import { ACP_PRESETS, type AcpPresetId } from '../../src/core/team/workers/acpWorker'
import { acpSpawnArgs, AcpUserServersSwitchError } from '../../src/core/team/workers/workerFence'
import { sessionNewRequest } from '../../src/host/team/acpProcess'

const STARTS: readonly (readonly [AcpPresetId, readonly string[]])[] = [
  ['own', ['--no-user-mcp-servers']],
  ['gemini', ['--acp', '--allowed-mcp-server-names', 'muse-team-no-user-mcp-servers']],
  ['claude', ['--hide-claude-auth']],
]
const REFUSED: readonly AcpPresetId[] = ['codex', 'copilot']

describe('the preset switches', () => {
  it.each(STARTS)('%s starts with its captured switch', (id, args) => {
    expect(acpSpawnArgs({ preset: ACP_PRESETS[id] })).toEqual(args)
  })

  it.each(REFUSED)('%s has no switch and does not start', (id) => {
    expect(() => acpSpawnArgs({ preset: ACP_PRESETS[id] })).toThrow(AcpUserServersSwitchError)
  })

  it('refuses any extra argument, which could undo the switch', () => {
    for (const [id] of STARTS)
      expect(() =>
        acpSpawnArgs({
          preset: ACP_PRESETS[id],
          extraArgs: ['--allowed-mcp-server-names', 'docs'],
        }),
      ).toThrow(AcpUserServersSwitchError)
  })

  it('opens Claude’s session with the option that ignores every other MCP configuration', () => {
    const { withoutUserServersMeta } = ACP_PRESETS.claude
    expect(
      sessionNewRequest({ cwd: '/work/copy', mcpServers: [], meta: withoutUserServersMeta }),
    ).toEqual({
      cwd: '/work/copy',
      mcpServers: [],
      _meta: { claudeCode: { options: { strictMcpConfig: true } } },
    })
    // The request never shares the preset's own object, so a caller cannot change the switch.
    const request = sessionNewRequest({
      cwd: '/work/copy',
      mcpServers: [],
      meta: withoutUserServersMeta,
    })
    expect(request._meta).not.toBe(withoutUserServersMeta)
    expect(
      sessionNewRequest({
        cwd: '/work/copy',
        mcpServers: [],
        meta: ACP_PRESETS.own.withoutUserServersMeta,
      }),
    ).toEqual({ cwd: '/work/copy', mcpServers: [] })
  })
})
