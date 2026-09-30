// The editor's side of the verify loop (M68): the language servers' reports
// on edited files once they settle, the tabs it opens and closes, the one
// queue every caller shares, the diagnostics tool's file, and format on
// edit, over the `vscode` mock. The real API is exercised by the integration
// test inside VS Code.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import {
  commands,
  diagnosticsChanged,
  EndOfLine,
  FakeUri,
  languages,
  TabInputText,
  Uri,
  ViewColumn,
  window,
  workspace,
} from './mocks/vscode'
import { createVerifyEditor, type VerifyEditor } from '../../src/host/editor/verifyEditor'
import { fingerprint } from '../../src/core/verify/fingerprint'
import { FakeLogOutputChannel } from './helpers/fakes'
import { logLines } from './helpers/logText'
import { createLogger } from '../../src/host/logger'

const shownDocument = window.showTextDocument

const ROOT = '/ws'
const FILE = { relative: 'src/a.ts', absolute: '/ws/src/a.ts' }
const OTHER = { relative: 'src/b.ts', absolute: '/ws/src/b.ts' }
const SETTLE = { firstMs: 60, quietMs: 25, maxMs: 400 }
const FORMAT = { syncMs: 60, pollMs: 5, formatMs: 60 }
const EDITOR_SETTINGS: Readonly<Record<string, unknown>> = { tabSize: 2, insertSpaces: true }
const BESIDE_COLUMN = 2
const USER_COLUMN = 1

interface DocumentState {
  text: string
  isDirty?: boolean
  eol?: (typeof EndOfLine)[keyof typeof EndOfLine]
}

/** The offset of a position in `text`, counting each line break's characters. */
function offsetOf(text: string, position: { line: number; character: number }): number {
  let offset = 0
  for (let line = 0; line < position.line; line += 1) {
    offset = text.indexOf('\n', offset) + 1
  }
  return offset + position.character
}

function fakeDocument(
  state: DocumentState,
  uri: vscode.Uri = Uri.file('/doc'),
): vscode.TextDocument {
  const document = {
    uri,
    get isDirty() {
      return state.isDirty ?? false
    },
    get eol() {
      return state.eol ?? EndOfLine.LF
    },
    getText: () => state.text,
    offsetAt: (position: vscode.Position) => offsetOf(state.text, position),
  }
  // Only what the verify editor reads of a document; nothing else is touched.
  return document as unknown as vscode.TextDocument
}

function fakeEditor(uri: vscode.Uri): vscode.TextEditor {
  // An editor showing a document: all the verify editor reads of one.
  return { document: { uri } } as unknown as vscode.TextEditor
}

function diagnostic(
  severity: number,
  line: number,
  character: number,
  message: string,
): vscode.Diagnostic {
  // The fields the verify editor maps; a real Diagnostic has these and more.
  return {
    severity,
    range: { start: { line, character } },
    message,
    source: 'ts',
  } as unknown as vscode.Diagnostic
}

function textEdit(
  start: [number, number],
  end: [number, number],
  newText: string,
): vscode.TextEdit {
  // A formatter's edit as the command returns it: a range and the new text.
  return {
    range: {
      start: { line: start[0], character: start[1] },
      end: { line: end[0], character: end[1] },
    },
    newText,
  } as unknown as vscode.TextEdit
}

/** The editor groups and their tabs, as the tab API reports them. */
const groups = new Map<number, vscode.Tab[]>()

function addTab(column: number, path: string, isDirty = false): vscode.Tab {
  const tabs = groups.get(column) ?? []
  groups.set(column, tabs)
  const group: vscode.TabGroup = {
    isActive: false,
    activeTab: undefined,
    viewColumn: column,
    tabs,
  }
  const tab: vscode.Tab = {
    label: path,
    group,
    input: new TabInputText(Uri.file(path)),
    isActive: true,
    isDirty,
    isPinned: false,
    isPreview: false,
  }
  tabs.push(tab)
  window.tabGroups.all = Array.from(groups.values(), (groupTabs) => groupTabs[0]?.group ?? group)
  return tab
}

function tabPaths(tabs: readonly vscode.Tab[]): readonly string[] {
  return tabs.map((tab) => (tab.input instanceof TabInputText ? tab.input.uri.fsPath : '?'))
}

/** Every editor a test made, disposed after it (each listens for reports). */
const made: VerifyEditor[] = []

function editor(options: { platform?: NodeJS.Platform; links?: Record<string, string> } = {}): {
  verify: VerifyEditor
  channel: FakeLogOutputChannel
} {
  const channel = new FakeLogOutputChannel()
  const verify = createVerifyEditor({
    platform: options.platform ?? 'linux',
    log: createLogger(channel),
    workspaceRoot: ROOT,
    realPath: (absolutePath) => Promise.resolve(options.links?.[absolutePath] ?? absolutePath),
    settle: SETTLE,
    format: FORMAT,
  })
  made.push(verify)
  return { verify, channel }
}

/** Records which files are opened, holding FILE's open until `held` resolves. */
function holdFirstFile(): {
  readonly order: string[]
  readonly held: PromiseWithResolvers<undefined>
} {
  const order: string[] = []
  const held = Promise.withResolvers<undefined>()
  vi.mocked(workspace.openTextDocument).mockImplementation(async (uri) => {
    order.push(uri.fsPath)
    if (uri.fsPath === FILE.absolute) {
      await held.promise
    }
    return fakeDocument({ text: '' }, uri)
  })
  return { order, held }
}

function report(...paths: readonly string[]): void {
  diagnosticsChanged.fire({ uris: paths.map((path) => Uri.file(path)) })
}

beforeEach(() => {
  groups.clear()
  window.tabGroups.all = []
  vi.mocked(workspace.openTextDocument).mockImplementation((uri) =>
    Promise.resolve(fakeDocument({ text: uri.fsPath }, uri)),
  )
  // The one method the verify editor reads of a configuration.
  vi.mocked(workspace.getConfiguration).mockReturnValue({
    get: (key: string) => EDITOR_SETTINGS[key],
  } as unknown as vscode.WorkspaceConfiguration)
  vi.mocked(languages.getDiagnostics).mockReturnValue([])
  // Showing a document beside opens a tab in the second group.
  vi.mocked(shownDocument).mockImplementation((uri: vscode.Uri | vscode.TextDocument) => {
    const target = 'fsPath' in uri ? uri : uri.uri
    addTab(BESIDE_COLUMN, target.fsPath)
    return Promise.resolve(fakeEditor(target))
  })
  vi.mocked(window.tabGroups.close).mockImplementation((tabs) => {
    for (const tab of tabs) {
      const list = groups.get(tab.group.viewColumn) ?? []
      list.splice(list.indexOf(tab), 1)
    }
    return Promise.resolve(true)
  })
  window.visibleTextEditors = []
})

afterEach(() => {
  for (const verify of made.splice(0)) {
    verify.dispose()
  }
  vi.mocked(workspace.fs.stat).mockReset()
  vi.mocked(workspace.fs.readFile).mockReset()
  vi.mocked(workspace.openTextDocument).mockReset()
  vi.mocked(commands.executeCommand).mockReset()
  vi.mocked(languages.getDiagnostics).mockReset()
  vi.mocked(shownDocument).mockReset()
  vi.mocked(window.tabGroups.close).mockReset()
})

describe('diagnosticsAfterEdit', () => {
  it('shows each file beside as a tab of its own, reads it once settled, and closes the tabs', async () => {
    const { verify } = editor()
    vi.mocked(languages.getDiagnostics).mockReturnValue([
      [Uri.file(FILE.absolute), [diagnostic(0, 2, 4, 'bad'), diagnostic(1, 0, 0, 'unused')]],
      [Uri.file('/ws/elsewhere.ts'), [diagnostic(0, 0, 0, 'not ours')]],
    ])
    const pending = verify.diagnosticsAfterEdit([FILE, OTHER], new AbortController().signal)
    setTimeout(() => {
      report(FILE.absolute)
    }, 10)
    const files = await pending
    // Each beside the user's editor, never a preview (which would replace
    // the user's own), without taking focus.
    expect(
      vi.mocked(shownDocument).mock.calls.map(([uri, options]) => [uri.fsPath, options]),
    ).toEqual([
      [FILE.absolute, { viewColumn: ViewColumn.Beside, preview: false, preserveFocus: true }],
      [OTHER.absolute, { viewColumn: ViewColumn.Beside, preview: false, preserveFocus: true }],
    ])
    expect(files).toEqual([
      {
        file: FILE,
        entries: [
          { path: 'src/a.ts', severity: 'error', line: 3, column: 5, message: 'bad', source: 'ts' },
          {
            path: 'src/a.ts',
            severity: 'warning',
            line: 1,
            column: 1,
            message: 'unused',
            source: 'ts',
          },
        ],
      },
      // No report arrived: not checked, never clean.
      { file: OTHER, entries: [], unchecked: 'noReport' },
    ])
    const [closed, preserveFocus] = vi.mocked(window.tabGroups.close).mock.calls[0] ?? []
    expect(tabPaths(closed ?? [])).toEqual([FILE.absolute, OTHER.absolute])
    expect(preserveFocus).toBe(true)
    expect(groups.get(BESIDE_COLUMN)).toEqual([])
  })

  it('starts its timers once the file is shown, so a slow show is not "no report"', async () => {
    const { verify } = editor()
    vi.mocked(shownDocument).mockImplementation((uri: vscode.Uri | vscode.TextDocument) => {
      const target = 'fsPath' in uri ? uri : uri.uri
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(fakeEditor(target))
        }, SETTLE.firstMs * 2)
      })
    })
    const pending = verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    setTimeout(
      () => {
        report(FILE.absolute)
      },
      SETTLE.firstMs * 2 + 10,
    )
    const [result] = await pending
    expect(result?.unchecked).toBeUndefined()
  })

  it('keeps a report that came while the file was being shown', async () => {
    const { verify } = editor()
    vi.mocked(shownDocument).mockImplementation((uri: vscode.Uri | vscode.TextDocument) => {
      const target = 'fsPath' in uri ? uri : uri.uri
      report(FILE.absolute)
      return Promise.resolve(fakeEditor(target))
    })
    const started = Date.now()
    const [result] = await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    expect(result?.unchecked).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(SETTLE.firstMs)
  })

  it('reads a file whose reports keep coming at the cap, ignoring other files’ reports', async () => {
    const { verify } = editor()
    const chatter = setInterval(() => {
      report(FILE.absolute)
    }, 5)
    const started = Date.now()
    let result: readonly unknown[]
    try {
      result = await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    } finally {
      clearInterval(chatter)
    }
    expect(Date.now() - started).toBeGreaterThanOrEqual(SETTLE.maxMs - 5)
    expect(result).toEqual([{ file: FILE, entries: [] }])
    const lonely = verify.diagnosticsAfterEdit([OTHER], new AbortController().signal)
    report('/ws/unrelated.ts')
    expect(await lonely).toEqual([{ file: OTHER, entries: [], unchecked: 'noReport' }])
  })

  it('honours a stop: at once, and for every file left', async () => {
    const { verify } = editor()
    const before = new AbortController()
    before.abort()
    expect(await verify.diagnosticsAfterEdit([FILE, OTHER], before.signal)).toEqual([
      { file: FILE, entries: [], unchecked: 'stopped' },
      { file: OTHER, entries: [], unchecked: 'stopped' },
    ])
    expect(shownDocument).not.toHaveBeenCalled()
    const during = new AbortController()
    const started = Date.now()
    const pending = verify.diagnosticsAfterEdit([FILE, OTHER], during.signal)
    setTimeout(() => {
      during.abort()
    }, 5)
    expect(await pending).toEqual([
      { file: FILE, entries: [], unchecked: 'stopped' },
      { file: OTHER, entries: [], unchecked: 'stopped' },
    ])
    expect(Date.now() - started).toBeLessThan(SETTLE.firstMs)
    expect(vi.mocked(shownDocument).mock.calls.map(([uri]) => uri.fsPath)).toEqual([FILE.absolute])
  })

  it('runs one caller at a time: a second waits for the first', async () => {
    const { verify } = editor()
    const { order, held } = holdFirstFile()
    const first = verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    const second = verify.diagnosticsAfterEdit([OTHER], new AbortController().signal)
    await vi.waitFor(() => {
      expect(order).toEqual([FILE.absolute])
    })
    // A while later the second still waits: the first is not done.
    await new Promise((resolve) => setTimeout(resolve, SETTLE.firstMs * 2))
    expect(order).toEqual([FILE.absolute])
    held.resolve(undefined)
    await Promise.all([first, second])
    expect(order).toEqual([FILE.absolute, OTHER.absolute])
  })

  // The Codex review of PR #54: a caller that stops while it waits its turn leaves at once.
  it('lets a waiting caller stop at once, and the next still waits for the first', async () => {
    const { verify } = editor()
    const { order, held } = holdFirstFile()
    const first = verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    const gone = new AbortController()
    const waiting = verify.diagnosticsAfterEdit([OTHER], gone.signal)
    const tool = new AbortController()
    const waitingTool = verify.settleFile(OTHER.absolute, tool.signal)
    const third = verify.diagnosticsAfterEdit([OTHER], new AbortController().signal)
    await vi.waitFor(() => {
      expect(order).toEqual([FILE.absolute])
    })
    gone.abort()
    tool.abort()
    expect(await waiting).toEqual([{ file: OTHER, entries: [], unchecked: 'stopped' }])
    expect(await waitingTool).toBeUndefined()
    // A while later the first still runs, and the third has not started.
    await new Promise((resolve) => setTimeout(resolve, SETTLE.firstMs))
    expect(order).toEqual([FILE.absolute])
    held.resolve(undefined)
    await Promise.all([first, third])
    expect(order).toEqual([FILE.absolute, OTHER.absolute])
  })

  // The Codex review of PR #54: a file an editor already shows may be
  // reported on before the check starts, and showing it brings no new report.
  it('reads an already shown file its server reported on since the write', async () => {
    const { verify } = editor()
    window.visibleTextEditors = [fakeEditor(Uri.file(FILE.absolute))]
    vi.mocked(workspace.fs.stat).mockResolvedValue({
      type: 1,
      ctime: 0,
      mtime: Date.now() - 1000,
      size: 1,
    })
    vi.mocked(languages.getDiagnostics).mockReturnValue([
      [Uri.file(FILE.absolute), [diagnostic(0, 0, 0, 'reported before the check')]],
    ])
    report(FILE.absolute)
    const started = Date.now()
    const [only] = await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    expect(only?.entries.map((entry) => entry.message)).toEqual(['reported before the check'])
    expect(Date.now() - started).toBeLessThan(SETTLE.firstMs)
    // A report older than the write does not count.
    vi.mocked(workspace.fs.stat).mockResolvedValue({
      type: 1,
      ctime: 0,
      mtime: Date.now() + 60_000,
      size: 1,
    })
    const [stale] = await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    expect(stale?.unchecked).toBe('noReport')
  })

  it('reads an already shown file that holds what is on disk when no new report comes', async () => {
    const { verify } = editor()
    window.visibleTextEditors = [fakeEditor(Uri.file(FILE.absolute))]
    const written = 'const a = 2\n'
    let shownText = written
    vi.mocked(workspace.openTextDocument).mockImplementation((uri) =>
      Promise.resolve(fakeDocument({ text: shownText }, uri)),
    )
    vi.mocked(workspace.fs.readFile).mockResolvedValue(new TextEncoder().encode(written))
    vi.mocked(languages.getDiagnostics).mockReturnValue([
      [Uri.file(FILE.absolute), [diagnostic(1, 0, 0, 'held for this text')]],
    ])
    const [same] = await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    expect(same?.entries.map((entry) => entry.message)).toEqual(['held for this text'])
    // The editor still shows older text: what it holds is not about the write.
    shownText = 'const a = 1\n'
    const [older] = await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    expect(older?.unchecked).toBe('noReport')
  })

  it('matches files case-insensitively on Windows, and leaves a shown file as it is', async () => {
    const { verify } = editor({ platform: 'win32' })
    window.visibleTextEditors = [fakeEditor(Uri.file('/WS/Src/a.ts'))]
    vi.mocked(languages.getDiagnostics).mockReturnValue([
      [Uri.file('/WS/SRC/A.TS'), [diagnostic(0, 0, 0, 'bad')]],
    ])
    const pending = verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    // A report counts from the moment the check starts, a tick after the call.
    setTimeout(() => {
      report('/WS/src/A.ts')
    }, 5)
    const [only] = await pending
    expect(only?.entries.map((entry) => entry.message)).toEqual(['bad'])
    expect(shownDocument).not.toHaveBeenCalled()
    expect(window.tabGroups.close).not.toHaveBeenCalled()
  })

  it('closes only the tabs it opened, and none the user has since changed', async () => {
    const { verify } = editor()
    const users = addTab(USER_COLUMN, FILE.absolute)
    vi.mocked(shownDocument).mockImplementation((uri: vscode.Uri | vscode.TextDocument) => {
      const target = 'fsPath' in uri ? uri : uri.uri
      // The user types into the tab the loop opened for OTHER.
      addTab(BESIDE_COLUMN, target.fsPath, target.fsPath === OTHER.absolute)
      return Promise.resolve(fakeEditor(target))
    })
    await verify.diagnosticsAfterEdit([FILE, OTHER], new AbortController().signal)
    const [closed] = vi.mocked(window.tabGroups.close).mock.calls[0] ?? []
    expect(tabPaths(closed ?? [])).toEqual([FILE.absolute])
    expect(closed?.[0]?.group.viewColumn).toBe(BESIDE_COLUMN)
    expect(groups.get(USER_COLUMN)).toEqual([users])
  })

  it('does not read a file with unsaved changes, nor one it cannot open or show', async () => {
    const { verify, channel } = editor()
    const THIRD = { relative: 'src/c.ts', absolute: '/ws/src/c.ts' }
    vi.mocked(workspace.openTextDocument).mockImplementation((uri) =>
      uri.fsPath === FILE.absolute
        ? Promise.reject(new Error('too large'))
        : Promise.resolve(fakeDocument({ text: '', isDirty: uri.fsPath === THIRD.absolute }, uri)),
    )
    vi.mocked(shownDocument).mockRejectedValueOnce(new Error('no editor group'))
    const started = Date.now()
    const files = await verify.diagnosticsAfterEdit(
      [FILE, OTHER, THIRD],
      new AbortController().signal,
    )
    expect(Date.now() - started).toBeLessThan(SETTLE.firstMs)
    expect(files.map((result) => result.unchecked)).toEqual(['notShown', 'notShown', 'unsaved'])
    const logged = logLines(channel).join('\n')
    expect(logged).toContain('Verify: src/a.ts could not be opened for diagnostics: too large')
    expect(logged).toContain('Verify: src/b.ts could not be shown for diagnostics: no editor group')
  })

  it('logs tabs that could not be closed', async () => {
    const { verify, channel } = editor()
    vi.mocked(window.tabGroups.close).mockRejectedValueOnce(new Error('busy'))
    await verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    expect(logLines(channel).join('\n')).toContain(
      'Verify: the files shown for diagnostics could not be closed: busy',
    )
  })
})

/** What the file holds on disk at each next read, in turn. */
function onDisk(...texts: readonly string[]): void {
  for (const text of texts) {
    vi.mocked(workspace.fs.readFile).mockResolvedValueOnce(new TextEncoder().encode(text))
  }
}

// The Codex review of PR #54: the file is checked just before each act on it.
describe('the file as the edit left it', () => {
  const EDITED = { ...FILE, fingerprint: fingerprint('const a = 2\n') }

  it('never opens a file that no longer holds what the edit left, or is not where it was', async () => {
    const { verify } = editor({ links: { [FILE.absolute]: '/elsewhere/a.ts' } })
    expect(await verify.diagnosticsAfterEdit([EDITED], new AbortController().signal)).toEqual([
      { file: EDITED, entries: [], unchecked: 'changed' },
    ])
    const plain = editor().verify
    onDisk('someone else')
    expect(await plain.diagnosticsAfterEdit([EDITED], new AbortController().signal)).toEqual([
      { file: EDITED, entries: [], unchecked: 'changed' },
    ])
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
  })

  it('reads a file only while it still holds what the edit left', async () => {
    const { verify } = editor()
    vi.mocked(languages.getDiagnostics).mockReturnValue([
      [Uri.file(FILE.absolute), [diagnostic(0, 0, 0, 'about the new text')]],
    ])
    onDisk('const a = 2\n', 'const a = 3\n')
    const pending = verify.diagnosticsAfterEdit([EDITED], new AbortController().signal)
    setTimeout(() => {
      report(FILE.absolute)
    }, 5)
    expect(await pending).toEqual([{ file: EDITED, entries: [], unchecked: 'changed' }])
    onDisk('const a = 2\n', 'const a = 2\n')
    const again = verify.diagnosticsAfterEdit([EDITED], new AbortController().signal)
    setTimeout(() => {
      report(FILE.absolute)
    }, 5)
    const [read] = await again
    expect(read?.entries.map((entry) => entry.message)).toEqual(['about the new text'])
  })

  it('does not open for the diagnostics tool a path retargeted after it was confined', async () => {
    let calls = 0
    const verify = createVerifyEditor({
      platform: 'linux',
      log: createLogger(new FakeLogOutputChannel()),
      workspaceRoot: ROOT,
      // Confinement resolves the root and the path; the next look finds a link.
      realPath: (absolutePath) => {
        calls += 1
        return Promise.resolve(calls > 2 ? '/elsewhere/a.ts' : absolutePath)
      },
      settle: SETTLE,
    })
    made.push(verify)
    expect(await verify.settleFile(FILE.absolute)).toBeUndefined()
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
  })

  it('does not format a file whose path now leads elsewhere', async () => {
    const { verify, channel } = editor({ links: { [FILE.absolute]: '/elsewhere/a.ts' } })
    expect(await verify.formatAfterEdit(FILE.absolute, 'x')).toBeUndefined()
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
    expect(logLines(channel).join('\n')).toContain('its path now leads to another file')
  })

  it('shows a background tab where it is, as it is, and brings back the tab that was in front', async () => {
    const { verify } = editor()
    const side: {
      isActive: boolean
      viewColumn: number
      activeTab: vscode.Tab | undefined
      tabs: vscode.Tab[]
    } = { isActive: false, viewColumn: BESIDE_COLUMN, activeTab: undefined, tabs: [] }
    const tabIn = (path: string, isPreview: boolean): vscode.Tab => ({
      label: path,
      group: side,
      input: new TabInputText(Uri.file(path)),
      isActive: false,
      isDirty: false,
      isPinned: false,
      isPreview,
    })
    const users = tabIn('/ws/user.ts', false)
    side.tabs.push(users, tabIn(FILE.absolute, true))
    side.activeTab = users
    const main: vscode.TabGroup = {
      isActive: true,
      viewColumn: USER_COLUMN,
      activeTab: undefined,
      tabs: [],
    }
    window.tabGroups.all = [main, side]
    vi.mocked(shownDocument).mockImplementation((uri: vscode.Uri | vscode.TextDocument) => {
      const target = 'fsPath' in uri ? uri : uri.uri
      side.activeTab = side.tabs.find(
        (tab) => tab.input instanceof TabInputText && tab.input.uri.fsPath === target.fsPath,
      )
      return Promise.resolve(fakeEditor(target))
    })
    const pending = verify.diagnosticsAfterEdit([FILE], new AbortController().signal)
    setTimeout(() => {
      report(FILE.absolute)
    }, 5)
    await pending
    expect(
      vi
        .mocked(shownDocument)
        .mock.calls.map(([uri, options]): readonly unknown[] => [
          uri instanceof FakeUri ? uri.fsPath : undefined,
          options,
        ]),
    ).toEqual([
      [FILE.absolute, { viewColumn: BESIDE_COLUMN, preview: true, preserveFocus: true }],
      ['/ws/user.ts', { viewColumn: BESIDE_COLUMN, preview: false, preserveFocus: true }],
    ])
    expect(side.activeTab).toBe(users)
    expect(window.tabGroups.close).not.toHaveBeenCalled()
  })
})

describe('settleFile (the diagnostics tool)', () => {
  it('shows a workspace file and reads what its server reported before the tab closes', async () => {
    const { verify } = editor()
    vi.mocked(languages.getDiagnostics).mockReturnValue([
      [Uri.file(FILE.absolute), [diagnostic(0, 2, 4, 'bad')]],
    ])
    // The server clears a file's diagnostics when its tab closes (the
    // integration run found the JSON server doing so).
    vi.mocked(window.tabGroups.close).mockImplementationOnce(() => {
      vi.mocked(languages.getDiagnostics).mockReturnValue([])
      return Promise.resolve(true)
    })
    const pending = verify.settleFile(FILE.absolute)
    setTimeout(() => {
      report(FILE.absolute)
    }, 5)
    expect(await pending).toEqual([
      { path: 'src/a.ts', severity: 'error', line: 3, column: 5, message: 'bad', source: 'ts' },
    ])
    expect(vi.mocked(shownDocument).mock.calls[0]?.[0].fsPath).toBe(FILE.absolute)
    expect(window.tabGroups.close).toHaveBeenCalledTimes(1)
    // No report: nothing read.
    expect(await verify.settleFile(OTHER.absolute)).toBeUndefined()
  })

  it('never opens a link out of the workspace, code the editor runs, or anything without a folder', async () => {
    const { verify } = editor({ links: { '/ws/creds.ts': '/home/me/.aws/credentials' } })
    expect(await verify.settleFile('/ws/creds.ts')).toBeUndefined()
    expect(await verify.settleFile('/ws/eslint.config.js')).toBeUndefined()
    expect(await verify.settleFile('/ws/node_modules/x/index.js')).toBeUndefined()
    const channel = new FakeLogOutputChannel()
    const folderless = createVerifyEditor({
      platform: 'linux',
      log: createLogger(channel),
      workspaceRoot: undefined,
      realPath: (absolutePath) => Promise.resolve(absolutePath),
    })
    expect(await folderless.settleFile(FILE.absolute)).toBeUndefined()
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
  })

  it('stops waiting when its caller goes away', async () => {
    const { verify } = editor()
    const gone = new AbortController()
    const started = Date.now()
    const pending = verify.settleFile(FILE.absolute, gone.signal)
    setTimeout(() => {
      gone.abort()
    }, 5)
    expect(await pending).toBeUndefined()
    expect(Date.now() - started).toBeLessThan(SETTLE.firstMs)
  })
})

function documentWith(state: DocumentState): void {
  vi.mocked(workspace.openTextDocument).mockResolvedValue(fakeDocument(state))
}

describe('formatAfterEdit', () => {
  it('applies the formatter’s edits to what the tool wrote, with the editor’s options', async () => {
    const { verify } = editor()
    documentWith({ text: 'let  a=1\nlet b=2\n' })
    vi.mocked(commands.executeCommand).mockResolvedValue([
      textEdit([0, 3], [0, 5], ' '),
      textEdit([0, 6], [0, 7], ' = '),
      textEdit([1, 5], [1, 6], ' = '),
    ])
    expect(await verify.formatAfterEdit(FILE.absolute, 'let  a=1\nlet b=2\n')).toBe(
      'let a = 1\nlet b = 2\n',
    )
    const [command, uri, options] = vi.mocked(commands.executeCommand).mock.calls[0] ?? []
    expect(command).toBe('vscode.executeFormatDocumentProvider')
    expect(uri).toBeInstanceOf(FakeUri)
    expect(uri).toMatchObject({ fsPath: FILE.absolute })
    expect(options).toEqual({ tabSize: 2, insertSpaces: true })
  })

  it('keeps a BOM and writes the formatter’s line breaks as the file’s CRLF', async () => {
    const { verify } = editor()
    documentWith({ text: 'a\r\nb\r\n', eol: EndOfLine.CRLF })
    vi.mocked(commands.executeCommand).mockResolvedValue([textEdit([0, 1], [0, 1], ';\nx')])
    expect(await verify.formatAfterEdit(FILE.absolute, '\u{FEFF}a\r\nb\r\n')).toBe(
      '\u{FEFF}a;\r\nx\r\nb\r\n',
    )
  })

  it('waits for an open document to catch up with the file before formatting it', async () => {
    const { verify } = editor()
    const state: DocumentState = { text: 'old' }
    documentWith(state)
    setTimeout(() => {
      state.text = 'new '
    }, 15)
    vi.mocked(commands.executeCommand).mockResolvedValue([textEdit([0, 3], [0, 4], '')])
    expect(await verify.formatAfterEdit(FILE.absolute, 'new ')).toBe('new')
  })

  it('formats nothing it cannot trust: stale, dirty, changed meanwhile, overlapping, slow', async () => {
    const { verify, channel } = editor()
    documentWith({ text: 'never caught up' })
    expect(await verify.formatAfterEdit(FILE.absolute, 'x')).toBeUndefined()
    expect(logLines(channel).join('\n')).toContain('the editor did not show the new text')
    expect(commands.executeCommand).not.toHaveBeenCalled()

    documentWith({ text: 'x', isDirty: true })
    expect(await verify.formatAfterEdit(FILE.absolute, 'y')).toBeUndefined()

    const moving: DocumentState = { text: 'x' }
    documentWith(moving)
    vi.mocked(commands.executeCommand).mockImplementationOnce(() => {
      moving.text = 'typed meanwhile'
      return Promise.resolve([textEdit([0, 0], [0, 1], 'y')])
    })
    expect(await verify.formatAfterEdit(FILE.absolute, 'x')).toBeUndefined()

    documentWith({ text: 'abcdef' })
    vi.mocked(commands.executeCommand).mockResolvedValueOnce([
      textEdit([0, 1], [0, 4], ''),
      textEdit([0, 3], [0, 5], ''),
    ])
    expect(await verify.formatAfterEdit(FILE.absolute, 'abcdef')).toBeUndefined()
    expect(logLines(channel).join('\n')).toContain("the formatter's edits overlap")

    vi.mocked(commands.executeCommand).mockReturnValueOnce(
      new Promise((resolve) => {
        setTimeout(() => {
          resolve([textEdit([0, 0], [0, 1], 'z')])
        }, FORMAT.formatMs * 3)
      }),
    )
    expect(await verify.formatAfterEdit(FILE.absolute, 'abcdef')).toBeUndefined()
    // A formatter that never answered in time is logged, not skipped silently.
    expect(logLines(channel).join('\n')).toContain(
      `the formatter did not answer in ${String(FORMAT.formatMs)} ms`,
    )
  })

  it('returns nothing when there is no formatter or it changes nothing', async () => {
    const { verify } = editor()
    documentWith({ text: 'same' })
    vi.mocked(commands.executeCommand).mockResolvedValueOnce(undefined)
    expect(await verify.formatAfterEdit(FILE.absolute, 'same')).toBeUndefined()
    vi.mocked(commands.executeCommand).mockResolvedValueOnce([])
    expect(await verify.formatAfterEdit(FILE.absolute, 'same')).toBeUndefined()
    vi.mocked(commands.executeCommand).mockResolvedValueOnce([textEdit([0, 0], [0, 4], 'same')])
    expect(await verify.formatAfterEdit(FILE.absolute, 'same')).toBeUndefined()
  })
})
