// A function tool definition as recorded request bytes carry it, shared by
// the tests that parse captures back into the send path's shapes. Loose,
// so a recorded addition is retained where a test compares rather than
// silently omitted.
import * as z from 'zod/mini'

export const recordedFunctionToolSchema = z.looseObject({
  type: z.literal('function'),
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  strict: z.boolean(),
})
