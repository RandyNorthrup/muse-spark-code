// What the code intelligence tools ask of VS Code's language services (M67,
// PLAN.md D49), as plain data: the host adapter
// (src/host/codeIntel/languageServices.ts) runs VS Code's `vscode.execute…`
// commands and converts their results; the unit tests hand in a fake. Paths
// are absolute file-system paths; a result that is not a file on disk (a
// virtual document) has no path and is counted as outside the workspace.

/** A 0-based position, counted as VS Code counts: UTF-16 code units in the line. */
export interface CodePosition {
  readonly line: number
  readonly character: number
}

export interface CodeRange {
  readonly start: CodePosition
  readonly end: CodePosition
}

export interface CodeLocation {
  /** Absolute; undefined for a resource that is no file on disk. */
  readonly path: string | undefined
  readonly range: CodeRange
}

export interface CodeSymbol {
  readonly name: string
  /** VS Code's `SymbolKind` value. */
  readonly kind: number
  readonly detail: string | undefined
  /** The symbol it belongs to, as the provider names it (a workspace symbol's). */
  readonly container: string | undefined
  /** The whole declaration. */
  readonly location: CodeLocation
  /** The name itself where the provider says (a document symbol's), else the location's range. */
  readonly selection: CodeRange
  readonly children: readonly CodeSymbol[]
}

/** A caller (incoming) or a callee (outgoing), and where the calls are. */
export interface CallSite {
  readonly symbol: CodeSymbol
  /**
   * Incoming: the calls, in the caller's file. Outgoing: the calls, in the
   * file of the function asked about.
   */
  readonly ranges: readonly CodeRange[]
}

export interface CallHierarchyAnswer {
  /** The function or method the position names: the one declared there, when several are. */
  readonly item: CodeSymbol
  readonly calls: readonly CallSite[]
  /** The others the position also names (overloads, merged declarations), not asked. */
  readonly otherItems: number
}

export type CallDirection = 'incoming' | 'outgoing'

export interface TextEdit {
  readonly range: CodeRange
  readonly newText: string
}

export interface FileEdits {
  /** Absolute; undefined for a resource that is no file on disk. */
  readonly path: string | undefined
  readonly edits: readonly TextEdit[]
}

/**
 * Whether the edit also creates, renames or deletes files, which the tool
 * refuses; `unknown` when VS Code does not say, which it refuses too.
 */
export type FileOperations = 'none' | 'present' | 'unknown'

export interface RenameEdits {
  readonly files: readonly FileEdits[]
  readonly fileOperations: FileOperations
}

/** A document as the language services see it (an open editor's text, unsaved changes included). */
export interface OpenedDocument {
  readonly languageId: string
  readonly text: string
  readonly isDirty: boolean
}

export interface LanguageServiceHost {
  /** Loads the document without showing it; rejects when it cannot be read as text. */
  open(path: string): Promise<OpenedDocument>
  definitions(path: string, at: CodePosition): Promise<readonly CodeLocation[]>
  /** The references, the declaration included (VS Code's `executeReferenceProvider`). */
  references(path: string, at: CodePosition): Promise<readonly CodeLocation[]>
  /** The hover's parts as Markdown. */
  hover(path: string, at: CodePosition): Promise<readonly string[]>
  documentSymbols(path: string): Promise<readonly CodeSymbol[]>
  workspaceSymbols(query: string): Promise<readonly CodeSymbol[]>
  /** Undefined when nothing at the position has a call hierarchy. */
  callHierarchy(
    path: string,
    at: CodePosition,
    direction: CallDirection,
  ): Promise<CallHierarchyAnswer | undefined>
  /** Rejects with the provider's own reason when the position cannot be renamed. */
  rename(path: string, at: CodePosition, newName: string): Promise<RenameEdits>
  /**
   * Folders outside the workspace whose declarations a hover may still
   * describe: the editor's own installation and its extensions, where the
   * languages' bundled libraries live (`lib.dom.d.ts`, typeshed).
   */
  libraryRoots(): readonly string[]
}
