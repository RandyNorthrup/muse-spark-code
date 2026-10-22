// Runs inside the Extension Development Host (see .vscode-test.mjs).

import * as assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as vscode from 'vscode'
import { loadGitApi, repositoryAt } from '../../src/host/git/gitExtension'
import { processGitRunner } from '../../src/host/git'
import { readSettings } from '../../src/host/settings'
import type { Logger } from '../../src/host/logger'
import { planMarkdownLoader } from '../../src/host/planMarkdownBundle'
import {
  CHAT_PANEL_VIEW_TYPE,
  CHAT_VIEW_ID,
  COMMAND_IDS,
  EXTENSION_QUALIFIED_ID,
  PLAN_MARKDOWN_BUNDLE_FILE,
  SETTING_DEFAULTS,
  SETTINGS_SECTION,
} from '../../src/shared/constants'
import { removeFolder } from '../unit/helpers/temporaryFolders'

const TAB_WAIT_TIMEOUT_MS = 5000
// test/fixtures/workspace/.vscode/settings.json sets this window-scoped key
// and two machine-scoped ones (PLAN.md D15).
const FIXTURE_OVERRIDE = 'hideOnboarding'
const RULES_HEADER = 'Muse Code reads this file as project rules when it runs in this directory.'
const TAB_POLL_INTERVAL_MS = 50
// The measured panel-focus steal landed 0.4 to 0.8 s late; the watch outlasts it.
const FOCUS_WATCH_MS = 3000

async function waitForDocument(target: vscode.Uri): Promise<void> {
  const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
  while (
    vscode.window.activeTextEditor?.document.uri.toString() !== target.toString() &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
  }
  assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, target.fsPath)
}

// Tab groups update asynchronously after a webview panel is created, so a
// direct read right after executeCommand races the UI.
function describeTab(tab: vscode.Tab): string {
  // A label alone cannot name the F74 thief: every chat panel is labelled
  // 'Untitled', same as an untitled document. The kind tells them apart.
  const { input, label } = tab
  if (input instanceof vscode.TabInputWebview) {
    const kind = `webview:${input.viewType}`
    return `${label}(${kind})`
  }
  if (input instanceof vscode.TabInputText) {
    const kind = `text:${input.uri.fsPath}`
    return `${label}(${kind})`
  }
  return `${label}(other)`
}

async function waitForTab(isMatch: (tab: vscode.Tab) => boolean): Promise<vscode.Tab> {
  const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
  while (Date.now() < deadline) {
    const tab = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .find((candidate) => isMatch(candidate))
    if (tab !== undefined) {
      return tab
    }
    await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
  }
  const open = vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.map((tab) => describeTab(tab)),
  )
  throw new Error(
    `no matching tab appeared within ${String(TAB_WAIT_TIMEOUT_MS)} ms; open: ${open.join(', ')}; active editor: ${activeTextEditorFsPath() ?? 'none'}`,
  )
}

// Read fresh on every poll: an earlier assert's narrowing of the editor
// chain does not survive the awaits between polls, so the read lives in its
// own function where the optional chain is genuinely needed.
function activeTextEditorFsPath(): string | undefined {
  return vscode.window.activeTextEditor?.document.uri.fsPath
}

// The active tab's file, when the active tab is a text file: same fresh-read
// reason as above, for the tab group instead of the editor.
function activeTextTabFsPath(): string | undefined {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab
  return activeTab?.input instanceof vscode.TabInputText ? activeTab.input.uri.fsPath : undefined
}

suite('activation', () => {
  let chatPanel: vscode.WebviewPanel | undefined
  let isChatDisposed = false
  const isArduino = () =>
    vscode.extensions.getExtension('dankeboy36.vscode-arduino-api') !== undefined

  test('the extension is installed and activates', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
    await extension.activate()
    assert.equal(extension.isActive, true)
  })

  test('registers its commands and the chat view focus command', async () => {
    const commands = await vscode.commands.getCommands(true)
    for (const id of Object.values(COMMAND_IDS)) {
      assert.ok(commands.includes(id), `missing command ${id}`)
    }
    assert.ok(commands.includes(`${CHAT_VIEW_ID}.focus`), 'chat view focus command missing')
  })

  test('exposes every setting with its documented default', () => {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    // The fixture workspace overrides one window-scoped setting (next test).
    const defaults = Object.entries(SETTING_DEFAULTS).filter(([key]) => key !== FIXTURE_OVERRIDE)
    for (const [key, value] of defaults) {
      assert.deepEqual(configuration.inspect(key)?.defaultValue, value, `default for ${key}`)
    }
  })

  test('opens an Untitled chat panel in a new tab', async () => {
    chatPanel = await vscode.commands.executeCommand<vscode.WebviewPanel>(COMMAND_IDS.openInNewTab)
    assert.ok(chatPanel, 'the command returned the created panel')
    chatPanel.onDidDispose(() => {
      isChatDisposed = true
    })
    if (isArduino()) {
      // This host omits webviews from tabGroups. Its panel lifecycle is the
      // native API that can prove creation, visibility and in-place reuse.
      assert.equal(chatPanel.viewType, CHAT_PANEL_VIEW_TYPE)
      assert.equal(chatPanel.title, 'Untitled')
      assert.equal(chatPanel.visible, true)
      return
    }
    const tab = await waitForTab(
      (candidate) =>
        candidate.input instanceof vscode.TabInputWebview &&
        candidate.input.viewType.includes(CHAT_PANEL_VIEW_TYPE),
    )
    assert.equal(tab.label, 'Untitled')
  })

  test('the keybinding commands run and toggleFocusView flips the setting', async () => {
    await vscode.commands.executeCommand(COMMAND_IDS.focusInput)
    await vscode.commands.executeCommand(COMMAND_IDS.insertMentionReference)
    await vscode.commands.executeCommand(COMMAND_IDS.toggleFocusView)
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    assert.equal(configuration.get('focusView'), true)
    await configuration.update('focusView', undefined, vscode.ConfigurationTarget.Global)
  })

  test('a workspace cannot set the machine-scoped settings but sets the others (D15)', () => {
    const configuration = vscode.workspace.getConfiguration(SETTINGS_SECTION)
    const log: Logger = {
      trace: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    }
    const settings = readSettings(configuration, log)
    assert.equal(settings.allowDangerouslySkipPermissions, false)
    assert.equal(
      settings.museBinaryPath,
      configuration.inspect('museBinaryPath')?.globalValue ?? '',
    )
    assert.equal(configuration.inspect(FIXTURE_OVERRIDE)?.workspaceValue, true)
    assert.equal(configuration.get(FIXTURE_OVERRIDE), true)
  })

  test('creates AGENTS.md in the workspace root and opens it (D15)', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'no workspace folder')
    const target = vscode.Uri.joinPath(folder.uri, 'AGENTS.md')
    try {
      await vscode.commands.executeCommand(COMMAND_IDS.createRulesFile)
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(target))
      assert.ok(text.startsWith('# AGENTS.md'), text.slice(0, 40))
      assert.ok(text.includes(RULES_HEADER), 'header line missing')
      // Observe the actual editor snapshot, including hosts without tab-group text entries.
      await waitForDocument(target)
      assert.equal(vscode.window.activeTextEditor?.document.uri.fsPath, target.fsPath)
      // A chat panel finishing loading behind the new file must not take the
      // keyboard back: the measured steal landed 0.4 to 0.8 s after
      // showTextDocument resolved, so AGENTS.md stays the active editor and
      // the active tab for 3 s of polling.
      const watchUntil = Date.now() + FOCUS_WATCH_MS
      while (Date.now() < watchUntil) {
        assert.equal(
          activeTextEditorFsPath(),
          target.fsPath,
          'the chat panel took the keyboard from the file just opened',
        )
        assert.equal(
          activeTextTabFsPath(),
          target.fsPath,
          'the chat panel took the active tab from the file just opened',
        )
        await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
      }
    } finally {
      const tabs = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === target.toString(),
        )
      if (tabs.length > 0) {
        await vscode.window.tabGroups.close(tabs, true)
      } else {
        const editor = vscode.window.visibleTextEditors.find(
          (shown) => shown.document.uri.toString() === target.toString(),
        )
        assert.ok(editor, 'the owned AGENTS.md editor is still visible')
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- Missing tab identities require the same exact-editor close API as the M103A2 production adapter; never close a focused chat panel.
        editor.hide()
        const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
        while (vscode.window.visibleTextEditors.includes(editor) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
        }
        assert.equal(vscode.window.visibleTextEditors.includes(editor), false)
      }
      await vscode.workspace.fs.delete(target)
    }
  })

  test('Focus Input from a file brings the chat panel forward (panel-focus)', async () => {
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'no workspace folder')
    const target = vscode.Uri.joinPath(folder.uri, 'AGENTS.md')
    const isChatTab = (tab: vscode.Tab | undefined) =>
      tab?.input instanceof vscode.TabInputWebview &&
      tab.input.viewType.includes(CHAT_PANEL_VIEW_TYPE)
    try {
      // This case owns its panel, so an earlier case's cleanup cannot leave
      // Focus Input with no surface and no tab to bring forward.
      await vscode.commands.executeCommand(COMMAND_IDS.openInNewTab)
      await waitForTab(isChatTab)
      await vscode.commands.executeCommand(COMMAND_IDS.createRulesFile)
      await waitForTab(
        (tab) =>
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.fsPath === target.fsPath &&
          vscode.window.activeTextEditor?.document.uri.fsPath === target.fsPath,
      )
      // The person acting on the chat: Focus Input moves the keyboard there,
      // and the composer's owned request lands because the panel is active.
      await vscode.commands.executeCommand(COMMAND_IDS.focusInput)
      const deadline = Date.now() + TAB_WAIT_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (isChatTab(vscode.window.tabGroups.activeTabGroup.activeTab)) {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
      }
      assert.ok(
        isChatTab(vscode.window.tabGroups.activeTabGroup.activeTab),
        'Focus Input did not bring the chat panel forward',
      )
      // Input ownership, not just panel visibility: the composer's landing
      // effect focuses the textarea, the webview reports it back, and the
      // next Focus Input — a toggle — hands the keyboard to the file. A panel
      // that merely revealed, without the composer ever taking focus, would
      // re-post focusInput here instead, and the file would never go active.
      // A waitForTab red in this file names every open tab's kind through
      // describeTab, so the next F74 names its thief instead of 'Untitled'.
      const toggleDeadline = Date.now() + TAB_WAIT_TIMEOUT_MS
      let hasEditorBack = false
      while (Date.now() < toggleDeadline) {
        await vscode.commands.executeCommand(COMMAND_IDS.focusInput)
        await new Promise((resolve) => setTimeout(resolve, TAB_POLL_INTERVAL_MS))
        if (activeTextEditorFsPath() === target.fsPath) {
          hasEditorBack = true
          break
        }
      }
      assert.ok(hasEditorBack, 'Focus Input did not hand the keyboard back to the file')
    } finally {
      // Close the file tab wherever it is; the chat panels stay for the
      // later cases that count them.
      const textTab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            tab.input instanceof vscode.TabInputText && tab.input.uri.fsPath === target.fsPath,
        )
      if (textTab !== undefined) {
        await vscode.window.tabGroups.close(textTab)
      }
      await vscode.workspace.fs.delete(target)
    }
  })

  test('New Conversation clears the active surface in place (D15)', async () => {
    const webviewTabs = () =>
      vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .filter((tab) => tab.input instanceof vscode.TabInputWebview).length
    if (isArduino()) {
      assert.ok(chatPanel, 'a chat panel from the earlier test is open')
      assert.equal(isChatDisposed, false)
      await vscode.commands.executeCommand(COMMAND_IDS.newConversation)
      assert.equal(isChatDisposed, false)
      assert.equal(chatPanel.visible, true)
      assert.equal(chatPanel.title, 'Untitled')
      return
    }
    const before = webviewTabs()
    assert.ok(before > 0, 'a chat panel from the earlier test is open')
    await vscode.commands.executeCommand(COMMAND_IDS.newConversation)
    assert.equal(webviewTabs(), before)
  })

  test('runs Retry Plugin Hooks in a live window, with no plugin configured (M91b)', async () => {
    // AGENTS rule 10: the README's command runs here, not only in unit tests.
    // It forgets a failed Windows job preparation and says so; with nothing
    // to forget it still resolves, on every platform.
    await vscode.commands.executeCommand(COMMAND_IDS.retryPluginHooks)
    const commands = await vscode.commands.getCommands(true)
    assert.ok(commands.includes(COMMAND_IDS.retryPluginHooks))
  })

  test('opens the walkthrough (D15)', async () => {
    await vscode.commands.executeCommand(COMMAND_IDS.openWalkthrough)
    // The walkthrough opens in VS Code's Welcome editor.
    await waitForTab(
      (candidate) => candidate.label === 'Welcome' || candidate.label.includes('Muse Spark'),
    )
  })
})

// M71: the part of VS Code's git extension API the extension types and
// calls, against the real one in this VS Code (the floor version and the
// latest): commit with `all` and no post-commit command, and a plain,
// three-argument push that makes a branch on a local bare remote.
suite('VS Code git extension API (M71)', () => {
  test('commits and pushes through the members the extension calls', async () => {
    // Inside the workspace, as the extension's repository always is: VS Code
    // 1.99 to at least 1.104 open no repository through the API outside the
    // workspace folders unless `git.openRepositoryInParentFolders` is "always".
    const folder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(folder, 'the integration tests open a workspace folder')
    const base = await mkdtemp(path.join(folder.uri.fsPath, 'muse-m71-git-'))
    const runGit = processGitRunner()
    try {
      const remote = path.join(base, 'remote.git')
      const work = path.join(base, 'work')
      await runGit(['init', '--bare', '-q', remote], base)
      await runGit(['init', '-q', '-b', 'main', work], base)
      await runGit(['config', 'user.email', 'test@example.invalid'], work)
      await runGit(['config', 'user.name', 'Muse Spark test'], work)
      await runGit(['remote', 'add', 'origin', remote], work)
      await writeFile(path.join(work, 'a.txt'), 'one\n')
      const repository = await repositoryAt(await loadGitApi(), work)
      await repository.status()
      // `git.untrackedChanges` decides which group a new file is in ("mixed" by default).
      const { state } = repository
      assert.equal(state.workingTreeChanges.length + state.untrackedChanges.length, 1)
      await repository.commit('Add a.txt', { all: true, postCommitCommand: null })
      await repository.status()
      assert.equal(repository.state.HEAD?.name, 'main')
      await repository.push('origin', 'main', true)
      const pushed = await runGit(['log', '--format=%s', 'main'], remote)
      assert.equal(pushed.trim(), 'Add a.txt')
      await repository.status()
      assert.equal(repository.state.HEAD.upstream?.remote, 'origin')
      const log = await repository.log({ range: 'origin/main..HEAD' })
      assert.deepEqual(log, [])
    } finally {
      await removeFolder(base)
    }
  })
})

// The plan reader (M79, PLAN.md D6) is dist/planMarkdown.js beside
// dist/extension.js, loaded on the first plan action; this loads it from the
// installed extension, as activate's loader does, and reads a plan with it.
suite('the plan reader bundle', () => {
  test('loads from the installed extension and finds text the panel hides', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_QUALIFIED_ID)
    assert.ok(extension, `extension ${EXTENSION_QUALIFIED_ID} not found`)
    const errors: string[] = []
    const reader = planMarkdownLoader({
      bundlePath: vscode.Uri.joinPath(extension.extensionUri, 'dist', PLAN_MARKDOWN_BUNDLE_FILE)
        .fsPath,
      log: {
        trace: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: (message) => {
          errors.push(message)
        },
      },
    })
    assert.equal(reader().hasRawHtml('1. Do it.\n\n```js`\n<!-- hidden -->\n```'), true)
    assert.deepEqual(reader().listItems('1. One.\n2. Two.'), ['One.', 'Two.'])
    assert.deepEqual(errors, [])
  })
})
