// Presentation projections, not MHP wire shapes. T-MHP injects the frozen
// protocol's schema-validated decoder and encoder (docs/certification/m110-t.md).
import { z } from 'zod'
import { TUI_LIMITS } from '../../shared/constants'
import { legacyUsdSchema } from '../../shared/usdSchema'

const id = z.string().min(1).max(TUI_LIMITS.inputChars)
const text = z.string().max(TUI_LIMITS.transcriptChars)
const expiry = z.number().nonnegative()
const askIdentity = { id, digest: id, expiresAt: expiry, title: text, detail: text }
const askSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...askIdentity, kind: z.literal('tool') }),
  z.strictObject({ ...askIdentity, kind: z.literal('vault') }),
  z.strictObject({
    ...askIdentity,
    kind: z.literal('paid'),
    price: id,
    // Exact money (a number on the wire canonicalizes); never a float.
    dailyBudgetUsd: legacyUsdSchema,
  }),
])

export const tuiEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('status'),
    node: id,
    attended: z.boolean(),
    cpuPercent: z.number().min(0).max(100),
    memoryBytes: z.number().nonnegative(),
    sealed: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('pairing'),
    // Full SHA-256, never a shortened display pin or a setup-code-derived pin.
    fingerprint: z.string().regex(/^[\da-f]{64}$/i),
    setup: z
      .strictObject({ code: z.string().min(1).max(TUI_LIMITS.setupCodeChars), expiresAt: expiry })
      .nullable(),
  }),
  z.strictObject({
    type: z.literal('chat'),
    id,
    role: z.enum(['user', 'agent']),
    text,
    delta: z.boolean(),
  }),
  z.strictObject({ type: z.literal('diff'), path: id, patch: text }),
  z.strictObject({ type: z.literal('ask'), ask: askSchema }),
  z.strictObject({ type: z.literal('settled'), id }),
  z.strictObject({
    type: z.literal('tasks'),
    items: z.array(z.strictObject({ id, title: text, status: id })).max(TUI_LIMITS.tasks),
  }),
])
export type TuiEvent = z.infer<typeof tuiEventSchema>
export type TuiAsk = z.infer<typeof askSchema>

export const tuiActionSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('message'), text: id }),
  z.strictObject({ type: z.literal('stop'), scope: z.literal('all') }),
  z.strictObject({
    type: z.literal('answer'),
    id,
    digest: id,
    expiresAt: expiry,
    choice: z.enum(['once', 'always', 'deny']),
  }),
])
export type TuiAction = z.infer<typeof tuiActionSchema>

export interface TuiWireBinding {
  /** Validate with MHP/node zod schemas FIRST, then project into tuiEventSchema. */
  decode(frame: unknown): TuiEvent
  /** Map a validated action to a validated frozen MHP request. */
  encode(action: TuiAction): unknown
}

export interface TuiConnection {
  send(action: TuiAction): void
  /** Rejects on invalid frames, connection loss or a failed write. */
  readonly closed: Promise<void>
  close(): void
}

export type TuiConnect = (receive: (event: TuiEvent) => void) => Promise<TuiConnection>
