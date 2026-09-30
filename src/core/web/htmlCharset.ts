// An HTML page's bytes as text (M69, PLAN.md D49), as the HTML standard's
// encoding sniffing finds the encoding (html-encoding-sniffer, the
// implementation jsdom uses): a byte order mark, then the Content-Type
// header's charset, then the prescan of the first 1,024 bytes for a
// `<meta>` that declares one (comments and other attributes skipped as the
// standard says), else UTF-8.
// Only a byte order mark or the header makes the encoding certain: one from
// the prescan or the fallback is tentative, and a `<meta>` the parser meets
// later may still change it (changedEncoding, the standard's "change the
// encoding"). The standard leaves the fallback to the user's locale; UTF-8
// is what a page without any declaration most likely is.

import { TextDecoder } from 'node:util'
import sniffHtmlEncoding from 'html-encoding-sniffer'
import { decodeIn, encodingOf, UndecodableText } from './textDecoding'

const FALLBACK_ENCODING = 'utf8'
// Handed to the sniffer as its fallback, so a sniff that found nothing is known.
const NOTHING_FOUND = 'x-nothing-found'
const UTF_16 = new Set(['utf-16be', 'utf-16le'])
const USER_DEFINED = 'x-user-defined'
const WINDOWS_1252 = 'windows-1252'
// The Encoding standard's name for UTF-8, as TextDecoder reports it.
const UTF_8 = new TextDecoder(FALLBACK_ENCODING).encoding

/** A page's text, the encoding it was decoded in, and whether a later `<meta>` may change it. */
export interface DecodedHtml {
  readonly text: string
  /** The Encoding standard's name, lower case (`utf-8`, `windows-1252`). */
  readonly encoding: string
  readonly isTentative: boolean
}

/** The encoding a byte order mark or the header makes certain, if either does. */
function certainEncoding(bytes: Uint8Array, headerCharset: string | undefined): string | undefined {
  const found = sniffHtmlEncoding(bytes, {
    xml: true,
    ...(headerCharset !== undefined && { transportLayerEncodingLabel: headerCharset }),
    defaultEncoding: NOTHING_FOUND,
  })
  return found === NOTHING_FOUND ? undefined : found
}

/** The page's encoding, and whether it is only tentative. */
function sniff(
  bytes: Uint8Array,
  headerCharset: string | undefined,
): { readonly encoding: string; readonly isTentative: boolean } {
  const certain = certainEncoding(bytes, headerCharset)
  if (certain !== undefined) {
    return { encoding: certain, isTentative: false }
  }
  let prescanned: string
  try {
    prescanned = sniffHtmlEncoding(bytes, { defaultEncoding: NOTHING_FOUND })
  } catch {
    // html-encoding-sniffer 6.0.0 throws on a malformed `<meta>` content
    // (`charset=` with nothing after it): the prescan then found nothing.
    prescanned = NOTHING_FOUND
  }
  return {
    encoding: prescanned === NOTHING_FOUND ? FALLBACK_ENCODING : prescanned,
    isTentative: true,
  }
}

/** The page's text, decoded in the encoding its bytes, header and markup declare. */
export function decodeHtml(bytes: Uint8Array, headerCharset: string | undefined): DecodedHtml {
  const sniffed = sniff(bytes, headerCharset)
  // The sniffer names only the standard's encodings; one this runtime lacks is refused.
  const encoding = encodingOf(sniffed.encoding)
  if (encoding === undefined) {
    throw new UndecodableText(sniffed.encoding.toLowerCase())
  }
  return { text: decodeIn(bytes, encoding), encoding, isTentative: sniffed.isTentative }
}

/**
 * The encoding a `<meta>` met while parsing changes a tentative one to (the
 * standard's "change the encoding"), or undefined when it stays: a UTF-16
 * page, or a declaration of the same encoding, changes nothing; UTF-16 is
 * read as UTF-8, and x-user-defined as windows-1252.
 */
export function changedEncoding(current: string, declaredLabel: string): string | undefined {
  const declared = encodingOf(declaredLabel)
  if (declared === undefined || UTF_16.has(current)) {
    return undefined
  }
  let next = declared
  if (UTF_16.has(next)) {
    next = UTF_8
  } else if (next === USER_DEFINED) {
    next = WINDOWS_1252
  }
  return next === current ? undefined : next
}

/**
 * The charset a `<meta http-equiv="content-type">`'s content names (the
 * standard's "extracting a character encoding from a meta element").
 */
export function charsetInMetaContent(content: string): string | undefined {
  const lower = content.toLowerCase()
  let from = 0
  for (let at = lower.indexOf(CHARSET, from); at !== -1; at = lower.indexOf(CHARSET, from)) {
    let index = skipWhitespace(content, at + CHARSET.length)
    if (content[index] !== EQUALS) {
      from = at + CHARSET.length
      continue
    }
    index = skipWhitespace(content, index + 1)
    const quote = content[index]
    if (quote === '"' || quote === "'") {
      const end = content.indexOf(quote, index + 1)
      return end === -1 ? undefined : content.slice(index + 1, end)
    }
    let end = index
    while (end < content.length && !WHITESPACE.has(content[end] ?? '') && content[end] !== ';') {
      end += 1
    }
    return end === index ? undefined : content.slice(index, end)
  }
  return undefined
}

const CHARSET = 'charset'
const EQUALS = '='
const WHITESPACE = new Set([' ', '\t', '\n', '\f', '\r'])

function skipWhitespace(text: string, from: number): number {
  let index = from
  while (index < text.length && WHITESPACE.has(text[index] ?? '')) {
    index += 1
  }
  return index
}
