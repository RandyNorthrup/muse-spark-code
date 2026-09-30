// The first line of a fetched page as the model receives it (M69, PLAN.md
// D49): `MODEL_TEXT.webFetchHeader`, written by the extension's own fetch on
// both backends (on Muse Code it reaches the row as the `ide` tool's text,
// verbatim, as the M5 capture showed for `mcp__ide__getDiagnostics`). The
// row reads the size and type back from it; a line that does not match
// (another tool's text) gives no size, and the text is still shown whole.

import * as z from 'zod/mini'

export interface WebPageFacts {
  readonly url: string
  readonly status: number
  readonly type: string
  readonly bytes: number
}

// `Fetched <url> (HTTP <status>, <type>, <bytes> bytes).` Each part is a run
// of characters the next separator cannot hold, so the match is linear.
const HEADER = /^Fetched (\S+) \(HTTP (\d{3}), ([^\s,()]+), (\d+) bytes\)\./
const HEADER_MAX_CHARS = 4096
const factsSchema = z.object({
  url: z.string(),
  status: z.int(),
  type: z.string(),
  bytes: z.int().check(z.nonnegative()),
})

/** The facts of a fetch result's first line, or undefined when it is not one. */
export function parseWebPageHeader(output: string): WebPageFacts | undefined {
  const match = HEADER.exec(output.slice(0, HEADER_MAX_CHARS))
  if (match === null) {
    return undefined
  }
  const parsed = factsSchema.safeParse({
    url: match[1],
    status: Number(match[2]),
    type: match[3],
    bytes: Number(match[4]),
  })
  return parsed.success ? parsed.data : undefined
}
