// The language server's lifecycle and dispatch (M104 lane H, PLAN.md D84):
// LSP 3.17's initialize/shutdown/exit, full document synchronization, Tab
// through LSP 3.18's `textDocument/inlineCompletion` (and the completion
// list for older editors), and the commands `workspace/executeCommand`
// runs. Every parameter is parsed before use; a request the editor cancels
// answers `RequestCancelled`.
import type { Readable, Writable } from 'node:stream'
import {
  ACP_AGENT_TITLE,
  LSP_COMMANDS,
  LSP_COMPLETION_ITEM_TEXT,
  LSP_INLINE_TRIGGER_INVOKED,
  LSP_INSERT_TEXT_PLAIN,
  LSP_MESSAGE_TYPE,
  LSP_SERVER_NOT_INITIALIZED,
  LSP_TEXT_SYNC_FULL,
  MHP_ERROR_CODES,
} from '../../shared/constants'
import { failureForLog } from '../../core/backends/musecode/logText'
import { unlessAborted } from '../../core/timeouts'
import type { Logger } from '../../host/logger'
import { LspDocuments, documentOffset, type LspDocument } from './documents'
import {
  actionAnswerSchema,
  appliedSchema,
  cancelSchema,
  changedSchema,
  closedSchema,
  commandSchema,
  completionSchema,
  initializeSchema,
  invokeArgumentsSchema,
  openedSchema,
  type Position,
  type RpcId,
  type RpcMessage,
} from './protocol'
import { lspTransport, type LspTransport } from './transport'

/** A suggestion and what its accept command reports to the accept hook. */
export interface LspSuggestion {
  readonly text: string
  readonly accept: unknown
}

/** What the server asks of the Tab composition and the runtime. */
export interface LspServices {
  /** Tab at the position; undefined is no suggestion. Never throws for a quiet reason. */
  complete(
    document: LspDocument,
    position: Position,
    isInvoke: boolean,
    signal: AbortSignal,
  ): Promise<LspSuggestion | undefined>
  /** The item's accept command ran: the accept hook observes it. */
  accepted(accept: unknown): void
  /** Today's Tab spend, as `muse.usage` shows and answers it. */
  usage(): { readonly text: string; readonly report: unknown }
  /** `muse.help`'s text. */
  help(): string
  /** `muse.stop`: every supervised run in this workspace, after the reply went out. */
  stop(): Promise<void>
  /** The item's label when its text has no first line to show. */
  readonly label: string
  /** The connection ended: pending work stops and the hooks' state goes. */
  dispose(): void
}

/** What the services may ask of the editor on this connection. */
export interface LspEditor {
  /** `window/showMessageRequest`: the chosen action's title, or undefined when dismissed. */
  ask(message: string, actions: readonly string[]): Promise<string | undefined>
  /** `window/showMessage`. */
  notify(type: number, message: string): void
}

type ServerState = 'new' | 'initialized' | 'ready' | 'shutdown'

/** Request failures with their LSP error codes; anything else is an internal error. */
const FAILURE_CODES: Readonly<Record<string, number>> = {
  ELSP_NOT_READY: LSP_SERVER_NOT_INITIALIZED,
  ELSP_SHUT_DOWN: MHP_ERROR_CODES.invalidRequest,
  ELSP_INITIALIZED: MHP_ERROR_CODES.invalidRequest,
  ELSP_METHOD: MHP_ERROR_CODES.methodNotFound,
  ELSP_POSITION: MHP_ERROR_CODES.invalidParams,
  ELSP_VERSION: MHP_ERROR_CODES.invalidParams,
  ELSP_DOCUMENT_CLOSED: MHP_ERROR_CODES.invalidParams,
  ELSP_CAPABILITY: MHP_ERROR_CODES.invalidRequest,
}

/** The fixed word and code a failed request answers with; no message text crosses. */
function failureOf(error: unknown): { readonly word: string; readonly code: number } {
  // zod's parse failure, recognized by name: its class is each bundle's own copy.
  if (error instanceof Error && error.name === '$ZodError')
    return { word: 'ELSP_PARAMS', code: MHP_ERROR_CODES.invalidParams }
  const word = error instanceof Error ? error.message : ''
  const code = FAILURE_CODES[word]
  return code === undefined
    ? { word: 'ELSP_INTERNAL', code: MHP_ERROR_CODES.internalError }
    : { word, code }
}

/** The completion list's label: the suggestion's first non-blank line. */
function labelOf(text: string, fallback: string): string {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '') ?? fallback
  )
}

/**
Serves one editor over `input`/`output` until `exit` or the stream's end.
Resolves with the process's exit code: 0 after `shutdown` then `exit`, 1
when the connection ended without a shutdown (the specification's rule).
*/
export async function serveLsp(
  input: Readable,
  output: Writable,
  createServices: (editor: LspEditor) => LspServices,
  log: Logger,
  signal: AbortSignal,
): Promise<number> {
  const documents = new LspDocuments()
  const calls = new Map<RpcId, AbortController>()
  let state: ServerState = 'new'
  let canApplyEdit = false
  /** Read through a call: the handlers move the state while the server waits. */
  const isShutDown = (): boolean => state === 'shutdown'
  const transport: LspTransport = lspTransport(input, output, receive)
  const services = createServices({
    ask: async (message, actions) =>
      actionAnswerSchema.parse(
        await transport.request('window/showMessageRequest', {
          type: LSP_MESSAGE_TYPE.warning,
          message,
          actions: actions.map((title) => ({ title })),
        }),
      )?.title,
    notify: (type, message) => {
      transport.notify('window/showMessage', { type, message })
    },
  })
  const onAbort = () => {
    transport.close()
  }
  signal.addEventListener('abort', onAbort, { once: true })

  function receive(message: RpcMessage): void {
    if (message.id === undefined) {
      try {
        notification(message)
      } catch (error: unknown) {
        // A malformed notification has no reply; both logs say so.
        log.warn(`Language server notification refused: ${failureForLog(error)}`)
        transport.notify('window/logMessage', {
          type: LSP_MESSAGE_TYPE.warning,
          message: failureOf(error).word,
        })
      }
      return
    }
    const { id } = message
    if (id === null) return
    if (calls.has(id)) {
      transport.error(id, MHP_ERROR_CODES.invalidRequest, 'ELSP_DUPLICATE_ID')
      return
    }
    const call = new AbortController()
    calls.set(id, call)
    void answer(id, message, call)
  }

  /**
  One request's reply: its result, its failure's code, or RequestCancelled
  at once when the editor cancels; the work the request began finishes on
  its own (a sent Tab request runs to its end, and its answer is dropped).
  */
  async function answer(id: RpcId, message: RpcMessage, call: AbortController): Promise<void> {
    try {
      const result = await unlessAborted(request(message, call.signal), call.signal)
      if (call.signal.aborted) transport.error(id, MHP_ERROR_CODES.cancelled, 'ELSP_CANCELLED')
      else transport.reply(id, result)
    } catch (error: unknown) {
      const failure = call.signal.aborted
        ? { word: 'ELSP_CANCELLED', code: MHP_ERROR_CODES.cancelled }
        : failureOf(error)
      if (failure.code === MHP_ERROR_CODES.internalError)
        log.warn(`Language server request failed: ${failureForLog(error)}`)
      transport.error(id, failure.code, failure.word)
    } finally {
      calls.delete(id)
    }
  }

  function notification(message: RpcMessage): void {
    switch (message.method) {
      case 'exit': {
        transport.close()
        return
      }
      case '$/cancelRequest': {
        calls.get(cancelSchema.parse(message.params).id)?.abort()
        return
      }
      case 'initialized': {
        if (state === 'initialized') state = 'ready'
        return
      }
    }
    // Before initialization only `exit` counts (the specification drops the rest).
    if (state !== 'ready') return
    switch (message.method) {
      case 'textDocument/didOpen': {
        const { textDocument } = openedSchema.parse(message.params)
        documents.put(textDocument)
        return
      }
      case 'textDocument/didChange': {
        const { textDocument, contentChanges } = changedSchema.parse(message.params)
        const old = documents.get(textDocument.uri)
        documents.put({ ...old, version: textDocument.version, text: contentChanges[0].text })
        return
      }
      case 'textDocument/didClose': {
        documents.close(closedSchema.parse(message.params).textDocument.uri)
        return
      }
    }
  }

  async function complete(
    uri: string,
    position: Position,
    isInvoke: boolean,
    signal: AbortSignal,
  ): Promise<{ readonly document: LspDocument; readonly suggestion: LspSuggestion } | undefined> {
    const document = documents.get(uri)
    documentOffset(document.text, position)
    const suggestion = await services.complete(
      document,
      position,
      isInvoke,
      AbortSignal.any([signal, documents.signal(uri)]),
    )
    return suggestion === undefined || signal.aborted || !documents.isCurrent(document)
      ? undefined
      : { document, suggestion }
  }

  function acceptCommand(suggestion: LspSuggestion) {
    return {
      title: services.label,
      command: LSP_COMMANDS.tabAccepted,
      arguments: [suggestion.accept],
    }
  }

  async function invoke(raw: unknown, signal: AbortSignal): Promise<unknown> {
    const [uri, version, position] = invokeArgumentsSchema.parse(raw)
    if (documents.get(uri).version !== version) throw new Error('ELSP_VERSION')
    const answer = await complete(uri, position, true, signal)
    if (answer === undefined) return null
    const { document, suggestion } = answer
    if (!canApplyEdit) return { text: suggestion.text }
    const range = { start: position, end: position }
    const { applied } = appliedSchema.parse(
      await transport.request('workspace/applyEdit', {
        label: services.label,
        edit: {
          documentChanges: [
            {
              textDocument: { uri: document.uri, version: document.version },
              edits: [{ range, newText: suggestion.text }],
            },
          ],
        },
      }),
    )
    if (applied) services.accepted(suggestion.accept)
    return { text: suggestion.text, applied }
  }

  async function executeCommand(params: unknown, signal: AbortSignal): Promise<unknown> {
    const { command, arguments: args } = commandSchema.parse(params)
    switch (command) {
      case LSP_COMMANDS.usage: {
        const usage = services.usage()
        transport.notify('window/showMessage', { type: LSP_MESSAGE_TYPE.info, message: usage.text })
        return usage.report
      }
      case LSP_COMMANDS.help: {
        transport.notify('window/showMessage', {
          type: LSP_MESSAGE_TYPE.info,
          message: services.help(),
        })
        return null
      }
      case LSP_COMMANDS.stop: {
        // The answer goes out first: the stop may end this server too.
        setImmediate(() => {
          void services.stop().catch((error: unknown) => {
            log.warn(`Stop failed: ${failureForLog(error)}`)
            transport.notify('window/showMessage', {
              type: LSP_MESSAGE_TYPE.error,
              message: failureOf(error).word,
            })
          })
        })
        return null
      }
      case LSP_COMMANDS.tabInvoke: {
        return await invoke(args, signal)
      }
      case LSP_COMMANDS.tabAccepted: {
        services.accepted(args?.[0])
        return null
      }
    }
  }

  async function request(message: RpcMessage, signal: AbortSignal): Promise<unknown> {
    if (message.method === 'initialize') {
      if (state !== 'new') throw new Error('ELSP_INITIALIZED')
      const { capabilities } = initializeSchema.parse(message.params)
      canApplyEdit = capabilities.workspace?.applyEdit === true
      state = 'initialized'
      return {
        capabilities: {
          positionEncoding: 'utf-16',
          textDocumentSync: { openClose: true, change: LSP_TEXT_SYNC_FULL },
          completionProvider: { resolveProvider: false },
          ...(capabilities.textDocument?.inlineCompletion !== undefined && {
            inlineCompletionProvider: true,
          }),
          executeCommandProvider: { commands: Object.values(LSP_COMMANDS) },
        },
        serverInfo: { name: ACP_AGENT_TITLE },
      }
    }
    if (message.method === 'shutdown') {
      if (state === 'new') throw new Error('ELSP_NOT_READY')
      state = 'shutdown'
      for (const [id, call] of calls) if (id !== message.id) call.abort()
      return null
    }
    if (state === 'shutdown') throw new Error('ELSP_SHUT_DOWN')
    if (state !== 'ready') throw new Error('ELSP_NOT_READY')
    switch (message.method) {
      case 'textDocument/inlineCompletion': {
        const params = completionSchema.parse(message.params)
        const answer = await complete(
          params.textDocument.uri,
          params.position,
          params.context?.triggerKind === LSP_INLINE_TRIGGER_INVOKED,
          signal,
        )
        if (answer === undefined) return { items: [] }
        const range = { start: params.position, end: params.position }
        return {
          items: [
            {
              insertText: answer.suggestion.text,
              range,
              command: acceptCommand(answer.suggestion),
            },
          ],
        }
      }
      case 'textDocument/completion': {
        // A completion list's trigger cannot tell typing from a person's
        // explicit request, so it counts as automatic: `muse.tabInvoke` is
        // the explicit Tab where an editor has no inline completions.
        const params = completionSchema.parse(message.params)
        const answer = await complete(params.textDocument.uri, params.position, false, signal)
        if (answer === undefined) return []
        const range = { start: params.position, end: params.position }
        return [
          {
            label: labelOf(answer.suggestion.text, services.label),
            kind: LSP_COMPLETION_ITEM_TEXT,
            detail: services.label,
            insertTextFormat: LSP_INSERT_TEXT_PLAIN,
            filterText: '',
            textEdit: { range, newText: answer.suggestion.text },
            command: acceptCommand(answer.suggestion),
          },
        ]
      }
      case 'workspace/executeCommand': {
        return await executeCommand(message.params, signal)
      }
      default: {
        throw new Error('ELSP_METHOD')
      }
    }
  }

  await transport.closed
  signal.removeEventListener('abort', onAbort)
  for (const call of calls.values()) call.abort()
  services.dispose()
  return isShutDown() ? 0 : 1
}
