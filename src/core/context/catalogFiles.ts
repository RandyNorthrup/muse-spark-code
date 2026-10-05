// One loader for the workspace's Markdown catalogs (M76): Muse Code's
// skills (`.agents/skills/<id>/SKILL.md`) and this extension's custom agents
// (`.agents/agents/<id>/AGENT.md`). Both list `<id>` directories under a
// project root confined to the workspace and a personal root, ids sorted,
// the project shadowing the personal one, each file size-capped and parsed;
// every skip is a warning naming what is wrong, never a failed turn.
//
// Each root stands alone (M76 review, RV70x): a root that cannot be listed
// is a warning naming it, and the other roots still load. What a root holds
// but did not yield (a root unlisted, a file unreadable, over its cap or
// refused) is reported with it, so a caller whose precedence narrows (the
// agents) can refuse a name instead of letting a lower root stand in.

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
  /** Entries kept across every root; the rest are skipped with one warning each. Undefined: no limit. */
  readonly maxEntries?: number
}

export type CatalogParse<Entry> =
  | { readonly ok: true; readonly name: string; readonly entry: Entry }
  | { readonly ok: false; readonly reason: string }

export interface CatalogEntry<Entry, Source> {
  readonly id: string
  readonly source: Source
  /** The root directory that yielded the entry (M92: one source may read two roots). */
  readonly directory: string
  readonly entry: Entry
}

/** A file a listed root holds but did not yield: unreadable, over its cap, refused, or past the limit. */
export interface CatalogRefusal {
  readonly id: string
  readonly file: string
}

/** What one root yielded beyond its entries (M76 review, RV70x). */
export interface CatalogRootLoad<Source extends string> {
  readonly root: CatalogRoot<Source>
  /** Why the root could not be listed; undefined when it was (a missing root lists as empty). */
  readonly listingFailure: string | undefined
  readonly refused: readonly CatalogRefusal[]
}

export interface CatalogLoad<Entry, Source extends string> {
  readonly entries: readonly CatalogEntry<Entry, Source>[]
  /** One per root, in root order. */
  readonly roots: readonly CatalogRootLoad<Source>[]
  readonly warnings: readonly string[]
}

export type FrontMatterSplit =
  | {
      readonly ok: true
      readonly fields: ReadonlyMap<string, string>
      readonly body: string
      /**
       * What the line reader could not take as `key: value` (a list item, an
       * indented continuation) and what it saw a second time: a format that
       * narrows something must refuse such a file, not guess its meaning.
       */
      readonly ignoredLines: readonly string[]
      readonly duplicateKeys: readonly string[]
    }
  | { readonly ok: false; readonly reason: string }

const FRONT_MATTER_FENCE = '---'
const COMMENT_PREFIX = '#'
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
  const ignoredLines: string[] = []
  const duplicateKeys: string[] = []
  for (const line of lines.slice(1, end)) {
    const match = KEY_VALUE.exec(line)
    if (match?.[1] !== undefined && match[2] !== undefined) {
      if (fields.has(match[1])) {
        duplicateKeys.push(match[1])
      }
      fields.set(match[1], unquote(match[2]))
    } else if (line.trim() !== '' && !line.trimStart().startsWith(COMMENT_PREFIX)) {
      ignoredLines.push(line)
    }
  }
  return {
    ok: true,
    fields,
    ignoredLines,
    duplicateKeys,
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
  maxBytes: number,
): Promise<ContextText | undefined> {
  try {
    return await readContextText(deps, file, confineTo, maxBytes)
  } catch (error: unknown) {
    return { ok: false, reason: `could not be read: ${describe(error)}` }
  }
}

/** A root's ids, or why it could not be listed. */
async function listRoot(
  deps: CatalogLoaderDeps,
  directory: string,
): Promise<{ readonly ids: readonly string[] } | { readonly failure: string }> {
  try {
    const listed = await deps.io.listDirectory(directory)
    return { ids: listed.toSorted((a, b) => a.localeCompare(b, 'en')) }
  } catch (error: unknown) {
    return { failure: describe(error) }
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
  const rootLoads: CatalogRootLoad<Source>[] = []
  const warnings: string[] = []
  for (const root of roots) {
    const listed = await listRoot(deps, root.directory)
    if ('failure' in listed) {
      // This root alone is unknown; the others still load.
      warnings.push(`loading the ${root.source} ${kind.kind}s failed: ${listed.failure}`)
      rootLoads.push({ root, listingFailure: listed.failure, refused: [] })
      continue
    }
    const refused: CatalogRefusal[] = []
    rootLoads.push({ root, listingFailure: undefined, refused })
    for (const id of listed.ids) {
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
      // What exists here but is not taken is reported with the root.
      const refuse = (warning: string): void => {
        warnings.push(`${label} skipped: ${warning}`)
        refused.push({ id, file })
      }
      if (kind.maxEntries !== undefined && entries.length >= kind.maxEntries) {
        refuse(`only the first ${String(kind.maxEntries)} ${kind.kind}s are loaded`)
        continue
      }
      const read = await readCatalogFile(deps, file, root.confineTo, kind.maxBytes)
      if (read === undefined) {
        warnings.push(`${label} skipped: ${kind.fileName} is missing`)
        continue
      }
      if (!read.ok) {
        refuse(`${kind.fileName} ${read.reason}`)
        continue
      }
      const { text } = read
      const bytes = Buffer.byteLength(text)
      if (bytes > kind.maxBytes) {
        refuse(
          `${kind.fileName} is ${String(bytes)} bytes, over the ${String(kind.maxBytes)} byte limit`,
        )
        continue
      }
      const parsed = parse(text)
      if (!parsed.ok) {
        refuse(parsed.reason)
        continue
      }
      if (parsed.name !== id) {
        warnings.push(
          `${label}: front matter name ${parsed.name} differs from the directory; the directory name is the selector`,
        )
      }
      seen.set(id, root.source)
      entries.push({ id, source: root.source, directory: root.directory, entry: parsed.entry })
    }
  }
  return { entries, roots: rootLoads, warnings }
}
