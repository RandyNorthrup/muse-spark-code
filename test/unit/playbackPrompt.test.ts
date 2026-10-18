import { describe, expect, it } from 'vitest'
import { playbackInstructionsFor } from '../../src/core/backends/modelapi/playback'
import { PLAYBACK_MODEL_TEXT } from '../../src/shared/constants'

const FACTS = {
  workspaceRoot: '/work/quest',
  platform: 'linux' as const,
  today: '2026-10-17',
  goalSection: 'Goal: chart the northern passage.',
  rules: 'Rule: knock twice.',
  teamRoster: 'Team roster: the scout maps, the smith builds.',
  agent: { id: 'cartographer', source: 'project' as const, prompt: 'Draw every coastline.' },
}

describe('a playback turn on the Model API (D203)', () => {
  it('reports everything that shapes the conversation: goal, rules, team and role', () => {
    const instructions = playbackInstructionsFor(FACTS)
    expect(instructions).toContain('/work/quest')
    expect(instructions).toContain('Goal: chart the northern passage.')
    expect(instructions).toContain('Rule: knock twice.')
    expect(instructions).toContain('Team roster: the scout maps, the smith builds.')
    expect(instructions).toContain('cartographer')
    expect(instructions).toContain('Draw every coastline.')
    expect(instructions).toContain(PLAYBACK_MODEL_TEXT.playbackNoTools)
  })

  it('builds without any of them, and never prints undefined', () => {
    const instructions = playbackInstructionsFor({
      ...FACTS,
      goalSection: undefined,
      rules: undefined,
      teamRoster: undefined,
      agent: undefined,
    })
    expect(instructions).not.toContain('undefined')
    expect(instructions).toContain(PLAYBACK_MODEL_TEXT.playbackNoTools)
  })
})
