// Runtime-only LSP requires Node 22; its Map.groupBy and promise declarations
// stay out of the Node 20 extension activation bundle.
/// <reference lib="es2024.collection" />
/// <reference lib="es2024.promise" />
import * as z from 'zod/mini'
import { LSP_LIMITS } from '../../shared/constants'

const integer = z.int().check(z.gte(0))
export const positionSchema = z.strictObject({ line: integer, character: integer })
export const rangeSchema = z.strictObject({ start: positionSchema, end: positionSchema })
export const uriSchema = z.string().check(z.maxLength(LSP_LIMITS.uriChars))
export const documentSchema = z.object({ uri: uriSchema })
export const locationSchema = z.object({ textDocument: documentSchema, position: positionSchema })
export const diagnosticSchema = z.object({
  range: rangeSchema,
  message: z.string().check(z.maxLength(LSP_LIMITS.messageChars)),
  severity: z.optional(z.int().check(z.gte(1), z.lte(LSP_LIMITS.diagnosticSeverities))),
  source: z.optional(z.string()),
  code: z.optional(z.union([z.string(), z.number()])),
})
export const editSchema = z.strictObject({ range: rangeSchema, newText: z.string() })
export const suggestionSchema = z.strictObject({
  uri: uriSchema,
  version: z.int(),
  contentHash: z.string().check(z.regex(/^[a-f0-9]{64}$/u)),
  diagnostic: diagnosticSchema,
  edit: z.optional(editSchema),
})
export type Position = z.infer<typeof positionSchema>
export type Range = z.infer<typeof rangeSchema>
export type Suggestion = z.infer<typeof suggestionSchema>
export const idSchema = z.union([z.string(), z.int()])
export type RpcId = z.infer<typeof idSchema>
export const messageSchema = z
  .object({
    jsonrpc: z.literal('2.0'),
    id: z.optional(z.nullable(idSchema)),
    method: z.optional(z.string().check(z.minLength(1), z.maxLength(LSP_LIMITS.messageChars))),
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
export const COMMANDS = [
  'muse.openPanel',
  'muse.stop',
  'muse.usage',
  'muse.help',
  'muse.fix',
  'muse.explain',
  'muse.apply',
] as const
export const commandSchema = z.object({
  command: z.enum(COMMANDS),
  arguments: z.optional(z.array(z.unknown())),
})
