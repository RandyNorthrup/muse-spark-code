// The stored `tool_patch` document an edit-family tool call leaves behind
// (`item/readOutput` of the item's `patchRef`, `application/json`; shape
// verified live 2026-09-21, docs/certification/m4.md): unified hunks with
// line numbers, one entry per file. Shared by the webview (diff rows) and the
// host (diff view and revert). No `vscode`, Node or DOM imports.

import * as z from 'zod/mini'

export const patchHunkSchema = z.object({
  oldStart: z.number(),
  oldLines: z.optional(z.number()),
  newStart: z.number(),
  newLines: z.optional(z.number()),
  /** Unified lines: ` ` context, `-` removed, `+` added, marker first. */
  lines: z.array(z.string()),
})
export type PatchHunk = z.infer<typeof patchHunkSchema>

export const patchFileSchema = z.object({
  /** Workspace-relative or absolute, as the tool reported it. */
  path: z.string(),
  hunks: z.array(patchHunkSchema),
  /**
   * Whether the edit created the file (PLAN.md D27). The Model API's tools
   * say so; Muse Code's documents do not, and a whole-file add stands in.
   */
  created: z.optional(z.boolean()),
})
export type PatchFile = z.infer<typeof patchFileSchema>

const patchDocumentSchema = z.object({ files: z.array(patchFileSchema) })

export const ADD_MARKER = '+'
export const REMOVE_MARKER = '-'
export const CONTEXT_MARKER = ' '

/** The document's files; undefined when the text is not a patch document. */
export function parsePatchFiles(json: string): readonly PatchFile[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return undefined
  }
  const result = patchDocumentSchema.safeParse(parsed)
  return result.success ? result.data.files : undefined
}
