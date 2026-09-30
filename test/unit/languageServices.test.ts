// VS Code's language services as the code intelligence tools read them
// (M67): each `vscode.execute…` command's result converted to plain data,
// a result that is no file left without a path, and a rename's file
// operations noticed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as vscode from 'vscode'
import { vscodeLanguageServices } from '../../src/host/codeIntel/languageServices'
import { VSCODE_COMMANDS } from '../../src/shared/constants'
import { extensions as mockExtensions } from './mocks/vscode'

const FILE = '/ws/a.ts'
const AT = { line: 1, character: 2 }
const answers = new Map<string, (...args: unknown[]) => unknown>()

function range(line: number, from: number, to: number) {
  return { start: { line, character: from }, end: { line, character: to } }
}

const fileUri = vscode.Uri.file(FILE)

/**
 * A `WorkspaceEdit` as VS Code's extension host builds one (1.125.0 and
 * 1.139.0): `entries()` lists only the text edits and `size` counts them;
 * `_allEntries()` lists everything, file operations (`_type` 1) included.
 */
function vsCodeWorkspaceEdit(allEntries: readonly Record<string, unknown>[]) {
  const entries = () => {
    const byUri = new Map<unknown, [unknown, unknown[]]>()
    const listed: [unknown, unknown[]][] = []
    for (const entry of allEntries) {
      if (entry['_type'] !== 2) {
        continue
      }
      let known = byUri.get(entry['uri'])
      if (known === undefined) {
        known = [entry['uri'], []]
        byUri.set(entry['uri'], known)
        listed.push(known)
      }
      known[1].push(entry['edit'])
    }
    return listed
  }
  return {
    entries,
    get size() {
      return entries().length
    },
    _allEntries: () => allEntries,
  }
}
const virtualUri = { scheme: 'untitled', fsPath: 'Untitled-1' }

beforeEach(() => {
  answers.clear()
  vi.mocked(vscode.commands.executeCommand).mockReset()
  vi.mocked(vscode.commands.executeCommand).mockImplementation(((
    command: string,
    ...args: unknown[]
  ) => Promise.resolve(answers.get(command)?.(...args))) as typeof vscode.commands.executeCommand)
})

describe('vscodeLanguageServices', () => {
  const services = vscodeLanguageServices()

  it('opens a document without showing it', async () => {
    vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue({
      languageId: 'typescript',
      getText: () => 'text',
      isDirty: true,
    } as unknown as vscode.TextDocument)
    expect(await services.open(FILE)).toEqual({
      languageId: 'typescript',
      text: 'text',
      isDirty: true,
    })
  })

  it('reads locations and links, asking at the position given', async () => {
    answers.set(VSCODE_COMMANDS.executeDefinitionProvider, (uri, position) => {
      expect(uri).toMatchObject({ fsPath: FILE })
      expect(position).toMatchObject(AT)
      return [
        { uri: fileUri, range: range(0, 1, 2) },
        { targetUri: fileUri, targetRange: range(3, 0, 9), targetSelectionRange: range(3, 4, 5) },
        { targetUri: virtualUri, targetRange: range(4, 0, 1) },
      ]
    })
    answers.set(VSCODE_COMMANDS.executeReferenceProvider, () => [
      { uri: fileUri, range: range(7, 0, 3) },
    ])
    expect(await services.definitions(FILE, AT)).toEqual([
      { path: FILE, range: range(0, 1, 2) },
      { path: FILE, range: range(3, 4, 5) },
      { path: undefined, range: range(4, 0, 1) },
    ])
    expect(await services.references(FILE, AT)).toEqual([{ path: FILE, range: range(7, 0, 3) }])
    answers.clear()
    expect(await services.definitions(FILE, AT)).toEqual([])
    expect(await services.references(FILE, AT)).toEqual([])
    expect(await services.hover(FILE, AT)).toEqual([])
    expect(await services.documentSymbols(FILE)).toEqual([])
    expect(await services.workspaceSymbols('x')).toEqual([])
  })

  it('reads hover parts as Markdown, code fenced, an unknown shape as it came', async () => {
    answers.set(VSCODE_COMMANDS.executeHoverProvider, () => [
      { contents: ['plain', { language: 'ts', value: 'let x' }, { value: '**md**' }, 42] },
    ])
    expect(await services.hover(FILE, AT)).toEqual(['plain', '```ts\nlet x\n```', '**md**', '42'])
  })

  it('reads document symbols in both of their shapes, and workspace symbols', async () => {
    const child = {
      name: 'run',
      kind: 5,
      detail: '()',
      range: range(2, 0, 9),
      selectionRange: range(2, 2, 5),
      children: [],
    }
    answers.set(VSCODE_COMMANDS.executeDocumentSymbolProvider, () => [
      {
        name: 'Host',
        kind: 4,
        detail: '',
        range: range(1, 0, 20),
        selectionRange: range(1, 6, 10),
        children: [child],
      },
      {
        name: 'flat',
        kind: 12,
        containerName: 'Host',
        location: { uri: fileUri, range: range(9, 0, 4) },
      },
    ])
    answers.set(VSCODE_COMMANDS.executeWorkspaceSymbolProvider, (query) => [
      {
        name: String(query),
        kind: 11,
        containerName: '',
        location: { uri: virtualUri, range: range(0, 0, 1) },
      },
    ])
    const [host, flat] = await services.documentSymbols(FILE)
    expect(host).toMatchObject({
      name: 'Host',
      selection: range(1, 6, 10),
      location: { path: FILE, range: range(1, 0, 20) },
      children: [{ name: 'run', detail: '()', selection: range(2, 2, 5) }],
    })
    expect(flat).toMatchObject({
      name: 'flat',
      container: 'Host',
      selection: range(9, 0, 4),
      children: [],
    })
    expect(await services.workspaceSymbols('greet')).toMatchObject([
      { name: 'greet', kind: 11, location: { path: undefined } },
    ])
  })

  it("names VS Code's installation and every extension's folder as library roots", () => {
    mockExtensions.all = [{ extensionPath: '/ext/ms-python.python' }]
    expect(services.libraryRoots()).toEqual(['/vscode/resources/app', '/ext/ms-python.python'])
  })

  it('prepares a call hierarchy and reads its calls either way', async () => {
    const item = {
      name: 'greet',
      kind: 11,
      uri: fileUri,
      range: range(0, 0, 30),
      selectionRange: range(0, 16, 21),
    }
    const caller = { ...item, name: 'main', detail: 'main.ts' }
    answers.set(VSCODE_COMMANDS.prepareCallHierarchy, () => [item])
    answers.set(VSCODE_COMMANDS.provideIncomingCalls, () => [
      { from: caller, fromRanges: [range(5, 2, 7)] },
    ])
    answers.set(VSCODE_COMMANDS.provideOutgoingCalls, () => [
      { to: caller, fromRanges: [range(1, 2, 7)] },
    ])
    expect(await services.callHierarchy(FILE, AT, 'incoming')).toMatchObject({
      item: { name: 'greet', selection: range(0, 16, 21) },
      calls: [{ symbol: { name: 'main', detail: 'main.ts' }, ranges: [range(5, 2, 7)] }],
    })
    expect(await services.callHierarchy(FILE, AT, 'outgoing')).toMatchObject({
      calls: [{ symbol: { name: 'main' }, ranges: [range(1, 2, 7)] }],
    })
    answers.set(VSCODE_COMMANDS.provideIncomingCalls, () => undefined)
    answers.set(VSCODE_COMMANDS.provideOutgoingCalls, () => undefined)
    expect(await services.callHierarchy(FILE, AT, 'incoming')).toMatchObject({ calls: [] })
    expect(await services.callHierarchy(FILE, AT, 'outgoing')).toMatchObject({ calls: [] })
    answers.set(VSCODE_COMMANDS.prepareCallHierarchy, () => [])
    expect(await services.callHierarchy(FILE, AT, 'incoming')).toBeUndefined()
  })

  it('asks the one of several call items declared at the position, and counts the others', async () => {
    const at = { line: 3, character: 18 }
    const elsewhere = { name: 'greet', kind: 11, uri: vscode.Uri.file('/ws/b.ts') }
    const items = [
      { ...elsewhere, range: range(3, 0, 30), selectionRange: range(3, 16, 21) },
      { ...elsewhere, uri: fileUri, range: range(0, 0, 30), selectionRange: range(0, 16, 21) },
      { ...elsewhere, uri: fileUri, range: range(3, 0, 30), selectionRange: range(3, 16, 21) },
    ]
    answers.set(VSCODE_COMMANDS.prepareCallHierarchy, () => items)
    answers.set(VSCODE_COMMANDS.provideIncomingCalls, (item) => [
      { from: item, fromRanges: [range(9, 0, 5)] },
    ])
    expect(await services.callHierarchy(FILE, at, 'incoming')).toMatchObject({
      item: { location: { path: FILE }, selection: range(3, 16, 21) },
      otherItems: 2,
    })
    // None declared at the position: the first.
    expect(await services.callHierarchy(FILE, { line: 7, character: 0 }, 'incoming')).toMatchObject(
      { item: { location: { path: '/ws/b.ts' } }, otherItems: 2 },
    )
  })

  it("reads a rename's edits, notices file operations, and passes a refusal on", async () => {
    const edits = [{ range: range(0, 16, 21), newText: 'welcome' }]
    let workspaceEdit: unknown = vsCodeWorkspaceEdit([{ _type: 2, uri: fileUri, edit: edits[0] }])
    answers.set(VSCODE_COMMANDS.executeDocumentRenameProvider, (_uri, _position, newName) => {
      expect(newName).toBe('welcome')
      return workspaceEdit
    })
    expect(await services.rename(FILE, AT, 'welcome')).toEqual({
      files: [{ path: FILE, edits: [{ range: range(0, 16, 21), newText: 'welcome' }] }],
      fileOperations: 'none',
    })
    // A file moved by the rename: VS Code's `entries()` and `size` do not show it.
    workspaceEdit = vsCodeWorkspaceEdit([
      { _type: 2, uri: fileUri, edit: edits[0] },
      { _type: 1, from: fileUri, to: virtualUri },
    ])
    expect(await services.rename(FILE, AT, 'welcome')).toMatchObject({
      files: [{ path: FILE }],
      fileOperations: 'present',
    })
    // A VS Code whose edit no longer says: the rename is refused as unknown.
    workspaceEdit = { size: 1, entries: () => [[fileUri, edits]] }
    expect(await services.rename(FILE, AT, 'welcome')).toMatchObject({ fileOperations: 'unknown' })
    workspaceEdit = { entries: () => [[fileUri, edits]], _allEntries: () => [{ kind: 'text' }] }
    expect(await services.rename(FILE, AT, 'welcome')).toMatchObject({ fileOperations: 'unknown' })
    answers.delete(VSCODE_COMMANDS.executeDocumentRenameProvider)
    expect(await services.rename(FILE, AT, 'welcome')).toEqual({
      files: [],
      fileOperations: 'none',
    })
    vi.mocked(vscode.commands.executeCommand).mockImplementation(((command: string) =>
      command === VSCODE_COMMANDS.prepareRename
        ? Promise.reject(new Error('You cannot rename this element.'))
        : Promise.resolve(undefined)) as typeof vscode.commands.executeCommand)
    await expect(services.rename(FILE, AT, 'welcome')).rejects.toThrow(
      'You cannot rename this element.',
    )
  })
})
