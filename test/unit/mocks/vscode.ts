// Minimal stand-in for the `vscode` module in unit tests (vitest alias in
// vitest.config.ts). Only what src/host actually touches is implemented, and
// each piece is typed against @types/vscode so drift is a compile error.

import type * as vscode from 'vscode'
import { vi } from 'vitest'

export class FakeUri implements vscode.Uri {
  public readonly scheme: string = 'file'
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
  // Tab's status bar item (M94): the last one created, for assertions.
  createStatusBarItem: vi.fn<typeof vscode.window.createStatusBarItem>(),
  // The pickers, dialogs and editors behind the CLI features (M30).
  showQuickPick: vi.fn<typeof vscode.window.showQuickPick>(),
  showInformationMessage: vi.fn<typeof vscode.window.showInformationMessage>(),
  showErrorMessage: vi.fn<typeof vscode.window.showErrorMessage>(),
  showWarningMessage: vi.fn<typeof vscode.window.showWarningMessage>(),
  showInputBox: vi.fn<typeof vscode.window.showInputBox>(),
  showSaveDialog: vi.fn<typeof vscode.window.showSaveDialog>(),
  // Picking a session-export file to import or read (M84).
  showOpenDialog: vi.fn<typeof vscode.window.showOpenDialog>(),
  showTextDocument: vi.fn<typeof vscode.window.showTextDocument>(),
  // The editors on screen: the verify loop shows a file only when none does (M68).
  visibleTextEditors: [] as readonly vscode.TextEditor[],
  // The tabs, so the verify loop closes the ones it opened (M68).
  tabGroups: {
    all: [] as readonly vscode.TabGroup[],
    close: vi.fn<(tabs: readonly vscode.Tab[], shouldKeepFocus?: boolean) => Thenable<boolean>>(),
  },
}

/** A text editor's tab input (M68): a tab showing a document at `uri`. */
export class TabInputText implements vscode.TabInputText {
  public constructor(public readonly uri: vscode.Uri) {}
}

export const workspace = {
  isTrusted: true,
  // The folders an export redacts (M84); none unless a test sets them.
  workspaceFolders: undefined as readonly vscode.WorkspaceFolder[] | undefined,
  // The folder VS Code attributes a file to (M94): none unless a test sets it.
  getWorkspaceFolder: vi.fn<typeof vscode.workspace.getWorkspaceFolder>(),
  fs: {
    writeFile: vi.fn<typeof vscode.workspace.fs.writeFile>(),
    // The Memory view's delete, to the trash (M49).
    delete: vi.fn<typeof vscode.workspace.fs.delete>(),
    // The verify loop (M68): when a shown file was written, and what it holds.
    stat: vi.fn<typeof vscode.workspace.fs.stat>(),
    readFile: vi.fn<typeof vscode.workspace.fs.readFile>(),
  },
  // The verify loop (M68): the documents the language servers and the
  // formatter read, and the editor's indentation settings.
  openTextDocument: vi.fn<(uri: vscode.Uri) => Thenable<vscode.TextDocument>>(),
  applyEdit: vi.fn<typeof vscode.workspace.applyEdit>(),
  getConfiguration:
    vi.fn<
      (section?: string, scope?: vscode.ConfigurationScope | null) => vscode.WorkspaceConfiguration
    >(),
}

/** A status bar item Tab's tests read and drive (M94). */
export class FakeStatusBarItem implements vscode.StatusBarItem {
  public readonly id = 'museSpark.tab'
  public alignment = 2 as vscode.StatusBarAlignment
  public priority: number | undefined = undefined
  public name: string | undefined = undefined
  public text = ''
  public tooltip: string | vscode.MarkdownString | undefined = undefined
  public color: string | vscode.ThemeColor | undefined = undefined
  public backgroundColor: vscode.ThemeColor | undefined = undefined
  public command: string | vscode.Command | undefined = undefined
  public accessibilityInformation: vscode.AccessibilityInformation | undefined = undefined
  public visible = false

  public show(): void {
    this.visible = true
  }

  public hide(): void {
    this.visible = false
  }

  public dispose(): void {
    this.visible = false
  }
}

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const

export class ThemeColor implements vscode.ThemeColor {
  public constructor(public readonly id: string) {}
}

/** A ghost-text suggestion Tab's tests read back (M94). */
export class InlineCompletionItem implements vscode.InlineCompletionItem {
  public filterText?: string
  public range: vscode.Range
  public command: vscode.Command
  public completeBracketPairs?: boolean | undefined

  public constructor(
    public insertText: string,
    range?: vscode.Range,
    command?: vscode.Command,
  ) {
    this.range = range ?? new Range(new Position(0, 0), new Position(0, 0))
    this.command = command ?? { command: '', title: '' }
  }
}

export const InlineCompletionTriggerKind = {
  Invoke: 0,
  Automatic: 1,
} as const

export const EndOfLine = { LF: 1, CRLF: 2 } as const

/** Fired by tests as a language server would report (M68). */
export const diagnosticsChanged = new EventEmitter<vscode.DiagnosticChangeEvent>()

export const languages = {
  getDiagnostics: vi.fn<() => [vscode.Uri, vscode.Diagnostic[]][]>(),
  onDidChangeDiagnostics: diagnosticsChanged.event,
  // Tab's ghost-text provider (M94): the last registration, for assertions.
  registerInlineCompletionItemProvider: vi.fn<
    typeof vscode.languages.registerInlineCompletionItemProvider
  >(),
  getLanguages: vi.fn<() => Thenable<string[]>>(),
}

/** A position, as the language-service commands take one (M67). */
export class Position {
  public constructor(
    public readonly line: number,
    public readonly character: number,
  ) {}

  private compare(other: vscode.Position): number {
    if (this.line !== other.line) {
      return this.line < other.line ? -1 : 1
    }
    if (this.character !== other.character) {
      return this.character < other.character ? -1 : 1
    }
    return 0
  }

  public isBefore(other: vscode.Position): boolean {
    return this.compare(other) < 0
  }

  public isBeforeOrEqual(other: vscode.Position): boolean {
    return this.compare(other) <= 0
  }

  public isAfter(other: vscode.Position): boolean {
    return this.compare(other) > 0
  }

  public isAfterOrEqual(other: vscode.Position): boolean {
    return this.compare(other) >= 0
  }

  public isEqual(other: vscode.Position): boolean {
    return this.compare(other) === 0
  }

  public compareTo(other: vscode.Position): number {
    return this.compare(other)
  }

  public translate(lineDelta?: number, characterDelta?: number): Position;
  public translate(change: { lineDelta?: number; characterDelta?: number }): Position;
  public translate(
    lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
    characterDelta?: number,
  ): Position {
    return typeof lineDeltaOrChange === 'object' ? new Position(
        this.line + (lineDeltaOrChange.lineDelta ?? 0),
        this.character + (lineDeltaOrChange.characterDelta ?? 0),
      ) : new Position(this.line + (lineDeltaOrChange ?? 0), this.character + (characterDelta ?? 0));
  }

  public with(line?: number, character?: number): Position;
  public with(change: { line?: number; character?: number }): Position;
  public with(
    lineOrChange?: number | { line?: number; character?: number },
    character?: number,
  ): Position {
    return typeof lineOrChange === 'object'
      ? new Position(lineOrChange.line ?? this.line, lineOrChange.character ?? this.character)
      : new Position(lineOrChange ?? this.line, character ?? this.character)
  }
}

export class Range {
  public constructor(
    public readonly start: vscode.Position,
    public readonly end: vscode.Position,
  ) {}

  public get isEmpty(): boolean {
    return this.start.isEqual(this.end)
  }

  public get isSingleLine(): boolean {
    return this.start.line === this.end.line
  }

  public contains(positionOrRange: vscode.Position | vscode.Range): boolean {
    const start = 'start' in positionOrRange ? positionOrRange.start : positionOrRange
    const end = 'end' in positionOrRange ? positionOrRange.end : positionOrRange
    return this.start.isBeforeOrEqual(start) && end.isBeforeOrEqual(this.end)
  }

  public isEqual(other: vscode.Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end)
  }

  public intersection(range: vscode.Range): vscode.Range | undefined {
    const start = this.start.isAfter(range.start) ? this.start : range.start
    const end = this.end.isBefore(range.end) ? this.end : range.end
    return start.isBeforeOrEqual(end) ? new Range(start, end) : undefined
  }

  public union(other: vscode.Range): vscode.Range {
    const start = this.start.isBefore(other.start) ? this.start : other.start
    const end = this.end.isAfter(other.end) ? this.end : other.end
    return new Range(start, end)
  }

  public with(start?: vscode.Position, end?: vscode.Position): Range;
  public with(change: { start?: vscode.Position; end?: vscode.Position }): Range;
  public with(
    startOrChange?: vscode.Position | { start?: vscode.Position; end?: vscode.Position },
    end?: vscode.Position,
  ): Range {
    if (startOrChange !== undefined && 'line' in startOrChange) {
      return new Range(startOrChange, end ?? this.end)
    }
    const change = startOrChange
    return new Range(change?.start ?? this.start, change?.end ?? this.end)
  }
}

/** Records the same replacement the host sends to VS Code, without writing a file. */
export class WorkspaceEdit {
  private readonly replacements = new Map<string, vscode.TextEdit[]>()
  public replace(uri: vscode.Uri, range: vscode.Range, text: string): void {
    this.replacements.set(uri.toString(), [{ range, newText: text }])
  }
  public get(uri: vscode.Uri): vscode.TextEdit[] | undefined {
    return this.replacements.get(uri.toString())
  }
}

export const env = {
  clipboard: { writeText: vi.fn<typeof vscode.env.clipboard.writeText>() },
  openExternal: vi.fn<typeof vscode.env.openExternal>(),
  // Where VS Code is installed (M67: the built-in languages' libraries).
  appRoot: '/vscode/resources/app',
}

/** The installed extensions, by folder (M67): a test sets the list it needs. */
export const extensions: {
  all: readonly Pick<vscode.Extension<unknown>, 'extensionPath'>[]
  // No Copilot unless a test says so (M94): Tab yields only when present.
  getExtension: (id: string) => vscode.Extension<unknown> | undefined
} = {
  all: [],
  getExtension: vi.fn<(id: string) => vscode.Extension<unknown> | undefined>(),
}

export const commands = {
  executeCommand: vi.fn<typeof vscode.commands.executeCommand>(),
  registerCommand: vi.fn<typeof vscode.commands.registerCommand>(),
}

export const version = '0.0.0-test'
