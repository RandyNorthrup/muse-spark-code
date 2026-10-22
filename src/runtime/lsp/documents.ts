import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { LSP_LIMITS } from '../../shared/constants'
import type { Position, Range } from './protocol'

export interface LspDocument {
  readonly uri: string
  readonly path: string
  readonly version: number
  readonly languageId: string
  readonly text: string
}

export function workspaceFile(workspace: string, uri: string): string {
  const url = new URL(uri)
  if (url.protocol !== 'file:' || url.search !== '' || url.hash !== '') throw new Error('ELSP_URI')
  const file = fileURLToPath(url)
  const relative = path.relative(workspace, file)
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error('ELSP_ROOT')
  return file
}

/** LSP positions are UTF-16; reject bad offsets rather than clamp into another edit. */
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

export function rangeOffsets(text: string, range: Range): { start: number; end: number } {
  const start = documentOffset(text, range.start)
  const end = documentOffset(text, range.end)
  if (end < start) throw new Error('ELSP_RANGE')
  return { start, end }
}

export class LspDocuments {
  private readonly leases = new Map<string, AbortController>()
  private readonly open = new Map<string, LspDocument>()
  public constructor(private readonly workspace: string) {}
  public put(document: Omit<LspDocument, 'path'>): void {
    const old = this.open.get(document.uri)
    if (old !== undefined && document.version <= old.version) throw new Error('ELSP_VERSION')
    if (old === undefined && this.open.size >= LSP_LIMITS.documentCount)
      throw new Error('ELSP_DOCUMENTS')
    if (Buffer.byteLength(document.text) > LSP_LIMITS.documentBytes)
      throw new Error('ELSP_DOCUMENT_SIZE')
    const file = workspaceFile(this.workspace, document.uri)
    this.leases.get(document.uri)?.abort()
    this.leases.set(document.uri, new AbortController())
    this.open.set(document.uri, { ...document, path: file })
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
  public signal(uri: string): AbortSignal {
    const lease = this.leases.get(uri)
    if (lease === undefined) throw new Error('ELSP_DOCUMENT_CLOSED')
    return lease.signal
  }
  public current(document: LspDocument): boolean {
    return this.open.get(document.uri) === document
  }
}
