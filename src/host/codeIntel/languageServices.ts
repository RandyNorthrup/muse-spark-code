// VS Code's language services for the code intelligence tools (M67,
// PLAN.md D49): the `vscode.execute…` commands the editor's own Go to
// Definition, Find All References, outline, hover, call hierarchy and
// Rename Symbol use, their results converted to the plain data
// src/core/codeIntel works with. A document is loaded without being shown;
// a result that is no file on disk (a virtual document) has no path.

import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { VSCODE_COMMANDS } from '../../shared/constants'
import type {
  CallDirection,
  CallHierarchyAnswer,
  CallSite,
  CodeLocation,
  CodePosition,
  CodeRange,
  CodeSymbol,
  FileOperations,
  LanguageServiceHost,
  RenameEdits,
} from '../../core/codeIntel/languageService'

const FILE_SCHEME = 'file'
const FENCE = '```'

function pathOf(uri: vscode.Uri): string | undefined {
  return uri.scheme === FILE_SCHEME ? uri.fsPath : undefined
}

function toPosition(at: CodePosition): vscode.Position {
  return new vscode.Position(at.line, at.character)
}

function fromRange(range: vscode.Range): CodeRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}

/** A `Location` or a `LocationLink` (definition providers return either). */
function fromLocation(location: vscode.Location | vscode.LocationLink): CodeLocation {
  return 'targetUri' in location
    ? {
        path: pathOf(location.targetUri),
        range: fromRange(location.targetSelectionRange ?? location.targetRange),
      }
    : { path: pathOf(location.uri), range: fromRange(location.range) }
}

function fromDocumentSymbol(symbol: vscode.DocumentSymbol, path: string): CodeSymbol {
  return {
    name: symbol.name,
    kind: symbol.kind,
    detail: symbol.detail,
    container: undefined,
    location: { path, range: fromRange(symbol.range) },
    selection: fromRange(symbol.selectionRange),
    children: symbol.children.map((child) => fromDocumentSymbol(child, path)),
  }
}

function fromSymbolInformation(symbol: vscode.SymbolInformation): CodeSymbol {
  const location = fromLocation(symbol.location)
  return {
    name: symbol.name,
    kind: symbol.kind,
    detail: undefined,
    container: symbol.containerName,
    location,
    selection: location.range,
    children: [],
  }
}

function fromCallItem(item: vscode.CallHierarchyItem): CodeSymbol {
  return {
    name: item.name,
    kind: item.kind,
    detail: item.detail,
    container: undefined,
    location: { path: pathOf(item.uri), range: fromRange(item.range) },
    selection: fromRange(item.selectionRange),
    children: [],
  }
}

// A hover part: Markdown text, or code in a language (the older marked-string form).
const markedCodeSchema = z.object({ language: z.string(), value: z.string() })
const markdownSchema = z.object({ value: z.string() })

/**
 * A hover part as Markdown, code fenced. A shape VS Code does not document
 * is shown as it came, never dropped (AGENTS rule 13).
 */
function hoverText(part: unknown): string {
  if (typeof part === 'string') {
    return part
  }
  const code = markedCodeSchema.safeParse(part)
  if (code.success) {
    return `${FENCE}${code.data.language}\n${code.data.value}\n${FENCE}`
  }
  const markdown = markdownSchema.safeParse(part)
  return markdown.success ? markdown.data.value : JSON.stringify(part)
}

async function run<T>(command: string, ...args: unknown[]): Promise<T | undefined> {
  return await vscode.commands.executeCommand<T | undefined>(command, ...args)
}

/** Whether the range holds the position, its ends included. */
function isWithin(range: CodeRange, at: CodePosition): boolean {
  const { start, end } = range
  return (
    (at.line > start.line || (at.line === start.line && at.character >= start.character)) &&
    (at.line < end.line || (at.line === end.line && at.character <= end.character))
  )
}

async function callHierarchy(
  uri: vscode.Uri,
  at: CodePosition,
  direction: CallDirection,
): Promise<CallHierarchyAnswer | undefined> {
  const items =
    (await run<vscode.CallHierarchyItem[]>(
      VSCODE_COMMANDS.prepareCallHierarchy,
      uri,
      toPosition(at),
    )) ?? []
  // Several items (overloads, merged declarations): the one declared at the
  // position is asked, else the first; the answer counts the others.
  const item =
    items.find(
      (candidate) =>
        pathOf(candidate.uri) === pathOf(uri) && isWithin(fromRange(candidate.selectionRange), at),
    ) ?? items[0]
  if (item === undefined) {
    return undefined
  }
  let calls: readonly CallSite[]
  if (direction === 'incoming') {
    const incoming = await run<vscode.CallHierarchyIncomingCall[]>(
      VSCODE_COMMANDS.provideIncomingCalls,
      item,
    )
    calls = (incoming ?? []).map((call) => ({
      symbol: fromCallItem(call.from),
      ranges: call.fromRanges.map((range) => fromRange(range)),
    }))
  } else {
    const outgoing = await run<vscode.CallHierarchyOutgoingCall[]>(
      VSCODE_COMMANDS.provideOutgoingCalls,
      item,
    )
    calls = (outgoing ?? []).map((call) => ({
      symbol: fromCallItem(call.to),
      ranges: call.fromRanges.map((range) => fromRange(range)),
    }))
  }
  return { item: fromCallItem(item), calls, otherItems: items.length - 1 }
}

async function rename(uri: vscode.Uri, at: CodePosition, newName: string): Promise<RenameEdits> {
  const position = toPosition(at)
  // Rejects with the provider's reason ("You cannot rename this element.").
  await run(VSCODE_COMMANDS.prepareRename, uri, position)
  const edit = await run<vscode.WorkspaceEdit>(
    VSCODE_COMMANDS.executeDocumentRenameProvider,
    uri,
    position,
    newName,
  )
  if (edit === undefined) {
    return { files: [], fileOperations: 'none' }
  }
  return {
    files: edit.entries().map(([target, edits]) => ({
      path: pathOf(target),
      edits: edits.map((textEdit) => ({
        range: fromRange(textEdit.range),
        newText: textEdit.newText,
      })),
    })),
    fileOperations: fileOperationsOf(edit),
  }
}

// What `WorkspaceEdit` holds beyond its text edits. Its API shows only
// those: `entries()` lists text edits and `size` counts them (read from
// VS Code 1.125.0's and 1.139.0's extensionHostProcess.js), so a rename that
// also creates, moves or deletes files looks like a plain one. Only the
// internal `_allEntries()` lists everything, each entry with a `_type` (1 a
// file operation, 2 a text edit, others cells and snippets). It is read as
// untyped data: when it is missing or its shape changes, the answer is
// `unknown`, and the rename is refused rather than half applied.
const ALL_ENTRIES = '_allEntries'
const TEXT_EDIT_TYPE = 2
const allEntriesSchema = z.array(z.object({ _type: z.number() }))

function fileOperationsOf(edit: vscode.WorkspaceEdit): FileOperations {
  const allEntries: unknown = Reflect.get(edit, ALL_ENTRIES)
  if (typeof allEntries !== 'function') {
    return 'unknown'
  }
  const parsed = allEntriesSchema.safeParse(Reflect.apply(allEntries, edit, []))
  if (!parsed.success) {
    return 'unknown'
  }
  return parsed.data.every((entry) => entry._type === TEXT_EDIT_TYPE) ? 'none' : 'present'
}

/** The language services behind the code intelligence tools. */
export function vscodeLanguageServices(): LanguageServiceHost {
  return {
    open: async (path) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(path))
      return {
        languageId: document.languageId,
        text: document.getText(),
        isDirty: document.isDirty,
      }
    },
    definitions: async (path, at) => {
      const found = await run<(vscode.Location | vscode.LocationLink)[]>(
        VSCODE_COMMANDS.executeDefinitionProvider,
        vscode.Uri.file(path),
        toPosition(at),
      )
      return (found ?? []).map((location) => fromLocation(location))
    },
    references: async (path, at) => {
      const found = await run<vscode.Location[]>(
        VSCODE_COMMANDS.executeReferenceProvider,
        vscode.Uri.file(path),
        toPosition(at),
      )
      return (found ?? []).map((location) => fromLocation(location))
    },
    hover: async (path, at) => {
      const hovers = await run<vscode.Hover[]>(
        VSCODE_COMMANDS.executeHoverProvider,
        vscode.Uri.file(path),
        toPosition(at),
      )
      return (hovers ?? []).flatMap((hover) => hover.contents.map((part) => hoverText(part)))
    },
    documentSymbols: async (path) => {
      const found = await run<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
        VSCODE_COMMANDS.executeDocumentSymbolProvider,
        vscode.Uri.file(path),
      )
      return (found ?? []).map((symbol) =>
        'selectionRange' in symbol
          ? fromDocumentSymbol(symbol, path)
          : fromSymbolInformation(symbol),
      )
    },
    workspaceSymbols: async (query) => {
      const found = await run<vscode.SymbolInformation[]>(
        VSCODE_COMMANDS.executeWorkspaceSymbolProvider,
        query,
      )
      return (found ?? []).map((symbol) => fromSymbolInformation(symbol))
    },
    callHierarchy: async (path, at, direction) =>
      await callHierarchy(vscode.Uri.file(path), at, direction),
    rename: async (path, at, newName) => await rename(vscode.Uri.file(path), at, newName),
    // VS Code's installation holds the built-in languages' libraries (the
    // TypeScript extension's `lib.*.d.ts`); an installed extension holds
    // its own (Python's typeshed). Read at each call: extensions come and go.
    libraryRoots: () => [
      vscode.env.appRoot,
      ...vscode.extensions.all.map((extension) => extension.extensionPath),
    ],
  }
}
