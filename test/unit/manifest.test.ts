// Guards against drift between package.json contribution points and the ids
// and defaults the code is built around.

import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import {
  ARCHIVE_DAY_CHOICES,
  CHAT_PANEL_VIEW_TYPE,
  CHAT_VIEW_ID,
  COMMAND_IDS,
  CONTEXT_KEYS,
  EXTENSION_NAME,
  EXTENSION_PUBLISHER,
  MACHINE_SCOPED_SETTINGS,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  WALKTHROUGH_ID,
} from '../../src/shared/constants'

const SURFACE_ACTIVE = `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || focusedView == '${CHAT_VIEW_ID}'`

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
    // Alt+T alone is a Windows menu-bar mnemonic (Terminal) and Ctrl+Alt+T is
    // GNOME's terminal shortcut, so only macOS keeps the Claude Code binding.
    expect(bindings.get(COMMAND_IDS.toggleThinking)).toMatchObject({
      key: 'ctrl+alt+t',
      mac: 'alt+t',
      linux: 'ctrl+alt+o',
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

  it('offers the Claude Code archive periods for archiveInactiveSessions', () => {
    const properties = manifest.contributes.configuration.properties
    expect(properties['museSpark.archiveInactiveSessions'].enum).toEqual([...ARCHIVE_DAY_CHOICES])
  })

  it('activates for restored chat panels only (D15)', () => {
    expect(manifest.activationEvents).toEqual([`onWebviewPanel:${CHAT_PANEL_VIEW_TYPE}`])
  })

  it('machine-scopes the settings that choose what runs and what is billed (D15)', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { scope?: string }
    >
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      const expected = (MACHINE_SCOPED_SETTINGS as readonly string[]).includes(key)
        ? 'machine'
        : undefined
      expect(properties[`${SETTINGS_SECTION}.${key}`]?.scope, key).toBe(expected)
    }
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited')
    expect(manifest.capabilities.untrustedWorkspaces).not.toHaveProperty('restrictedConfigurations')
  })

  it('gates the chords that would otherwise fire anywhere (D15)', () => {
    const bindings = new Map(
      manifest.contributes.keybindings.map((binding) => [binding.command, binding]),
    )
    expect(bindings.get(COMMAND_IDS.insertMentionReference)?.when).toBe('editorTextFocus')
    expect(bindings.get(COMMAND_IDS.toggleFocusView)?.when).toBe(SURFACE_ACTIVE)
    expect(bindings.get(COMMAND_IDS.newConversation)).toMatchObject({
      key: 'ctrl+n',
      mac: 'cmd+n',
      when: `config.${SETTINGS_SECTION}.enableNewConversationShortcut && (${SURFACE_ACTIVE})`,
    })
    expect(bindings.get(COMMAND_IDS.focusInput)?.when).toBeUndefined()
    expect(bindings.get(COMMAND_IDS.openInNewTab)?.when).toBeUndefined()
  })

  it('contributes the walkthrough the command opens, completed by our own events (D15)', () => {
    const [walkthrough] = manifest.contributes.walkthroughs
    expect(walkthrough?.id).toBe(WALKTHROUGH_ID)
    expect(walkthrough?.steps.map((step) => step.id)).toEqual(['welcome', 'open', 'signIn', 'chat'])
    const events = walkthrough?.steps.flatMap((step) => step.completionEvents ?? []) ?? []
    expect(events).toContain(`onView:${CHAT_VIEW_ID}`)
    expect(events).toContain(`onCommand:${COMMAND_IDS.openInNewTab}`)
    expect(events).toContain(`onContext:${CONTEXT_KEYS.signedIn}`)
    expect(events).toContain(`onCommand:${COMMAND_IDS.createRulesFile}`)
  })

  it('pins @types/vscode to the engines.vscode minimum', () => {
    const engine = /^\^(\d+\.\d+)\.\d+$/.exec(manifest.engines.vscode)?.[1]
    const types = /^(\d+\.\d+)\.\d+$/.exec(manifest.devDependencies['@types/vscode'])?.[1]
    expect(engine).toBeDefined()
    expect(types).toBe(engine)
  })
})
