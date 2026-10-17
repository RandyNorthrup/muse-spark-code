import { describe, expect, it } from 'vitest'
import { playbackTurnText } from '../../src/core/playback/playbackPrompt'
import {
  playbackInstructionsFor,
  playbackToolRefusal,
} from '../../src/core/backends/modelapi/playback'
import { PLAYBACK_MODEL_TEXT } from '../../src/shared/constants'

const FACTS = {
  workspaceRoot: '/work/quest',
  platform: 'linux' as const,
  today: '2026-10-17',
  environment: { git: undefined },
  goalSection: 'Goal: chart the northern passage.',
  rules: 'Rule: knock twice.',
}

describe('a playback turn (D203)', () => {
  it('asks for the report from memory, with no tools and the marker', () => {
    const text = playbackTurnText()
    expect(text).toContain(PLAYBACK_MODEL_TEXT.playbackRole)
    expect(text).toContain(PLAYBACK_MODEL_TEXT.playbackNoTools)
    expect(text).toContain(PLAYBACK_MODEL_TEXT.playbackSections)
    expect(text).toContain(PLAYBACK_MODEL_TEXT.playbackMarker)
  })

  it('keeps the working memory the turn reports: the goal and the rules', () => {
    const instructions = playbackInstructionsFor(FACTS)
    expect(instructions).toContain('/work/quest')
    expect(instructions).toContain('Goal: chart the northern passage.')
    expect(instructions).toContain('Rule: knock twice.')
    expect(instructions).toContain(PLAYBACK_MODEL_TEXT.playbackNoTools)
  })

  it('builds without a goal or rules, and never prints undefined', () => {
    const instructions = playbackInstructionsFor({
      ...FACTS,
      goalSection: undefined,
      rules: undefined,
    })
    expect(instructions).not.toContain('undefined')
    expect(instructions).toContain(PLAYBACK_MODEL_TEXT.playbackNoTools)
  })

  it('refuses any tool by name, including one it has never seen', () => {
    for (const name of ['read', 'bash', 'some_future_tool']) {
      const refusal = playbackToolRefusal(name)
      expect(refusal).toContain(name)
      expect(refusal).toContain(PLAYBACK_MODEL_TEXT.playbackToolRefused)
    }
  })
})
