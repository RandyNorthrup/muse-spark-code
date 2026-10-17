import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import {
  QUESTION_DEFER_DEFAULT_SECONDS,
  QUESTION_DEFER_MAX_SECONDS,
  QUESTION_DEFER_SETTING,
} from '../../src/shared/constants'

const focus = "activeWebviewPanelId == 'museSpark.chatPanel' || focusedView == 'museSpark.chatView'"
describe('M112 question contributions', () => {
  it('uses machine scope and the frozen default/range, admitting 0 and 1–9 for host normalization', () => {
    const setting =
      manifest.contributes.configuration.properties['museSpark.questions.deferAfterSeconds']
    expect(QUESTION_DEFER_SETTING).toBe('questions.deferAfterSeconds')
    expect(setting).toMatchObject({
      type: 'integer',
      default: QUESTION_DEFER_DEFAULT_SECONDS,
      minimum: 0,
      maximum: QUESTION_DEFER_MAX_SECONDS,
      scope: 'machine',
    })
  })
  it('binds both directions only to the actual chat focus scopes, with platform-specific chords', () => {
    const bindings = new Map(
      manifest.contributes.keybindings.map((binding) => [binding.command, binding]),
    )
    expect(bindings.get('museSpark.nextOpenQuestion')).toEqual({
      command: 'museSpark.nextOpenQuestion',
      key: 'ctrl+alt+j',
      mac: 'cmd+alt+j',
      when: focus,
    })
    expect(bindings.get('museSpark.previousOpenQuestion')).toEqual({
      command: 'museSpark.previousOpenQuestion',
      key: 'ctrl+alt+shift+j',
      mac: 'cmd+alt+shift+j',
      when: focus,
    })
    const commands = new Map(
      manifest.contributes.commands.map((command) => [command.command, command.title]),
    )
    expect(commands.get('museSpark.nextOpenQuestion')).toBe('%command.nextOpenQuestion.title%')
    expect(commands.get('museSpark.previousOpenQuestion')).toBe(
      '%command.previousOpenQuestion.title%',
    )
  })
})
