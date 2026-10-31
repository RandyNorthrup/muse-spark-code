import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import { QUESTION_DEFER_DEFAULT_SECONDS, QUESTION_DEFER_SETTING } from '../../src/shared/constants'

const focus = "activeWebviewPanelId == 'museSpark.chatPanel' || focusedView == 'museSpark.chatView'"
describe('M112 question contributions', () => {
  it('uses machine scope and the frozen default, with no maximum of ours', () => {
    const setting =
      manifest.contributes.configuration.properties['museSpark.questions.deferAfterSeconds']
    expect(QUESTION_DEFER_SETTING).toBe('questions.deferAfterSeconds')
    expect(setting).toMatchObject({
      type: 'integer',
      default: QUESTION_DEFER_DEFAULT_SECONDS,
      minimum: 0,
      scope: 'machine',
    })
    expect('maximum' in setting).toBe(false)
  })
  it('describes the deferral the code keeps: the frozen default, never-defers 0, machine scope, no clamp', () => {
    // The settings UI must not promise the removed clamp (RLF-M112 found
    // "1–9 are read as 10; maximum 3,600" here while the code, the CLI help
    // and all 14 translations already said D121). The description resolves
    // through package.nls.json, as in manifest.test.ts.
    const setting =
      manifest.contributes.configuration.properties['museSpark.questions.deferAfterSeconds']
    const here = path.dirname(fileURLToPath(import.meta.url))
    const nls: Record<string, string> = JSON.parse(
      readFileSync(path.join(here, '..', '..', 'package.nls.json'), 'utf8'),
    )
    const description = nls[setting.description.replace(/^%(.+)%$/, '$1')] ?? ''
    expect(description).toContain(
      `${String(QUESTION_DEFER_DEFAULT_SECONDS)} (the default) means never`,
    )
    expect(description).toContain('any other whole number of seconds is used as set')
    expect(description).toContain('Only this machine')
    expect(description).not.toMatch(/read as 10|maximum|60 by default/)
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
