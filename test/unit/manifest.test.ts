// Guards against drift between package.json contribution points and the ids
// and defaults the code is built around.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

/** How many times a pattern (with the `g` flag) occurs in a text. */
function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

const SURFACE_ACTIVE = `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || focusedView == '${CHAT_VIEW_ID}'`

describe('package.json manifest', () => {
  it('identifies the extension the way constants.ts expects', () => {
    expect(manifest.name).toBe(EXTENSION_NAME)
    expect(manifest.publisher).toBe(EXTENSION_PUBLISHER)
    expect(manifest.main).toBe('./dist/extension.js')
  })

  it('points the Marketplace Sponsor button at the same link as the repository', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const funding = readFileSync(path.join(here, '..', '..', '.github', 'FUNDING.yml'), 'utf8')
    expect(manifest.sponsor.url).toMatch(/^https:\/\/www\.paypal\.com\/donate\//)
    expect(funding).toContain(manifest.sponsor.url)
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
    // Windows opens Start on Ctrl+Esc and Task Manager on Ctrl+Shift+Esc
    // before VS Code sees either, so Windows adds Alt (M26, D29).
    expect(bindings.get(COMMAND_IDS.focusInput)).toMatchObject({
      key: 'ctrl+escape',
      mac: 'cmd+escape',
      win: 'ctrl+alt+escape',
    })
    expect(bindings.get(COMMAND_IDS.openInNewTab)).toMatchObject({
      key: 'ctrl+shift+escape',
      mac: 'cmd+shift+escape',
      win: 'ctrl+shift+alt+escape',
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

  it('binds nothing on Windows that Windows itself takes first (M26)', () => {
    // support.microsoft.com "Keyboard shortcuts in Windows": Ctrl+Esc opens
    // Start, Ctrl+Shift+Esc Task Manager, Alt+Esc cycles windows, Alt+Tab
    // switches apps, Alt+F4 closes the window; Ctrl+Alt+Del is the secure
    // attention sequence.
    const reservedOnWindows = new Set([
      'ctrl+escape',
      'ctrl+shift+escape',
      'alt+escape',
      'alt+tab',
      'alt+f4',
      'ctrl+alt+delete',
    ])
    for (const binding of manifest.contributes.keybindings) {
      const onWindows = 'win' in binding ? binding.win : binding.key
      expect(reservedOnWindows.has(onWindows), `${binding.command}: ${onWindows}`).toBe(false)
    }
  })

  it('lists a command in the Command Palette only where it can act (M26)', () => {
    const palette = new Map(
      manifest.contributes.menus.commandPalette.map((entry) => [entry.command, entry.when]),
    )
    expect(Object.fromEntries(palette)).toEqual({
      // Needs an editor selection to mention.
      [COMMAND_IDS.insertMentionReference]: 'editorIsOpen',
      // Acts on the conversation in front of the user.
      [COMMAND_IDS.toggleThinking]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // The Windows sandbox; a remote window may run on Windows whatever this machine is.
      [COMMAND_IDS.setUpSandbox]: 'isWindows || remoteName',
      // Writes AGENTS.md into the workspace folder.
      [COMMAND_IDS.createRulesFile]: 'workspaceFolderCount > 0',
      // Exports the conversation in front of the user (M30).
      [COMMAND_IDS.exportConversation]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // git worktrees of the open folder's repository (M32).
      [COMMAND_IDS.newWorktree]: 'workspaceFolderCount > 0',
      [COMMAND_IDS.removeWorktree]: 'workspaceFolderCount > 0',
    })
    const registered: readonly string[] = Object.values(COMMAND_IDS)
    for (const command of palette.keys()) {
      expect(registered).toContain(command)
    }
  })

  it('lists the extension under the AI and Chat categories only (M26)', () => {
    expect(manifest.categories).toEqual(['AI', 'Chat'])
  })

  it('pins @types/vscode to the engines.vscode minimum', () => {
    const engine = /^\^(\d+\.\d+)\.\d+$/.exec(manifest.engines.vscode)?.[1]
    const types = /^(\d+\.\d+)\.\d+$/.exec(manifest.devDependencies['@types/vscode'])?.[1]
    expect(engine).toBeDefined()
    expect(types).toBe(engine)
  })
})

describe('packaging (M26)', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const read = (...segments: string[]) => readFileSync(path.join(root, ...segments), 'utf8')
  // .vscodeignore excludes everything, then lets these through.
  const shipped = read('.vscodeignore')
    .split('\n')
    .filter((line) => line.startsWith('!'))
    .map((line) => line.slice(1).trim())

  it('ships the licence, the third-party notices and both dictation helpers', () => {
    expect(shipped).toEqual(
      expect.arrayContaining([
        'LICENSE',
        'THIRD_PARTY_NOTICES.txt',
        'native/windows/dictate.ps1',
        'native/darwin/muse-dictate',
      ]),
    )
    // The notices name every bundled runtime dependency (the build's check
    // keeps the whole list current; this pins the obvious ones).
    const notices = read('THIRD_PARTY_NOTICES.txt')
    expect(notices.startsWith('THIRD-PARTY SOFTWARE NOTICES\n')).toBe(true)
    for (const name of [...Object.keys(manifest.dependencies), 'react', 'zod', '@muse-code/sdk']) {
      expect(notices, name).toContain(`\n${name} (`)
    }
  })

  it('ships the manifest strings and the translated tables, not the harness (M40)', () => {
    // VS Code reads package.nls*.json beside package.json; the host reads
    // l10n/ui.<language>.json. The gate's allowlist and the harness stay out.
    expect(shipped).toEqual(
      expect.arrayContaining(['package.nls.json', 'package.nls.*.json', 'l10n/ui.*.json']),
    )
    expect(shipped.filter((entry) => entry.startsWith('test/') || entry === 'l10n/**')).toEqual([])
    expect(manifest.displayName).toBe('%displayName%')
  })

  it('bounds every CI job, keeps tokens out of checkouts and the PAT in one step (M26)', () => {
    for (const file of ['build.yml', 'ci.yml', 'release.yml']) {
      const workflow = read('.github', 'workflows', file)
      // A job that calls a reusable workflow (`uses:` at job level) takes no
      // timeout; every job that runs on a runner has one.
      expect(count(workflow, /^ {4}timeout-minutes: \d+$/gm), file).toBe(
        count(workflow, /^ {4}runs-on: /gm),
      )
      expect(count(workflow, /^ {6}- uses: actions\/checkout@/gm), file).toBe(
        count(workflow, /^ {10}persist-credentials: false$/gm),
      )
      if (file !== 'release.yml') {
        expect(workflow, file).not.toContain('VSCE_PAT')
      }
    }
    const release = read('.github', 'workflows', 'release.yml')
    // The flag (whether it is set) and the one step that receives it.
    expect(release.match(/\$\{\{ secrets\.VSCE_PAT[^}]*\}\}/g)).toEqual([
      "${{ secrets.VSCE_PAT != '' }}",
      '${{ secrets.VSCE_PAT }}',
    ])
    expect(release).toMatch(
      /run: npm ci --ignore-scripts --no-audit\n.*\n.*\n.*\n {10}VSCE_PAT: \$\{\{ secrets\.VSCE_PAT \}\}\n {8}run: \.\/node_modules\/\.bin\/vsce publish/,
    )
    expect(release).toContain('git merge-base --is-ancestor "${GITHUB_SHA}" origin/main')
  })

  it('takes the macOS helper’s version from package.json when it is built, never by hand', () => {
    expect(read('native', 'darwin', 'Info.plist')).not.toContain('CFBundleShortVersionString')
    const build = read('native', 'darwin', 'build.sh')
    expect(build).toContain('MANIFEST=../../package.json')
    expect(build).toContain('VERSION="$(plutil -extract version raw -o - "$MANIFEST")"')
    expect(build).toContain('plutil -replace "$VERSION_KEY" -string "$VERSION" "$PLIST"')
    expect(build).toContain('launchctl plist __TEXT,__info_plist "$OUTPUT"')
  })
})
