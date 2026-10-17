// Complete fakes for the VS Code interfaces src/host consumes. Complete means
// every member of the real interface is implemented, so no cast is needed and
// the compiler reports when the API changes.

import type * as vscode from 'vscode'
import { vi } from 'vitest'
import type { SecretStore } from '../../../src/host/auth/credentialStore'
import type { Logger } from '../../../src/host/logger'
import type {
  SessionBudgetConfig,
  SessionBudgetConfigSource,
  SessionBudgetScope,
} from '../../../src/host/models/sessionBudget'
import { createSessionBudgetConfig } from '../../../src/host/models/sessionBudget'
import type { ProviderEntry, ProvidersStore } from '../../../src/host/providers/providerPorts'
import { Usd, legacyUsdSchema, type UsdAmount } from '../../../src/shared/usd'
import { UI_TEXT } from '../../../src/shared/constants'
import { providerEntrySchema } from '../../../src/core/providers/providersFile'
import { parseModelRef } from '../../../src/core/providers/modelRef'
import { EventEmitter, FakeUri } from '../mocks/vscode'

function acceptMessage(_message: unknown): Thenable<boolean> {
  return Promise.resolve(true)
}
import type { HostToWebviewMessage } from '../../../src/shared/protocol'
import type { ChatSurface } from '../../../src/host/views/chatSurface'

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
    documentId: `${id}-document`,
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

/** An in-memory `SecretStore` for tests: a stand-in for the OS credential store (the outside world). */
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

/** A `CredentialStore` warning sink for tests that expect none: one fails the test. */
export function unexpectedWarning(message: string): never {
  throw new Error(`unexpected warning: ${message}`)
}

/**
 * The conversation spending limit setting backed by memory: the effective
 * value and the scope it is effective from, with every write recorded. The
 * shared wizard function reads and writes through this, exactly as through
 * VS Code's configuration in production.
 */
export function memorySessionBudgetConfig(
  parts: {
    readonly effective?: string
    readonly scope?: SessionBudgetScope
    readonly failWrite?: boolean
  } = {},
): SessionBudgetConfig & {
  readonly writes: readonly { readonly value: UsdAmount; readonly scope: SessionBudgetScope }[]
} {
  let current = Usd.from(parts.effective ?? 0).toAmount()
  const scope = parts.scope ?? 'global'
  const writes: { value: UsdAmount; scope: SessionBudgetScope }[] = []
  const log: Logger = {
    trace: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  }
  const source: SessionBudgetConfigSource = {
    get: (section) => (section === 'modelApiSessionBudgetUsd' ? current : undefined),
    inspect: (section) =>
      section === 'modelApiSessionBudgetUsd' && scope === 'workspace'
        ? { workspaceValue: current }
        : undefined,
    update: (section, value, nextScope) => {
      if (parts.failWrite === true) {
        return Promise.reject(new Error('settings are read-only in this test'))
      }
      const parsed = legacyUsdSchema.safeParse(value)
      if (section !== 'modelApiSessionBudgetUsd' || !parsed.success) {
        return Promise.reject(new Error('rejected by the setting schema in this test'))
      }
      current = parsed.data
      writes.push({ value: parsed.data, scope: nextScope })
      return Promise.resolve()
    },
  }
  return { ...createSessionBudgetConfig(source, log), writes }
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
    validate: (entry, ref) => {
      providerEntrySchema.parse(entry)
      if (ref !== undefined && parseModelRef(ref) === undefined)
        throw new Error(UI_TEXT.providerText.schema.modelRef)
    },
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
      const rows = typeof next === 'function' ? next(previous) : next
      current.length = 0
      current.push(...rows)
      replaced.push([...rows])
      if (replacement !== undefined) defaultModel = replacement.defaultModel
      return Promise.resolve(previous)
    },
    setDefaultModel: (ref, expected) => {
      if (expected !== undefined && defaultModel !== expected.value) {
        return Promise.reject(new Error(UI_TEXT.providerEditConflict))
      }
      defaultModel = ref
      return Promise.resolve()
    },
    defaultModel: () => Promise.resolve(defaultModel),
  }
}
