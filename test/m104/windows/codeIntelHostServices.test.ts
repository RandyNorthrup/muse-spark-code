import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createVscodeHostServices } from '../../../src/host/vscode/hostServices'
import { MHP, MHP_ERROR_CODES, VSCODE_COMMANDS } from '../../../src/shared/constants'
import { FakeTextDocument } from '../../unit/helpers/fakes'
import { commands, Position, Range, Uri, workspace } from '../../unit/mocks/vscode'

const span = new Range(new Position(0, 0), new Position(0, 4))
const wireRange = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } }
function rig() {
  const source = new FakeTextDocument(Uri.file('/fixture/source.ts'), 'typescript', 'name 😀')
  workspace.openTextDocument.mockResolvedValue(source)
  vi.spyOn(workspace, 'textDocuments', 'get').mockReturnValue([source])
  const state = { get: () => undefined, update: () => Promise.resolve() }
  const subscriptions: vscode.Disposable[] = []
  const host = createVscodeHostServices({
    globalState: state,
    workspaceState: state,
    subscriptions,
  })
  const at = { uri: source.uri.toString(), position: { line: 0, character: 1 } }
  return { source, host, at, subscriptions }
}
function symbol(uri: vscode.Uri): vscode.CallHierarchyItem {
  return { name: 'name', kind: 11, uri, range: span, selectionRange: span }
}
beforeEach(() => {
  vi.clearAllMocks()
  commands.executeCommand.mockReset()
  workspace.isTrusted = true
})
afterEach(() => vi.restoreAllMocks())

describe('native frozen code-intelligence services', () => {
  it.each(['cancel', 'close', 'dispose'])(
    'releases a suspended native query on %s and ignores its late answer',
    async (failure) => {
      const r = rig()
      const started = Promise.withResolvers<boolean>()
      const provider = Promise.withResolvers<unknown>()
      const signal = new AbortController()
      commands.executeCommand.mockImplementation(() => {
        started.resolve(true)
        return provider.promise
      })
      const query = r.host.request('codeIntel/definition', r.at, signal.signal)
      const refused = expect(query).rejects.toThrow(
        failure === 'cancel' ? 'MHP_CANCELLED' : 'MHP_HOST_CLOSED',
      )
      await started.promise
      if (failure === 'cancel') signal.abort()
      else if (failure === 'close') await r.host.request('shutdown', {})
      else for (const subscription of r.subscriptions) subscription.dispose()
      await refused
      provider.resolve([{ uri: r.source.uri, range: span }])
      await provider.promise
      expect(commands.executeCommand).toHaveBeenCalledTimes(1)
    },
  )
  it('declares the complete request-only group and preserves virtual definition URIs', async () => {
    const r = rig()
    const target = Uri.file('/notebook/cell')
    Object.defineProperty(target, 'scheme', { value: 'vscode-notebook-cell' })
    commands.executeCommand.mockResolvedValue([{ targetUri: target, targetRange: span }])
    await expect(r.host.request('codeIntel/definition', r.at)).resolves.toEqual([
      { uri: target.toString(), range: wireRange },
    ])
    expect(commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      VSCODE_COMMANDS.executeDefinitionProvider,
      r.source.uri,
      new Position(0, 1),
    )
    const result = await r.host.request('initialize', {
      host: { id: 'vscode', version: 'fixture' },
      protocolRange: { minimum: MHP.version, maximumExclusive: MHP.maximumVersionExclusive },
      capabilities: ['lifecycle'],
      locale: 'en',
      theme: { kind: 'dark', tokens: {} },
      folders: [],
      trusted: true,
    })
    expect(result.capabilities).toContain('codeIntel')
  })

  it('honors declaration exclusion while retaining unrelated references', async () => {
    const r = rig()
    const use = new Range(new Position(0, 5), new Position(0, 7))
    const declaration = { uri: r.source.uri, range: span }
    commands.executeCommand
      .mockResolvedValueOnce([declaration, { uri: r.source.uri, range: use }])
      .mockResolvedValueOnce([declaration])
    const result = await r.host.request('codeIntel/references', {
      ...r.at,
      includeDeclaration: false,
    })
    expect(result).toEqual([
      {
        uri: r.at.uri,
        range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } },
      },
    ])
    commands.executeCommand.mockReset().mockResolvedValue([declaration])
    await expect(
      r.host.request('codeIntel/references', { ...r.at, includeDeclaration: true }),
    ).resolves.toHaveLength(1)
    expect(commands.executeCommand).toHaveBeenCalledTimes(1)
  })

  it('flattens nested document symbols with containers and reads native hover/workspace symbols', async () => {
    const r = rig()
    const child: vscode.DocumentSymbol = {
      name: 'child',
      detail: '',
      kind: 11,
      range: span,
      selectionRange: span,
      children: [],
    }
    commands.executeCommand.mockResolvedValueOnce([
      {
        name: 'parent',
        detail: '',
        kind: 11,
        range: span,
        selectionRange: span,
        children: [child],
      },
    ])
    const rows = await r.host.request('codeIntel/documentSymbols', { uri: r.at.uri })
    expect(rows.map((row) => [row.name, row.container])).toEqual([
      ['parent', undefined],
      ['child', 'parent'],
    ])
    expect(rows.every((row) => row.location.uri === r.at.uri)).toBe(true)
    commands.executeCommand.mockResolvedValueOnce([
      { contents: [{ value: 'native hover' }, { language: 'ts', value: 'name' }] },
    ])
    await expect(r.host.request('codeIntel/hover', r.at)).resolves.toEqual([
      'native hover',
      '```ts\nname\n```',
    ])
    commands.executeCommand.mockResolvedValueOnce([
      {
        name: 'workspace',
        kind: 11,
        containerName: 'module',
        location: { uri: r.source.uri, range: span },
      },
    ])
    await expect(
      r.host.request('codeIntel/workspaceSymbols', { query: 'work' }),
    ).resolves.toMatchObject([{ name: 'workspace', container: 'module' }])
  })

  it('reads both native prepare-rename forms and returns explicit no-provider results', async () => {
    const r = rig()
    commands.executeCommand
      .mockResolvedValueOnce({ range: span, placeholder: 'native' })
      .mockResolvedValueOnce(span)
      .mockResolvedValueOnce(undefined)
    await expect(r.host.request('codeIntel/prepareRename', r.at)).resolves.toEqual({
      range: wireRange,
      placeholder: 'native',
    })
    await expect(r.host.request('codeIntel/prepareRename', r.at)).resolves.toEqual({
      range: wireRange,
      placeholder: 'name',
    })
    await expect(r.host.request('codeIntel/prepareRename', r.at)).resolves.toBeNull()
    await expect(
      r.host.request('codeIntel/rename', { ...r.at, newName: 'next' }),
    ).rejects.toMatchObject({
      error: { code: MHP_ERROR_CODES.unsupportedCapability, message: 'MHP_RENAME_UNAVAILABLE' },
    })
  })

  it('returns versioned text-only rename plans without changing the editor', async () => {
    const r = rig()
    commands.executeCommand.mockResolvedValue({
      entries: () => [[r.source.uri, [{ range: span, newText: 'next' }]]],
      _allEntries: () => [{ _type: 2 }],
    })
    await expect(r.host.request('codeIntel/rename', { ...r.at, newName: 'next' })).resolves.toEqual(
      {
        fileOperations: 'none',
        files: [
          { uri: r.at.uri, expectedVersion: 1, edits: [{ range: wireRange, newText: 'next' }] },
        ],
      },
    )
    expect(r.source.getText()).toBe('name 😀')
  })

  it.each(['present', 'unknown'])(
    'refuses to claim file-operation support when operations are %s',
    async (kind) => {
      const r = rig()
      const entries = () => [[r.source.uri, [{ range: span, newText: 'next' }]]]
      commands.executeCommand.mockResolvedValue(
        kind === 'present' ? { entries, _allEntries: () => [{ _type: 1 }] } : { entries },
      )
      await expect(
        r.host.request('codeIntel/rename', { ...r.at, newName: 'next' }),
      ).resolves.toEqual({ files: [], fileOperations: kind })
    },
  )

  it.each(['dirty', 'changed', 'unobserved'])(
    'refuses %s target snapshots in a rename plan',
    async (failure) => {
      const r = rig()
      const target = new FakeTextDocument(Uri.file('/fixture/target.ts'), 'typescript', 'name')
      vi.spyOn(workspace, 'textDocuments', 'get').mockReturnValue(
        failure === 'unobserved' ? [r.source] : [r.source, target],
      )
      workspace.openTextDocument.mockResolvedValueOnce(r.source).mockResolvedValueOnce(target)
      commands.executeCommand.mockImplementation(() => {
        if (failure === 'dirty') Object.defineProperty(target, 'isDirty', { value: true })
        else if (failure === 'changed') Object.defineProperty(target, 'version', { value: 2 })
        return Promise.resolve({
          entries: () => [[target.uri, [{ range: span, newText: 'next' }]]],
          _allEntries: () => [{ _type: 2 }],
        })
      })
      await expect(
        r.host.request('codeIntel/rename', { ...r.at, newName: 'next' }),
      ).rejects.toThrow(failure === 'dirty' ? 'MHP_DIRTY_BUFFER' : 'MHP_VERSION_CONFLICT')
      expect(target.getText()).toBe('name')
    },
  )

  it.each(['incoming', 'outgoing'] as const)(
    'returns %s call hierarchies with UTF-16 ranges',
    async (direction) => {
      const r = rig()
      const value = symbol(r.source.uri)
      const site = direction === 'incoming' ? { from: value } : { to: value }
      commands.executeCommand
        .mockResolvedValueOnce([value])
        .mockResolvedValueOnce([{ ...site, fromRanges: [span] }])
      await expect(
        r.host.request('codeIntel/callHierarchy', { ...r.at, direction }),
      ).resolves.toMatchObject({
        item: { location: { uri: r.at.uri } },
        calls: [{ ranges: [wireRange] }],
        otherItems: 0,
      })
      expect(commands.executeCommand.mock.calls[1]?.[0]).toBe(
        direction === 'incoming'
          ? VSCODE_COMMANDS.provideIncomingCalls
          : VSCODE_COMMANDS.provideOutgoingCalls,
      )
    },
  )

  it('asks the overload declared in this document and refuses when none is', async () => {
    const r = rig()
    const elsewhere = symbol(Uri.file('/elsewhere/one.ts'))
    const dotted = Uri.file('/fixture/./source.ts')
    commands.executeCommand
      .mockResolvedValueOnce([elsewhere, symbol(dotted)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([elsewhere, symbol(Uri.file('/elsewhere/two.ts'))])
    const call = { ...r.at, direction: 'incoming' } as const
    await expect(r.host.request('codeIntel/callHierarchy', call)).resolves.toMatchObject({
      item: { location: { uri: dotted.toString() } },
      otherItems: 1,
    })
    await expect(r.host.request('codeIntel/callHierarchy', call)).rejects.toMatchObject({
      error: { code: MHP_ERROR_CODES.invalidParams, message: 'MHP_CALL_HIERARCHY_AMBIGUOUS' },
    })
    expect(commands.executeCommand).toHaveBeenCalledTimes(3)
  })

  it('returns an unwritten formatting plan with native options', async () => {
    const r = rig()
    commands.executeCommand.mockResolvedValue([{ range: span, newText: 'next' }])
    await expect(
      r.host.request('codeIntel/format', {
        uri: r.at.uri,
        expectedVersion: 1,
        tabSize: 2,
        insertSpaces: true,
      }),
    ).resolves.toEqual([{ range: wireRange, newText: 'next' }])
    expect(commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      VSCODE_COMMANDS.formatDocument,
      r.source.uri,
      { tabSize: 2, insertSpaces: true },
    )
    expect(r.source.getText()).toBe('name 😀')
    Object.defineProperty(r.source, 'isDirty', { value: true })
    await expect(
      r.host.request('codeIntel/format', {
        uri: r.at.uri,
        expectedVersion: 1,
        tabSize: 2,
        insertSpaces: true,
      }),
    ).rejects.toThrow('MHP_DIRTY_BUFFER')
    expect(commands.executeCommand).toHaveBeenCalledTimes(1)
  })

  it('rejects stale expected formatting versions and invalid positions before provider dispatch', async () => {
    const r = rig()
    await expect(
      r.host.request('codeIntel/format', {
        uri: r.at.uri,
        expectedVersion: 0,
        tabSize: 2,
        insertSpaces: true,
      }),
    ).rejects.toMatchObject({ error: { code: MHP_ERROR_CODES.versionConflict } })
    vi.spyOn(r.source, 'validatePosition').mockReturnValue(new Position(0, 0))
    await expect(r.host.request('codeIntel/definition', r.at)).rejects.toMatchObject({
      error: { code: MHP_ERROR_CODES.invalidParams },
    })
    expect(commands.executeCommand).not.toHaveBeenCalled()
  })

  it.each(['version', 'trust', 'cancel', 'close'])(
    'rejects a late %s transition after provider completion',
    async (failure) => {
      const r = rig()
      const abort = new AbortController()
      commands.executeCommand.mockImplementation(async () => {
        switch (failure) {
          case 'version': {
            Object.defineProperty(r.source, 'version', { value: 2 })
            break
          }
          case 'trust': {
            workspace.isTrusted = false
            break
          }
          case 'cancel': {
            abort.abort()
            break
          }
          case 'close': {
            await r.host.request('shutdown', {})
            break
          }
        }
        return [{ uri: r.source.uri, range: span }]
      })
      await expect(r.host.request('codeIntel/definition', r.at, abort.signal)).rejects.toThrow(
        {
          version: 'MHP_VERSION_CONFLICT',
          trust: 'MHP_UNTRUSTED_WORKSPACE',
          cancel: 'MHP_CANCELLED',
          close: 'MHP_HOST_CLOSED',
        }[failure],
      )
    },
  )

  it('rejects initial distrust and malformed provider results through the shared boundary', async () => {
    const r = rig()
    workspace.isTrusted = false
    await expect(r.host.request('codeIntel/workspaceSymbols', { query: 'name' })).rejects.toThrow(
      'MHP_UNTRUSTED_WORKSPACE',
    )
    expect(commands.executeCommand).not.toHaveBeenCalled()
    workspace.isTrusted = true
    commands.executeCommand.mockResolvedValue([{ range: span, newText: 1 }])
    await expect(
      r.host.request('codeIntel/format', {
        uri: r.at.uri,
        expectedVersion: 1,
        tabSize: 2,
        insertSpaces: true,
      }),
    ).rejects.toThrow('MHP_INVALID_RESULT')
  })
})
