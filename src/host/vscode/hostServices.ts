// In-process VS Code implementation of the frozen HostServices boundary.
// Features with their own existing drivers are passed to composition explicitly;
// unbound MHP methods refuse with a typed error rather than empty success.
import * as vscode from 'vscode'
import type * as z from 'zod/mini'
import { MHP, MHP_ERROR_CODES, SETTINGS_SECTION, VSCODE_COMMANDS } from '../../shared/constants'
import { isMhpVersionSupported } from '../../shared/hostApi/capabilities'
import {
  MHP_METHODS,
  type HostServices,
  type MhpParams,
  type MhpRequestMethod,
  type MhpNotificationMethod,
  type MhpResult,
} from '../../shared/hostApi/methods'
import { settingSchema } from '../settings'
import { countSecretMatches } from '../../shared/redact'
import { isCredentialVariable } from '../../core/credentialEnvironment'
import { jsonValueSchema, type errorSchema } from '../../shared/hostApi/data'

export class VscodeHostError extends Error {
  public constructor(public readonly error: z.infer<typeof errorSchema>) {
    super(error.message)
    this.name = 'VscodeHostError'
  }
}

export type HostServiceHandlers = {
  readonly [M in MhpRequestMethod]?: (
    params: MhpParams<M>,
    signal?: AbortSignal,
  ) => Promise<MhpResult<M>>
}
interface StatePort {
  get(key: string): unknown
  update(key: string, value: unknown): PromiseLike<void>
}
export interface VscodeHostOptions {
  /** Native feature drivers may bind additional frozen methods here. */
  readonly handlers?: HostServiceHandlers
  readonly onNotification?: <M extends MhpNotificationMethod>(
    method: M,
    params: MhpParams<M>,
  ) => void
}
const contracts: {
  readonly [M in keyof typeof MHP_METHODS]: {
    readonly params: z.ZodMiniType<MhpParams<M>>
  }
} = MHP_METHODS
const requests: {
  readonly [M in MhpRequestMethod]: {
    readonly result: z.ZodMiniType<MhpResult<M>>
  }
} = MHP_METHODS

function fail(code: z.infer<typeof errorSchema>['code'], message: string): never {
  throw new VscodeHostError({ code, message })
}
function checkCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) fail(MHP_ERROR_CODES.cancelled, 'MHP_CANCELLED')
}
function checkWorkspaceTrusted(): void {
  if (!vscode.workspace.isTrusted)
    fail(MHP_ERROR_CODES.untrustedWorkspace, 'MHP_UNTRUSTED_WORKSPACE')
}
function documentInfo(document: vscode.TextDocument): MhpResult<'documents/applyEdits'> {
  return {
    uri: document.uri.toString(),
    version: document.version,
    dirty: document.isDirty,
    languageId: document.languageId,
  }
}
function toRange(range: MhpParams<'editor/replaceSelection'>['range']): vscode.Range {
  const start = new vscode.Position(range.start.line, range.start.character)
  const end = new vscode.Position(range.end.line, range.end.character)
  if (end.isBefore(start)) fail(MHP_ERROR_CODES.invalidParams, 'MHP_REVERSED_RANGE')
  return new vscode.Range(start, end)
}
function fromRange(range: vscode.Range): MhpParams<'editor/replaceSelection'>['range'] {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}
async function versionedDocument(
  uri: string,
  expectedVersion: number,
  signal?: AbortSignal,
): Promise<vscode.TextDocument> {
  checkCancelled(signal)
  checkWorkspaceTrusted()
  const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
  checkCancelled(signal)
  checkWorkspaceTrusted()
  if (document.version !== expectedVersion) {
    throw new VscodeHostError({
      code: MHP_ERROR_CODES.versionConflict,
      message: 'MHP_VERSION_CONFLICT',
      data: { uri, expectedVersion, actualVersion: document.version },
    })
  }
  return document
}
function settingName(key: string): string {
  const name = key.slice(SETTINGS_SECTION.length + 1)
  if (settingSchema(name) === undefined) fail(MHP_ERROR_CODES.invalidParams, 'MHP_UNKNOWN_SETTING')
  return name
}

function checkStoredValue(key: string, value: z.infer<typeof jsonValueSchema>): void {
  const names = /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential)/iu
  const hasNamedCredential = (name: string, item: z.infer<typeof jsonValueSchema>): boolean =>
    names.test(name) ||
    (name === 'name' &&
      typeof item === 'string' &&
      (names.test(item) || isCredentialVariable(item))) ||
    (item !== null &&
      typeof item === 'object' &&
      Object.entries(item).some(([field, child]) => hasNamedCredential(field, child)))
  if (hasNamedCredential(key, value))
    fail(MHP_ERROR_CODES.permissionDenied, 'MHP_CREDENTIAL_REFUSED')
  if (countSecretMatches(JSON.stringify(value), []) > 0)
    fail(MHP_ERROR_CODES.permissionDenied, 'MHP_CREDENTIAL_REFUSED')
}
function storedValue(
  state: { get(key: string): unknown },
  key: string,
): { value: z.infer<typeof jsonValueSchema> } {
  checkStoredValue(key, null)
  const value = jsonValueSchema.parse(state.get(key) ?? null)
  checkStoredValue(key, value)
  return { value }
}

/** Every response is parsed even in-process. Optional feature bindings share that boundary. */
export function createVscodeHostServices(
  context: {
    readonly globalState: StatePort
    readonly workspaceState: StatePort
  },
  options: VscodeHostOptions = {},
): HostServices {
  let isClosed = false
  const handlers: HostServiceHandlers = {
    initialize: (params) => {
      if (!isMhpVersionSupported(params.protocolRange))
        fail(MHP_ERROR_CODES.incompatibleVersion, 'MHP_INCOMPATIBLE_VERSION')
      // Sparse declaration: feature drivers keep their existing explicit ports.
      return Promise.resolve({ protocolVersion: MHP.version, capabilities: ['lifecycle'] })
    },
    shutdown: () => {
      isClosed = true
      return Promise.resolve(null)
    },
    'workspace/folders': () =>
      Promise.resolve(
        (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
          uri: folder.uri.toString(),
          name: folder.name,
        })),
      ),
    'workspace/trust': () => Promise.resolve({ trusted: vscode.workspace.isTrusted }),
    'workspace/findFiles': async ({ include, exclude, limit }, signal) => {
      checkCancelled(signal)
      const files = await vscode.workspace.findFiles(include, exclude, limit)
      return files.map((uri) => uri.toString())
    },
    'workspace/openFolder': async ({ uri, newWindow }) => {
      await vscode.commands.executeCommand(VSCODE_COMMANDS.openFolder, vscode.Uri.parse(uri), {
        forceNewWindow: newWindow,
      })
      return null
    },
    'documents/list': () =>
      Promise.resolve(vscode.workspace.textDocuments.map((document) => documentInfo(document))),
    'documents/read': async ({ uri }) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
      return { document: documentInfo(document), text: document.getText() }
    },
    'documents/applyEdits': async ({ uri, expectedVersion, edits }, signal) => {
      const document = await versionedDocument(uri, expectedVersion, signal)
      const sorted = edits
        .map((edit) => ({ range: toRange(edit.range), text: edit.newText }))
        .toSorted((a, b) => a.range.start.compareTo(b.range.start))
      for (const [index, edit] of sorted.entries()) {
        if (!document.validateRange(edit.range).isEqual(edit.range))
          fail(MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_RANGE')
        const previous = sorted[index - 1]
        if (previous?.range.end.isAfter(edit.range.start))
          fail(MHP_ERROR_CODES.invalidParams, 'MHP_OVERLAPPING_EDITS')
      }
      const editor = await vscode.window.showTextDocument(document, {
        preserveFocus: true,
        preview: true,
      })
      checkCancelled(signal)
      // The editor can change while it is being shown: check again before edit.
      if (document.version !== expectedVersion)
        fail(MHP_ERROR_CODES.versionConflict, 'MHP_VERSION_CONFLICT')
      if (!vscode.workspace.isTrusted)
        fail(MHP_ERROR_CODES.untrustedWorkspace, 'MHP_UNTRUSTED_WORKSPACE')
      const isApplied = await editor.edit(
        (builder) => {
          for (const edit of sorted) builder.replace(edit.range, edit.text)
        },
        { undoStopBefore: true, undoStopAfter: true },
      )
      if (!isApplied) fail(MHP_ERROR_CODES.versionConflict, 'MHP_EDIT_NOT_APPLIED')
      return documentInfo(document)
    },
    'documents/save': async ({ uri, expectedVersion }, signal) => {
      const document = await versionedDocument(uri, expectedVersion, signal)
      if (!(await document.save())) fail(MHP_ERROR_CODES.internalError, 'MHP_SAVE_FAILED')
      return documentInfo(document)
    },
    'documents/saveAll': async () => ({ saved: await vscode.workspace.saveAll(false) }),
    'editor/active': () => {
      const editor = vscode.window.activeTextEditor
      if (editor === undefined) return Promise.resolve(null)
      const text = editor.document.getText(editor.selection)
      return Promise.resolve({
        uri: editor.document.uri.toString(),
        version: editor.document.version,
        range: fromRange(editor.selection),
        excerpt: text.slice(0, MHP.maximumSelectionChars),
        truncated: text.length > MHP.maximumSelectionChars,
      })
    },
    'editor/open': async ({ uri, range }) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(uri))
      const editor = await vscode.window.showTextDocument(document, { preview: true })
      if (range !== undefined) {
        const selected = toRange(range)
        editor.selection = new vscode.Selection(selected.start, selected.end)
        editor.revealRange(selected)
      }
      return null
    },
    'editor/insertAtCursor': async ({ uri, expectedVersion, position, text }, signal) => {
      const document = await versionedDocument(uri, expectedVersion, signal)
      const editor = vscode.window.activeTextEditor
      if (editor?.document !== document)
        fail(MHP_ERROR_CODES.invalidParams, 'MHP_EDITOR_NOT_ACTIVE')
      const at = new vscode.Position(position.line, position.character)
      if (!document.validatePosition(at).isEqual(at))
        fail(MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_POSITION')
      if (
        !(await editor.edit((builder) => {
          builder.insert(at, text)
        }))
      )
        fail(MHP_ERROR_CODES.versionConflict, 'MHP_EDIT_NOT_APPLIED')
      return documentInfo(document)
    },
    'editor/replaceSelection': async ({ uri, expectedVersion, range, text }, signal) => {
      const document = await versionedDocument(uri, expectedVersion, signal)
      const editor = vscode.window.activeTextEditor
      if (editor?.document !== document)
        fail(MHP_ERROR_CODES.invalidParams, 'MHP_EDITOR_NOT_ACTIVE')
      const selected = toRange(range)
      if (!document.validateRange(selected).isEqual(selected))
        fail(MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_RANGE')
      if (
        !(await editor.edit((builder) => {
          builder.replace(selected, text)
        }))
      )
        fail(MHP_ERROR_CODES.versionConflict, 'MHP_EDIT_NOT_APPLIED')
      editor.revealRange(editor.selection)
      return documentInfo(document)
    },
    'diff/open': async ({ left, right, title }) => {
      await vscode.commands.executeCommand(
        VSCODE_COMMANDS.diff,
        vscode.Uri.parse(left),
        vscode.Uri.parse(right),
        title,
      )
      return null
    },
    'diagnostics/get': ({ uri }) => {
      const entries =
        uri === undefined
          ? vscode.languages.getDiagnostics()
          : [
              [
                vscode.Uri.parse(uri),
                vscode.languages.getDiagnostics(vscode.Uri.parse(uri)),
              ] as const,
            ]
      return Promise.resolve(
        entries.flatMap(([file, diagnostics]) =>
          diagnostics.map((d) => ({
            uri: file.toString(),
            range: fromRange(d.range),
            severity: diagnosticSeverity(d.severity),
            message: d.message,
            ...(d.source !== undefined && { source: d.source }),
            ...(d.code !== undefined && {
              code: typeof d.code === 'object' ? d.code.value : d.code,
            }),
          })),
        ),
      )
    },
    'ui/notify': async ({ severity, message }) => {
      if (severity === 'error') await vscode.window.showErrorMessage(message)
      else if (severity === 'warning') await vscode.window.showWarningMessage(message)
      else await vscode.window.showInformationMessage(message)
      return null
    },
    'ui/confirm': async ({ title, message, choices }) => {
      const items = choices.map((choice) => ({ ...choice }))
      const picked = await vscode.window.showWarningMessage(
        title,
        { modal: true, detail: message },
        ...items,
      )
      return picked?.id ?? null
    },
    'ui/pick': async ({ title, items, multiple }) => {
      const choices = items.map((item) => ({ label: item.title, id: item.id }))
      if (multiple) {
        const picked = await vscode.window.showQuickPick(choices, { title, canPickMany: true })
        return picked?.map((item) => item.id) ?? null
      }
      const picked = await vscode.window.showQuickPick(choices, { title, canPickMany: false })
      return picked === undefined ? null : [picked.id]
    },
    'ui/input': async ({ title, prompt, value }) =>
      (await vscode.window.showInputBox({
        title,
        prompt,
        ...(value !== undefined && { value }),
      })) ?? null,
    'ui/openExternal': async ({ uri }) => {
      if (!(await vscode.env.openExternal(vscode.Uri.parse(uri))))
        fail(MHP_ERROR_CODES.internalError, 'MHP_OPEN_FAILED')
      return null
    },
    'ui/clipboard': async ({ text }) => {
      await vscode.env.clipboard.writeText(text)
      return null
    },
    'settings/get': ({ key }) => {
      settingName(key)
      const value = jsonValueSchema.parse(vscode.workspace.getConfiguration().get(key) ?? null)
      checkStoredValue(key, value)
      return Promise.resolve({ value })
    },
    'settings/update': async ({ key, value, scope }) => {
      const name = settingName(key)
      checkStoredValue(key, value)
      settingSchema(name)?.parse(value)
      await vscode.workspace
        .getConfiguration()
        .update(
          key,
          value,
          scope === 'user'
            ? vscode.ConfigurationTarget.Global
            : vscode.ConfigurationTarget.Workspace,
        )
      return null
    },
    'storage/global.get': ({ key }) => Promise.resolve(storedValue(context.globalState, key)),
    'storage/global.set': async ({ key, value }) => {
      checkStoredValue(key, value)
      await context.globalState.update(key, value)
      return null
    },
    'storage/workspace.get': ({ key }) => Promise.resolve(storedValue(context.workspaceState, key)),
    'storage/workspace.set': async ({ key, value }) => {
      checkStoredValue(key, value)
      await context.workspaceState.update(key, value)
      return null
    },
    'auth/github': async ({ scopes, createIfNone: shouldCreate }) => ({
      authenticated:
        (await vscode.authentication.getSession('github', [...scopes], {
          createIfNone: shouldCreate,
        })) !== undefined,
    }),
    'window/state': () => Promise.resolve({ focused: vscode.window.state.focused }),
    'window/attention': async ({ message }) => {
      await vscode.window.showInformationMessage(message)
      return null
    },
    ...options.handlers,
  }
  return {
    request: async (method, params, signal) => {
      if (isClosed) fail(MHP_ERROR_CODES.invalidRequest, 'MHP_HOST_CLOSED')
      checkCancelled(signal)
      if (!Object.hasOwn(MHP_METHODS, method))
        fail(MHP_ERROR_CODES.methodNotFound, 'MHP_METHOD_NOT_FOUND')
      const parsed = contracts[method].params.safeParse(params)
      if (!parsed.success) fail(MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_PARAMS')
      const handler = handlers[method]
      if (handler === undefined)
        throw new VscodeHostError({
          code: MHP_ERROR_CODES.unsupportedCapability,
          message: 'MHP_UNSUPPORTED_CAPABILITY',
          data: { capability: MHP_METHODS[method].capability },
        })
      const result = await handler(parsed.data, signal)
      checkCancelled(signal)
      const response = requests[method].result.safeParse(result)
      if (!response.success) fail(MHP_ERROR_CODES.internalError, 'MHP_INVALID_RESULT')
      return response.data
    },
    notify: (method, params) => {
      if (isClosed) fail(MHP_ERROR_CODES.invalidRequest, 'MHP_HOST_CLOSED')
      if (!Object.hasOwn(MHP_METHODS, method))
        fail(MHP_ERROR_CODES.methodNotFound, 'MHP_METHOD_NOT_FOUND')
      const parsed = contracts[method].params.safeParse(params)
      if (!parsed.success) fail(MHP_ERROR_CODES.invalidParams, 'MHP_INVALID_PARAMS')
      if (options.onNotification === undefined)
        fail(MHP_ERROR_CODES.unsupportedCapability, 'MHP_NOTIFICATION_UNBOUND')
      options.onNotification(method, parsed.data)
    },
  }
}
function diagnosticSeverity(
  severity: vscode.DiagnosticSeverity,
): MhpResult<'diagnostics/get'>[number]['severity'] {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error: {
      return 'error'
    }
    case vscode.DiagnosticSeverity.Warning: {
      return 'warning'
    }
    case vscode.DiagnosticSeverity.Information: {
      return 'information'
    }
    case vscode.DiagnosticSeverity.Hint: {
      return 'hint'
    }
  }
}
