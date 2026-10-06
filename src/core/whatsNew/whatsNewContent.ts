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
import { Buffer } from 'node:buffer'
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from 'node:zlib'
import {
  L10N_COMPRESSION_QUALITY,
  UI_TEXT,
  WHATS_NEW_CONTENT_MAX_BYTES,
  WHATS_NEW_CONTENT_DECODE_MAX_BYTES,
} from '../../shared/constants'

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

const packedContentSchema = z.object({
  encoding: z.literal('br'),
  data: z.string().check(z.regex(/^[A-Za-z0-9+/]*={0,2}$/)),
})

/** Build-only encoding retains both full releases within the artifact budget. */
export function encodeWhatsNewContent(text: string): string {
  const bytes = Buffer.byteLength(text)
  if (bytes > WHATS_NEW_CONTENT_DECODE_MAX_BYTES) throw new Error(UI_TEXT.actionFailed)
  contentSchema.parse(JSON.parse(text))
  if (bytes <= WHATS_NEW_CONTENT_MAX_BYTES) return text
  const data = brotliCompressSync(text, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: L10N_COMPRESSION_QUALITY },
  }).toString('base64')
  const packed = JSON.stringify({ encoding: 'br', data })
  if (Buffer.byteLength(packed) > WHATS_NEW_CONTENT_MAX_BYTES) throw new Error(UI_TEXT.actionFailed)
  return packed
}

/** The content file's text, checked; throws with zod's reason when it is not ours. */
export function parseWhatsNewContent(text: string): WhatsNewContent {
  const raw: unknown = JSON.parse(text)
  const packed = packedContentSchema.safeParse(raw)
  if (packed.success && Buffer.byteLength(text) > WHATS_NEW_CONTENT_MAX_BYTES)
    throw new Error(UI_TEXT.actionFailed)
  const content: unknown = packed.success
    ? JSON.parse(
        brotliDecompressSync(Buffer.from(packed.data.data, 'base64'), {
          maxOutputLength: WHATS_NEW_CONTENT_DECODE_MAX_BYTES,
        }).toString('utf8'),
      )
    : raw
  return contentSchema.parse(content)
}
