// D250: the external agents on offer and the offers built from them — the
// five presets, the person's own agents by command, and the lead/worker
// honesty the panel derives from the same list.

import { describe, expect, it } from 'vitest'
import {
  allExternalAgents,
  customExternalAgents,
  externalAgentPresets,
  isExternalDefaultModel,
  resolveExternalAgent,
} from '../../../src/core/team/externalAgents'
import { buildTeamModelOffers } from '../../../src/core/team/teamModelRegistry'
import { deriveTeamPanel } from '../../../src/core/team/teamPanelViews'
import { teamOffers } from '../helpers/teamPanelOffers'
import { ACP_PRESETS } from '../../../src/core/team/workers/acpWorker'
import { UI_TEXT } from '../../../src/shared/constants'

describe('external agent presets', () => {
  it('offers the five presets with lane W’s captured launch facts', () => {
    const presets = externalAgentPresets()
    expect(presets.map((row) => row.agentId)).toEqual([
      'claude',
      'codex',
      'gemini',
      'copilot',
      'own',
    ])
    for (const preset of presets) {
      const worker = ACP_PRESETS[preset.preset!]
      expect(preset.command).toBe(worker.command)
      expect(preset.args).toEqual(worker.defaultArgs)
      expect(preset.pays).toBe('subscription')
      expect(isExternalDefaultModel(preset)).toBe(true)
    }
    expect(presets[0]?.signInCommand).toBe('claude')
  })

  it('reads the person’s own agents by command and drops broken rows', () => {
    const custom = customExternalAgents([
      { name: 'mine', command: 'my-agent', args: ['--acp'], model: 'big' },
      { name: 'mine', command: 'other' },
      { name: 'claude', command: 'shadow' },
      { command: 'noname' },
      { name: 'broken', args: '--acp' },
      'not-an-object',
    ])
    expect(custom).toEqual([
      expect.objectContaining({
        agentId: 'mine',
        command: 'my-agent',
        args: ['--acp'],
        model: 'big',
        pays: 'subscription',
      }),
    ])
    expect(customExternalAgents('not-a-list')).toEqual([])
    expect(customExternalAgents(undefined)).toEqual([])
  })

  it('resolves a stored ref to its launch facts, and a removed entry to nothing', () => {
    const raw = [{ name: 'mine', command: 'my-agent', model: 'big' }]
    expect(resolveExternalAgent({ agentId: 'mine', model: 'other' }, raw)).toMatchObject({
      command: 'my-agent',
      model: 'other',
    })
    expect(resolveExternalAgent({ agentId: 'gone', model: 'gone' }, raw)).toBeUndefined()
    expect(allExternalAgents(raw)).toHaveLength(6)
  })
})

describe('external offers', () => {
  const base = {
    engine: [],
    museCode: [],
    limits: [],
    maxWorkers: 4,
    external: externalAgentPresets(),
  }

  it('offers an external agent as lead-only when only the lead can run it', () => {
    const { offers, absent } = buildTeamModelOffers({
      ...base,
      canRunKind: (kind) => kind === 'engine',
      canLeadKind: () => true,
    })
    expect(absent).toEqual([])
    expect(offers).toHaveLength(5)
    expect(offers[0]).toMatchObject({
      ref: 'external:claude',
      label: 'Claude Code',
      worker: false,
      agent: { kind: 'external', agentId: 'claude', model: 'claude', pays: 'subscription' },
      controls: [],
    })
  })

  it('offers nothing external when neither lead nor worker can run it', () => {
    const { offers, absent } = buildTeamModelOffers({
      ...base,
      canRunKind: () => false,
      canLeadKind: () => false,
    })
    expect(offers).toEqual([])
    expect(absent.map((row) => row.provider)).toContain('claude')
  })

  it('keeps an uninstalled agent out of the offers, by name', () => {
    const { offers, absent } = buildTeamModelOffers({
      ...base,
      canRunKind: () => false,
      canLeadKind: () => true,
      isExternalInstalled: (agent) => agent.agentId === 'own',
    })
    expect(offers.map((offer) => offer.ref)).toEqual(['external:own'])
    expect(absent.every((row) => row.reason === 'unavailable')).toBe(true)
  })
})

describe('the panel’s reading of an external lead', () => {
  it('accepts an external orchestrator and refuses it as a worker, in words', () => {
    const offers = [
      ...teamOffers(),
      {
        ref: 'external:claude',
        label: 'Claude Code',
        agent: {
          kind: 'external' as const,
          agentId: 'claude',
          model: 'claude',
          pays: 'subscription' as const,
        },
        worker: false,
        toolCalling: true,
        ceiling: 2,
        controls: [],
      },
    ]
    const document = {
      template: 'custom' as const,
      intensity: 'minimal' as const,
      orchestrator: { agent: offers[2]?.agent },
      roles: [
        {
          role: 'research',
          pool: [
            { id: 'e1', agent: offers[2]?.agent, concurrent: 1, caps: [] },
            { id: 'e2', agent: offers[1]?.agent, concurrent: 1, caps: [] },
          ],
        },
      ],
    }
    const dismissed = new Set<string>()
    const slice = deriveTeamPanel(
      document,
      offers,
      offers[0]?.ref ?? '',
      4,
      {
        isDismissed: (role, kind) => dismissed.has(`${role}:${kind}`),
        dismiss: (role, kind) => {
          dismissed.add(`${role}:${kind}`)
        },
      },
      'research-library',
      false,
      false,
      undefined,
      [],
    )
    // The lead stands; the pool entry on the same agent refuses, naming it.
    expect(slice.issues.some((line) => line.includes('Claude Code'))).toBe(true)
    expect(slice.issues.some((line) => line.includes('second model'))).toBe(false)
    // And the lead itself is accepted: no "invalid" for the external pick.
    expect(slice.issues).not.toContain(UI_TEXT.teamEditor.invalid)
  })
})
