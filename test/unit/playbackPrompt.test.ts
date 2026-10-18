import { describe, expect, it } from 'vitest'
import {
  checkPlaybackMarker,
  ensurePlaybackMarker,
  playbackInstructionsFor,
} from '../../src/core/backends/modelapi/playback'
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

describe('the host-enforced playback marker (D203)', () => {
  const marker = PLAYBACK_MODEL_TEXT.playbackMarker

  it('leaves a compliant reply alone, never doubled', () => {
    const reply = `${marker}\nThe goal is charted.`
    expect(ensurePlaybackMarker(reply)).toBe(reply)
  })

  it('leaves leading blank lines alone when the marker follows them', () => {
    const reply = `\n${marker}\nThe goal is charted.`
    expect(ensurePlaybackMarker(reply)).toBe(reply)
  })

  it('prefixes the marker line when the model omits it', () => {
    expect(ensurePlaybackMarker('The goal is charted.')).toBe(`${marker}\nThe goal is charted.`)
  })

  it('prefixes the marker line when the model paraphrases it', () => {
    const paraphrase = 'Here is my understanding of the task: the goal is charted.'
    const marked = ensurePlaybackMarker(paraphrase)
    expect(marked.startsWith(`${marker}\n`)).toBe(true)
    expect(marked).toContain(paraphrase)
  })

  it('leaves an empty reply empty', () => {
    expect(ensurePlaybackMarker('')).toBe('')
  })

  it('lets a compliant stream flow untouched', () => {
    expect(checkPlaybackMarker('', `${marker}\nThe goal`)).toEqual({ inject: '', ensured: true })
  })

  it('lets a marker prefix in progress flow untouched', () => {
    const prefix = marker.slice(0, 11)
    expect(checkPlaybackMarker('', prefix)).toEqual({ inject: '', ensured: false })
    expect(checkPlaybackMarker(prefix, marker.slice(11))).toEqual({ inject: '', ensured: true })
  })

  it('injects the marker before the delta that diverges from it', () => {
    const check = checkPlaybackMarker('', 'The goal is charted.')
    expect(check.ensured).toBe(true)
    expect(check.inject).toBe(`${marker}\n`)
  })

  it('injects the marker when a partial prefix diverges', () => {
    const prefix = marker.slice(0, 11)
    const check = checkPlaybackMarker(prefix, 'ground control')
    expect(check.ensured).toBe(true)
    expect(check.inject).toBe(`${marker}\n`)
  })
})
