// Guards against drift between package.json contribution points and the ids
// and defaults the code is built around.

import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import {
  CHAT_VIEW_ID,
  COMMAND_IDS,
  EXTENSION_NAME,
  EXTENSION_PUBLISHER,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
} from '../../src/shared/constants'

describe('package.json manifest', () => {
  it('identifies the extension the way constants.ts expects', () => {
    expect(manifest.name).toBe(EXTENSION_NAME)
    expect(manifest.publisher).toBe(EXTENSION_PUBLISHER)
    expect(manifest.main).toBe('./dist/extension.js')
  })

  it('contributes the chat view the provider registers', () => {
    const viewIds = Object.values(manifest.contributes.views)
      .flat()
      .map((view) => view.id)
    expect(viewIds).toEqual([CHAT_VIEW_ID])
  })

  it('contributes exactly the commands the extension registers', () => {
    const contributed = manifest.contributes.commands.map((command) => command.command)
    const registered = Object.values(COMMAND_IDS)
    expect(new Set(contributed)).toEqual(new Set(registered))
    expect(contributed).toHaveLength(registered.length)
  })

  it('binds the Claude Code parity shortcuts to registered commands', () => {
    const bindings = new Map(
      manifest.contributes.keybindings.map((binding) => [binding.command, binding]),
    )
    expect(bindings.get(COMMAND_IDS.focusInput)).toMatchObject({
      key: 'ctrl+escape',
      mac: 'cmd+escape',
    })
    expect(bindings.get(COMMAND_IDS.openInNewTab)).toMatchObject({
      key: 'ctrl+shift+escape',
      mac: 'cmd+shift+escape',
    })
    expect(bindings.get(COMMAND_IDS.insertMentionReference)).toMatchObject({ key: 'alt+k' })
    expect(bindings.get(COMMAND_IDS.toggleFocusView)).toMatchObject({ key: 'ctrl+alt+f' })
    expect(bindings.get(COMMAND_IDS.toggleThinking)).toMatchObject({
      key: 'alt+t',
      mac: 'alt+t',
      when: 'museSpark.inputFocused',
    })
    for (const command of bindings.keys()) {
      expect(Object.values(COMMAND_IDS)).toContain(command)
    }
  })

  it('declares every setting with the default constants.ts uses', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default: unknown }
    >
    const declared = Object.keys(properties).map((key) => key.replace(`${SETTINGS_SECTION}.`, ''))
    expect(new Set(declared)).toEqual(new Set(Object.keys(SETTING_DEFAULTS)))
    for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
      expect(properties[`${SETTINGS_SECTION}.${key}`]?.default, key).toEqual(value)
    }
  })

  it('pins @types/vscode to the engines.vscode minimum', () => {
    const engine = /^\^(\d+\.\d+)\.\d+$/.exec(manifest.engines.vscode)?.[1]
    const types = /^(\d+\.\d+)\.\d+$/.exec(manifest.devDependencies['@types/vscode'])?.[1]
    expect(engine).toBeDefined()
    expect(types).toBe(engine)
  })
})
