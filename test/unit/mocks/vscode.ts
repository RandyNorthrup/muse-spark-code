// Minimal stand-in for the `vscode` module in unit tests (vitest alias in
// vitest.config.ts). Only what src/host actually touches is implemented, and
// each piece is typed against @types/vscode so drift is a compile error.

import type * as vscode from 'vscode'
import { vi } from 'vitest'

export class FakeUri implements vscode.Uri {
  public readonly scheme = 'file'
  public readonly authority = ''
  public readonly query = ''
  public readonly fragment = ''

  public constructor(public readonly path: string) {}

  public get fsPath(): string {
    return this.path
  }

  public with(): vscode.Uri {
    return this
  }

  public toString(): string {
    return `${this.scheme}://${this.path}`
  }

  public toJSON(): unknown {
    return { scheme: this.scheme, path: this.path }
  }
}

export const Uri = {
  file(path: string): vscode.Uri {
    return new FakeUri(path)
  },
  /** Enough for the external links the host opens: the whole string as the path. */
  parse(value: string): vscode.Uri {
    return new FakeUri(value)
  },
  joinPath(base: vscode.Uri, ...segments: string[]): vscode.Uri {
    return new FakeUri([base.path, ...segments].join('/'))
  },
}

export class Disposable implements vscode.Disposable {
  public constructor(private readonly onDispose: () => void) {}

  public dispose(): void {
    this.onDispose()
  }
}

export class EventEmitter<T> implements vscode.EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => unknown>()

  public event: vscode.Event<T> = (listener, thisArgs?: unknown, disposables?) => {
    const bound = thisArgs === undefined ? listener : listener.bind(thisArgs)
    this.listeners.add(bound)
    const disposable = new Disposable(() => {
      this.listeners.delete(bound)
    })
    disposables?.push(disposable)
    return disposable
  }

  public fire(value: T): void {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  public dispose(): void {
    this.listeners.clear()
  }
}

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
} as const

export const window = {
  state: { focused: true },
  createWebviewPanel: vi.fn<typeof vscode.window.createWebviewPanel>(),
  // The pickers, dialogs and editors behind the CLI features (M30).
  showQuickPick: vi.fn<typeof vscode.window.showQuickPick>(),
  showInformationMessage: vi.fn<typeof vscode.window.showInformationMessage>(),
  showErrorMessage: vi.fn<typeof vscode.window.showErrorMessage>(),
  showWarningMessage: vi.fn<typeof vscode.window.showWarningMessage>(),
  showInputBox: vi.fn<typeof vscode.window.showInputBox>(),
  showSaveDialog: vi.fn<typeof vscode.window.showSaveDialog>(),
  showTextDocument: vi.fn<typeof vscode.window.showTextDocument>(),
}

export const workspace = {
  isTrusted: true,
  fs: {
    writeFile: vi.fn<typeof vscode.workspace.fs.writeFile>(),
    // The Memory view's delete, to the trash (M49).
    delete: vi.fn<typeof vscode.workspace.fs.delete>(),
  },
}

export const env = {
  openExternal: vi.fn<typeof vscode.env.openExternal>(),
}

export const commands = {
  executeCommand: vi.fn<typeof vscode.commands.executeCommand>(),
}

export const version = '0.0.0-test'
