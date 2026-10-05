// What's New's content (M99, PLAN.md D79): CHANGELOG.md's released sections,
// turned at build time (scripts/lib/whatsNewContent.mjs) into a small tree
// of the few Markdown parts release notes use, written to dist/whatsNew.json
// and read by the What's New bundle the first time it shows a page. The tree
// holds text only: raw HTML never becomes markup (an HTML comment is dropped,
// any other tag is kept as its literal text), a picture becomes its alt text,
// and a link is kept only when it is http or https. The notes stay English
// (D79); the page's own words are translated.
//
// The file ships inside the extension, but it is still read through this
// schema before use (AGENTS.md rule 7).

import * as z from 'zod/mini'

export const WHATS_NEW_CONTENT_SCHEMA_VERSION = 1

export type Inline =
  | { readonly t: 'text'; readonly v: string }
  | { readonly t: 'code'; readonly v: string }
  | { readonly t: 'br' }
  | { readonly t: 'strong' | 'em' | 'del'; readonly c: readonly Inline[] }
  | { readonly t: 'link'; readonly href: string; readonly c: readonly Inline[] }

export type Block =
  | { readonly t: 'p' | 'h'; readonly c: readonly Inline[] }
  | { readonly t: 'pre'; readonly v: string }
  | { readonly t: 'quote'; readonly c: readonly Block[] }
  | {
      readonly t: 'list'
      readonly ordered: boolean
      readonly start: number
      readonly items: readonly (readonly Block[])[]
    }

/** A Highlight's "Try it": a contributed command to run, or a setting to open (D79). */
export const TRY_KINDS = ['command', 'setting'] as const
export type TryKind = (typeof TRY_KINDS)[number]
export interface TryIt {
  readonly kind: TryKind
  readonly id: string
}

export interface Highlight {
  readonly c: readonly Block[]
  readonly tries: readonly TryIt[]
}

export interface ReleaseSection {
  /** The `###` heading (Added, Changed, Fixed…); empty for text before the first one. */
  readonly heading: string
  readonly blocks: readonly Block[]
}

export interface ReleaseNotes {
  readonly version: string
  /** `YYYY-MM-DD`, as the CHANGELOG heading dates it. */
  readonly date: string
  readonly highlights: readonly Highlight[]
  readonly sections: readonly ReleaseSection[]
}

export interface WhatsNewContent {
  readonly schema: typeof WHATS_NEW_CONTENT_SCHEMA_VERSION
  readonly releases: readonly ReleaseNotes[]
}

const WEB_LINK = /^https?:\/\//
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/

const inlineSchema: z.ZodMiniType<Inline> = z.lazy(() =>
  z.union([
    z.object({ t: z.enum(['text', 'code']), v: z.string() }),
    z.object({ t: z.literal('br') }),
    z.object({ t: z.enum(['strong', 'em', 'del']), c: z.array(inlineSchema) }),
    z.object({
      t: z.literal('link'),
      href: z.string().check(z.regex(WEB_LINK)),
      c: z.array(inlineSchema),
    }),
  ]),
)

const blockSchema: z.ZodMiniType<Block> = z.lazy(() =>
  z.union([
    z.object({ t: z.enum(['p', 'h']), c: z.array(inlineSchema) }),
    z.object({ t: z.literal('pre'), v: z.string() }),
    z.object({ t: z.literal('quote'), c: z.array(blockSchema) }),
    z.object({
      t: z.literal('list'),
      ordered: z.boolean(),
      start: z.number(),
      items: z.array(z.array(blockSchema)),
    }),
  ]),
)

const contentSchema = z.object({
  schema: z.literal(WHATS_NEW_CONTENT_SCHEMA_VERSION),
  releases: z.array(
    z.object({
      version: z.string(),
      date: z.string().check(z.regex(RELEASE_DATE)),
      highlights: z.array(
        z.object({
          c: z.array(blockSchema),
          tries: z.array(z.object({ kind: z.enum(TRY_KINDS), id: z.string() })),
        }),
      ),
      sections: z.array(z.object({ heading: z.string(), blocks: z.array(blockSchema) })),
    }),
  ),
})

/** The content file's text, checked; throws with zod's reason when it is not ours. */
export function parseWhatsNewContent(text: string): WhatsNewContent {
  return contentSchema.parse(JSON.parse(text))
}
