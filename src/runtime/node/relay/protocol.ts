// The relay's wire frames (M110d lane X1, D90.8): `node relay` forwards
// opaque sealed envelopes between registered nodes and never sees inside
// one. Every frame is parsed with these schemas before use (rule 7). The
// frame ceiling is the relay operator's own setting: the reader takes it
// as a parameter and refuses past it, and there is no default of ours.
import * as z from 'zod/mini'

const FRAME_LENGTH_BYTES = 4
const RELAY_NODE_ID_MAX = 128

export const relayNodeIdSchema = z.string().check(z.minLength(1), z.maxLength(RELAY_NODE_ID_MAX))
export type RelayNodeId = z.infer<typeof relayNodeIdSchema>

export const relayClientFrameSchema = z.union([
  z.strictObject({ t: z.literal('register'), nodeId: relayNodeIdSchema }),
  z.strictObject({
    t: z.literal('forward'),
    to: relayNodeIdSchema,
    sealed: z.string().check(z.minLength(1)),
    sequence: z.int().check(z.gte(0)),
  }),
  z.strictObject({ t: z.literal('close') }),
])
export type RelayClientFrame = z.infer<typeof relayClientFrameSchema>

export const relayServerFrameSchema = z.union([
  z.strictObject({ t: z.literal('registered'), nodeId: relayNodeIdSchema }),
  z.strictObject({
    t: z.literal('deliver'),
    from: relayNodeIdSchema,
    sealed: z.string().check(z.minLength(1)),
    sequence: z.int().check(z.gte(0)),
  }),
  z.strictObject({ t: z.literal('unreachable'), to: relayNodeIdSchema, reason: z.string() }),
  z.strictObject({ t: z.literal('refused'), reason: z.string().check(z.minLength(1)) }),
])
export type RelayServerFrame = z.infer<typeof relayServerFrameSchema>

export function encodeRelayFrame(frame: RelayClientFrame | RelayServerFrame): Buffer {
  const body = Buffer.from(JSON.stringify(frame), 'utf8')
  const out = Buffer.alloc(FRAME_LENGTH_BYTES + body.length)
  out.writeUInt32BE(body.length, 0)
  body.copy(out, FRAME_LENGTH_BYTES)
  return out
}

export type RelayReaderResult =
  | { readonly ok: true; readonly frames: readonly unknown[] }
  | { readonly ok: false; readonly problem: 'oversize' | 'unparseable' }

/* Pulls length-prefixed frames out of socket chunks; bad bytes are a
 * verdict, and the first bad verdict latches: a poisoned reader never
 * answers again, so no caller can continue past a failure. */
export class RelayFrameReader {
  private pending: Buffer = Buffer.alloc(0)
  private failed: RelayReaderResult | undefined

  public constructor(private readonly maxFrameBytes: number) {
    if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1)
      throw new Error('the relay frame ceiling is a positive whole number of bytes')
  }

  public push(chunk: Buffer): RelayReaderResult {
    if (this.failed !== undefined) return this.failed
    this.pending = Buffer.concat([this.pending, chunk])
    const frames: unknown[] = []
    for (;;) {
      if (this.pending.length < FRAME_LENGTH_BYTES) return { ok: true, frames }
      const length = this.pending.readUInt32BE(0)
      if (length > this.maxFrameBytes) {
        this.failed = { ok: false, problem: 'oversize' }
        return this.failed
      }
      if (this.pending.length < FRAME_LENGTH_BYTES + length) return { ok: true, frames }
      const body = this.pending
        .subarray(FRAME_LENGTH_BYTES, FRAME_LENGTH_BYTES + length)
        .toString('utf8')
      this.pending = this.pending.subarray(FRAME_LENGTH_BYTES + length)
      try {
        const parsed: unknown = JSON.parse(body)
        frames.push(parsed)
      } catch (error) {
        if (error instanceof SyntaxError) {
          this.failed = { ok: false, problem: 'unparseable' }
          return this.failed
        }
        throw error
      }
    }
  }
}
