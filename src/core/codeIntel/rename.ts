// `rename_symbol`'s plan (M67, PLAN.md D49): VS Code's rename provider asked
// for the edit, which is checked before anything asks or writes. Every file
// it touches must be in the workspace (confined as the file tools confine a
// path, D24), have no unsaved changes, and read on disk exactly as VS Code
// holds it; and every range of the edit must cover exactly the old name in
// that text, so an edit the service computed on an older version of a file
// is refused, never applied to the newer one. An edit that also creates,
// moves or deletes files (or one VS Code does not say that of) is refused.
// The Model API then writes the files through its edit path
// (src/core/backends/modelapi/codeIntelCalls.ts); the `ide` tool returns the
// diff for Muse Code's own edit tool and writes nothing.

import { CODE_INTEL_NAME_MAX_CHARS, MODEL_TEXT, RENAME_MAX_FILES } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { PatchHunk } from '../../shared/patchDocument'
import { applyTextEdits, BOM, patchHunks, textIn, unifiedDiff, withoutBom } from './codeText'
import {
  ask,
  checkName,
  compareText,
  type CodeIntelDeps,
  CodeIntelQuery,
  CodeIntelRefusal,
  joinLines,
  parseArgs,
  type PlacedFile,
  placeText,
  type Target,
} from './codeIntelQuery'
import { renameArgs } from './definitions'
import type { FileEdits, RenameEdits, TextEdit } from './languageService'

export interface RenameFile extends PlacedFile {
  /** The file on disk as the plan read it, BOM included. */
  readonly before: string
  /** What the rename writes, BOM kept. */
  readonly after: string
  readonly edits: number
  readonly hunks: readonly PatchHunk[]
}

export interface RenamePlan {
  readonly from: string
  readonly to: string
  /** Sorted by path. */
  readonly files: readonly RenameFile[]
  readonly edits: number
}

export type RenamePlanResult =
  | { readonly ok: true; readonly plan: RenamePlan }
  | { readonly ok: false; readonly reason: string; readonly visibleReason: string }

function staleRefusal(file: PlacedFile): CodeIntelRefusal {
  return new CodeIntelRefusal(fill(MODEL_TEXT.renameStale, { path: file.relative }))
}

/**
 * The file's text with the edits applied, or why the plan cannot use it.
 * `expected` is the text the rename's position was read from, for the file
 * that holds it: the document must still be that text.
 */
async function plannedFile(
  query: CodeIntelQuery,
  planned: { readonly file: PlacedFile; readonly edits: readonly TextEdit[] },
  from: string,
  expected: string | undefined,
): Promise<RenameFile> {
  const { file, edits } = planned
  // By the real path: an editor may hold the file under a link's path.
  if ((await query.unsavedPath(file)) !== undefined) {
    throw new CodeIntelRefusal(`${file.relative} ${MODEL_TEXT.fileHasUnsavedChanges}`)
  }
  const before = await query.deps.io.readFile(file.checkedAbsolute, file.checkedAbsolute)
  const document = await ask(query.service.open(file.absolute))
  const { text } = document
  if (
    before === undefined ||
    document.isDirty ||
    text !== withoutBom(before) ||
    (expected !== undefined && text !== expected) ||
    // An edit made on another version of the file lands on other text.
    edits.some((edit) => textIn(text, edit.range.start, edit.range.end) !== from)
  ) {
    throw staleRefusal(file)
  }
  const changed = applyTextEdits(text, edits)
  if (changed === undefined) {
    throw staleRefusal(file)
  }
  return {
    ...file,
    before,
    after: before.startsWith(BOM) ? `${BOM}${changed}` : changed,
    edits: edits.length,
    hunks: patchHunks(text, changed),
  }
}

/** The edit's files placed in the workspace; any outside refuses the whole rename. */
async function placedFiles(
  query: CodeIntelQuery,
  files: readonly FileEdits[],
): Promise<readonly { file: PlacedFile; edits: readonly TextEdit[] }[]> {
  const placed = await Promise.all(
    files
      .filter((entry) => entry.edits.length > 0)
      .map(async (entry) => ({ file: await query.place(entry.path), edits: entry.edits })),
  )
  const outside = placed.filter((entry) => entry.file === undefined).length
  if (outside > 0) {
    throw new CodeIntelRefusal(fill(MODEL_TEXT.renameOutside, { count: String(outside) }))
  }
  // One entry per file, however the edit groups its changes.
  const byFile = new Map<string, { file: PlacedFile; edits: TextEdit[] }>()
  const merged: { file: PlacedFile; edits: TextEdit[] }[] = []
  for (const { file, edits } of placed) {
    if (file === undefined) {
      continue
    }
    let entry = byFile.get(file.checkedAbsolute)
    if (entry === undefined) {
      entry = { file, edits: [] }
      byFile.set(file.checkedAbsolute, entry)
      merged.push(entry)
    }
    entry.edits.push(...edits)
  }
  if (merged.length > RENAME_MAX_FILES) {
    throw new CodeIntelRefusal(
      fill(MODEL_TEXT.renameTooMany, {
        count: String(merged.length),
        max: String(RENAME_MAX_FILES),
      }),
    )
  }
  return merged
}

/** Refuses an edit that also changes files, or one VS Code does not say that of. */
function checkFileOperations(edit: RenameEdits): void {
  if (edit.fileOperations === 'present') {
    throw new CodeIntelRefusal(MODEL_TEXT.renameFileOperations)
  }
  if (edit.fileOperations === 'unknown') {
    throw new CodeIntelRefusal(MODEL_TEXT.renameFileOperationsUnknown)
  }
}

/**
 * The old name: what the edit at the position replaces, in the text the
 * position was read from. Every other range of the edit must cover it too.
 */
function oldName(
  target: Target,
  placed: readonly { file: PlacedFile; edits: readonly TextEdit[] }[],
): string {
  const own = placed
    .find((entry) => entry.file.checkedAbsolute === target.file.checkedAbsolute)
    ?.edits.find(
      (candidate) =>
        candidate.range.start.line === target.at.line &&
        candidate.range.start.character <= target.at.character &&
        candidate.range.end.character >= target.at.character,
    )
  const from =
    own === undefined ? undefined : textIn(target.document.text, own.range.start, own.range.end)
  if (from === undefined || from === '') {
    throw staleRefusal(target.file)
  }
  return from
}

async function plan(query: CodeIntelQuery, raw: unknown): Promise<RenamePlan> {
  const args = parseArgs(renameArgs, raw)
  const to = checkName('new_name', args.new_name)
  const target = await query.target(args)
  const place = placeText(target.file.relative, target.at)
  const edit = await ask(query.service.rename(target.file.absolute, target.at, to))
  checkFileOperations(edit)
  if (edit.files.every((entry) => entry.edits.length === 0)) {
    const symbols = await ask(query.service.documentSymbols(target.file.absolute))
    throw symbols.length === 0
      ? query.noService(target.file, target.document)
      : new CodeIntelRefusal(fill(MODEL_TEXT.renameNothing, { place }))
  }
  const placed = await placedFiles(query, edit.files)
  const from = oldName(target, placed)
  if (from === to) {
    throw new CodeIntelRefusal(fill(MODEL_TEXT.renameSameName, { name: to }))
  }
  const files: RenameFile[] = []
  for (const entry of placed) {
    const isTargetFile = entry.file.checkedAbsolute === target.file.checkedAbsolute
    files.push(
      await plannedFile(query, entry, from, isTargetFile ? target.document.text : undefined),
    )
  }
  const changed = files
    .filter((file) => file.after !== file.before)
    .toSorted((a, b) => compareText(a.relative, b.relative))
  if (changed.length === 0) {
    throw new CodeIntelRefusal(fill(MODEL_TEXT.renameNothing, { place }))
  }
  return {
    from: from.slice(0, CODE_INTEL_NAME_MAX_CHARS),
    to,
    files: changed,
    edits: changed.reduce((total, file) => total + file.edits, 0),
  }
}

/** The rename's edit, checked file by file; nothing is written here. */
export async function planRename(raw: unknown, deps: CodeIntelDeps): Promise<RenamePlanResult> {
  try {
    return { ok: true, plan: await plan(new CodeIntelQuery(deps), raw) }
  } catch (error: unknown) {
    if (error instanceof CodeIntelRefusal) {
      return { ok: false, reason: error.message, visibleReason: error.visibleReason }
    }
    throw error
  }
}

/** The plan as the `ide` tool hands it to Muse Code: a lead and a unified diff per file. */
export function renameDiff(plan: RenamePlan): string {
  return joinLines([
    fill(MODEL_TEXT.renameEditsLead, {
      from: plan.from,
      to: plan.to,
      edits: String(plan.edits),
      files: String(plan.files.length),
    }),
    ...plan.files.map((file) => unifiedDiff(file.relative, file.hunks)),
  ])
}
