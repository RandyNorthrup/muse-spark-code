// Complete fakes for the VS Code interfaces src/host consumes. Complete means
// every member of the real interface is implemented, so no cast is needed and
// the compiler reports when the API changes.

import type * as vscode from 'vscode'
import { vi } from 'vitest'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { SettingsSource } from '../../../src/host/settings'
import type { HostToWebviewMessage, SettingsSnapshot } from '../../../src/shared/protocol'
import type { ChatSurface, WebviewHostContext } from '../../../src/host/views/webviewSetup'
import { EventEmitter, FakeUri, Uri } from '../mocks/vscode'

function acceptMessage(_message: unknown): Thenable<boolean> {
  return Promise.resolve(true)
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
  public iconPath?: vscode.IconPath
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
}

export function fakeSurface(id: string): FakeSurface {
  const posted: HostToWebviewMessage[] = []
  return {
    id,
    posted,
    post(message) {
      posted.push(message)
    },
    reveal: vi.fn<() => void>(),
    markUnread: vi.fn<() => void>(),
    setTitle: vi.fn<(title: string) => void>(),
    dispose() {
      // nothing to release in the fake
    },
  }
}

/** A `SecretStore` backed by a Map, exposed for assertions. */
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
