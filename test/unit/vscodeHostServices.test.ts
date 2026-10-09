import { runInNewContext } from 'node:vm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as vscode from 'vscode'
import { createVscodeHostServices, VscodeHostError } from '../../src/host/vscode/hostServices'
import { MHP, MHP_ERROR_CODES, VSCODE_COMMANDS } from '../../src/shared/constants'
import { FakeTextDocument } from './helpers/fakes'
import {
  commands,
  env,
  languages,
  Position,
  Range,
  Selection,
  Uri,
  window,
  workspace,
} from './mocks/vscode'

function unused(): never {
  throw new Error('unused fake editor operation')
}
function fakeState() {
  return {
    get: vi.fn<(key: string) => unknown>(),
    update: vi.fn<vscode.Memento['update']>(() => Promise.resolve()),
  }
}
function rig() {
  const globalState = fakeState()
  const workspaceState = fakeState()
  const document = new FakeTextDocument(Uri.file('/doc'), 'typescript', 'old text')
  const clamp = (at: vscode.Position) => {
    const line = Math.min(at.line, document.lineCount - 1)
    return new Position(line, Math.min(at.character, document.lineAt(line).text.length))
  }
  vi.spyOn(document, 'validatePosition').mockImplementation(clamp)
  vi.spyOn(document, 'validateRange').mockImplementation(
    (range) => new Range(clamp(range.start), clamp(range.end)),
  )
  const replaces = vi.fn<vscode.TextEditorEdit['replace']>()
  const inserts = vi.fn<vscode.TextEditorEdit['insert']>()
  const edit = vi.fn<vscode.TextEditor['edit']>((callback) => {
    callback({ replace: replaces, insert: inserts, delete: unused, setEndOfLine: unused })
    return Promise.resolve(true)
  })
  const selection = new Selection(new Position(0, 0), new Position(0, 3))
  const editor: vscode.TextEditor = {
    document,
    selection,
    selections: [selection],
    visibleRanges: [],
    options: {},
    viewColumn: 1,
    edit,
    insertSnippet: unused,
    setDecorations: unused,
    revealRange: vi.fn(),
    show: unused,
    hide: unused,
  }
  workspace.openTextDocument.mockResolvedValue(document)
  window.showTextDocument.mockResolvedValue(editor)
  vi.spyOn(window, 'activeTextEditor', 'get').mockReturnValue(editor)
  vi.spyOn(workspace, 'textDocuments', 'get').mockReturnValue([document])
  const services = createVscodeHostServices({ globalState, workspaceState })
  return { services, document, editor, edit, replaces, inserts, globalState, workspaceState }
}
const uri = 'file:///doc'
const span = { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }
const edits = {
  uri,
  expectedVersion: 1,
  edits: [{ range: span, newText: 'new' }],
  undoLabel: 'Apply',
}

afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.clearAllMocks()
  workspace.isTrusted = true
})

describe('VS Code HostServices in-process boundary', () => {
  it('validates params and returned values before crossing the boundary', async () => {
    const r = rig()
    await expect(r.services.request('documents/read', { uri })).resolves.toEqual({
      document: { uri, version: 1, dirty: false, languageId: 'typescript' },
      text: 'old text',
    })
    await expect(r.services.request('documents/read', { uri: 'invalid' })).rejects.toMatchObject({
      error: { code: MHP_ERROR_CODES.invalidParams },
    })
    Object.defineProperty(r.document, 'version', { value: 'invalid' })
    await expect(r.services.request('documents/read', { uri })).rejects.toMatchObject({
      error: { code: MHP_ERROR_CODES.internalError, message: 'MHP_INVALID_RESULT' },
    })
  })
  it('negotiates frozen v1, explicitly refuses unbound methods, and closes on shutdown', async () => {
    const r = rig()
    const params = {
      host: { id: 'vscode', version: 'test' },
      protocolRange: { minimum: MHP.version, maximumExclusive: MHP.maximumVersionExclusive },
      capabilities: ['lifecycle'] as const,
      locale: 'en',
      theme: { kind: 'dark' as const, tokens: {} },
      folders: [],
      trusted: true,
    }
    await expect(
      r.services.request('initialize', { ...params, capabilities: [...params.capabilities] }),
    ).resolves.toEqual({ protocolVersion: MHP.version, capabilities: ['lifecycle'] })
    await expect(
      r.services.request('initialize', {
        ...params,
        capabilities: [...params.capabilities],
        protocolRange: { minimum: 'mhp/2.0.0', maximumExclusive: 'mhp/3.0.0' },
      }),
    ).rejects.toBeInstanceOf(VscodeHostError)
    await expect(r.services.request('voice/capture', { action: 'start' })).rejects.toMatchObject({
      error: { code: MHP_ERROR_CODES.unsupportedCapability, data: { capability: 'voice' } },
    })
    expect(() => {
      r.services.notify('commands/execute', { id: 'command' })
    }).toThrow('MHP_NOTIFICATION_UNBOUND')
    await r.services.request('shutdown', {})
    await expect(r.services.request('window/state', {})).rejects.toThrow('MHP_HOST_CLOSED')
  })
  it('applies edits once with one undo and refuses stale versions before an edit', async () => {
    const r = rig()
    await expect(r.services.request('documents/applyEdits', edits)).resolves.toMatchObject({
      version: 1,
    })
    expect(r.edit).toHaveBeenCalledTimes(1)
    expect(r.edit.mock.calls[0]?.[1]).toEqual({ undoStopBefore: true, undoStopAfter: true })
    expect(r.replaces).toHaveBeenCalledExactlyOnceWith(
      new Range(new Position(0, 0), new Position(0, 3)),
      'new',
    )
    Object.defineProperty(r.document, 'isDirty', { value: true })
    await expect(
      r.services.request('documents/applyEdits', { ...edits, expectedVersion: 0 }),
    ).rejects.toMatchObject({
      error: {
        code: MHP_ERROR_CODES.versionConflict,
        data: { expectedVersion: 0, actualVersion: 1 },
      },
    })
    expect(r.edit).toHaveBeenCalledTimes(1)
  })
  it('rechecks version and trust after showing an editor and before a mutation', async () => {
    const r = rig()
    window.showTextDocument.mockImplementationOnce(() => {
      Object.defineProperty(r.document, 'version', { value: 2, configurable: true })
      return Promise.resolve(r.editor)
    })
    await expect(r.services.request('documents/applyEdits', edits)).rejects.toThrow(
      'MHP_VERSION_CONFLICT',
    )
    expect(r.edit).not.toHaveBeenCalled()
    Object.defineProperty(r.document, 'version', { value: 1 })
    window.showTextDocument.mockImplementationOnce(() => {
      workspace.isTrusted = false
      return Promise.resolve(r.editor)
    })
    await expect(r.services.request('documents/applyEdits', edits)).rejects.toThrow(
      'MHP_UNTRUSTED_WORKSPACE',
    )
    expect(r.edit).not.toHaveBeenCalled()
  })
  it('rechecks trust after opening a document before a mutation', async () => {
    const r = rig()
    workspace.openTextDocument.mockImplementationOnce(() => {
      workspace.isTrusted = false
      return Promise.resolve(r.document)
    })
    const save = vi.spyOn(r.document, 'save')
    await expect(r.services.request('documents/save', { uri, expectedVersion: 1 })).rejects.toThrow(
      'MHP_UNTRUSTED_WORKSPACE',
    )
    expect(save).not.toHaveBeenCalled()
    expect(r.edit).not.toHaveBeenCalled()
  })
  it('refuses reversed, out-of-bounds and overlapping edits without editor effects', async () => {
    const r = rig()
    const ranges = [
      { start: span.end, end: span.start },
      { start: { line: 99, character: 0 }, end: { line: 99, character: 1 } },
    ]
    for (const range of ranges)
      await expect(
        r.services.request('documents/applyEdits', {
          ...edits,
          edits: [{ range, newText: 'new' }],
        }),
      ).rejects.toMatchObject({ error: { code: MHP_ERROR_CODES.invalidParams } })
    await expect(
      r.services.request('documents/applyEdits', {
        ...edits,
        edits: [...edits.edits, ...edits.edits],
      }),
    ).rejects.toThrow('MHP_OVERLAPPING_EDITS')
    expect(r.edit).not.toHaveBeenCalled()
    expect(window.showTextDocument).not.toHaveBeenCalled()
  })
  it('honors cancellation before and after an asynchronous document open', async () => {
    const r = rig(),
      abort = new AbortController()
    abort.abort()
    await expect(r.services.request('documents/applyEdits', edits, abort.signal)).rejects.toThrow(
      'MHP_CANCELLED',
    )
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
    const later = new AbortController()
    workspace.openTextDocument.mockImplementationOnce(() => {
      later.abort()
      return Promise.resolve(r.document)
    })
    await expect(r.services.request('documents/applyEdits', edits, later.signal)).rejects.toThrow(
      'MHP_CANCELLED',
    )
    expect(r.edit).not.toHaveBeenCalled()
  })
  it('rejects unknown JavaScript calls, initial distrust and invalid caret positions', async () => {
    const r = rig()
    // A plain JavaScript caller can supply a method TypeScript would reject.
    const result: unknown = runInNewContext('service.request("constructor", {})', {
      service: r.services,
    })
    await expect(result).rejects.toThrow('MHP_METHOD_NOT_FOUND')
    workspace.isTrusted = false
    await expect(r.services.request('documents/applyEdits', edits)).rejects.toThrow(
      'MHP_UNTRUSTED_WORKSPACE',
    )
    expect(workspace.openTextDocument).not.toHaveBeenCalled()
    workspace.isTrusted = true
    await expect(
      r.services.request('editor/insertAtCursor', {
        uri,
        expectedVersion: 1,
        position: { line: 99, character: 0 },
        text: 'new',
        undoLabel: 'Insert',
      }),
    ).rejects.toThrow('MHP_INVALID_POSITION')
    expect(r.edit).not.toHaveBeenCalled()
  })
  it('validates optional feature handlers, notifications and settings updates', async () => {
    const r = rig(),
      notify = vi.fn()
    const status = vi.fn(() => Promise.resolve(null))
    const service = createVscodeHostServices(
      { globalState: r.globalState, workspaceState: r.workspaceState },
      { handlers: { 'ui/status': status }, onNotification: notify },
    )
    await service.request('ui/status', { id: 'status', text: 'Ready', visible: true })
    expect(status).toHaveBeenCalledExactlyOnceWith(
      { id: 'status', text: 'Ready', visible: true },
      undefined,
    )
    service.notify('commands/execute', { id: 'command' })
    expect(notify).toHaveBeenCalledExactlyOnceWith('commands/execute', { id: 'command' })
    expect(() => {
      runInNewContext('service.notify("commands/execute", {id: 1})', { service })
    }).toThrow('MHP_INVALID_PARAMS')
    expect(() => {
      runInNewContext('service.notify("constructor", {})', { service })
    }).toThrow('MHP_METHOD_NOT_FOUND')
    await service.request('shutdown', {})
    expect(() => {
      service.notify('commands/execute', { id: 'command' })
    }).toThrow('MHP_HOST_CLOSED')
    await expect(
      r.services.request('settings/get', { key: 'museSpark.unknownSetting' }),
    ).rejects.toThrow('MHP_UNKNOWN_SETTING')
    await expect(
      r.services.request('settings/update', {
        key: 'museSpark.modelApiRepoMap',
        value: 1,
        scope: 'user',
      }),
    ).rejects.toThrow()
    await expect(
      r.services.request('settings/update', {
        key: 'museSpark.environmentVariables',
        value: [{ name: 'META_API_KEY', value: 'dummy' }],
        scope: 'user',
      }),
    ).rejects.toThrow('MHP_CREDENTIAL_REFUSED')
    expect(workspace.getConfiguration).not.toHaveBeenCalled()
  })
  it('keeps insert and apply on the selected editor, and reports failed edit/save operations', async () => {
    const r = rig()
    await r.services.request('editor/insertAtCursor', {
      uri,
      expectedVersion: 1,
      position: span.start,
      text: 'insert',
      undoLabel: 'Insert',
    })
    expect(r.inserts).toHaveBeenCalledExactlyOnceWith(new Position(0, 0), 'insert')
    await r.services.request('editor/replaceSelection', {
      uri,
      expectedVersion: 1,
      range: span,
      text: 'replace',
      undoLabel: 'Apply',
    })
    expect(r.editor.revealRange).toHaveBeenCalledWith(r.editor.selection)
    r.edit.mockResolvedValueOnce(false)
    await expect(r.services.request('documents/applyEdits', edits)).rejects.toThrow(
      'MHP_EDIT_NOT_APPLIED',
    )
    vi.spyOn(r.document, 'save').mockResolvedValueOnce(false)
    await expect(r.services.request('documents/save', { uri, expectedVersion: 1 })).rejects.toThrow(
      'MHP_SAVE_FAILED',
    )
    vi.spyOn(window, 'activeTextEditor', 'get').mockReturnValue(undefined)
    await expect(
      r.services.request('editor/replaceSelection', {
        uri,
        expectedVersion: 1,
        range: span,
        text: 'replace',
        undoLabel: 'Apply',
      }),
    ).rejects.toThrow('MHP_EDITOR_NOT_ACTIVE')
  })
  it('retains modal detail, stable choice ids, clipboard and folder behavior', async () => {
    const r = rig()
    const chosen: vscode.MessageItem & { id: number } = { id: 1, title: 'Continue' }
    window.showWarningMessage.mockResolvedValueOnce(chosen)
    expect(
      await r.services.request('ui/confirm', {
        title: 'Warning',
        message: 'Detail',
        choices: [{ id: 1, title: 'Continue' }],
      }),
    ).toBe(1)
    expect(window.showWarningMessage).toHaveBeenCalledExactlyOnceWith(
      'Warning',
      { modal: true, detail: 'Detail' },
      { id: 1, title: 'Continue' },
    )
    await r.services.request('ui/clipboard', { text: 'Code' })
    expect(env.clipboard.writeText).toHaveBeenCalledExactlyOnceWith('Code')
    workspace.saveAll.mockResolvedValueOnce(true)
    expect(await r.services.request('documents/saveAll', {})).toEqual({ saved: true })
    await r.services.request('workspace/openFolder', { uri: 'file:///attempt', newWindow: true })
    expect(commands.executeCommand).toHaveBeenCalledWith(
      VSCODE_COMMANDS.openFolder,
      Uri.parse('file:///attempt'),
      { forceNewWindow: true },
    )
  })
  it('bounds active selection text and maps diagnostics', async () => {
    const r = rig()
    const text = 'x'.repeat(MHP.maximumSelectionChars + 1)
    vi.spyOn(r.document, 'getText').mockReturnValue(text)
    const active = await r.services.request('editor/active', {})
    expect(active?.excerpt).toHaveLength(MHP.maximumSelectionChars)
    expect(active?.truncated).toBe(true)
    languages.getDiagnostics.mockReturnValueOnce([
      [
        Uri.file('/doc'),
        [
          {
            range: new Range(new Position(0, 0), new Position(0, 1)),
            severity: 0,
            message: 'Problem',
          },
        ],
      ],
    ])
    expect(await r.services.request('diagnostics/get', {})).toHaveLength(1)
  })
  it('refuses credentials in settings and storage before persisting or returning them', async () => {
    const r = rig()
    for (const [key, value] of [
      ['apiKey', 'dummy'],
      ['normal', { password: 'dummy' }],
      ['environment', { name: 'META_API_KEY', value: 'dummy' }],
      ['normal', 'sk-' + 'x'.repeat(40)],
    ] as const) {
      await expect(r.services.request('storage/global.set', { key, value })).rejects.toThrow(
        'MHP_CREDENTIAL_REFUSED',
      )
    }
    expect(r.globalState.update).not.toHaveBeenCalled()
    await expect(r.services.request('storage/global.get', { key: 'apiKey' })).rejects.toThrow(
      'MHP_CREDENTIAL_REFUSED',
    )
    expect(r.globalState.get).not.toHaveBeenCalled()
    r.workspaceState.get.mockReturnValueOnce({ secret: 'dummy' })
    await expect(r.services.request('storage/workspace.get', { key: 'normal' })).rejects.toThrow(
      'MHP_CREDENTIAL_REFUSED',
    )
    await r.services.request('storage/workspace.set', { key: 'normal', value: { theme: 'dark' } })
    expect(r.workspaceState.update).toHaveBeenCalledExactlyOnceWith('normal', { theme: 'dark' })
  })
})
