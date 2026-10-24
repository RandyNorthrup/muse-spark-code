// The editor's open documents as the language server holds them (M104
// lane H): full text, version and language, synchronized in full on every
// change. Positions are LSP's UTF-16 code units; an offset outside the text
// is refused, never clamped into another place.
import { fileURLToPath } from 'node:url'
import type { Position } from './protocol'

export interface LspDocument {
  readonly uri: string
  /** The file's path for a `file:` document; undefined for any other scheme. */
  readonly path: string | undefined
  readonly languageId: string
  readonly version: number
  readonly text: string
}

/** A `file:` URI's path; any other scheme, or a query or fragment, names no file. */
function filePath(uri: string): string | undefined {
  let url: URL
  try {
    url = new URL(uri)
  } catch (error: unknown) {
    // An unparsable URI (the WHATWG parser's TypeError) names no file.
    if (!(error instanceof TypeError)) throw error
    return undefined
  }
  return url.protocol === 'file:' && url.search === '' && url.hash === ''
    ? fileURLToPath(url)
    : undefined
}

/** The UTF-16 offset of a position; a line or character past the text throws. */
export function documentOffset(text: string, position: Position): number {
  let start = 0
  for (let line = 0; line < position.line; line += 1) {
    const end = text.indexOf('\n', start)
    if (end === -1) throw new Error('ELSP_POSITION')
    start = end + 1
  }
  const newline = text.indexOf('\n', start)
  let end = newline === -1 ? text.length : newline
  if (end > start && text[end - 1] === '\r') end -= 1
  if (position.character > end - start) throw new Error('ELSP_POSITION')
  return start + position.character
}

export class LspDocuments {
  private readonly open = new Map<string, LspDocument>()
  /** Each open document's lease: a change or a close aborts work begun on the older text. */
  private readonly leases = new Map<string, AbortController>()

  public put(document: Omit<LspDocument, 'path'>): void {
    const old = this.open.get(document.uri)
    if (old !== undefined && document.version <= old.version) throw new Error('ELSP_VERSION')
    this.leases.get(document.uri)?.abort()
    this.leases.set(document.uri, new AbortController())
    this.open.set(document.uri, { ...document, path: filePath(document.uri) })
  }

  public get(uri: string): LspDocument {
    const document = this.open.get(uri)
    if (document === undefined) throw new Error('ELSP_DOCUMENT_CLOSED')
    return document
  }

  public close(uri: string): void {
    this.leases.get(uri)?.abort()
    this.leases.delete(uri)
    this.open.delete(uri)
  }

  /** Aborts when the document changes or closes. */
  public signal(uri: string): AbortSignal {
    const lease = this.leases.get(uri)
    if (lease === undefined) throw new Error('ELSP_DOCUMENT_CLOSED')
    return lease.signal
  }

  /** Whether this exact version is still the one open. */
  public isCurrent(document: LspDocument): boolean {
    return this.open.get(document.uri) === document
  }
}
