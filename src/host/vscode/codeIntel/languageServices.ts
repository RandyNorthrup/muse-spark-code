// VS Code's language services for the code intelligence tools (M67,
// PLAN.md D49): the `vscode.execute…` commands the editor's own Go to
// Definition, Find All References, outline, hover, call hierarchy and
// Rename Symbol use, their results converted to the plain data
// src/core/codeIntel works with. A document is loaded without being shown;
// a result that is no file on disk (a virtual document) has no path.

import path from 'node:path'
import * as vscode from 'vscode'
import * as z from 'zod/mini'
import { isSamePath } from '../../../core/paths'
import { VSCODE_COMMANDS } from '../../../shared/constants'
import { canonicalPath } from '../../canonicalPath'
import { stripExtendedLengthPrefix } from '../../editor/extendedLengthPath'
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
} from '../../../core/codeIntel/languageService'
import type { MhpParams, MhpResult } from '../../../shared/hostApi/methods'

const FILE_SCHEME = 'file'
const FENCE = '```'
/** Several items share the position and none is declared at it in this file: never guessed. */
const CALL_HIERARCHY_AMBIGUOUS = 'MHP_CALL_HIERARCHY_AMBIGUOUS'

function pathOf(uri: vscode.Uri): string | undefined {
  return uri.scheme === FILE_SCHEME ? uri.fsPath : undefined
}

/**
The file a path names, as the file system resolves it: a Windows
extended-length prefix is dropped and `.`/`..` collapse (src/core/paths.ts's
normalisation), then 8.3 aliases, junctions and links resolve
(canonicalPath). A path the system refuses to resolve keeps its spelling.
*/
async function fileIdentity(filePath: string): Promise<string> {
  const plain =
    process.platform === 'win32'
      ? path.win32.normalize(stripExtendedLengthPrefix(path.win32.normalize(filePath)))
      : filePath
  try {
    return await canonicalPath(plain)
  } catch {
    return plain
  }
}

/** Compares resources by resolved file identity, each URI resolved once per answer. */
function resourceComparer(): (first: vscode.Uri, second: vscode.Uri) => Promise<boolean> {
  const identities = new Map<string, Promise<string | undefined>>()
  const identity = (uri: vscode.Uri): Promise<string | undefined> => {
    const key = uri.toString()
    const known = identities.get(key)
    if (known !== undefined) return known
    const filePath = pathOf(uri)
    const resolved = filePath === undefined ? Promise.resolve(undefined) : fileIdentity(filePath)
    identities.set(key, resolved)
    return resolved
  }
  return async (first, second) => {
    if (first.toString() === second.toString()) return true
    const [left, right] = await Promise.all([identity(first), identity(second)])
    return left !== undefined && right !== undefined && isSamePath(left, right, process.platform)
  }
}

/**
The call-hierarchy item the position names. One item is the provider's
answer; among several (overloads, merged declarations) it is the one
declared at the position in this file, else the answer is ambiguous.
*/
async function declaredItem(
  items: readonly vscode.CallHierarchyItem[],
  uri: vscode.Uri,
  at: CodePosition,
  ambiguous: () => never,
): Promise<vscode.CallHierarchyItem | undefined> {
  if (items.length <= 1) return items[0]
  const sameResource = resourceComparer()
  for (const candidate of items)
    if (
      isWithin(fromRange(candidate.selectionRange), at) &&
      (await sameResource(candidate.uri, uri))
    )
      return candidate
  return ambiguous()
}

function refuseAmbiguous(): never {
  throw new Error(CALL_HIERARCHY_AMBIGUOUS)
}

function mhpLocation(
  value: vscode.Location | vscode.LocationLink,
): MhpResult<'codeIntel/definition'>[number] {
  return {
    uri: ('targetUri' in value ? value.targetUri : value.uri).toString(),
    range: fromRange(
      'targetUri' in value ? (value.targetSelectionRange ?? value.targetRange) : value.range,
    ),
  }
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
A hover part as Markdown, code fenced. A shape VS Code does not document
is shown as it came, never dropped (AGENTS rule 13).
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
  // position is asked; the answer counts the others.
  const item = await declaredItem(items, uri, at, refuseAmbiguous)
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

/** Frozen native methods retain virtual URIs; plans never write or invent file-operation support. */
export function vscodeCodeIntelHandlers(
  checkCurrent: (signal?: AbortSignal) => void,
  refuse: (
    code:
      'versionConflict' | 'dirtyBuffer' | 'invalidParams' | 'unsupportedCapability' | 'cancelled',
    message: string,
  ) => never,
  lifetime: AbortSignal,
) {
  type At = MhpParams<'codeIntel/definition'>
  type Symbol = MhpResult<'codeIntel/documentSymbols'>[number]
  async function query<T>(
    command: string,
    signal: AbortSignal | undefined,
    ...args: unknown[]
  ): Promise<T | undefined> {
    checkCurrent(signal)
    const ending = signal === undefined ? lifetime : AbortSignal.any([signal, lifetime])
    let abort: (() => void) | undefined
    // Node 20 at the supported VS Code floor has no Promise.withResolvers.
    const cancelled = new Promise<never>((_resolve, reject) => {
      abort = () => {
        try {
          checkCurrent(signal)
          refuse('cancelled', 'MHP_CANCELLED')
        } catch (error) {
          reject(error instanceof Error ? error : new Error('MHP_CANCELLED'))
        }
      }
      ending.addEventListener('abort', abort, { once: true })
      if (ending.aborted) abort()
    })
    try {
      return await Promise.race([run<T>(command, ...args), cancelled])
    } finally {
      if (abort !== undefined) ending.removeEventListener('abort', abort)
    }
  }
  const callItem = (value: vscode.CallHierarchyItem): Symbol => ({
    name: value.name,
    kind: value.kind,
    location: { uri: value.uri.toString(), range: fromRange(value.range) },
    selection: fromRange(value.selectionRange),
  })
  const information = (value: vscode.SymbolInformation): Symbol => ({
    name: value.name,
    kind: value.kind,
    location: mhpLocation(value.location),
    selection: fromRange(value.location.range),
    container: value.containerName,
  })
  async function opened(uri: string, signal?: AbortSignal) {
    checkCurrent(signal)
    const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
    checkCurrent(signal)
    const version = document.version
    const check = () => {
      checkCurrent(signal)
      if (document.version !== version) refuse('versionConflict', 'MHP_VERSION_CONFLICT')
    }
    return { document, check }
  }
  async function at(params: At, signal?: AbortSignal) {
    const snapshot = await opened(params.uri, signal)
    const position = toPosition(params.position)
    if (!snapshot.document.validatePosition(position).isEqual(position))
      refuse('invalidParams', 'MHP_INVALID_POSITION')
    return { ...snapshot, position }
  }
  return {
    'codeIntel/definition': async (params: At, signal?: AbortSignal) => {
      const snapshot = await at(params, signal)
      const answer = await query<(vscode.Location | vscode.LocationLink)[]>(
        VSCODE_COMMANDS.executeDefinitionProvider,
        signal,
        snapshot.document.uri,
        snapshot.position,
      )
      snapshot.check()
      return (answer ?? []).map((value) => mhpLocation(value))
    },
    'codeIntel/references': async (
      params: MhpParams<'codeIntel/references'>,
      signal?: AbortSignal,
    ) => {
      const snapshot = await at(params, signal)
      const answer = await query<vscode.Location[]>(
        VSCODE_COMMANDS.executeReferenceProvider,
        signal,
        snapshot.document.uri,
        snapshot.position,
      )
      snapshot.check()
      if (params.includeDeclaration) return (answer ?? []).map((value) => mhpLocation(value))
      const declarations = await query<(vscode.Location | vscode.LocationLink)[]>(
        VSCODE_COMMANDS.executeDefinitionProvider,
        signal,
        snapshot.document.uri,
        snapshot.position,
      )
      snapshot.check()
      const sameResource = resourceComparer()
      const excluded = (declarations ?? []).map((value) => ({
        uri: 'targetUri' in value ? value.targetUri : value.uri,
        range: JSON.stringify(mhpLocation(value).range),
      }))
      const found = answer ?? []
      const kept: MhpResult<'codeIntel/references'> = []
      for (const value of found) {
        const location = mhpLocation(value)
        const range = JSON.stringify(location.range)
        let isDeclaration = false
        for (const declaration of excluded)
          if (declaration.range === range && (await sameResource(declaration.uri, value.uri)))
            isDeclaration = true
        if (!isDeclaration) kept.push(location)
      }
      snapshot.check()
      return kept
    },
    'codeIntel/hover': async (params: At, signal?: AbortSignal) => {
      const snapshot = await at(params, signal)
      const answer = await query<vscode.Hover[]>(
        VSCODE_COMMANDS.executeHoverProvider,
        signal,
        snapshot.document.uri,
        snapshot.position,
      )
      snapshot.check()
      return (answer ?? []).flatMap((value) => value.contents.map((part) => hoverText(part)))
    },
    'codeIntel/documentSymbols': async (
      params: MhpParams<'codeIntel/documentSymbols'>,
      signal?: AbortSignal,
    ) => {
      const snapshot = await opened(params.uri, signal)
      const answer = await query<(vscode.DocumentSymbol | vscode.SymbolInformation)[]>(
        VSCODE_COMMANDS.executeDocumentSymbolProvider,
        signal,
        snapshot.document.uri,
      )
      snapshot.check()
      const flatten = (value: vscode.DocumentSymbol, container?: string): Symbol[] => [
        {
          name: value.name,
          kind: value.kind,
          location: { uri: snapshot.document.uri.toString(), range: fromRange(value.range) },
          selection: fromRange(value.selectionRange),
          ...(container !== undefined && { container }),
        },
        ...value.children.flatMap((child) => flatten(child, value.name)),
      ]
      return (answer ?? []).flatMap((value) =>
        'selectionRange' in value ? flatten(value) : [information(value)],
      )
    },
    'codeIntel/workspaceSymbols': async (
      params: MhpParams<'codeIntel/workspaceSymbols'>,
      signal?: AbortSignal,
    ) => {
      checkCurrent(signal)
      const answer = await query<vscode.SymbolInformation[]>(
        VSCODE_COMMANDS.executeWorkspaceSymbolProvider,
        signal,
        params.query,
      )
      checkCurrent(signal)
      return (answer ?? []).map((value) => information(value))
    },
    'codeIntel/prepareRename': async (params: At, signal?: AbortSignal) => {
      const snapshot = await at(params, signal)
      const answer = await query<vscode.Range | { range: vscode.Range; placeholder: string }>(
        VSCODE_COMMANDS.prepareRename,
        signal,
        snapshot.document.uri,
        snapshot.position,
      )
      snapshot.check()
      if (answer === undefined) return null
      const range = 'range' in answer ? answer.range : answer
      return {
        range: fromRange(range),
        placeholder:
          'placeholder' in answer ? answer.placeholder : snapshot.document.getText(range),
      }
    },
    'codeIntel/rename': async (params: MhpParams<'codeIntel/rename'>, signal?: AbortSignal) => {
      const snapshot = await at(params, signal)
      const versions = new Map(
        vscode.workspace.textDocuments.map((document) => [
          document.uri.toString(),
          document.version,
        ]),
      )
      const edit = await query<vscode.WorkspaceEdit>(
        VSCODE_COMMANDS.executeDocumentRenameProvider,
        signal,
        snapshot.document.uri,
        snapshot.position,
        params.newName,
      )
      snapshot.check()
      if (edit === undefined) refuse('unsupportedCapability', 'MHP_RENAME_UNAVAILABLE')
      const fileOperations = fileOperationsOf(edit)
      if (fileOperations !== 'none') return { files: [], fileOperations }
      const files: MhpResult<'codeIntel/rename'>['files'] = []
      for (const [uri, edits] of edit.entries()) {
        const target = await opened(uri.toString(), signal)
        snapshot.check()
        const expectedVersion = versions.get(uri.toString())
        if (expectedVersion === undefined || target.document.version !== expectedVersion)
          refuse('versionConflict', 'MHP_VERSION_CONFLICT')
        if (target.document.isDirty) refuse('dirtyBuffer', 'MHP_DIRTY_BUFFER')
        if (edits.length > 0)
          files.push({
            uri: uri.toString(),
            expectedVersion,
            edits: edits.map((value) => ({
              range: fromRange(value.range),
              newText: value.newText,
            })),
          })
      }
      snapshot.check()
      for (const file of files) {
        const document = vscode.workspace.textDocuments.find(
          (value) => value.uri.toString() === file.uri,
        )
        if (document?.version !== file.expectedVersion)
          refuse('versionConflict', 'MHP_VERSION_CONFLICT')
        if (document.isDirty) refuse('dirtyBuffer', 'MHP_DIRTY_BUFFER')
      }
      return { files, fileOperations }
    },
    'codeIntel/callHierarchy': async (
      params: MhpParams<'codeIntel/callHierarchy'>,
      signal?: AbortSignal,
    ) => {
      const snapshot = await at(params, signal)
      const items =
        (await query<vscode.CallHierarchyItem[]>(
          VSCODE_COMMANDS.prepareCallHierarchy,
          signal,
          snapshot.document.uri,
          snapshot.position,
        )) ?? []
      snapshot.check()
      const item = await declaredItem(items, snapshot.document.uri, params.position, () =>
        refuse('invalidParams', CALL_HIERARCHY_AMBIGUOUS),
      )
      snapshot.check()
      if (item === undefined) return null
      let calls: NonNullable<MhpResult<'codeIntel/callHierarchy'>>['calls']
      if (params.direction === 'incoming') {
        const answer = await query<vscode.CallHierarchyIncomingCall[]>(
          VSCODE_COMMANDS.provideIncomingCalls,
          signal,
          item,
        )
        calls = (answer ?? []).map((value) => ({
          symbol: callItem(value.from),
          ranges: value.fromRanges.map((range) => fromRange(range)),
        }))
      } else {
        const answer = await query<vscode.CallHierarchyOutgoingCall[]>(
          VSCODE_COMMANDS.provideOutgoingCalls,
          signal,
          item,
        )
        calls = (answer ?? []).map((value) => ({
          symbol: callItem(value.to),
          ranges: value.fromRanges.map((range) => fromRange(range)),
        }))
      }
      snapshot.check()
      return { item: callItem(item), calls, otherItems: items.length - 1 }
    },
    'codeIntel/format': async (params: MhpParams<'codeIntel/format'>, signal?: AbortSignal) => {
      const snapshot = await opened(params.uri, signal)
      const check = () => {
        snapshot.check()
        if (snapshot.document.version !== params.expectedVersion)
          refuse('versionConflict', 'MHP_VERSION_CONFLICT')
        if (snapshot.document.isDirty) refuse('dirtyBuffer', 'MHP_DIRTY_BUFFER')
      }
      check()
      const answer = await query<vscode.TextEdit[]>(
        VSCODE_COMMANDS.formatDocument,
        signal,
        snapshot.document.uri,
        { tabSize: params.tabSize, insertSpaces: params.insertSpaces },
      )
      check()
      return (answer ?? []).map((value) => ({
        range: fromRange(value.range),
        newText: value.newText,
      }))
    },
  }
}
