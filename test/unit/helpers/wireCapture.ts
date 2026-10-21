// One recorded JSON-RPC frame row of an MSP capture envelope (the m106
// captures): the direction on the wire and the frame itself. The envelopes
// differ per capture (each keeps its own provenance shape), but every row
// has this shape, so the suites share it instead of repeating it.
import { z } from 'zod'

const record = z.record(z.string(), z.unknown())

export const captureFrameRow = z.object({
  direction: z.enum(['sent', 'received']),
  frame: z.object({
    jsonrpc: z.literal('2.0'),
    id: z.number().optional(),
    method: z.string().optional(),
    params: record.optional(),
    result: record.optional(),
    error: z
      .object({
        code: z.number(),
        message: z.string(),
        data: record,
      })
      .optional(),
  }),
})
