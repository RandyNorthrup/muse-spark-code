// One code intelligence call (M67, PLAN.md D49): the language service
// asked under a deadline, the file the model named confined like the file
// tools' (D24), each result placed in the workspace or left out and
// counted, and the symbol the model meant found from what it gave (a
// position, a name on a line or in a file, or a workspace symbol).

import * as z from 'zod/mini'
import {
  CODE_INTEL_MAX_NAME_MATCHES,
  CODE_INTEL_NAME_MAX_CHARS,
  CODE_INTEL_PREVIEW_MAX_CHARS,
  CODE_INTEL_TIMEOUT_MS,
  MILLISECONDS_PER_SECOND,
  MODEL_TEXT,
  SYMBOL_KIND_NAMES,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { isSamePath } from '../paths'
import { withDeadline } from '../timeouts'
import { confineWorkspacePath, isBelow, type RealPathIo } from '../workspacePath'
import { pathModule } from '../workspaceRoot'
import { findName, withoutBom } from './codeText'
import type { LocateArgs } from './definitions'
import type {
  CodePosition,
  CodeSymbol,
  LanguageServiceHost,
  OpenedDocument,
} from './languageService'

/** The file access the tools need: `ToolIo` satisfies it. */
export interface CodeIntelIo extends RealPathIo {
  /** A UTF-8 file's text; undefined when it does not exist; rejects for other content. */
  readFile(absolutePath: string, expectedCanonicalPath?: string): Promise<string | undefined>
  /** Workspace-relative, forward-slash paths of the workspace's files. */
  listFiles(): Promise<readonly string[]>
  /** Absolute paths of the files open in an editor with unsaved changes, as the editor names them. */
  unsavedFiles(): readonly string[]
}

/**
 * The path of the editor holding unsaved changes to the file, or undefined:
 * one naming it as the tools or the language service do, or naming another
 * path whose real path is the file's. A workspace opened through a link
 * has the editor name a file by the link and the language service by its
 * real path (D27 by the file, not by its name).
 */
export async function unsavedDocumentPath(
  io: Pick<CodeIntelIo, 'unsavedFiles' | 'realPath'>,
  file: Pick<PlacedFile, 'absolute' | 'checkedAbsolute'>,
  platform: NodeJS.Platform,
): Promise<string | undefined> {
  const open = io.unsavedFiles()
  const named = open.find(
    (path) =>
      isSamePath(path, file.absolute, platform) || isSamePath(path, file.checkedAbsolute, platform),
  )
  if (named !== undefined) {
    return named
  }
  for (const path of open) {
    try {
      if (isSamePath(await io.realPath(path), file.checkedAbsolute, platform)) {
        return path
      }
    } catch {
      // An editor's path the file system cannot resolve is not this file.
    }
  }
  return undefined
}

export interface CodeIntelDeps {
  readonly service: LanguageServiceHost
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: CodeIntelIo
  /** Epoch milliseconds, for the repo map's time budget. */
  readonly now: () => number
}

export type CodeIntelAnswer =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly reason: string; readonly visibleReason: string }

/** Why a call cannot be answered: what the model reads, and what the row shows. */
export class CodeIntelRefusal extends Error {
  public constructor(
    reason: string,
    public readonly visibleReason: string = reason,
  ) {
    super(reason)
    this.name = 'CodeIntelRefusal'
  }
}

const TIMEOUT_SECONDS = CODE_INTEL_TIMEOUT_MS / MILLISECONDS_PER_SECOND
const LINE_BREAK = /[\r\n]/
const ELLIPSIS = '…'
const CALL_PARENTHESES = '()'
const HIGH_SURROGATE = /[\uD800-\uDBFF]$/
const DOCUMENT_LINE_BREAK = /\r\n|\r|\n/

/** The language service's answer, or a refusal once it has taken too long. */
export async function ask<T>(work: Promise<T>): Promise<T> {
  try {
    return await withDeadline(
      work,
      CODE_INTEL_TIMEOUT_MS,
      fill(MODEL_TEXT.codeIntelTimedOut, { seconds: String(TIMEOUT_SECONDS) }),
    )
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'DeadlineError') {
      throw new CodeIntelRefusal(
        error.message,
        fill(UI_TEXT.codeIntelTimedOut, { seconds: TIMEOUT_SECONDS }),
      )
    }
    throw error
  }
}

/** A value's arguments, or the refusal that names what is wrong with them. */
export function parseArgs<T>(schema: z.ZodMiniType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new CodeIntelRefusal(`invalid arguments: ${z.prettifyError(parsed.error)}`)
  }
  return parsed.data
}

/** A name or query the model gave: one line, not empty, not too long. */
export function checkName(field: string, value: string): string {
  if (value === '' || value.length > CODE_INTEL_NAME_MAX_CHARS || LINE_BREAK.test(value)) {
    throw new CodeIntelRefusal(
      fill(MODEL_TEXT.codeIntelBadName, { field, max: String(CODE_INTEL_NAME_MAX_CHARS) }),
    )
  }
  return value
}

/**
 * A symbol's name as code spells it: TypeScript's workspace symbols name a
 * function or a method with its call parentheses (`greet()`), which the
 * code never spells that way. Shown as it came; matched without them.
 */
export function bareName(symbol: CodeSymbol): string {
  return symbol.name.endsWith(CALL_PARENTHESES)
    ? symbol.name.slice(0, -CALL_PARENTHESES.length)
    : symbol.name
}

/** A symbol kind in words; one VS Code adds later shows as its number (AGENTS rule 13). */
export function kindName(kind: number): string {
  return SYMBOL_KIND_NAMES[kind] ?? `kind ${String(kind)}`
}

/** `path:line:column`, 1-based, as the model and the user read positions. */
export function placeText(relative: string, at: CodePosition): string {
  return `${relative}:${String(at.line + 1)}:${String(at.character + 1)}`
}

/** At most `max` characters, cut on a code point, marked when cut. */
export function clipText(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  const kept = text.slice(0, max - 1)
  // Never half a surrogate pair.
  return `${HIGH_SURROGATE.test(kept) ? kept.slice(0, -1) : kept}${ELLIPSIS}`
}

/** A file in the workspace: how the model names it, and where it really is. */
export interface PlacedFile {
  /** Absolute, as VS Code names it (what the language services are asked with). */
  readonly absolute: string
  /** Workspace-relative, forward slashes. */
  readonly relative: string
  /** Workspace-relative after links are resolved: what the permission rules judge (D24). */
  readonly canonical: string
  /** The real path, which the disk is read and written at. */
  readonly checkedAbsolute: string
}

/** The symbol a call is about. */
export interface Target {
  readonly file: PlacedFile
  readonly at: CodePosition
  readonly document: OpenedDocument
  /** Says how a name was resolved, and the other symbols of that name. */
  readonly lead: string | undefined
}

function isWholeNumberFromOne(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1
}

/** Ordinal order of two strings: the same on every machine, whatever its locale. */
export function compareText(a: string, b: string): number {
  if (a === b) {
    return 0
  }
  return a < b ? -1 : 1
}

function comparePlaces(
  a: { readonly relative: string; readonly at: CodePosition },
  b: { readonly relative: string; readonly at: CodePosition },
): number {
  return (
    compareText(a.relative, b.relative) || a.at.line - b.at.line || a.at.character - b.at.character
  )
}

/** Sorts by path, line and column: the same answer every time (M67's acceptance). */
export function byPlace<T extends { readonly relative: string; readonly at: CodePosition }>(
  items: readonly T[],
): readonly T[] {
  return items.toSorted((a, b) => comparePlaces(a, b))
}

/** One call's view of the workspace: confinement and file reads, each done once. */
export class CodeIntelQuery {
  /** Files whose lines this call took from an editor with unsaved changes. */
  private readonly unsaved = new Set<string>()
  private readonly realPaths = new Map<string, Promise<string>>()
  private readonly placed = new Map<string, Promise<PlacedFile | undefined>>()
  private readonly texts = new Map<string, Promise<readonly string[] | undefined>>()
  private readonly io: RealPathIo = {
    realPath: (absolutePath) => {
      let known = this.realPaths.get(absolutePath)
      if (known === undefined) {
        known = this.deps.io.realPath(absolutePath)
        this.realPaths.set(absolutePath, known)
      }
      return known
    },
  }

  public constructor(public readonly deps: CodeIntelDeps) {}

  private async placeOnce(path: string): Promise<PlacedFile | undefined> {
    const { workspaceRoot, platform } = this.deps
    const textual = await confineWorkspacePath(workspaceRoot, path, platform, this.io)
    if (textual.ok) {
      return textual
    }
    let realRoot: string
    let realTarget: string
    try {
      ;[realRoot, realTarget] = await Promise.all([
        this.io.realPath(workspaceRoot),
        this.io.realPath(path),
      ])
    } catch {
      // A path the file system will not resolve is not shown as a workspace file.
      return undefined
    }
    const p = pathModule(platform)
    const relative = p.relative(realRoot, realTarget)
    if (!isBelow(relative, p)) {
      return undefined
    }
    const forward = relative.split(p.sep).join('/')
    return { absolute: path, relative: forward, canonical: forward, checkedAbsolute: realTarget }
  }

  /**
   * The file's lines as the language service read them: the editor's when
   * it holds unsaved changes (the answer then says so), else the disk's;
   * undefined when it is missing or not UTF-8 text.
   */
  private async readLines(file: PlacedFile): Promise<readonly string[] | undefined> {
    let text: string | undefined
    try {
      const edited = await this.unsavedPath(file)
      if (edited === undefined) {
        text = await this.deps.io.readFile(file.checkedAbsolute, file.checkedAbsolute)
      } else {
        // The editor's document, by the editor's own path: the same file
        // opened by its real path would be another document, read from disk.
        const document = await ask(this.service.open(edited))
        this.noteDocument(file, document)
        text = document.text
      }
    } catch {
      // A file that cannot be read as text keeps its locations, without their lines.
      return
    }
    return text === undefined ? undefined : withoutBom(text).split(DOCUMENT_LINE_BREAK)
  }

  /** Whether a path is under one of the languages' library folders (`LanguageServiceHost.libraryRoots`). */
  private async isInLibrary(path: string): Promise<boolean> {
    const roots = this.service.libraryRoots()
    const p = pathModule(this.deps.platform)
    const isUnder = (root: string, target: string) => isBelow(p.relative(root, target), p)
    if (roots.some((root) => isUnder(root, path))) {
      return true
    }
    try {
      const real = await this.io.realPath(path)
      const realRoots = await Promise.all(roots.map(async (root) => await this.io.realPath(root)))
      return realRoots.some((root) => isUnder(root, real))
    } catch {
      // A path the file system will not resolve is not taken as a library's.
      return false
    }
  }

  /** The file's lines, read once per call. */
  private async linesOf(file: PlacedFile): Promise<readonly string[] | undefined> {
    let lines = this.texts.get(file.checkedAbsolute)
    if (lines === undefined) {
      lines = this.readLines(file)
      this.texts.set(file.checkedAbsolute, lines)
    }
    return await lines
  }

  private inFile(
    file: PlacedFile,
    document: OpenedDocument,
    args: LocateArgs,
    symbol: string | undefined,
  ): Target {
    const { line, column } = args
    if (line !== undefined && !isWholeNumberFromOne(line)) {
      throw new CodeIntelRefusal(MODEL_TEXT.codeIntelBadPosition)
    }
    if (column !== undefined) {
      if (line === undefined || !isWholeNumberFromOne(column)) {
        throw new CodeIntelRefusal(MODEL_TEXT.codeIntelBadPosition)
      }
      return { file, document, at: { line: line - 1, character: column - 1 }, lead: undefined }
    }
    if (symbol === undefined) {
      throw new CodeIntelRefusal(MODEL_TEXT.codeIntelNoTarget)
    }
    const text = withoutBom(document.text)
    const at =
      line === undefined
        ? findName(text, symbol, { line: 0, character: 0 })
        : findName(text, symbol, { line: line - 1, character: 0 }, line - 1)
    const where = line === undefined ? file.relative : `${file.relative}:${String(line)}`
    if (at === undefined) {
      throw new CodeIntelRefusal(fill(MODEL_TEXT.codeIntelNotInFile, { symbol, place: where }))
    }
    return {
      file,
      document,
      at,
      lead: fill(MODEL_TEXT.codeIntelUsing, { symbol, place: placeText(file.relative, at) }),
    }
  }

  /** The workspace symbols named exactly `name`, inside the workspace, in place order. */
  private async symbolsNamed(
    name: string,
  ): Promise<
    readonly { symbol: CodeSymbol; file: PlacedFile; relative: string; at: CodePosition }[]
  > {
    const found = await ask(this.service.workspaceSymbols(name))
    const placed = await Promise.all(
      found
        .filter((symbol) => bareName(symbol) === name)
        .map(async (symbol) => {
          const file = await this.place(symbol.location.path)
          return file === undefined
            ? undefined
            : { symbol, file, relative: file.relative, at: symbol.selection.start }
        }),
    )
    return byPlace(placed.filter((entry) => entry !== undefined))
  }

  private async byWorkspaceSymbol(symbol: string): Promise<Target> {
    const [first, ...others] = await this.symbolsNamed(symbol)
    if (first === undefined) {
      throw new CodeIntelRefusal(fill(MODEL_TEXT.codeIntelNoSymbolNamed, { symbol }))
    }
    const { file, document } = await this.openAsEdited(first.file)
    this.noteDocument(file, document)
    const { selection } = first.symbol
    // The provider's range may start before the name (`export class Foo`).
    const at =
      findName(withoutBom(document.text), symbol, selection.start, selection.end.line) ??
      selection.start
    const listed = others
      .slice(0, CODE_INTEL_MAX_NAME_MATCHES)
      .map((other) => placeText(other.relative, other.at))
    const hidden = others.length - listed.length
    const places = hidden > 0 ? [...listed, `+${String(hidden)}`] : listed
    return {
      file,
      document,
      at,
      lead: joinLines([
        fill(MODEL_TEXT.codeIntelUsing, { symbol, place: placeText(first.relative, at) }),
        places.length === 0
          ? undefined
          : fill(MODEL_TEXT.codeIntelOtherMatches, { symbol, places: places.join(', ') }),
      ]),
    }
  }

  public get service(): LanguageServiceHost {
    return this.deps.service
  }

  /** A path the model gave, confined like the file tools' (D24), or the refusal. */
  public async confine(given: string): Promise<PlacedFile> {
    const { workspaceRoot, platform } = this.deps
    const resolved = await confineWorkspacePath(workspaceRoot, given, platform, this.io)
    if (!resolved.ok) {
      throw new CodeIntelRefusal(resolved.reason)
    }
    return resolved
  }

  /**
   * Where a result is in the workspace, or undefined when it is outside (a
   * library's declarations, another folder, a virtual document). A file is
   * inside when its path is, or when its real path is inside the real root
   * (a workspace opened through a link, whose files the server reports by
   * their real paths).
   */
  public place(path: string | undefined): Promise<PlacedFile | undefined> {
    if (path === undefined) {
      return Promise.resolve(undefined)
    }
    let known = this.placed.get(path)
    if (known === undefined) {
      known = this.placeOnce(path)
      this.placed.set(path, known)
    }
    return known
  }

  /** A line of a file on disk (0-based), trimmed and clipped; undefined when it cannot be read. */
  public async preview(file: PlacedFile, line: number): Promise<string | undefined> {
    const lines = await this.linesOf(file)
    const text = lines?.[line]?.trim()
    return text === undefined || text === ''
      ? undefined
      : clipText(text, CODE_INTEL_PREVIEW_MAX_CHARS)
  }

  /**
   * Where a symbol's name starts, found in its range on disk: a provider's
   * range may start before the name (TypeScript's workspace symbols start at
   * `export`). The range's own start when the name is not found there.
   */
  public async nameStart(file: PlacedFile, symbol: CodeSymbol): Promise<CodePosition> {
    const { start, end } = symbol.selection
    const lines = (await this.linesOf(file)) ?? []
    for (let line = start.line; line <= end.line; line += 1) {
      const from = { line: 0, character: line === start.line ? start.character : 0 }
      const found = findName(lines[line] ?? '', bareName(symbol), from)
      if (found !== undefined) {
        return { line, character: found.character }
      }
    }
    return start
  }

  /** The path of an editor with unsaved changes to the file (`unsavedDocumentPath`), or undefined. */
  public async unsavedPath(
    file: Pick<PlacedFile, 'absolute' | 'checkedAbsolute'>,
  ): Promise<string | undefined> {
    return await unsavedDocumentPath(
      {
        unsavedFiles: () => this.deps.io.unsavedFiles(),
        realPath: async (path) => await this.io.realPath(path),
      },
      file,
      this.deps.platform,
    )
  }

  /**
   * The file's document as the language service reads it: an editor's with
   * unsaved changes, by the editor's path, when one holds the file (the file
   * is then asked about at that path), else the file's own.
   */
  public async openAsEdited(
    file: PlacedFile,
  ): Promise<{ readonly file: PlacedFile; readonly document: OpenedDocument }> {
    const edited = await this.unsavedPath(file)
    const asked = edited === undefined ? file : { ...file, absolute: edited }
    return { file: asked, document: await ask(this.service.open(asked.absolute)) }
  }

  /** Remembers a document the answer read with unsaved changes, for `unsavedNotes`. */
  public noteDocument(file: PlacedFile, document: OpenedDocument): void {
    if (document.isDirty) {
      this.unsaved.add(file.relative)
    }
  }

  /** What the answer adds when its lines came from editors with unsaved changes. */
  public unsavedNotes(): readonly string[] {
    return this.unsaved.size === 0
      ? []
      : [
          fill(MODEL_TEXT.codeIntelUnsavedNote, {
            paths: [...this.unsaved].toSorted((a, b) => compareText(a, b)).join(', '),
          }),
        ]
  }

  /**
   * Whether an answer may show what a result says about its file: a file in
   * the workspace, or one under a language's library folder.
   */
  public async isDescribable(path: string | undefined): Promise<boolean> {
    return (
      path !== undefined &&
      ((await this.place(path)) !== undefined || (await this.isInLibrary(path)))
    )
  }

  /** The refusal for a file no language service answers for (M67: never an empty answer). */
  public noService(file: PlacedFile, document: OpenedDocument): CodeIntelRefusal {
    return new CodeIntelRefusal(
      fill(MODEL_TEXT.codeIntelNoService, { path: file.relative, language: document.languageId }),
      fill(UI_TEXT.codeIntelNoService, { path: file.relative }),
    )
  }

  /**
   * What an empty answer means: nothing of the kind at the position when
   * the file's language service answers for it (it lists the file's
   * symbols), else no language service at all.
   */
  public async nothingAt(what: string, target: Target): Promise<string> {
    const symbols = await ask(this.service.documentSymbols(target.file.absolute))
    if (symbols.length === 0) {
      throw this.noService(target.file, target.document)
    }
    return joinLines([
      target.lead,
      fill(MODEL_TEXT.codeIntelNothingAt, {
        what,
        place: placeText(target.file.relative, target.at),
      }),
    ])
  }

  /** The symbol the arguments name (see `definitions.ts`), or the refusal. */
  public async target(args: LocateArgs): Promise<Target> {
    const symbol = args.symbol === undefined ? undefined : checkName('symbol', args.symbol)
    if (args.path !== undefined) {
      const { file, document } = await this.openAsEdited(await this.confine(args.path))
      // The model's lines come from read_file, which reads the disk; the
      // service reads the editor's text, and the two differ here.
      if (document.isDirty && args.line !== undefined) {
        throw new CodeIntelRefusal(
          fill(MODEL_TEXT.codeIntelUnsavedPosition, { path: file.relative }),
        )
      }
      this.noteDocument(file, document)
      return this.inFile(file, document, args, symbol)
    }
    if (symbol !== undefined) {
      return await this.byWorkspaceSymbol(symbol)
    }
    throw new CodeIntelRefusal(MODEL_TEXT.codeIntelNoTarget)
  }
}

/** The lines that are present, one per line. */
export function joinLines(lines: readonly (string | undefined)[]): string {
  return lines.filter((line) => line !== undefined && line !== '').join('\n')
}
