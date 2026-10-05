import * as z from 'zod/mini'
import { MHP } from '../constants'
import {
  type MhpCapability,
  type MhpFallback,
  offeredCapabilitiesSchema,
  versionRangeSchema,
} from './capabilities'
import {
  diagnosticSchema,
  documentSchema,
  folderSchema,
  hunkSchema,
  idSchema,
  integerSchema,
  jsonValueSchema,
  locationSchema,
  positionSchema,
  rangeSchema,
  selectionSchema,
  settingKeySchema,
  surfaceKindSchema,
  symbolSchema,
  textEditSchema,
  themeSchema,
  uriSchema,
  versionedEditsSchema,
} from './data'

export type MhpDirection = 'runtimeToHost' | 'hostToRuntime' | 'bidirectional'
function request<P extends z.ZodMiniType, R extends z.ZodMiniType>(
  capability: MhpCapability,
  fallback: MhpFallback,
  params: P,
  result: R,
  direction: MhpDirection = 'runtimeToHost',
) {
  return { kind: 'request' as const, direction, capability, fallback, params, result }
}
function notification<P extends z.ZodMiniType>(
  capability: MhpCapability,
  fallback: MhpFallback,
  params: P,
  direction: MhpDirection = 'hostToRuntime',
) {
  return {
    kind: 'notification' as const,
    direction,
    capability,
    fallback,
    params,
    result: z.never(),
  }
}
const empty = z.strictObject({})
const uri = z.strictObject({ uri: uriSchema })
const at = z.strictObject({ uri: uriSchema, position: positionSchema })
const terminal = z.strictObject({ terminalId: idSchema })
const surface = z.strictObject({ surfaceId: idSchema })
const setting = z.strictObject({ key: settingKeySchema })
const storedKey = z.strictObject({ key: z.string() })
const storedValue = z.strictObject({ key: z.string(), value: jsonValueSchema })
const choice = z.strictObject({ id: idSchema, title: z.string() })
const resultChoice = z.nullable(idSchema)
const theme = themeSchema
const initialized = z.strictObject({
  protocolVersion: z.literal(MHP.version),
  capabilities: offeredCapabilitiesSchema,
})

// Frozen from the method groups in editor-parity research §3.3. Notifications
// have no result; cancellation targets the sender's request id on this pipe.
export const MHP_METHODS = {
  initialize: request(
    'lifecycle',
    'required',
    z.strictObject({
      host: z.strictObject({ id: z.string(), version: z.string() }),
      protocolRange: versionRangeSchema,
      capabilities: offeredCapabilitiesSchema,
      locale: z.string(),
      theme,
      folders: z.array(folderSchema),
      trusted: z.boolean(),
    }),
    initialized,
  ),
  shutdown: request('lifecycle', 'required', empty, z.null()),
  '$/cancelRequest': notification(
    'lifecycle',
    'required',
    z.strictObject({ id: idSchema }),
    'bidirectional',
  ),
  'workspace/folders': request('workspace', 'runtime-workspace', empty, z.array(folderSchema)),
  'workspace/trust': request(
    'workspace',
    'runtime-workspace',
    empty,
    z.strictObject({ trusted: z.boolean() }),
  ),
  'workspace/didGrantTrust': notification(
    'workspace',
    'runtime-workspace',
    z.strictObject({ trusted: z.literal(true) }),
  ),
  'workspace/findFiles': request(
    'workspace',
    'runtime-workspace',
    z.strictObject({
      include: z.string(),
      exclude: z.optional(z.string()),
      limit: integerSchema,
    }),
    z.array(uriSchema),
  ),
  'workspace/openFolder': request(
    'workspace',
    'runtime-workspace',
    z.strictObject({ uri: uriSchema, newWindow: z.boolean() }),
    z.null(),
  ),
  'documents/list': request(
    'documents',
    'disk-with-dirty-buffer-refusal',
    empty,
    z.array(documentSchema),
  ),
  'documents/read': request(
    'documents',
    'disk-with-dirty-buffer-refusal',
    uri,
    z.strictObject({ document: documentSchema, text: z.string() }),
  ),
  'documents/applyEdits': request(
    'documents',
    'disk-with-dirty-buffer-refusal',
    z.strictObject({
      ...versionedEditsSchema.shape,
      undoLabel: z.string().check(z.minLength(1)),
    }),
    documentSchema,
  ),
  'documents/save': request(
    'documents',
    'disk-with-dirty-buffer-refusal',
    z.strictObject({ uri: uriSchema, expectedVersion: integerSchema }),
    documentSchema,
  ),
  'documents/saveAll': request(
    'documents',
    'disk-with-dirty-buffer-refusal',
    empty,
    z.strictObject({ saved: z.boolean() }),
  ),
  'documents/didChange': notification(
    'documents',
    'disk-with-dirty-buffer-refusal',
    z.strictObject({ document: documentSchema, text: z.string() }),
  ),
  'documents/didSave': notification('documents', 'disk-with-dirty-buffer-refusal', documentSchema),
  'documents/didClose': notification('documents', 'disk-with-dirty-buffer-refusal', uri),
  'editor/active': request('editor', 'launcher-or-clipboard', empty, z.nullable(selectionSchema)),
  'editor/didChangeSelection': notification(
    'editor',
    'launcher-or-clipboard',
    z.strictObject({ selection: z.nullable(selectionSchema) }),
  ),
  'editor/open': request(
    'editor',
    'launcher-or-clipboard',
    z.strictObject({ uri: uriSchema, range: z.optional(rangeSchema) }),
    z.null(),
  ),
  'editor/insertAtCursor': request(
    'editor',
    'launcher-or-clipboard',
    z.strictObject({
      uri: uriSchema,
      expectedVersion: integerSchema,
      position: positionSchema,
      text: z.string(),
      undoLabel: z.string(),
    }),
    documentSchema,
  ),
  'editor/replaceSelection': request(
    'editor',
    'launcher-or-clipboard',
    z.strictObject({
      uri: uriSchema,
      expectedVersion: integerSchema,
      range: rangeSchema,
      text: z.string(),
      undoLabel: z.string(),
    }),
    documentSchema,
  ),
  'diff/open': request(
    'diff',
    'react-diff',
    z.strictObject({ left: uriSchema, right: uriSchema, title: z.string() }),
    z.null(),
  ),
  'diff/review': request(
    'diff',
    'react-diff',
    z.strictObject({ reviewId: idSchema, hunks: z.array(hunkSchema) }),
    z.null(),
  ),
  'diff/didDecide': notification(
    'diff',
    'react-diff',
    z.strictObject({
      reviewId: idSchema,
      hunkId: idSchema,
      decision: z.enum(['accept', 'reject', 'cancel']),
    }),
  ),
  'diagnostics/get': request(
    'diagnostics',
    'lsp-or-check-commands',
    z.strictObject({ uri: z.optional(uriSchema) }),
    z.array(diagnosticSchema),
  ),
  'diagnostics/didChange': notification(
    'diagnostics',
    'lsp-or-check-commands',
    z.strictObject({ uri: uriSchema, diagnostics: z.array(diagnosticSchema) }),
  ),
  'codeIntel/definition': request('codeIntel', 'lsp-broker', at, z.array(locationSchema)),
  'codeIntel/references': request(
    'codeIntel',
    'lsp-broker',
    z.strictObject({ ...at.shape, includeDeclaration: z.boolean() }),
    z.array(locationSchema),
  ),
  'codeIntel/documentSymbols': request('codeIntel', 'lsp-broker', uri, z.array(symbolSchema)),
  'codeIntel/workspaceSymbols': request(
    'codeIntel',
    'lsp-broker',
    z.strictObject({ query: z.string() }),
    z.array(symbolSchema),
  ),
  'codeIntel/hover': request('codeIntel', 'lsp-broker', at, z.array(z.string())),
  'codeIntel/prepareRename': request(
    'codeIntel',
    'lsp-broker',
    at,
    z.nullable(z.strictObject({ range: rangeSchema, placeholder: z.string() })),
  ),
  'codeIntel/rename': request(
    'codeIntel',
    'lsp-broker',
    z.strictObject({ ...at.shape, newName: z.string() }),
    z.strictObject({
      files: z.array(versionedEditsSchema),
      fileOperations: z.enum(['none', 'present', 'unknown']),
    }),
  ),
  'codeIntel/callHierarchy': request(
    'codeIntel',
    'lsp-broker',
    z.strictObject({ ...at.shape, direction: z.enum(['incoming', 'outgoing']) }),
    z.nullable(
      z.strictObject({
        item: symbolSchema,
        calls: z.array(z.strictObject({ symbol: symbolSchema, ranges: z.array(rangeSchema) })),
        otherItems: integerSchema,
      }),
    ),
  ),
  'codeIntel/format': request(
    'codeIntel',
    'lsp-broker',
    z.strictObject({
      uri: uriSchema,
      expectedVersion: integerSchema,
      tabSize: integerSchema,
      insertSpaces: z.boolean(),
    }),
    z.array(textEditSchema),
  ),
  'terminal/create': request(
    'terminal',
    'os-terminal',
    z.strictObject({
      cwd: uriSchema,
      executable: z.string(),
      args: z.array(z.string()),
      env: z.record(z.string().check(z.regex(/^(?:LANG|LC_ALL|TERM|COLORTERM)$/u)), z.string()),
    }),
    terminal,
  ),
  'terminal/show': request('terminal', 'os-terminal', terminal, z.null()),
  'terminal/sendText': request(
    'terminal',
    'os-terminal',
    z.strictObject({ ...terminal.shape, text: z.string(), addNewLine: z.boolean() }),
    z.null(),
  ),
  'ui/notify': request(
    'ui',
    'react-ui',
    z.strictObject({ severity: z.enum(['information', 'warning', 'error']), message: z.string() }),
    z.null(),
  ),
  'ui/confirm': request(
    'ui',
    'react-ui',
    z.strictObject({
      title: z.string(),
      message: z.string(),
      choices: z.array(choice).check(z.minLength(1)),
    }),
    resultChoice,
  ),
  'ui/pick': request(
    'ui',
    'react-ui',
    z.strictObject({ title: z.string(), items: z.array(choice), multiple: z.boolean() }),
    z.nullable(z.array(idSchema)),
  ),
  'ui/input': request(
    'ui',
    'react-ui',
    z.strictObject({ title: z.string(), prompt: z.string(), value: z.optional(z.string()) }),
    z.nullable(z.string()),
  ),
  'ui/openExternal': request(
    'ui',
    'react-ui',
    z.strictObject({ uri: z.string().check(z.url({ protocol: /^https?$/u })) }),
    z.null(),
  ),
  'ui/clipboard': request('ui', 'react-ui', z.strictObject({ text: z.string() }), z.null()),
  'ui/status': request(
    'ui',
    'react-ui',
    z.strictObject({
      id: idSchema,
      text: z.string(),
      visible: z.boolean(),
      command: z.optional(z.string()),
    }),
    z.null(),
  ),
  'ui/progress': request(
    'ui',
    'react-ui',
    z.strictObject({
      id: idSchema,
      title: z.string(),
      message: z.optional(z.string()),
      fraction: z.optional(z.number().check(z.gte(0), z.lte(1))),
      done: z.boolean(),
    }),
    z.null(),
  ),
  'surfaces/open': request(
    'surfaces',
    'companion-tabs',
    z.strictObject({
      kind: surfaceKindSchema,
      placement: z.enum(['side', 'tab', 'window']),
      sessionId: z.optional(idSchema),
    }),
    surface,
  ),
  'surfaces/focus': request('surfaces', 'companion-tabs', surface, z.null()),
  'surfaces/state': request(
    'surfaces',
    'companion-tabs',
    surface,
    z.strictObject({ visible: z.boolean(), focused: z.boolean() }),
  ),
  'settings/get': request(
    'settings',
    'runtime-settings',
    setting,
    z.strictObject({ value: jsonValueSchema }),
  ),
  'settings/update': request(
    'settings',
    'runtime-settings',
    z.strictObject({
      ...setting.shape,
      value: jsonValueSchema,
      scope: z.enum(['user', 'workspace']),
    }),
    z.null(),
  ),
  'settings/didChange': notification(
    'settings',
    'runtime-settings',
    z.strictObject({ keys: z.array(settingKeySchema) }),
  ),
  'storage/global.get': request(
    'storage',
    'runtime-storage',
    storedKey,
    z.strictObject({ value: jsonValueSchema }),
  ),
  'storage/global.set': request('storage', 'runtime-storage', storedValue, z.null()),
  'storage/workspace.get': request(
    'storage',
    'runtime-storage',
    storedKey,
    z.strictObject({ value: jsonValueSchema }),
  ),
  'storage/workspace.set': request('storage', 'runtime-storage', storedValue, z.null()),
  'commands/register': request(
    'commands',
    'panel-palette',
    z.strictObject({ id: z.string(), title: z.string(), suggestedKey: z.optional(z.string()) }),
    z.null(),
  ),
  'commands/execute': notification('commands', 'panel-palette', z.strictObject({ id: z.string() })),
  'tab/register': request(
    'tab',
    'lsp-or-completions-or-invoke',
    z.strictObject({
      languages: z.array(z.string()),
      trigger: z.enum(['automatic', 'invoke', 'both']),
    }),
    z.null(),
  ),
  'tab/complete': request(
    'tab',
    'lsp-or-completions-or-invoke',
    z.strictObject({
      ...at.shape,
      version: integerSchema,
      context: z.strictObject({
        prefix: z.string(),
        suffix: z.string(),
        trigger: z.enum(['automatic', 'invoke']),
      }),
    }),
    z.array(z.strictObject({ id: idSchema, text: z.string(), range: rangeSchema })),
    'hostToRuntime',
  ),
  'tab/accepted': notification(
    'tab',
    'lsp-or-completions-or-invoke',
    z.strictObject({ id: idSchema, uri: uriSchema, version: integerSchema }),
  ),
  'tab/rejected': notification(
    'tab',
    'lsp-or-completions-or-invoke',
    z.strictObject({ id: idSchema }),
  ),
  'voice/capture': request(
    'voice',
    'runtime-or-browser-capture',
    z.strictObject({ action: z.enum(['start', 'stop', 'cancel']) }),
    z.nullable(z.strictObject({ mimeType: z.string(), audioBase64: z.string() })),
  ),
  // Authentication status only. Tokens and the Model API key never cross MHP.
  'auth/github': request(
    'auth',
    'gh-credential-store',
    z.strictObject({ scopes: z.array(z.string()), createIfNone: z.boolean() }),
    z.strictObject({ authenticated: z.boolean() }),
  ),
  'window/state': request(
    'window',
    'companion-notification',
    empty,
    z.strictObject({ focused: z.boolean() }),
  ),
  'window/attention': request(
    'window',
    'companion-notification',
    z.strictObject({ message: z.string() }),
    z.null(),
  ),
} as const

export type MhpMethod = keyof typeof MHP_METHODS
type MethodsOfKind<K extends 'request' | 'notification'> = {
  [M in MhpMethod]: (typeof MHP_METHODS)[M]['kind'] extends K ? M : never
}[MhpMethod]
export type MhpRequestMethod = MethodsOfKind<'request'>
export type MhpNotificationMethod = MethodsOfKind<'notification'>
export type MhpParams<M extends MhpMethod> = z.infer<(typeof MHP_METHODS)[M]['params']>
export type MhpResult<M extends MhpRequestMethod> = z.infer<(typeof MHP_METHODS)[M]['result']>

// Implementations are injected by the runtime/adapter lanes. They validate
// both sides, negotiate capabilities, and enforce direction and lifecycle.
export interface HostServices {
  request<M extends MhpRequestMethod>(
    method: M,
    params: MhpParams<M>,
    signal?: AbortSignal,
  ): Promise<MhpResult<M>>
  notify<M extends MhpNotificationMethod>(method: M, params: MhpParams<M>): void
}
