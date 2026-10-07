// Complete fakes for the VS Code interfaces src/host consumes. Complete means
// every member of the real interface is implemented, so no cast is needed and
// the compiler reports when the API changes.

import type * as vscode from 'vscode'
import { vi } from 'vitest'
import type { VerifyHooks } from '../../../src/core/backends/modelapi/verifyLoop'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { ProviderEntry, ProvidersStore } from '../../../src/host/providers/providerPorts'
import type { SettingsSource } from '../../../src/host/settings'
import { EN } from '../../../src/shared/l10n/en'
import { BASE_LOCALE } from '../../../src/shared/l10n/text'
import type { HostToWebviewMessage, SettingsSnapshot } from '../../../src/shared/protocol'
import type { ChatSurface } from '../../../src/host/views/chatSurface'
import type { WebviewHostContext } from '../../../src/host/views/webviewSetup'
import { EventEmitter, FakeUri, Position, Range, Uri } from '../mocks/vscode'

function acceptMessage(_message: unknown): Thenable<boolean> {
  return Promise.resolve(true)
}

/** Deterministic editor providers shared by the native checkpoint and trial fixtures. */
export function fakeEditProviders() {
  return {
    format: vi.fn<VerifyHooks['formatAfterEdit']>((_file, text) =>
      Promise.resolve(text.replace('2', '3')),
    ),
    diagnostics: vi.fn<VerifyHooks['diagnosticsAfterEdit']>((files) =>
      Promise.resolve(files.map((file) => ({ file, entries: [] }))),
    ),
  }
}

export class FakeWebview implements vscode.Webview {
  public options: vscode.WebviewOptions = {}
  public html = ''
  public readonly cspSource = 'vscode-webview://fake'
  public readonly messages = new EventEmitter<unknown>()
  public readonly onDidReceiveMessage = this.messages.event
  public readonly postMessage = vi.fn(acceptMessage)

  public asWebviewUri(localResource: vscode.Uri): vscode.Uri {
    return new FakeUri(`webview${localResource.path}`)
  }
}

export class FakeWebviewView implements vscode.WebviewView {
  public readonly viewType = 'fake.view'
  public readonly webview = new FakeWebview()
  public title = 'Fake view'
  public description = ''
  public badge: vscode.ViewBadge | undefined = undefined
  public visible = true
  public readonly disposed = new EventEmitter<void>()
  public readonly onDidDispose = this.disposed.event
  public readonly visibility = new EventEmitter<void>()
  public readonly onDidChangeVisibility = this.visibility.event
  public readonly show = vi.fn((_shouldPreserveFocus?: boolean): void => {
    this.visible = true
  })
}

export class FakeWebviewPanel implements vscode.WebviewPanel {
  public readonly webview = new FakeWebview()
  public readonly options: vscode.WebviewPanelOptions = {}
  public iconPath?: NonNullable<vscode.WebviewPanel['iconPath']>
  public viewColumn: vscode.ViewColumn | undefined = undefined
  public active = true
  public visible = true
  public readonly disposed = new EventEmitter<void>()
  public readonly onDidDispose = this.disposed.event
  public readonly viewStateChanges =
    new EventEmitter<vscode.WebviewPanelOnDidChangeViewStateEvent>()
  public readonly onDidChangeViewState = this.viewStateChanges.event
  public readonly reveal = vi.fn(
    (_viewColumn?: vscode.ViewColumn, _shouldPreserveFocus?: boolean) => {
      this.visible = true
    },
  )

  public constructor(
    public readonly viewType: string,
    public title: string,
  ) {}

  public dispose(): void {
    this.disposed.fire()
  }
}

export class FakeLogOutputChannel implements vscode.LogOutputChannel {
  public readonly name = 'fake'
  public logLevel = 0 as vscode.LogLevel
  public readonly logLevelChanges = new EventEmitter<vscode.LogLevel>()
  public readonly onDidChangeLogLevel = this.logLevelChanges.event
  public readonly trace = vi.fn()
  public readonly debug = vi.fn()
  public readonly info = vi.fn()
  public readonly warn = vi.fn()
  public readonly error = vi.fn()
  public readonly append = vi.fn()
  public readonly appendLine = vi.fn()
  public readonly replace = vi.fn()
  public readonly clear = vi.fn()
  public readonly show = vi.fn()
  public readonly hide = vi.fn()
  public readonly dispose = vi.fn()
}

/** A `SettingsSource` backed by a plain object (absent keys read as undefined). */
export function fakeSettingsSource(values: Readonly<Record<string, unknown>>): SettingsSource {
  return {
    get: (section) => values[section],
  }
}

/** One text line Tab's tests read the cursor's line from (M94). */
export class FakeTextLine implements vscode.TextLine {
  public readonly range: vscode.Range
  public readonly rangeIncludingLineBreak: vscode.Range
  public readonly firstNonWhitespaceCharacterIndex: number
  public readonly isEmptyOrWhitespace: boolean

  public constructor(
    public readonly lineNumber: number,
    public readonly text: string,
  ) {
    this.range = new Range(new Position(lineNumber, 0), new Position(lineNumber, text.length))
    this.rangeIncludingLineBreak = new Range(
      new Position(lineNumber, 0),
      new Position(lineNumber + 1, 0),
    )
    this.firstNonWhitespaceCharacterIndex = text.length - text.trimStart().length
    this.isEmptyOrWhitespace = text.trim() === ''
  }
}

/** A document Tab's tests suggest in (M94): text, language and URIs. */
export class FakeTextDocument implements vscode.TextDocument {
  public readonly fileName: string
  public readonly isUntitled: boolean
  public readonly version = 1
  public readonly isDirty = false
  public readonly isClosed = false
  public readonly eol = 1 as vscode.EndOfLine

  public constructor(
    public readonly uri: vscode.Uri,
    public readonly languageId: string,
    private text: string,
  ) {
    this.fileName = uri.fsPath
    this.isUntitled = uri.scheme !== 'file'
  }

  public get lineCount(): number {
    return this.text.split('\n').length
  }

  public lineAt(lineOrPosition: number | vscode.Position): vscode.TextLine {
    const line = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line
    return new FakeTextLine(line, this.text.split('\n')[line] ?? '')
  }

  public offsetAt(position: vscode.Position): number {
    const before = this.text.split('\n').slice(0, position.line)
    return before.reduce((sum, text) => sum + text.length + 1, 0) + position.character
  }

  public positionAt(offset: number): vscode.Position {
    const lines = this.text.split('\n')
    let rest = offset
    for (const [line, text] of lines.entries()) {
      if (rest <= text.length) {
        return new Position(line, rest)
      }
      rest -= text.length + 1
    }
    const last = lines.length - 1
    return new Position(last, (lines[last] ?? '').length)
  }

  public getText(range?: vscode.Range): string {
    return range === undefined
      ? this.text
      : this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end))
  }

  public getWordRangeAtPosition(
    _position: vscode.Position,
    _regex?: RegExp,
  ): vscode.Range | undefined {
    return undefined
  }

  public validateRange(range: vscode.Range): vscode.Range {
    return range
  }

  public validatePosition(position: vscode.Position): vscode.Position {
    return position
  }

  public save(): Thenable<boolean> {
    return Promise.resolve(true)
  }
}

/** A cancellation token Tab's tests flip (M94). */
export class FakeCancellationToken implements vscode.CancellationToken {
  public readonly changed = new EventEmitter<void>()
  public readonly onCancellationRequested = this.changed.event
  public isCancellationRequested = false

  public cancel(): void {
    this.isCancellationRequested = true
    this.changed.fire()
  }
}

export const testSettings: SettingsSnapshot = {
  preferredLocation: 'panel',
  initialPermissionMode: 'manual',
  autosave: true,
  attachOpenFile: true,
  useCtrlEnterToSend: false,
  hideOnboarding: false,
  focusView: false,
  respectGitIgnore: true,
  confidentialWorkspace: false,
  allowDangerouslySkipPermissions: false,
  archiveInactiveSessions: 14,
  modelApiReplyUsage: false,
  museCodeAutoReviewer: true,
}

export interface FakeHostContext extends WebviewHostContext {
  readonly log: FakeLogOutputChannel
  readonly onInputFocusChanged: ReturnType<typeof vi.fn<WebviewHostContext['onInputFocusChanged']>>
  readonly onSurfaceReady: ReturnType<typeof vi.fn<WebviewHostContext['onSurfaceReady']>>
  readonly onConversationMessage: ReturnType<
    typeof vi.fn<WebviewHostContext['onConversationMessage']>
  >
}

export function fakeHostContext(settings: SettingsSnapshot = testSettings): FakeHostContext {
  return {
    extensionUri: Uri.file('/ext'),
    l10n: { locale: BASE_LOCALE, table: EN },
    log: new FakeLogOutputChannel(),
    getSettings: () => settings,
    onInputFocusChanged: vi.fn<WebviewHostContext['onInputFocusChanged']>(),
    onSurfaceReady: vi.fn<WebviewHostContext['onSurfaceReady']>(),
    onConversationMessage: vi.fn<WebviewHostContext['onConversationMessage']>(),
  }
}

export interface FakeSurface extends ChatSurface {
  readonly posted: HostToWebviewMessage[]
  readonly reveal: ReturnType<typeof vi.fn<() => void>>
  readonly markUnread: ReturnType<typeof vi.fn<() => void>>
  readonly setTitle: ReturnType<typeof vi.fn<(title: string) => void>>
  readonly reload: ReturnType<typeof vi.fn<() => void>>
  readonly takeRestoredSessionId: ReturnType<typeof vi.fn<() => string | undefined>>
}

export function fakeSurface(id: string, isSideChat = false): FakeSurface {
  const posted: HostToWebviewMessage[] = []
  return {
    id,
    isSideChat,
    posted,
    post(message) {
      posted.push(message)
    },
    reveal: vi.fn<() => void>(),
    markUnread: vi.fn<() => void>(),
    setTitle: vi.fn<(title: string) => void>(),
    reload: vi.fn<() => void>(),
    takeRestoredSessionId: vi.fn<() => string | undefined>(),
    dispose() {
      // nothing to release in the fake
    },
  }
}

/** A `SecretStore` backed by a Map, exposed for assertions. */
/** A `CredentialStore` warning sink for tests that expect none: one fails the test. */
export function unexpectedWarning(message: string): never {
  throw new Error(`unexpected warning: ${message}`)
}

export function memorySecrets(): SecretStore & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get: (key) => Promise.resolve(values.get(key)),
    store: (key, value) => {
      values.set(key, value)
      return Promise.resolve()
    },
    delete: (key) => {
      values.delete(key)
      return Promise.resolve()
    },
  }
}

/** A `ProvidersStore` (M95 lane K) backed by an array, exposed for assertions. */
export function memoryProvidersStore(
  entries: readonly ProviderEntry[] = [],
): ProvidersStore & { readonly current: ProviderEntry[]; readonly replaced: ProviderEntry[][] } {
  const current = [...entries]
  const replaced: ProviderEntry[][] = []
  let defaultModel: string | undefined
  return {
    current,
    replaced,
    list: () => Promise.resolve([...current]),
    add: (entry) => {
      if (current.some((existing) => existing.id === entry.id)) {
        return Promise.reject(new Error(`Provider ${entry.id} is already configured`))
      }
      current.push(entry)
      return Promise.resolve()
    },
    remove: (id) => {
      const index = current.findIndex((entry) => entry.id === id)
      const [removed] = index === -1 ? [undefined] : current.splice(index, 1)
      return Promise.resolve(removed)
    },
    restore: (entry) => {
      current.push(entry)
      return Promise.resolve()
    },
    replaceAll: (next, replacement) => {
      const previous = [...current]
      current.length = 0
      current.push(...next)
      replaced.push([...next])
      if (replacement !== undefined) defaultModel = replacement.defaultModel
      return Promise.resolve(previous)
    },
    setDefaultModel: (ref) => {
      defaultModel = ref
      return Promise.resolve()
    },
    defaultModel: () => Promise.resolve(defaultModel),
  }
}
