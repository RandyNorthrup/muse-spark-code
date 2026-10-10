// Guards against drift between package.json contribution points and the ids
// and defaults the code is built around.

import { spawnSync } from 'node:child_process'
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
  QUESTION_DEFER_SETTING,
  QUESTION_DEFER_DEFAULT_SECONDS,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
  WALKTHROUGH_ID,
  WHATS_NEW_CHANGELOG_URL,
  WHATS_NEW_README_URL,
} from '../../src/shared/constants'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { findBash } from './helpers/shellParsers'

const byText = (a: string, b: string) => a.localeCompare(b)

/** One aggregate case's outcome, named, so a failure says which case flipped. */
function verdict(label: string, isPassing: boolean): string {
  return `${label}: ${isPassing ? 'passes' : 'fails'}`
}

/** How many times a pattern (with the `g` flag) occurs in a text. */
function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

const SURFACE_ACTIVE = `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || focusedView == '${CHAT_VIEW_ID}'`

/** A package.json `%key%` reference names its package.nls.json string. */
const nlsKeyOf = (reference: string | undefined) => reference?.replace(/^%(.+)%$/, '$1') ?? ''

describe('package.json manifest', () => {
  it('never puts settings below a scalar setting that VS Code would ignore', () => {
    const properties = manifest.contributes.configuration.properties
    const keys = Object.keys(properties)
    for (const [parent, specification] of Object.entries(properties)) {
      if (specification.type === 'object') continue
      expect(
        keys.filter((key) => key.startsWith(`${parent}.`)),
        parent,
      ).toEqual([])
    }
  })

  it('offers paid Tab by default while retaining its machine scope and daily cap', () => {
    const properties = manifest.contributes.configuration.properties
    expect(properties['museSpark.modelApiTab']).toMatchObject({ default: true, scope: 'machine' })
    expect(properties['museSpark.tabDailyBudgetUsd']).toMatchObject({
      default: 1,
      minimum: 0.05,
      maximum: 50,
      scope: 'machine',
    })
  })

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
    expect(bindings.get('editor.action.inlineSuggest.trigger')).toMatchObject({
      key: 'alt+\\',
      when: 'editorTextFocus && museSpark.tabOn',
    })
    for (const command of bindings.keys()) {
      if (command === 'editor.action.inlineSuggest.trigger') {
        expect(bindings.get(command)).toMatchObject({
          key: 'alt+\\',
          when: 'editorTextFocus && museSpark.tabOn',
        })
      } else {
        expect(Object.values(COMMAND_IDS)).toContain(command)
      }
    }
  })

  it('declares every setting with its runtime default', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { default: unknown }
    >
    const declared = Object.keys(properties).map((key) => key.replace(`${SETTINGS_SECTION}.`, ''))
    const resource = resourceSettingsSchema.parse({})
    const defaults = {
      ...SETTING_DEFAULTS,
      [QUESTION_DEFER_SETTING]: QUESTION_DEFER_DEFAULT_SECONDS,
      resourceGovernor: resource.enabled,
      resourceCpuMaxPercent: resource.cpuMaxPercent,
      resourceMemoryMaxPercent: resource.memoryMaxPercent,
      resourceMemoryMinFreeGiB: resource.memoryMinFreeGiB,
      resourceGpuMaxPercent: resource.gpuMaxPercent,
      resourceDiskBusyMaxPercent: resource.diskBusyMaxPercent,
      resourceDiskMinFreeGiB: resource.diskMinFreeGiB,
      resourceRelocate: resource.relocate,
    }
    expect(new Set(declared)).toEqual(new Set(Object.keys(defaults)))
    for (const [key, value] of Object.entries(defaults)) {
      expect(properties[`${SETTINGS_SECTION}.${key}`]?.default, key).toEqual(value)
    }
  })

  it('offers the Claude Code archive periods for archiveInactiveSessions', () => {
    const properties = manifest.contributes.configuration.properties
    expect(properties['museSpark.archiveInactiveSessions'].enum).toEqual([...ARCHIVE_DAY_CHOICES])
  })

  it('activates at startup for Tab and for restored chat panels (D15, D73)', () => {
    expect(manifest.activationEvents).toEqual([
      `onWebviewPanel:${CHAT_PANEL_VIEW_TYPE}`,
      'onStartupFinished',
    ])
  })

  it('machine-scopes the settings that choose what runs and what is billed (D15)', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { scope?: string }
    >
    for (const key of Object.keys(SETTING_DEFAULTS)) {
      // FIN2's disclosed registry lookup is a per-window offline choice;
      // paid explanation and budget settings remain machine-scoped (D15).
      const workspaceScope = key === 'legalRegistryLookups' ? 'window' : undefined
      const expected = (MACHINE_SCOPED_SETTINGS as readonly string[]).includes(key)
        ? 'machine'
        : workspaceScope
      expect(properties[`${SETTINGS_SECTION}.${key}`]?.scope, key).toBe(expected)
    }
    expect(manifest.capabilities.untrustedWorkspaces.supported).toBe('limited')
    expect(manifest.capabilities.untrustedWorkspaces).not.toHaveProperty('restrictedConfigurations')
  })

  it('keeps prompt-cache retention under the user’s control, not repository settings (M56)', () => {
    // VS Code ignores a workspace value for a machine-scoped setting. This
    // keeps a cloned .vscode/settings.json from changing in_memory to 24h.
    const retention =
      manifest.contributes.configuration.properties['museSpark.modelApiPromptCacheRetention']
    expect(retention.scope).toBe('machine')
    expect(retention.default).toBe('in_memory')
    expect(retention.enum).toEqual(['in_memory', '24h'])
  })

  it('keeps the session budget a machine choice, and claims no more than it keeps (M82)', () => {
    // A cloned .vscode/settings.json must not set what is billed.
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { scope?: string; default?: unknown; description?: string }
    >
    const budget = properties['museSpark.modelApiSessionBudgetUsd']
    expect(budget?.scope).toBe('machine')
    expect(budget?.default).toBe(0)
    // The description resolves through package.nls.json. It says what the
    // cap does (a request that cannot fit is not sent) and what it cannot
    // promise: billed usage can differ from the estimates, sent requests keep
    // their reservation, and it makes no claim that the estimate's error is
    // the only way past the cap (the review of PR #58's "overclaims").
    const here = path.dirname(fileURLToPath(import.meta.url))
    const nls = JSON.parse(
      readFileSync(path.join(here, '..', '..', 'package.nls.json'), 'utf8'),
    ) as Record<string, string>
    const description = nls[budget?.description?.replace(/^%(.+)%$/, '$1') ?? '']
    expect(description).toContain('0 means no cap')
    expect(description).toContain('a request that cannot fit what is left is not sent')
    expect(description).toContain('input estimates may differ from billed usage')
    expect(description).toContain('Unknown sent requests keep their reservation')
    expect(description).toContain('Web search is unavailable while capped')
    expect(description).not.toMatch(/only through|only overrun|only way/i)
  })

  it('claims only the GitHub reads the wired network port can make (M113W)', () => {
    // The wired stores port is always unbound (src/runtime/reporting/network.ts):
    // store, workflow and release adapters await approved live captures, so no
    // setting may promise public release-channel reads (Grok M113W P2).
    const here = path.dirname(fileURLToPath(import.meta.url))
    const nls = JSON.parse(
      readFileSync(path.join(here, '..', '..', 'package.nls.json'), 'utf8'),
    ) as Record<string, string>
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { description?: string; enumDescriptions?: string[] }
    >
    const network = properties['museSpark.reports.network']
    const description = nls[nlsKeyOf(network?.description)] ?? ''
    expect(description).toContain('GitHub')
    expect(description).toContain('--network')
    expect(description).not.toMatch(/public release channels/i)
    const enumTexts = (network?.enumDescriptions ?? []).map(
      (reference) => nls[nlsKeyOf(reference)] ?? '',
    )
    for (const text of enumTexts) expect(text).not.toMatch(/public release channels/i)
    expect(nls[nlsKeyOf(network?.enumDescriptions?.[0])] ?? '').toContain('signed in')
  })

  it('notifies about background turns until turned off, a choice a workspace may make (M82)', () => {
    const properties = manifest.contributes.configuration.properties as Record<
      string,
      { scope?: string; default?: unknown }
    >
    const notify = properties['museSpark.notifyOnBackgroundTurn']
    // It chooses nothing that runs or is billed (D15), so it is not machine-scoped.
    expect(notify?.scope).toBeUndefined()
    expect(notify?.default).toBe(true)
    expect(properties['museSpark.modelApiReplyUsage']?.scope).toBeUndefined()
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
    // M46: Ctrl+B, the TUI's key, everywhere (VS Code's own is Cmd+B on a
    // Mac), and only while the conversation in view runs a command to move:
    // VS Code's sidebar toggle keeps it otherwise.
    expect(bindings.get(COMMAND_IDS.moveToBackground)).toMatchObject({
      key: 'ctrl+b',
      mac: 'ctrl+b',
      when: `${CONTEXT_KEYS.canMoveToBackground} && (${SURFACE_ACTIVE})`,
    })
  })

  it('contributes the walkthrough the command opens, completed by our own events (D15)', () => {
    const [walkthrough] = manifest.contributes.walkthroughs
    expect(walkthrough?.id).toBe(WALKTHROUGH_ID)
    expect(walkthrough?.steps.map((step) => step.id)).toEqual([
      'welcome',
      'open',
      'signIn',
      'chat',
      // M95 (PLAN.md D74): the step whose command link opens the wizard.
      'ownModel',
    ])
    const events = walkthrough?.steps.flatMap((step) => step.completionEvents ?? []) ?? []
    expect(events).toContain(`onView:${CHAT_VIEW_ID}`)
    expect(events).toContain(`onCommand:${COMMAND_IDS.openInNewTab}`)
    expect(events).toContain(`onContext:${CONTEXT_KEYS.signedIn}`)
    expect(events).toContain(`onCommand:${COMMAND_IDS.createRulesFile}`)
    expect(events).toContain(`onCommand:${COMMAND_IDS.startWithOwnModel}`)
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
      // M91b: only Windows prepares a job for plugin hooks.
      [COMMAND_IDS.retryPluginHooks]: 'isWindows',
      // Writes AGENTS.md into the workspace folder.
      [COMMAND_IDS.createRulesFile]: 'workspaceFolderCount > 0',
      // Exports the conversation in front of the user (M30).
      [COMMAND_IDS.exportConversation]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // Imports an export file into the conversation in front of the user, or reads one (M84).
      [COMMAND_IDS.legalScan]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      [COMMAND_IDS.importSession]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      [COMMAND_IDS.openShareFile]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // git worktrees of the open folder's repository (M32).
      [COMMAND_IDS.newWorktree]: 'workspaceFolderCount > 0',
      [COMMAND_IDS.removeWorktree]: 'workspaceFolderCount > 0',
      // A pull request of the open folder's repository, in a worktree (M71).
      [COMMAND_IDS.openPullRequestInConversation]: 'workspaceFolderCount > 0',
      // Only while the conversation in view runs a command to move (M46).
      [COMMAND_IDS.moveToBackground]: CONTEXT_KEYS.canMoveToBackground,
      // The background tasks of the conversation in front of the user (M46).
      [COMMAND_IDS.stopBackgroundTasks]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // Records the screen for the conversation in front of the user (M105).
      [COMMAND_IDS.attachScreenRecording]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // Attaches the newest saved recording to the conversation in front of the user (M105).
      [COMMAND_IDS.attachLatestScreenRecording]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
      // Deletes the conversation in front of the user's uploaded media (M105).
      [COMMAND_IDS.deleteUploadedFiles]: `activeWebviewPanelId == '${CHAT_PANEL_VIEW_TYPE}' || view.${CHAT_VIEW_ID}.visible`,
    })
    const registered: readonly string[] = Object.values(COMMAND_IDS)
    for (const command of palette.keys()) {
      expect(registered).toContain(command)
    }
  })

  it('links What’s New to the repository the manifest names (M99)', () => {
    const repository = manifest.repository.url.replace(/.git$/, '')
    expect(WHATS_NEW_CHANGELOG_URL).toBe(`${repository}/blob/main/CHANGELOG.md`)
    expect(WHATS_NEW_README_URL).toBe(manifest.homepage)
    // Machine-scoped and on by default (the owner's ruling: enhancements are on).
    expect(manifest.contributes.configuration.properties['museSpark.showWhatsNewOnUpdate']).toEqual(
      {
        type: 'boolean',
        default: true,
        description: '%config.showWhatsNewOnUpdate.description%',
        scope: 'machine',
      },
    )
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

  it('ships the licence, the third-party notices, both dictation helpers and the capture script', () => {
    expect(shipped).toEqual(
      expect.arrayContaining([
        'LICENSE',
        'THIRD_PARTY_NOTICES.txt',
        'native/windows/dictate.ps1',
        'native/windows/capture.ps1',
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

  it('ships What’s New: its bundle, its content and its page (M99)', () => {
    expect(shipped).toEqual(
      expect.arrayContaining([
        'dist/whatsNew.js',
        'dist/whatsNew.json',
        'dist/webview/whatsNew.js',
        'dist/webview/whatsNew.css',
      ]),
    )
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
      /run: npm ci --ignore-scripts --no-audit\n.*\n.*\n.*\n.*\n {10}VSCE_PAT: \$\{\{ secrets\.VSCE_PAT \}\}\n {8}run: node scripts\/publish-registry\.mjs marketplace /,
    )
    // That step's script publishes with the locked vsce just installed.
    expect(read('scripts', 'publish-registry.mjs')).toContain(
      "marketplace: ['./node_modules/.bin/vsce', ['publish'",
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

  it('keeps exact-tree reuse behind tag checks and preserves full-build fallback (RELFAST)', () => {
    const release = read('.github', 'workflows', 'release.yml')
    const reuse = release.split('\n  reuse:\n', 2)[1]!.split('\n  build:\n', 1)[0]!
    const build = release.split('\n  build:\n', 2)[1]!.split('\n  release:\n', 1)[0]!
    const publish = release.split('\n  release:\n', 2)[1]!.split('\n  publish:\n', 1)[0]!
    expect(reuse).toContain('needs: verify')
    expect(reuse).toContain('actions: read')
    expect(count(release, /^ {6}actions: read$/gm)).toBe(5)
    expect(reuse).toContain('FORCE_REBUILD: ${{ vars.RELEASE_FORCE_REBUILD }}')
    expect(count(reuse, /run-id: \$\{\{ steps.lookup.outputs.run-id \}\}/g)).toBe(4)
    expect(count(reuse, /github-token: \$\{\{ github.token \}\}/g)).toBe(4)
    expect(count(reuse, /uses: actions\/download-artifact@[a-f\d]{40}/g)).toBe(4)
    for (const id of ['receipt', 'vsix', 'acp', 'sboms']) {
      expect(reuse).toContain(`steps.${id}.outcome == 'success'`)
    }
    expect(reuse).toContain('node scripts/release-reuse.mjs verify reused')
    expect(reuse).toContain("echo 'reused=false'")
    expect(reuse).toContain('Full rebuild: a CI artifact download failed.')
    expect(count(reuse, /if: steps.check.outputs.reused == 'true'/g)).toBe(3)
    expect(build).toContain('needs: [verify, reuse]')
    expect(build).toContain("github.event_name == 'push' && needs.reuse.outputs.reused != 'true'")
    expect(build).toContain('uses: ./.github/workflows/build.yml')
    expect(publish).toContain('needs: [verify, reuse, build]')
    expect(publish).toContain(
      "if: ${{ !cancelled() && needs.verify.result == 'success' && needs.reuse.result == 'success' && (needs.reuse.outputs.reused == 'true' || needs.build.result == 'success') }}",
    )
    const ci = read('.github', 'workflows', 'build.yml')
    expect(ci).toContain('run: node scripts/release-reuse.mjs record')
    expect(ci).toContain('name: source-tree-${{ steps.source.outputs.tree }}')
    // Four package artifacts plus M114 S's visual-shards and visual jobs,
    // every one on the same 30-day retention.
    expect(count(ci, /retention-days: 30/g)).toBe(6)
  })
  it('keeps manual recovery on the shared verified staging path and never rebuilds it (RELFAST2)', () => {
    const release = read('.github', 'workflows', 'release.yml')
    const reuse = release.split('\n  reuse:\n', 2)[1]!.split('\n  build:\n', 1)[0]!
    const publishers = release.split('\n  release:\n', 2)[1]!
    expect(release).toContain('workflow_dispatch:\n    inputs:\n      artifacts_run_id:')
    expect(release).toContain("if: github.event_name == 'workflow_dispatch'")
    expect(release).toContain('if [ "${GITHUB_REF_TYPE}" != tag ]')
    expect(reuse).toContain('RECOVERY_RUN_ID: ${{ inputs.artifacts_run_id }}')
    expect(reuse).toContain("steps.lookup.outputs.legacy-recovery != 'true'")
    expect(reuse).toContain(
      "steps.receipt.outcome == 'success' || steps.lookup.outputs.legacy-recovery == 'true'",
    )
    expect(reuse).toContain('SOURCE_TREE: ${{ steps.lookup.outputs.tree }}')
    expect(reuse).toContain('LEGACY_RECOVERY: ${{ steps.lookup.outputs.legacy-recovery }}')
    expect(reuse).toContain(
      "echo '::error::Recovery download failed; preserve the original bytes.' >&2\n              exit 1",
    )
    expect(count(publishers, /run-id: \$\{\{ github.run_id \}\}/g)).toBe(6)
    expect(count(publishers, /github-token: \$\{\{ github.token \}\}/g)).toBe(6)
    expect(publishers).not.toContain('inputs.artifacts_run_id')
  })
  it('blocks every release publisher and tag mover after cancellation (RELFAST2)', () => {
    const release = read('.github', 'workflows', 'release.yml')
    expect(release).not.toContain('always()')
    for (const job of ['build', 'release', 'publish', 'openvsx', 'npm', 'summary']) {
      const body = release.split(`\n  ${job}:\n`, 2)[1]!.split(/\n {2}[a-z]+:\n/, 1)[0]!
      expect(body, job).toContain('if: ${{ !cancelled()')
    }
  })

  it('starts the live Action receipt by the owner’s hand only, under a hard cap (M80 LA)', () => {
    const live = read('.github', 'workflows', 'action-live.yml')
    // The one trigger: no pull request, push, comment or schedule reaches the key.
    const triggers = live.split('\non:\n', 2)[1]!.split('\npermissions:\n', 1)[0]!
    expect(triggers.match(/^ {2}\S.*$/gm)).toEqual(['  workflow_dispatch:'])
    const ownerGate = [
      "github.event_name == 'workflow_dispatch' &&",
      'github.actor == github.repository_owner &&',
      'github.triggering_actor == github.repository_owner &&',
      "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    ].join('\n      ')
    expect(count(live, /^ {4}runs-on: /gm)).toBe(2)
    expect(live.split(ownerGate).length - 1).toBe(2)
    expect(count(live, /^ {4}timeout-minutes: \d+$/gm)).toBe(2)
    expect(count(live, /^ {6}- uses: actions\/checkout@/gm)).toBe(
      count(live, /^ {10}persist-credentials: false$/gm),
    )
    expect(live).not.toMatch(/:\s*write\b/)
    // The key is the Action's input and nothing else's.
    expect(live.match(/secrets\.\w+/g)).toEqual(['secrets.MUSE_MODEL_API_KEY'])
    expect(live).toMatch(/^ {10}model-api-key: \$\{\{ secrets\.MUSE_MODEL_API_KEY \}\}$/m)
    for (const input of [
      "max-budget-usd: '0.25'",
      'model: muse-spark-1.3-contributor',
      "allow-contributor-models: 'true'",
      "image-generation: 'false'",
      "post-comment: 'false'",
      "timeout-minutes: '10'",
    ]) {
      expect(live).toContain(`\n          ${input}\n`)
    }
  })
})

describe('tiered CI (CIFLOW)', () => {
  const root = path.resolve(import.meta.dirname, '..', '..')
  const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
  const build = read('.github/workflows/build.yml')
  const job = (id: string) => {
    const body = build.split(`\n  ${id}:\n`, 2)[1]?.split(/\n {2}[\w-]+:\n/, 1)[0]
    if (body === undefined) throw new Error(`missing job ${id}`)
    return body
  }
  it('checks PRs quickly and merge groups/manual calls fully, on the event commit', () => {
    const ci = read('.github/workflows/ci.yml')
    for (const event of ['pull_request', 'merge_group', 'workflow_dispatch']) {
      expect(ci).toContain(`\n  ${event}:\n`)
    }
    // The fast tier waits for the maintainer's switch: without a merge queue
    // a fast-only PR would land without the full gate ever running.
    expect(ci).toContain(
      "fast: ${{ github.event_name == 'pull_request' && vars.CI_MERGE_QUEUE == 'on' }}",
    )
    expect(build).toContain('        default: false')
    expect(build).not.toMatch(/\n {10}ref:/)
    for (const id of ['checks', 'unit']) {
      expect(job(id)).toContain('inputs.fast && \'["ubuntu-latest"]\'')
      expect(job(id)).toContain('["ubuntu-latest","windows-latest","macos-latest"]')
    }
    // Exactly quality:gates without tests and pixels, which have required jobs: a
    // gate added to quality:gates and not to CI fails here. The static gates run
    // in parts (CIFIX017R3): each script quality:gates reaches through run-s
    // runs in exactly one part, none twice and none dropped.
    const scripts: Record<string, string | undefined> = manifest.scripts
    const leaves = (names: readonly string[]): string[] =>
      names.flatMap((name) => {
        const script = scripts[name] ?? ''
        return script.startsWith('run-s ') ? leaves(script.split(' ').slice(1)) : [name]
      })
    const gates = manifest.scripts['quality:gates'].split(' ')
    expect(gates.slice(0, 1)).toEqual(['run-s'])
    expect(gates).toContain('test:unit')
    const parts = Array.from(
      job('checks').matchAll(/\n {12}gates: '([^']+)'\n/g),
      ([, list = '']) => list.split(' '),
    )
    expect(parts).toHaveLength(3)
    expect(leaves(parts.flat()).toSorted((a, b) => a.localeCompare(b))).toEqual(
      leaves(
        gates.slice(1).filter((gate) => gate !== 'test:unit' && gate !== 'check:visual'),
      ).toSorted((a, b) => a.localeCompare(b)),
    )
    expect(job('checks')).toContain('      - run: npx run-s ${{ matrix.part.gates }}\n')
    expect(job('unit')).toContain('npx vitest run\n')
    for (const id of [
      'coverage',
      'accessibility',
      'integration',
      'native-build',
      'linux-native-build',
      'packages',
    ]) {
      expect(job(id)).toContain('if: ${{ !inputs.fast }}')
    }
    // M114 S's visual gate runs on every tier, like the static checks.
    expect(job('visual')).toContain('if: always()')
    expect(job('accessibility')).toContain('runs-on: ubuntu-latest')
    expect(job('accessibility')).toContain('run: npm run test:a11y\n')
    expect(job('accessibility')).toContain('run: npm run test:legal-a11y\n')
    // `npm run quality` runs both accessibility suites CI runs, so the local
    // gate a commit is proposed on never drops one.
    expect(manifest.scripts.quality.split(' ')).toEqual(
      expect.arrayContaining(['run-s', 'quality:gates', 'test:a11y', 'test:legal-a11y']),
    )
    expect(job('integration')).toContain('os: [ubuntu-latest, windows-latest]')
    expect(job('packages')).toContain('name: muse-spark-code-vsix')
    expect(job('packages')).toContain('name: muse-spark-code-acp')
    expect(job('packages')).toContain('name: muse-spark-code-sboms')
  })

  it('carries the whole production dist, not a hand list, to the accessibility job', () => {
    // A hand list drifted once: wire.js gained a lazy chunk the list lacked.
    expect(job('checks')).toContain(
      'path: |\n            dist\n            !dist/vsix-package\n            !dist/meta\n',
    )
    expect(job('checks')).not.toMatch(/^ {12}dist\/[A-Za-z]+\.js$/m)
    expect(job('accessibility')).toContain('name: production-webview\n          path: dist\n')
    expect(read('test/harness/reporting/verify.mjs')).toContain(
      "statSync(path.join(root, 'dist/reportingPanel.js'))",
    )
  })

  it('replays visual pixels only in required shards with the recorded Git source available', () => {
    expect(job('checks')).not.toContain('check:visual')
    expect(job('visual-shards')).toContain('fetch-depth: 0')
    expect(job('visual-shards')).toContain('git fetch --no-tags origin "$revision"')
    expect(job('visual-shards')).toContain('npm run check:visual -- --shard=${{ matrix.shard }}/6')
    expect(job('visual')).toContain('needs: visual-shards')
  })

  it('collects every shard per OS (eight on Windows, six on macOS) and gates merged coverage with unchanged thresholds', () => {
    expect(job('unit')).toContain(
      "shard: ${{ fromJSON(inputs.fast && '[1]' || '[1,2,3,4,5,6,7,8]') }}",
    )
    expect(job('unit')).toContain(
      `exclude: \${{ fromJSON(inputs.fast && '[]' || '[{"os":"ubuntu-latest","shard":5},{"os":"ubuntu-latest","shard":6},{"os":"ubuntu-latest","shard":7},{"os":"ubuntu-latest","shard":8},{"os":"macos-latest","shard":7},{"os":"macos-latest","shard":8}]') }}`,
    )
    expect(job('unit')).toContain(
      "SHARDS: ${{ matrix.os == 'ubuntu-latest' && 4 || matrix.os == 'macos-latest' && 6 || 8 }}",
    )
    expect(job('unit')).toContain('--shard="$SHARD/$SHARDS" --reporter=default --reporter=blob')
    expect(job('unit')).toContain('--outputFile="blob-reports/shard-$SHARD.json"')
    expect(job('coverage')).toContain('os: [ubuntu-latest, windows-latest, macos-latest]')
    expect(job('coverage')).toContain('pattern: coverage-${{ matrix.os }}-*')
    expect(job('coverage')).toContain('merge-multiple: true')
    expect(job('coverage')).toContain(
      "SHARDS: ${{ matrix.os == 'ubuntu-latest' && 4 || matrix.os == 'macos-latest' && 6 || 8 }}",
    )
    expect(job('coverage')).toContain('for shard in $(seq 1 "$SHARDS"); do')
    expect(job('coverage')).toContain('test -s "blob-reports/shard-$shard.json"')
    expect(job('coverage')).toContain('npx vitest run --merge-reports=blob-reports --coverage')
    const config = read('vitest.config.ts')
    expect(config).toContain('statements: 90,\n  branches: 85,\n  functions: 90,\n  lines: 90,')
    expect(config).toContain("arg !== '--shard' && !arg.startsWith('--shard=')")
    expect(config).toContain('...(process.argv.every')
    expect(config).toContain('thresholds: COVERAGE_THRESHOLDS,')
    expect(config).toContain("fileParallelism: process.platform !== 'win32' && !IS_HOSTED_MAC")
    expect(config).toContain(
      "process.platform === 'darwin' && process.env['GITHUB_ACTIONS'] === 'true'",
    )
  })

  it('keeps all required names and wires fail-closed checks for each selected-tier dependency', () => {
    const id = 'required'
    expect(job(id)).toContain('name: ${{ matrix.check }}')
    for (const name of [
      'quality (ubuntu-latest)',
      'quality (windows-latest)',
      'quality (macos-latest)',
      'dictation helper (macos)',
      'package (.vsix)',
    ]) {
      expect(job(id)).toContain(`- ${name}\n`)
    }
    expect(
      /needs:\s+\[([^\]]+)\]/
        .exec(job(id))?.[1]
        ?.split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ).toEqual([
      'checks',
      'visual',
      'unit',
      'coverage',
      'accessibility',
      'integration',
      'native-build',
      'linux-native-build',
      'packages',
      'secrets',
      'sast',
    ])
    expect(job(id)).toContain('if: always()')
    for (const key of ['CHECKS', 'VISUAL', 'UNIT', 'SECRETS', 'SAST']) {
      expect(job(id)).toContain(`          test "$${key}" = success\n`)
    }
    expect(job(id)).toContain('          if [ "$FAST" != true ]; then\n')
    for (const key of [
      'COVERAGE',
      'ACCESSIBILITY',
      'INTEGRATION',
      'HELPER',
      'LINUX_HELPER',
      'PACKAGES',
    ]) {
      expect(job(id)).toContain(`            test "$${key}" = success\n`)
    }
    expect(job(id)).not.toContain('continue-on-error')
    expect(job('secrets')).toContain('name: gitleaks')
    expect(job('sast')).toContain('name: semgrep')
  })

  it('scans a merge group with the checked CLI, since the action refuses that event', () => {
    const secrets = job('secrets')
    expect(secrets).toContain('          fetch-depth: 0\n')
    expect(secrets).toContain(
      "      - uses: gitleaks/gitleaks-action@e0c47f4f8be36e29cdc102c57e68cb5cbf0e8d1e # v3.0.0\n        if: github.event_name != 'merge_group'\n",
    )
    expect(secrets).toContain(
      "      - name: gitleaks (merge group, the history that lands)\n        if: github.event_name == 'merge_group'\n",
    )
    expect(secrets).toContain('          GITLEAKS_VERSION: 8.24.3\n')
    expect(secrets).toContain(
      '          GITLEAKS_SHA256: 9991e0b2903da4c8f6122b5c3186448b927a5da4deef1fe45271c3793f4ee29c\n',
    )
    expect(secrets).toContain('          echo "$GITLEAKS_SHA256  $archive" | sha256sum -c -\n')
    expect(secrets).toContain(
      '          "$RUNNER_TEMP/gitleaks" git --redact --no-banner -v --log-opts=HEAD .\n',
    )
    expect(secrets).not.toContain('continue-on-error')
  })

  const bash = findBash()
  // 24 subshells: about 7.5 s on a loaded Windows host, where each one is a
  // new process; well under a second on Linux.
  const BASH_CASES_TIMEOUT_MS = 60_000
  // The aggregate's own step, run the way GitHub runs a bash step (-e, pipefail)
  // over every way a selected-tier job can end: only all green passes.
  it.runIf(bash !== undefined)(
    'passes a required name only when its whole tier succeeded',
    { timeout: BASH_CASES_TIMEOUT_MS },
    () => {
      const required = job('required')
      // Each step variable and the expression it reads: FAST from the input,
      // the rest from one needed job's result.
      const pairs = Array.from(
        required.matchAll(/^ {10}([A-Z_]+): \$\{\{ (\S+) \}\}$/gm),
        (match) => [match[2] ?? '', match[1] ?? ''] as const,
      )
      const env = new Map(pairs)
      const ids =
        /needs:\s+\[([^\]]+)\]/
          .exec(required)?.[1]
          ?.split(',')
          .map((value) => value.trim())
          .filter(Boolean) ?? []
      const always = ['checks', 'visual', 'unit', 'secrets', 'sast']
      const fullOnly = [
        'coverage',
        'accessibility',
        'integration',
        'native-build',
        'linux-native-build',
        'packages',
      ]
      expect(ids.toSorted(byText)).toEqual([...always, ...fullOnly].toSorted(byText))
      expect(pairs.map(([expression]) => expression).toSorted(byText)).toEqual(
        ['inputs.fast', ...ids.map((id) => `needs.${id}.result`)].toSorted(byText),
      )
      const key = (id: string) => env.get(`needs.${id}.result`) ?? ''
      const lines = required.split('\n')
      const afterRun = lines.slice(lines.indexOf('        run: |') + 1)
      const body: string[] = []
      for (const line of afterRun) {
        if (line !== '' && !line.startsWith(' '.repeat(10))) break
        body.push(line.slice(10))
      }
      const results = (isFast: boolean, overrides: Readonly<Record<string, string>> = {}) => ({
        [env.get('inputs.fast') ?? '']: String(isFast),
        ...Object.fromEntries(
          ids.map((id) => [key(id), isFast && fullOnly.includes(id) ? 'skipped' : 'success']),
        ),
        ...overrides,
      })
      const cases: readonly (readonly [string, Record<string, string>, boolean])[] = [
        ['full tier, every job green', results(false), true],
        ...ids.map(
          (id) => [`full, ${id} failed`, results(false, { [key(id)]: 'failure' }), false] as const,
        ),
        ...fullOnly.map(
          (id) => [`full, ${id} skipped`, results(false, { [key(id)]: 'skipped' }), false] as const,
        ),
        ['full, helper cancelled', results(false, { [key('native-build')]: 'cancelled' }), false],
        ['fast tier, its jobs green, the rest skipped', results(true), true],
        ...always.map(
          (id) => [`fast, ${id} skipped`, results(true, { [key(id)]: 'skipped' }), false] as const,
        ),
        ['fast, semgrep cancelled', results(true, { [key('sast')]: 'cancelled' }), false],
      ]
      // One shell for every case (Windows starts each process slowly); each
      // case runs in its own subshell as a plain statement, so -e applies.
      const wrapper = cases
        .map(([, values]) => {
          const exports = Object.entries(values)
            .map(([name, value]) => `${name}=${value}`)
            .join(' ')
          return `( export ${exports}; set -eo pipefail; eval "$STEP" ) >/dev/null 2>&1; echo "$?"`
        })
        .join('\n')
      const run = spawnSync(bash ?? '', ['--noprofile', '--norc', '-c', wrapper], {
        env: { STEP: body.join('\n') },
        encoding: 'utf8',
        timeout: BASH_CASES_TIMEOUT_MS,
      })
      expect(run.status).toBe(0)
      const codes = run.stdout.trim().split(/\r?\n/)
      expect(cases.map(([label], index) => verdict(label, codes[index] === '0'))).toEqual(
        cases.map(([label, , isPassing]) => verdict(label, isPassing)),
      )
    },
  )
})

describe('toolchain pins (AGENTS.md)', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

  it('keeps Dependabot from proposing TypeScript 7 while typescript-eslint cannot take it', () => {
    // typescript-eslint accepts `>=4.8.4 <6.1.0`; a compiler outside that range
    // silently turns off every type-aware lint rule. The grouped dev-dependency
    // pull request carried TypeScript 7 (PR #61) until this ignore existed.
    expect(manifest.devDependencies.typescript).toMatch(/^6\.0\.\d+$/)
    const dependabot = readFileSync(path.join(root, '.github', 'dependabot.yml'), 'utf8')
    expect(dependabot).toMatch(
      /^ {6}- dependency-name: typescript\n {8}update-types: \['version-update:semver-major'\]$/m,
    )
  })
})

// cmd.exe reads at most 8,191 characters per command line. npm on Windows runs
// a script as `%ComSpec% /d /s /c "<script>"`, and a tool from node_modules/.bin
// is npm's .cmd shim, which re-expands every argument into one line of its own
// (CMD_SHIM_LINE). Measured on Windows 11 (CIFIX017W2): through dpdm's shim in a
// 51-character .bin folder, an 8,035-character script ran and 8,036 failed
// with "The syntax of the command is incorrect." (exit 255), as the 8,070-
// character `cycles` script did on the hosted runner. Each path in those lines
// may be up to MAX_PATH long, wherever the repository is checked out.
const CMD_LINE_MAX = 8191
const MAX_PATH = 260
const CMD_SHIM_LINE = String.raw`endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\..\%tool%" %*`

describe('npm scripts on Windows (CIFIX017W2)', () => {
  it('fit cmd.exe’s command line as npm runs them and as a node_modules/.bin shim expands them', () => {
    const longestPath = 'p'.repeat(MAX_PATH)
    const lines = (script: string) => [
      `${longestPath} /d /s /c "${script}"`,
      CMD_SHIM_LINE.replaceAll(/%(?:COMSPEC|_prog|dp0|tool)%/g, () => longestPath).replace(
        '%*',
        () => script,
      ),
    ]
    const tooLong = Object.entries(manifest.scripts).filter(([, script]) =>
      lines(script).some((line) => line.length > CMD_LINE_MAX),
    )
    expect(tooLong.map(([name, script]) => `${name}: ${String(script.length)}`)).toEqual([])
  })
})
