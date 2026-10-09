import { createHash } from 'node:crypto'
import type { Readable, Writable } from 'node:stream'
import * as z from 'zod/mini'
import {
  LSP_LIMITS,
  LSP_SERVER_NOT_INITIALIZED,
  MHP_ERROR_CODES,
  UI_TEXT,
} from '../../shared/constants'
import { LspDocuments, documentOffset, rangeOffsets, type LspDocument } from './documents'
import {
  COMMANDS,
  commandSchema,
  documentSchema,
  locationSchema,
  rangeSchema,
  suggestionSchema,
  type RpcId,
  type RpcMessage,
  type Suggestion,
  type Position,
} from './protocol'
import { lspTransport, type LspTransport } from './transport'

export interface LspServices {
  complete(
    document: LspDocument,
    position: Position,
    isInvoke: boolean,
    signal: AbortSignal,
    client: LspTransport,
  ): Promise<string | undefined>
  command(
    command: string,
    document: LspDocument | undefined,
    range: z.infer<typeof rangeSchema> | undefined,
    client: LspTransport,
    signal: AbortSignal,
  ): Promise<unknown>
  /** Controller policy/mode/hooks admission; absence refuses edits, even after a client prompt. */
  readonly permitsSuggestedEdit?:
    ((document: LspDocument, suggestion: Suggestion) => Promise<boolean>) | undefined
  readonly supportsReview: boolean
  readonly subscribe?: (publish: (suggestions: readonly Suggestion[]) => void) => () => void
  readonly trusted: boolean
}
const initializeSchema = z.object({
  capabilities: z.object({
    workspace: z.optional(
      z.object({
        applyEdit: z.optional(z.boolean()),
        workspaceEdit: z.optional(z.object({ documentChanges: z.optional(z.boolean()) })),
      }),
    ),
    textDocument: z.optional(
      z.object({
        inlineCompletion: z.optional(z.unknown()),
        codeAction: z.optional(z.object({ codeActionLiteralSupport: z.optional(z.unknown()) })),
      }),
    ),
    window: z.optional(z.object({ showDocument: z.optional(z.object({ support: z.boolean() })) })),
    general: z.optional(z.object({ positionEncodings: z.optional(z.array(z.string())) })),
  }),
})
const openedSchema = z.object({
  textDocument: z.object({
    uri: documentSchema.shape.uri,
    languageId: z.string(),
    version: z.int(),
    text: z.string(),
  }),
})
const changedSchema = z.object({
  textDocument: z.object({ uri: documentSchema.shape.uri, version: z.int() }),
  contentChanges: z
    .array(z.object({ text: z.string(), range: z.optional(rangeSchema) }))
    .check(z.minLength(1), z.maxLength(1)),
})
const actionsSchema = z.object({ textDocument: documentSchema, range: rangeSchema })
const completionSchema = z.object({
  ...locationSchema.shape,
  context: z.optional(z.object({ triggerKind: z.int() })),
})
const approvalSchema = z.nullable(z.object({ title: z.string() }))
const appliedSchema = z.object({ applied: z.boolean() })

export function serveLsp(
  input: Readable,
  output: Writable,
  workspace: string,
  services: LspServices,
): LspTransport {
  const documents = new LspDocuments(workspace)
  const calls = new Map<RpcId, AbortController>()
  const controlCalls = new Set<RpcId>()
  const suggestions = new Map<string, readonly Suggestion[]>()
  let state: 'new' | 'initialized' | 'ready' | 'shutdown' = 'new'
  let isApplyEdit = false
  let isInline = false
  let isLiteralActions = false
  const transport = lspTransport(input, output, receive)
  const unsubscribe = services.subscribe?.((raw) => {
    if (state !== 'ready') return
    const parsed = z
      .array(suggestionSchema)
      .check(z.maxLength(LSP_LIMITS.diagnosticCount))
      .safeParse(raw)
    if (!parsed.success) return
    const grouped = Map.groupBy(parsed.data, (item) => item.uri)
    const uris = new Set([...suggestions.keys(), ...grouped.keys()])
    for (const uri of uris) {
      let document: LspDocument
      try {
        document = documents.get(uri)
      } catch {
        continue
      }
      const items = (grouped.get(uri) ?? []).filter(
        (item) =>
          item.version === document.version &&
          item.contentHash === createHash('sha256').update(document.text).digest('hex'),
      )
      suggestions.set(uri, items)
      transport.notify('textDocument/publishDiagnostics', {
        uri,
        version: document.version,
        diagnostics: items.map((item) => item.diagnostic),
      })
    }
  })
  void transport.closed.then(() => {
    unsubscribe?.()
    for (const call of calls.values()) call.abort()
    calls.clear()
  })

  function receive(message: RpcMessage): void {
    if (message.method === '$/cancelRequest') {
      const cancelled = z.object({ id: z.union([z.string(), z.int()]) }).safeParse(message.params)
      if (cancelled.success) calls.get(cancelled.data.id)?.abort()
      return
    }
    if (message.id === undefined || message.id === null) {
      try {
        notification(message)
      } catch {
        transport.notify('window/logMessage', { type: 1, message: 'ELSP_NOTIFICATION' })
      }
      return
    }
    const id = message.id
    const command =
      message.method === 'workspace/executeCommand'
        ? commandSchema.safeParse(message.params)
        : undefined
    const isControl =
      message.method === 'shutdown' ||
      (command?.success === true && command.data.command === 'muse.stop')
    if (
      calls.has(id) ||
      (isControl
        ? controlCalls.size >= 2
        : calls.size - controlCalls.size >= LSP_LIMITS.pendingRequests)
    ) {
      transport.error(id, MHP_ERROR_CODES.invalidRequest, 'ELSP_BUSY')
      return
    }
    const call = new AbortController()
    calls.set(id, call)
    if (isControl) controlCalls.add(id)
    void request(message, call.signal)
      .then((result) => {
        if (call.signal.aborted) transport.error(id, MHP_ERROR_CODES.cancelled, 'ELSP_CANCELLED')
        else transport.reply(id, result)
      })
      .catch((error: unknown) => {
        const word = error instanceof Error ? error.message : ''
        let code: number = MHP_ERROR_CODES.invalidParams
        switch (word) {
          case 'ELSP_NOT_READY': {
            code = LSP_SERVER_NOT_INITIALIZED
            break
          }
          case 'ELSP_METHOD': {
            code = MHP_ERROR_CODES.methodNotFound
            break
          }
          case 'ELSP_INITIALIZED': {
            code = MHP_ERROR_CODES.invalidRequest
            break
          }
          case 'ELSP_PANEL_CONTROLLER_UNAVAILABLE': {
            code = MHP_ERROR_CODES.internalError
            break
          }
        }
        if (call.signal.aborted) code = MHP_ERROR_CODES.cancelled
        transport.error(
          id,
          code,
          word === 'ELSP_PANEL_CONTROLLER_UNAVAILABLE'
            ? 'ELSP_PANEL_CONTROLLER_UNAVAILABLE'
            : 'ELSP_REQUEST',
        )
      })
      .finally(() => {
        calls.delete(id)
        controlCalls.delete(id)
      })
  }
  function clearDiagnostics(uri: string): void {
    suggestions.delete(uri)
    transport.notify('textDocument/publishDiagnostics', { uri, diagnostics: [] })
  }
  function notification(message: RpcMessage): void {
    if (message.method === 'exit') {
      transport.close()
      return
    }
    if (state === 'initialized' && message.method === 'initialized') {
      state = 'ready'
      return
    }
    if (state !== 'ready') throw new Error('ELSP_STATE')
    switch (message.method) {
      case 'textDocument/didOpen': {
        const { textDocument } = openedSchema.parse(message.params)
        documents.put(textDocument)
        return
      }
      case 'textDocument/didChange': {
        const { textDocument, contentChanges } = changedSchema.parse(message.params)
        const change = contentChanges[0]
        if (change === undefined || change.range !== undefined) throw new Error('ELSP_FULL_SYNC')
        const old = documents.get(textDocument.uri)
        documents.put({ ...old, version: textDocument.version, text: change.text })
        clearDiagnostics(old.uri)
        return
      }
      case 'textDocument/didClose': {
        const { textDocument } = z.object({ textDocument: documentSchema }).parse(message.params)
        documents.close(textDocument.uri)
        clearDiagnostics(textDocument.uri)
        return
      }
      case 'textDocument/didSave':
      case '$/setTrace': {
        return
      }
      default: {
        return
      }
    }
  }
  async function request(message: RpcMessage, signal: AbortSignal): Promise<unknown> {
    if (message.method === 'initialize') {
      if (state !== 'new') throw new Error('ELSP_INITIALIZED')
      const { capabilities } = initializeSchema.parse(message.params)
      if (
        capabilities.general?.positionEncodings !== undefined &&
        !capabilities.general.positionEncodings.includes('utf-16')
      )
        throw new Error('ELSP_ENCODING')
      isInline = capabilities.textDocument?.inlineCompletion !== undefined
      isLiteralActions =
        capabilities.textDocument?.codeAction?.codeActionLiteralSupport !== undefined
      isApplyEdit =
        capabilities.workspace?.applyEdit === true &&
        capabilities.workspace.workspaceEdit?.documentChanges === true
      state = 'initialized'
      return {
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: 1 },
          completionProvider: { resolveProvider: false },
          ...(isInline && { inlineCompletionProvider: true }),
          codeActionProvider: services.supportsReview,
          executeCommandProvider: { commands: COMMANDS },
        },
        serverInfo: { name: 'Muse Spark Code (Unofficial)' },
      }
    }
    if (state !== 'new' && message.method === 'shutdown') {
      state = 'shutdown'
      for (const [id, call] of calls) if (id !== message.id) call.abort()
      return null
    }
    if (state !== 'ready') throw new Error('ELSP_NOT_READY')
    if (
      message.method === 'textDocument/completion' ||
      message.method === 'textDocument/inlineCompletion'
    ) {
      const isInlineRequest = message.method === 'textDocument/inlineCompletion'
      if (isInlineRequest && !isInline) throw new Error('ELSP_CAPABILITY')
      const params = completionSchema.parse(message.params)
      const document = documents.get(params.textDocument.uri)
      documentOffset(document.text, params.position)
      const answer = await services.complete(
        document,
        params.position,
        params.context === undefined || params.context.triggerKind === 1,
        AbortSignal.any([signal, documents.signal(document.uri)]),
        transport,
      )
      if (answer === undefined || signal.aborted || !documents.current(document))
        return isInlineRequest ? { items: [] } : []
      const range = { start: params.position, end: params.position }
      return isInlineRequest
        ? { items: [{ insertText: answer, range }] }
        : [
            {
              label: UI_TEXT.paidTabName,
              kind: 1,
              insertTextFormat: 1,
              textEdit: { range, newText: answer },
              detail: UI_TEXT.paidTabName,
            },
          ]
    }
    if (message.method === 'textDocument/codeAction') {
      if (!services.supportsReview) throw new Error('ELSP_PANEL_CONTROLLER_UNAVAILABLE')
      const params = actionsSchema.parse(message.params)
      const document = documents.get(params.textDocument.uri)
      rangeOffsets(document.text, params.range)
      const args = [document.uri, document.version, params.range]
      const commands = [
        { title: UI_TEXT.lspFix, command: 'muse.fix', arguments: args },
        { title: UI_TEXT.lspExplain, command: 'muse.explain', arguments: args },
      ]
      const actions: unknown[] = isLiteralActions
        ? commands.map((command) => ({ title: command.title, kind: 'quickfix', command }))
        : [...commands]
      const available = suggestions.get(document.uri) ?? []
      if (isApplyEdit && services.trusted)
        for (const suggestion of available) {
          if (suggestion.edit === undefined || suggestion.version !== document.version) continue
          const command = {
            title: UI_TEXT.lspApply,
            command: 'muse.apply',
            arguments: [suggestion],
          }
          actions.push(
            isLiteralActions
              ? {
                  title: command.title,
                  kind: 'quickfix',
                  diagnostics: [suggestion.diagnostic],
                  command,
                }
              : command,
          )
        }
      return actions
    }
    if (message.method === 'workspace/executeCommand') {
      const params = commandSchema.parse(message.params)
      if (params.command === 'muse.apply')
        return await hasAppliedSuggestion(params.arguments?.[0], signal)
      let document: LspDocument | undefined
      let range: z.infer<typeof rangeSchema> | undefined
      if (params.command === 'muse.fix' || params.command === 'muse.explain') {
        const [uri, version, selection] = z
          .tuple([z.string(), z.int(), rangeSchema])
          .parse(params.arguments)
        document = documents.get(uri)
        if (document.version !== version) throw new Error('ELSP_VERSION')
        range = selection
        rangeOffsets(document.text, range)
      }
      return await services.command(params.command, document, range, transport, signal)
    }
    throw new Error('ELSP_METHOD')
  }
  async function hasAppliedSuggestion(raw: unknown, signal: AbortSignal): Promise<boolean> {
    if (!isApplyEdit || !services.trusted) throw new Error('ELSP_CAPABILITY')
    const suggestion = suggestionSchema.parse(raw)
    const known = suggestions
      .get(suggestion.uri)
      ?.find((item) => JSON.stringify(item) === JSON.stringify(suggestion))
    if (known?.edit === undefined) throw new Error('ELSP_SUGGESTION')
    const document = documents.get(suggestion.uri)
    if (
      document.version !== suggestion.version ||
      suggestion.contentHash !== createHash('sha256').update(document.text).digest('hex')
    )
      throw new Error('ELSP_VERSION')
    rangeOffsets(document.text, known.edit.range)
    if (!(await services.permitsSuggestedEdit?.(document, known))) return false
    const isCancelled = () => signal.aborted
    const answer = approvalSchema.parse(
      await transport.request('window/showMessageRequest', {
        type: 2,
        message: UI_TEXT.lspApply,
        actions: [{ title: UI_TEXT.lspApply }, { title: UI_TEXT.paidDeny }],
      }),
    )
    if (
      answer?.title !== UI_TEXT.lspApply ||
      isCancelled() ||
      !documents.current(document) ||
      !(await services.permitsSuggestedEdit?.(document, known)) ||
      isCancelled() ||
      !documents.current(document)
    )
      return false
    const result = appliedSchema.parse(
      await transport.request('workspace/applyEdit', {
        label: UI_TEXT.lspApply,
        edit: {
          documentChanges: [
            { textDocument: { uri: document.uri, version: document.version }, edits: [known.edit] },
          ],
        },
      }),
    )
    if (result.applied) clearDiagnostics(document.uri)
    return result.applied
  }
  return transport
}
