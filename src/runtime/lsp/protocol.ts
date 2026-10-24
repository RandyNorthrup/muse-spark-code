// The language server's wire shapes (M104 lane H, PLAN.md D84): JSON-RPC
// 2.0 messages and the LSP 3.17/3.18 parameters the server reads, each
// parsed with zod before use (AGENTS.md rule 7).
import * as z from 'zod/mini'
import { LSP_COMMANDS } from '../../shared/constants'

const index = z.int().check(z.gte(0))
/** A UTF-16 line and character, as LSP counts them. */
export const positionSchema = z.object({ line: index, character: index })
export type Position = z.infer<typeof positionSchema>
export const textDocumentSchema = z.object({ uri: z.string() })
export const idSchema = z.union([z.string(), z.int()])
export type RpcId = z.infer<typeof idSchema>

/** A request has a method and an id, a notification a method only, a response an id and one outcome. */
export const messageSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.optional(z.nullable(idSchema)),
    method: z.optional(z.string().check(z.minLength(1))),
    params: z.optional(z.unknown()),
    result: z.optional(z.unknown()),
    error: z.optional(z.object({ code: z.int(), message: z.string() })),
  })
  .check(
    z.refine((value) =>
      value.method === undefined
        ? value.id !== undefined && Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error')
        : value.id !== null && !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error'),
    ),
  )
export type RpcMessage = z.infer<typeof messageSchema>

export const initializeSchema = z.object({
  capabilities: z.object({
    workspace: z.optional(z.object({ applyEdit: z.optional(z.boolean()) })),
    textDocument: z.optional(z.object({ inlineCompletion: z.optional(z.unknown()) })),
    general: z.optional(z.object({ positionEncodings: z.optional(z.array(z.string())) })),
  }),
})
export const openedSchema = z.object({
  textDocument: z.object({
    uri: z.string(),
    languageId: z.string(),
    version: z.int(),
    text: z.string(),
  }),
})
/** Full synchronization only: the server announces `TextDocumentSyncKind.Full`. */
export const changedSchema = z.object({
  textDocument: z.object({ uri: z.string(), version: z.int() }),
  contentChanges: z.tuple([z.object({ text: z.string() })]),
})
export const closedSchema = z.object({ textDocument: textDocumentSchema })
export const cancelSchema = z.object({ id: idSchema })
export const completionSchema = z.object({
  textDocument: textDocumentSchema,
  position: positionSchema,
  context: z.optional(z.object({ triggerKind: z.int() })),
})
export const commandSchema = z.object({
  command: z.enum([
    LSP_COMMANDS.usage,
    LSP_COMMANDS.help,
    LSP_COMMANDS.stop,
    LSP_COMMANDS.tabInvoke,
    LSP_COMMANDS.tabAccepted,
  ]),
  arguments: z.optional(z.array(z.unknown())),
})
/** `muse.tabInvoke`'s arguments: the document, its version and the cursor. */
export const invokeArgumentsSchema = z.tuple([z.string(), z.int(), positionSchema])
/** `window/showMessageRequest`'s answer: the chosen action, or none when dismissed. */
export const actionAnswerSchema = z.nullable(z.object({ title: z.string() }))
/** `workspace/applyEdit`'s answer. */
export const appliedSchema = z.object({ applied: z.boolean() })
