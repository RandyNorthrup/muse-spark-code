// One web search result. Meta's `web_search_call` results (M33) and Muse
// Code's own `web_search` tool result (captured live 2026-09-25, M43) share
// this shape, so both backends' search rows render the same list.

import * as z from 'zod/mini'

export const webResultSchema = z.object({
  url: z.string(),
  title: z.optional(z.nullable(z.string())),
  snippet: z.optional(z.nullable(z.string())),
})
