import type * as z from 'zod/mini'
import type { panelErrorSchema } from './panel'

// Separate from the schemas so the shared companion transport stays small.
export class MhpPanelError extends Error {
  constructor(readonly frame: z.infer<typeof panelErrorSchema>) {
    super(frame.code)
  }
}
