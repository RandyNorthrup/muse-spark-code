// What each external agent preset does to leave out the person's own MCP
// servers (RLF-TEAMWORKERS2, docs/certification/rlf-teamworkers2.md): the
// arguments it starts with and the `session/new` request it opens with, from
// the real preset table and the real request builder. A preset with no
// switch captured refuses to start, whatever else the caller passes.
import { describe, expect, it } from 'vitest'
import { ACP_PRESETS, type AcpPresetId } from '../../src/core/team/workers/acpWorker'
import { acpSpawnArgs, AcpUserServersSwitchError } from '../../src/core/team/workers/workerFence'
import { sessionNewRequest } from '../../src/host/team/acpProcess'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'

setUiText(EN, 'en')

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

  // RLF-TEAMWORKERS3: our own agent lists contributor-tier models only with its
  // flag, so the pool entry's pick of a listed contributor-tier model is the opt-in.
  describe('the contributor-tier switch', () => {
    const OWN = ['--no-user-mcp-servers']
    const OWN_WITH_CONTRIBUTOR = ['--no-user-mcp-servers', '--allow-contributor-models']

    it.each(['muse-wonder-full-1.0-contributor', 'muse-spark-1.3-contributor'])(
      'adds the flag for the listed contributor-tier model %s',
      (modelId) => {
        expect(acpSpawnArgs({ preset: ACP_PRESETS.own, modelId })).toEqual(OWN_WITH_CONTRIBUTOR)
      },
    )

    it.each([
      ['a standard Meta model', 'muse-wonder-full-1.0'],
      ['a model that is not Meta’s', 'echo'],
      ['a contributor suffix on an id the product does not list', 'muse-spark-9.9-contributor'],
      ['a provider-qualified id', 'meta/muse-spark-1.3-contributor'],
    ])('adds no flag for %s', (_name, modelId) => {
      expect(acpSpawnArgs({ preset: ACP_PRESETS.own, modelId })).toEqual(OWN)
    })

    it('adds no flag when the entry names no model', () => {
      expect(acpSpawnArgs({ preset: ACP_PRESETS.own })).toEqual(OWN)
    })

    it('adds nothing for an agent that has no such switch, whatever model is named', () => {
      for (const [id, args] of STARTS)
        if (id !== 'own')
          expect(
            acpSpawnArgs({ preset: ACP_PRESETS[id], modelId: 'muse-wonder-full-1.0-contributor' }),
          ).toEqual(args)
    })

    it('still refuses any other extra argument, with the flag or without', () => {
      for (const modelId of ['muse-wonder-full-1.0-contributor', 'echo'])
        expect(() =>
          acpSpawnArgs({
            preset: ACP_PRESETS.own,
            modelId,
            extraArgs: ['--allow-dangerously-skip-permissions'],
          }),
        ).toThrow(AcpUserServersSwitchError)
    })

    it('hands the agent’s own argument parser exactly the consent it was given', () => {
      expect(
        parseCommandLine([
          ...acpSpawnArgs({ preset: ACP_PRESETS.own, modelId: 'muse-wonder-full-1.0-contributor' }),
        ]),
      ).toMatchObject({
        command: 'serve',
        options: { noUserMcpServers: true, allowsContributorModels: true },
      })
      expect(
        parseCommandLine([...acpSpawnArgs({ preset: ACP_PRESETS.own, modelId: 'echo' })]),
      ).toMatchObject({
        command: 'serve',
        options: { noUserMcpServers: true, allowsContributorModels: false },
      })
    })
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
