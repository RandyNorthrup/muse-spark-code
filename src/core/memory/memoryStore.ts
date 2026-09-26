// Muse Code's memory, read and written by the extension (M49, PLAN.md D41):
// the Model API backend's `read_memory`, `add_memory` and `edit_memory`,
// which take Muse Code's arguments and answer with its results so both
// backends' rows read alike and both share one memory, and the Memory view.
//
// What a note may be follows Muse Code 1.3.0 (its binary's messages, and a
// live capture on 2026-09-25): a relative `.md` path under the scope's root,
// no `..`, no hidden component, no link anywhere below the root. `add`
// creates a note (with `type` and `description` as front matter) or appends
// to one after a blank line; `edit` replaces one exact string. Muse Code's
// tools leave `MEMORY.md` to the model; the extension adds a new note's line
// to its scope's index itself and removes a deleted note's lines (D41).
// Existing-note writes replace the file whole (a temporary file renamed over
// it). New notes publish complete bytes with a no-clobber hard link. Muse
// Code's own lock (`.muse-memory.lock`, an operating-system lock) is not
// taken: two writers updating one existing note may lose one write.

import path from 'node:path'
import {
  MEMORY_DIR,
  MEMORY_DIR_SEGMENTS,
  MEMORY_INDEX_FILE,
  MEMORY_LIST_MAX_DEPTH,
  MEMORY_LIST_MAX_NOTES,
  MEMORY_NOTE_EXTENSION,
  MEMORY_READ_DEFAULT_LIMIT,
  MEMORY_SCOPES,
  MEMORY_SNAPSHOT_MAX_NOTES,
  type MemoryScope,
  MODEL_TEXT,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../shared/constants'
import { resolveWorkspacePath } from '../backends/modelapi/tools'
import {
  indexLineFor,
  hasIndexLine,
  isIndexPath,
  limitMemoryIndex,
  noteSummary,
  withIndexLine,
  withoutIndexLines,
} from './memoryIndex'
import { personalMemoryRoot, projectMemoryFolder, projectsMemoryRoot } from './memoryLocation'

export interface MemoryDirectoryEntry {
  readonly name: string
  /** A link or junction is `other`: it is never followed. */
  readonly kind: 'file' | 'directory' | 'other'
}

/** What the store reads and writes through; the host lends the file system. */
export interface MemoryIo {
  /** The file's text, a BOM kept; undefined when absent; rejects when it is not UTF-8 text. */
  readFile(absolutePath: string): Promise<string | undefined>
  /** Replaces the file whole (a temporary file renamed into place), folders created. */
  writeFile(absolutePath: string, content: string): Promise<void>
  /** Atomically publishes a complete new note only if absent; never replaces another writer. */
  createFile(absolutePath: string, content: string): Promise<void>
  /** The canonical form (links resolved) of a path that may not exist yet. */
  realPath(absolutePath: string): Promise<string>
  /** A directory's entries; empty when it is missing. */
  listEntries(absolutePath: string): Promise<readonly MemoryDirectoryEntry[]>
}

export interface MemoryStoreDeps {
  readonly io: MemoryIo
  readonly platform: NodeJS.Platform
  /** Muse Code's memory data root (`…/muse/memory`); undefined without a home. */
  readonly dataRoot: () => string | undefined
  /** Undefined without a workspace folder. */
  readonly workspaceRoot: string | undefined
  /**
   * A path as the operating system spells it, links resolved and each name
   * in its own letter case: the workspace root Muse Code hashes.
   */
  readonly systemPath: (absolutePath: string) => Promise<string>
  /** Something that went wrong beside the call itself (an index line, an unreadable scope). */
  readonly warn: (message: string) => void
}

/** A note, validated and placed. */
export interface MemoryNotePlace {
  readonly scope: MemoryScope
  /** As the tools name it: relative to the scope's root, forward slashes. */
  readonly path: string
  readonly absolute: string
  /** What an approval card shows: `.agents/memory/…` for the project, else the absolute path. */
  readonly display: string
}

export type Located<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string }

/** A tool call's outcome: Muse Code's JSON result, or why it failed. */
export type MemoryOutcome = Located<string>

export interface MemoryNote extends MemoryNotePlace {
  /** Its front matter's description, else its first line of text. */
  readonly summary: string
}

/** One scope as the session-start snapshot gives it to the model. */
export interface MemoryScopeSnapshot {
  readonly scope: MemoryScope
  /** The scope's `MEMORY.md` within the limits; undefined when it has none. */
  readonly index: string | undefined
  /** The other notes' paths, at most MEMORY_SNAPSHOT_MAX_NOTES. */
  readonly notes: readonly string[]
  readonly hasMoreNotes: boolean
}

/** `read_memory`'s window: 1-based first line, and how many lines. */
export interface ReadWindow {
  readonly offset?: number | undefined
  readonly limit?: number | undefined
}

/** `add_memory`'s note: its text and, for a new note, its front matter. */
export interface NoteAddition {
  readonly content: string
  readonly type?: string | undefined
  readonly description?: string | undefined
}

/** `edit_memory`'s exact replacement. */
export interface NoteEdit {
  readonly old_str: string
  readonly new_str: string
}

const HIDDEN_PREFIX = '.'
const PARENT_SEGMENT = '..'
const SEPARATORS = /[/\\]/
const WINDOWS_DRIVE = /^[A-Za-z]:/
const TRAILING_BREAKS = /(?:\r?\n)+$/
// One line with its own line break (the last may have none).
const LINES_WITH_BREAKS = /[^\n]*\n|[^\n]+$/g
const PARAGRAPH_BREAK = '\n\n'
const FRONT_MATTER_FENCE = '---'
const OPERATION_ADD = 'add'
const OPERATION_EDIT = 'edit'

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTaken(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

function failed(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason }
}

function isUnavailable(reason: string): boolean {
  return reason === MODEL_TEXT.memoryNoWorkspace || reason === MODEL_TEXT.memoryNoHome
}

function pathModule(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/** Why Muse Code would refuse this note path, or undefined (its own checks, in its order). */
export function memoryPathProblem(given: string): string | undefined {
  if (given.trim() === '') {
    return MODEL_TEXT.memoryPathEmpty
  }
  if (path.posix.isAbsolute(given) || path.win32.isAbsolute(given) || WINDOWS_DRIVE.test(given)) {
    return MODEL_TEXT.memoryPathAbsolute
  }
  const segments = given.split(SEPARATORS)
  if (segments.includes(PARENT_SEGMENT)) {
    return MODEL_TEXT.memoryPathTraversal
  }
  const name = segments.at(-1) ?? ''
  if (name === '') {
    return MODEL_TEXT.memoryPathNoFileName
  }
  if (segments.some((segment) => segment.startsWith(HIDDEN_PREFIX))) {
    return MODEL_TEXT.memoryPathHidden
  }
  return name.endsWith(MEMORY_NOTE_EXTENSION) ? undefined : MODEL_TEXT.memoryPathNotMarkdown
}

/** Muse Code's `{:?}` of a string, near enough: quoted, with its escapes. */
function quoted(text: string): string {
  return JSON.stringify(text)
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}

/** A new note's text: `type` and `description` as front matter, as Muse Code writes them. */
function newNoteText(note: NoteAddition): string {
  const fields = [
    ...(note.type === undefined ? [] : [`type: ${note.type}`]),
    ...(note.description === undefined ? [] : [`description: ${note.description}`]),
  ]
  return fields.length === 0
    ? note.content
    : [FRONT_MATTER_FENCE, ...fields, FRONT_MATTER_FENCE, '', note.content].join('\n')
}

/** A note's text after `content` is appended: after a blank line, its front matter as it was. */
function appendedText(existing: string, content: string): string {
  const kept = existing.replace(TRAILING_BREAKS, '')
  return kept === '' ? content : `${kept}${PARAGRAPH_BREAK}${content}`
}

function isSamePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  // Windows and macOS file systems fold case.
  return platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

/** Muse Code's answer to a write (captured live 2026-09-25). */
function written(place: MemoryNotePlace, operation: string, message: string): string {
  return JSON.stringify({ success: true, scope: place.scope, path: place.path, operation, message })
}

function placeOf(scope: MemoryScope, notePath: string, absolute: string): MemoryNotePlace {
  return {
    scope,
    path: notePath,
    absolute,
    display: scope === 'project' ? `${MEMORY_DIR}/${notePath}` : absolute,
  }
}

/** The index first, then the notes by name. */
function byIndexThenName(a: string, b: string): number {
  if (isIndexPath(a) !== isIndexPath(b)) {
    return isIndexPath(a) ? -1 : 1
  }
  return a.localeCompare(b)
}

export class MemoryStore {
  public constructor(private readonly deps: MemoryStoreDeps) {}

  private get p(): path.PlatformPath {
    return pathModule(this.deps.platform)
  }

  private async personalProjectRoot(dataRoot: string): Promise<Located<string>> {
    const { workspaceRoot } = this.deps
    if (workspaceRoot === undefined) {
      return failed(MODEL_TEXT.memoryNoWorkspace)
    }
    const projects = projectsMemoryRoot(dataRoot, this.deps.platform)
    const checkedProjects = await this.checkedRoot(projects, dataRoot)
    if (!checkedProjects.ok) {
      return checkedProjects
    }
    let canonical: string
    let entries: readonly MemoryDirectoryEntry[]
    try {
      ;[canonical, entries] = await Promise.all([
        this.deps.systemPath(workspaceRoot),
        this.deps.io.listEntries(projects),
      ])
    } catch (error: unknown) {
      return failed(describe(error))
    }
    const folders = entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.name)
    return {
      ok: true,
      value: this.p.join(projects, projectMemoryFolder(folders, canonical, this.deps.platform)),
    }
  }

  /** The note's text (undefined when there is none), or why it cannot be read. */
  private async readNote(place: MemoryNotePlace): Promise<Located<string | undefined>> {
    try {
      return { ok: true, value: await this.deps.io.readFile(place.absolute) }
    } catch (error: unknown) {
      return failed(describe(error))
    }
  }

  /** The scope's index place; throws with the reason when the scope has none. */
  private async indexPlace(scope: MemoryScope): Promise<MemoryNotePlace> {
    const place = await this.locate(scope, MEMORY_INDEX_FILE)
    if (!place.ok) {
      throw new Error(place.reason)
    }
    return place.value
  }

  /** A new note's line in its scope's `MEMORY.md`, unless one already links to it (D41). */
  private async addIndexLine(place: MemoryNotePlace, hook: string): Promise<void> {
    if (isIndexPath(place.path)) {
      return
    }
    try {
      const index = await this.indexPlace(place.scope)
      const text = await this.deps.io.readFile(index.absolute)
      if (text !== undefined && hasIndexLine(text, place.path)) {
        return
      }
      await this.deps.io.writeFile(
        index.absolute,
        withIndexLine(text, indexLineFor(place.path, hook)),
      )
    } catch (error: unknown) {
      this.deps.warn(
        `${place.display} was written, but its ${MEMORY_INDEX_FILE} line was not: ${describe(error)}`,
      )
    }
  }

  private async walk(root: string, relative: readonly string[], found: string[]): Promise<void> {
    if (relative.length > MEMORY_LIST_MAX_DEPTH || found.length >= MEMORY_LIST_MAX_NOTES) {
      return
    }
    const entries = await this.deps.io.listEntries(this.p.join(root, ...relative))
    const visible = entries
      .filter((entry) => !entry.name.startsWith(HIDDEN_PREFIX))
      .toSorted((a, b) => a.name.localeCompare(b.name))
    for (const entry of visible) {
      if (found.length >= MEMORY_LIST_MAX_NOTES) {
        return
      }
      const segments = [...relative, entry.name]
      if (entry.kind === 'directory') {
        await this.walk(root, segments, found)
      } else if (entry.kind === 'file' && entry.name.endsWith(MEMORY_NOTE_EXTENSION)) {
        found.push(segments.join('/'))
      }
    }
  }

  /**
   * The notes of a scope as places, the index first; none when the scope is
   * unavailable. The walk never enters a link, so no place is behind one.
   */
  private async notePlaces(scope: MemoryScope): Promise<readonly MemoryNotePlace[]> {
    const root = await this.root(scope)
    if (!root.ok) {
      if (isUnavailable(root.reason)) {
        return []
      }
      throw new Error(root.reason)
    }
    const found: string[] = []
    await this.walk(root.value, [], found)
    return found
      .toSorted(byIndexThenName)
      .map((notePath) => placeOf(scope, notePath, this.p.join(root.value, ...notePath.split('/'))))
  }

  private async indexText(scope: MemoryScope): Promise<string | undefined> {
    const index = await this.indexPlace(scope)
    const text = await this.deps.io.readFile(index.absolute)
    if (text === undefined) {
      return undefined
    }
    const limited = limitMemoryIndex(text, `${scope} ${MEMORY_INDEX_FILE}`)
    if (limited.warning !== undefined) {
      this.deps.warn(limited.warning)
    }
    return limited.text
  }

  /** A scope must stay below its trusted anchor, even when its root is a link. */
  private async checkedRoot(root: string, anchor: string): Promise<Located<string>> {
    try {
      const [realAnchor, realRoot] = await Promise.all([
        this.deps.io.realPath(anchor),
        this.deps.io.realPath(root),
      ])
      return isSamePath(
        realRoot,
        this.p.join(realAnchor, this.p.relative(anchor, root)),
        this.deps.platform,
      )
        ? { ok: true, value: root }
        : failed(MODEL_TEXT.memoryPathLink)
    } catch (error: unknown) {
      return failed(describe(error))
    }
  }

  /** The scopes this window has: `personal` with a home, the other two with a folder. */
  public async availableScopes(): Promise<readonly MemoryScope[]> {
    const roots = await Promise.all(MEMORY_SCOPES.map((scope) => this.root(scope)))
    for (const [index, scope] of MEMORY_SCOPES.entries()) {
      const result = roots[index]
      if (result !== undefined && !result.ok && !isUnavailable(result.reason)) {
        this.deps.warn(`the ${scope} memory could not be read: ${result.reason}`)
      }
    }
    return MEMORY_SCOPES.filter((_scope, index) => roots[index]?.ok === true)
  }

  /** A scope's root folder (it may not exist yet), or why the scope is unavailable. */
  public async root(scope: MemoryScope): Promise<Located<string>> {
    if (scope === 'project') {
      const workspaceRoot = this.deps.workspaceRoot
      return workspaceRoot === undefined
        ? failed(MODEL_TEXT.memoryNoWorkspace)
        : await this.checkedRoot(this.p.join(workspaceRoot, ...MEMORY_DIR_SEGMENTS), workspaceRoot)
    }
    const dataRoot = this.deps.dataRoot()
    if (dataRoot === undefined) {
      return failed(MODEL_TEXT.memoryNoHome)
    }
    const root: Located<string> =
      scope === 'personal'
        ? { ok: true, value: personalMemoryRoot(dataRoot, this.deps.platform) }
        : await this.personalProjectRoot(dataRoot)
    return root.ok ? await this.checkedRoot(root.value, dataRoot) : root
  }

  /**
   * A note path checked as Muse Code checks it and placed under its scope,
   * or the refusal: a path that climbs out, a hidden part, not Markdown, or a
   * link anywhere between the scope's root and the note.
   */
  public async locate(scope: MemoryScope, given: string): Promise<Located<MemoryNotePlace>> {
    const problem = memoryPathProblem(given)
    if (problem !== undefined) {
      return failed(problem)
    }
    const root = await this.root(scope)
    if (!root.ok) {
      return root
    }
    const relative = given.split(SEPARATORS).join('/')
    // The Windows checks (device names, streams, trailing dots) of the file tools.
    const resolved = resolveWorkspacePath(root.value, relative, this.deps.platform)
    if (!resolved.ok) {
      return resolved
    }
    try {
      const [realRoot, realTarget] = await Promise.all([
        this.deps.io.realPath(root.value),
        this.deps.io.realPath(resolved.absolute),
      ])
      if (
        !isSamePath(realTarget, this.p.join(realRoot, ...relative.split('/')), this.deps.platform)
      ) {
        return failed(MODEL_TEXT.memoryPathLink)
      }
    } catch (error: unknown) {
      return failed(describe(error))
    }
    return { ok: true, value: placeOf(scope, relative, resolved.absolute) }
  }

  /** `read_memory`: a window of lines, each with its own line break. */
  public async read(place: MemoryNotePlace, window: ReadWindow): Promise<MemoryOutcome> {
    const offset = window.offset ?? 1
    if (offset < 1) {
      return failed(MODEL_TEXT.memoryOffsetTooSmall)
    }
    const limit = window.limit ?? MEMORY_READ_DEFAULT_LIMIT
    if (limit < 1) {
      return failed(MODEL_TEXT.memoryLimitTooSmall)
    }
    const read = await this.readNote(place)
    if (!read.ok) {
      return read
    }
    if (read.value === undefined) {
      return failed(MODEL_TEXT.memoryFileNotFound)
    }
    const lines = read.value.match(LINES_WITH_BREAKS) ?? []
    const shown = lines.slice(offset - 1, offset - 1 + limit).join('')
    const isClipped = shown.length > TOOL_OUTPUT_MAX_CHARS
    return {
      ok: true,
      value: JSON.stringify({
        success: true,
        scope: place.scope,
        path: place.path,
        start_line_number: offset,
        content: isClipped ? shown.slice(0, TOOL_OUTPUT_MAX_CHARS) : shown,
        truncated: isClipped || offset - 1 + limit < lines.length,
      }),
    }
  }

  /** `add_memory`: a new note, or the content appended after a blank line. */
  public async add(place: MemoryNotePlace, note: NoteAddition): Promise<MemoryOutcome> {
    const read = await this.readNote(place)
    if (!read.ok) {
      return read
    }
    const existing = read.value
    try {
      if (existing === undefined) {
        await this.deps.io.createFile(place.absolute, newNoteText(note))
      } else {
        await this.deps.io.writeFile(place.absolute, appendedText(existing, note.content))
      }
    } catch (error: unknown) {
      return failed(isTaken(error) ? MODEL_TEXT.memoryNoteExists : describe(error))
    }
    if (existing === undefined) {
      await this.addIndexLine(place, note.description ?? noteSummary(note.content))
    }
    return { ok: true, value: written(place, OPERATION_ADD, MODEL_TEXT.memoryNoteWritten) }
  }

  /** `edit_memory`: one exact string replaced, refused unless it occurs exactly once. */
  public async edit(place: MemoryNotePlace, change: NoteEdit): Promise<MemoryOutcome> {
    if (change.old_str === '') {
      return failed(MODEL_TEXT.memoryOldStrEmpty)
    }
    const read = await this.readNote(place)
    if (!read.ok) {
      return read
    }
    const text = read.value
    if (text === undefined) {
      return failed(MODEL_TEXT.memoryFileNotFound)
    }
    const count = occurrences(text, change.old_str)
    if (count === 0) {
      return failed(`${MODEL_TEXT.memoryOldStrNotFound} ${quoted(change.old_str)}`)
    }
    if (count > 1) {
      return failed(`${MODEL_TEXT.memoryOldStrAmbiguous} ${quoted(change.old_str)}`)
    }
    try {
      await this.deps.io.writeFile(
        place.absolute,
        text.replace(change.old_str, () => change.new_str),
      )
    } catch (error: unknown) {
      return failed(describe(error))
    }
    return { ok: true, value: written(place, OPERATION_EDIT, MODEL_TEXT.memoryNoteEdited) }
  }

  /** A scope's notes with what each is about, the index first (the Memory view). */
  public async notes(scope: MemoryScope): Promise<readonly MemoryNote[]> {
    const places = await this.notePlaces(scope)
    return await Promise.all(
      places.map(async (place) => {
        const read = await this.readNote(place)
        const summary = read.ok && read.value !== undefined ? noteSummary(read.value) : ''
        return { ...place, summary }
      }),
    )
  }

  /** Whether anything is already at the note's place. */
  public async hasNote(place: MemoryNotePlace): Promise<boolean> {
    const read = await this.readNote(place)
    return !read.ok || read.value !== undefined
  }

  /**
   * A new, empty note from the Memory view (its description as front
   * matter when given), with its line in the scope's index. Throws with the
   * reason when the path is refused or taken.
   */
  public async create(
    scope: MemoryScope,
    notePath: string,
    description: string,
  ): Promise<MemoryNotePlace> {
    const place = await this.locate(scope, notePath)
    if (!place.ok) {
      throw new Error(place.reason)
    }
    if (await this.hasNote(place.value)) {
      throw new Error(MODEL_TEXT.memoryNoteExists)
    }
    const hook = description.trim()
    try {
      await this.deps.io.createFile(
        place.value.absolute,
        hook === '' ? '' : newNoteText({ content: '', description: hook }),
      )
    } catch (error: unknown) {
      throw new Error(isTaken(error) ? MODEL_TEXT.memoryNoteExists : describe(error), {
        cause: error,
      })
    }
    await this.addIndexLine(place.value, hook)
    return place.value
  }

  /** After the view deleted a note: its lines leave the scope's index. */
  public async forget(place: MemoryNotePlace): Promise<void> {
    if (isIndexPath(place.path)) {
      return
    }
    const index = await this.indexPlace(place.scope)
    const text = await this.deps.io.readFile(index.absolute)
    const updated = text === undefined ? undefined : withoutIndexLines(text, place.path)
    if (updated !== undefined) {
      await this.deps.io.writeFile(index.absolute, updated)
    }
  }

  /**
   * What the model is given at the start of a session, as Muse Code gives
   * it: each scope's `MEMORY.md` and the paths of its other notes. A scope
   * that cannot be read is a warning, never a failed turn.
   */
  public async snapshot(): Promise<readonly MemoryScopeSnapshot[]> {
    const snapshots: MemoryScopeSnapshot[] = []
    for (const scope of MEMORY_SCOPES) {
      try {
        const places = await this.notePlaces(scope)
        const others = places.filter((place) => !isIndexPath(place.path)).map((place) => place.path)
        const index = others.length === places.length ? undefined : await this.indexText(scope)
        if (index !== undefined || others.length > 0) {
          snapshots.push({
            scope,
            index,
            notes: others.slice(0, MEMORY_SNAPSHOT_MAX_NOTES),
            hasMoreNotes: others.length > MEMORY_SNAPSHOT_MAX_NOTES,
          })
        }
      } catch (error: unknown) {
        this.deps.warn(`the ${scope} memory could not be read: ${describe(error)}`)
      }
    }
    return snapshots
  }
}
