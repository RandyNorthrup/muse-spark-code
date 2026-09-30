// One loader for the workspace's Markdown catalogs (M76): Muse Code's
// skills (`.agents/skills/<id>/SKILL.md`) and this extension's custom agents
// (`.agents/agents/<id>/AGENT.md`). Both list `<id>` directories under a
// project root confined to the workspace and a personal root, ids sorted,
// the project shadowing the personal one, each file size-capped and parsed;
// every skip is a warning naming what is wrong, never a failed turn.

import path from 'node:path'
import { type ContextIo, type ContextText, readContextText } from './contextFiles'

export interface CatalogLoaderDeps {
  readonly io: ContextIo
  readonly platform: NodeJS.Platform
}

export interface CatalogRoot<Source extends string = string> {
  /** Absolute directory holding `<id>/<file>` entries. */
  readonly directory: string
  readonly source: Source
  /**
   * The workspace root for project catalogs: a file whose canonical path
   * leaves it is skipped. Undefined for the personal root.
   */
  readonly confineTo: string | undefined
}

export interface CatalogKind {
  /** `skill` or `agent`, as the skip warnings name the entries. */
  readonly kind: string
  readonly fileName: string
  readonly maxBytes: number
  readonly idPattern: RegExp
}

export type CatalogParse<Entry> =
  | { readonly ok: true; readonly name: string; readonly entry: Entry }
  | { readonly ok: false; readonly reason: string }

export interface CatalogEntry<Entry, Source> {
  readonly id: string
  readonly source: Source
  readonly entry: Entry
}

export interface CatalogLoad<Entry, Source> {
  readonly entries: readonly CatalogEntry<Entry, Source>[]
  readonly warnings: readonly string[]
}

export type FrontMatterSplit =
  | { readonly ok: true; readonly fields: ReadonlyMap<string, string>; readonly body: string }
  | { readonly ok: false; readonly reason: string }

const FRONT_MATTER_FENCE = '---'
const LINE_BREAK = /\r?\n/
const KEY_VALUE = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/
const QUOTE_PAIRS = [
  ['"', '"'],
  ["'", "'"],
] as const

function unquote(value: string): string {
  const trimmed = value.trim()
  for (const [open, close] of QUOTE_PAIRS) {
    if (trimmed.length >= 2 && trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

/** Splits a catalog file into its front matter fields and body. */
export function splitFrontMatter(text: string): FrontMatterSplit {
  const lines = text.split(LINE_BREAK)
  if (lines[0]?.trim() !== FRONT_MATTER_FENCE) {
    return { ok: false, reason: 'front matter is missing' }
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FRONT_MATTER_FENCE)
  if (end === -1) {
    return { ok: false, reason: 'front matter is not closed' }
  }
  const fields = new Map<string, string>()
  for (const line of lines.slice(1, end)) {
    const match = KEY_VALUE.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      fields.set(match[1], unquote(match[2]))
    }
  }
  return {
    ok: true,
    fields,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** One catalog file; a read that throws (a link loop, permissions) refuses that entry only. */
async function readCatalogFile(
  deps: CatalogLoaderDeps,
  file: string,
  confineTo: string | undefined,
): Promise<ContextText | undefined> {
  try {
    return await readContextText(deps, file, confineTo)
  } catch (error: unknown) {
    return { ok: false, reason: `could not be read: ${describe(error)}` }
  }
}

/** Every valid entry under the roots, in root order; ids sorted within a root. */
export async function loadCatalogFiles<Entry, Source extends string>(
  deps: CatalogLoaderDeps,
  roots: readonly CatalogRoot<Source>[],
  kind: CatalogKind,
  parse: (text: string) => CatalogParse<Entry>,
): Promise<CatalogLoad<Entry, Source>> {
  const pathModule = deps.platform === 'win32' ? path.win32 : path.posix
  const seen = new Map<string, Source>()
  const entries: CatalogEntry<Entry, Source>[] = []
  const warnings: string[] = []
  for (const root of roots) {
    const listed = await deps.io.listDirectory(root.directory)
    const ids = listed.toSorted((a, b) => a.localeCompare(b, 'en'))
    for (const id of ids) {
      const label = `${root.source} ${kind.kind} ${id}`
      if (!kind.idPattern.test(id)) {
        warnings.push(`${label} skipped: the directory name is not a valid ${kind.kind} id`)
        continue
      }
      const shadowedBy = seen.get(id)
      if (shadowedBy !== undefined) {
        warnings.push(
          `${label} skipped: the ${shadowedBy} ${kind.kind} with the same id takes precedence`,
        )
        continue
      }
      const file = pathModule.join(root.directory, id, kind.fileName)
      const read = await readCatalogFile(deps, file, root.confineTo)
      if (read === undefined) {
        warnings.push(`${label} skipped: ${kind.fileName} is missing`)
        continue
      }
      if (!read.ok) {
        warnings.push(`${label} skipped: ${kind.fileName} ${read.reason}`)
        continue
      }
      const { text } = read
      const bytes = Buffer.byteLength(text)
      if (bytes > kind.maxBytes) {
        warnings.push(
          `${label} skipped: ${kind.fileName} is ${String(bytes)} bytes, over the ${String(kind.maxBytes)} byte limit`,
        )
        continue
      }
      const parsed = parse(text)
      if (!parsed.ok) {
        warnings.push(`${label} skipped: ${parsed.reason}`)
        continue
      }
      if (parsed.name !== id) {
        warnings.push(
          `${label}: front matter name ${parsed.name} differs from the directory; the directory name is the selector`,
        )
      }
      seen.set(id, root.source)
      entries.push({ id, source: root.source, entry: parsed.entry })
    }
  }
  return { entries, warnings }
}
