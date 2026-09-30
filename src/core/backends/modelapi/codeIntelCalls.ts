// The code intelligence tools on the Model API backend (M67, PLAN.md D49):
// the read tools' answers as tool outcomes, and `rename_symbol` written
// through the edit path. A rename's plan (src/core/codeIntel/rename.ts) is
// made before its card. Once approved, every file is confined, checked for
// unsaved changes and read again, and nothing is written unless each is
// still exactly as planned; a Stop until then writes nothing. The files are
// then written one by one with the tools' atomic write, each checked once
// more right before its own write, and the row carries one patch across
// what was written, so Edit Review and rewind cover the rename as they cover
// `edit_file`, a rename stopped partway included.

import { MODEL_TEXT, RENAME_CARD_FILES_SHOWN, UI_TEXT } from '../../../shared/constants'
import { fill, plural } from '../../../shared/l10n/text'
import { ADD_MARKER, type PatchFile, REMOVE_MARKER } from '../../../shared/patchDocument'
import { type CodeIntelDeps, unsavedDocumentPath } from '../../codeIntel/codeIntelQuery'
import { answerCodeIntel, type CodeIntelReadTool } from '../../codeIntel/codeIntelTools'
import {
  planRename,
  type RenameFile,
  type RenamePlan,
  type RenamePlanResult,
} from '../../codeIntel/rename'
import { isProtectedPath } from '../../protectedPaths'
import { confineWorkspacePath } from '../../workspacePath'
import { fingerprint } from '../../verify/fingerprint'
import { type ToolIo, type ToolOutcome } from './tools'

const NOT_JSON = 'arguments are not valid JSON'

function failed(reason: string, visibleReason: string = reason): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: visibleReason, failureReason: visibleReason }
}

/** The model's arguments as a value; undefined when they are not JSON. */
function parsedArguments(argsJson: string): { readonly value: unknown } | undefined {
  try {
    return { value: JSON.parse(argsJson) }
  } catch {
    return undefined
  }
}

/** A read tool's answer as the model and the row get it. */
export async function runCodeIntelRead(
  tool: CodeIntelReadTool,
  argsJson: string,
  deps: CodeIntelDeps,
  signal: AbortSignal,
): Promise<ToolOutcome> {
  const args = parsedArguments(argsJson)
  if (args === undefined) {
    return failed(NOT_JSON)
  }
  const answer = await answerCodeIntel(tool, args.value, deps, signal)
  return answer.ok
    ? { output: answer.text, visibleOutput: answer.text }
    : failed(answer.reason, answer.visibleReason)
}

/** A rename call's plan, made before its card: nothing is written here. */
export async function planRenameCall(
  argsJson: string,
  deps: CodeIntelDeps,
): Promise<RenamePlanResult> {
  const args = parsedArguments(argsJson)
  return args === undefined
    ? { ok: false, reason: NOT_JSON, visibleReason: NOT_JSON }
    : await planRename(args.value, deps)
}

/** The outcome of a rename that could not be planned. */
export function renameRefused(result: Extract<RenamePlanResult, { ok: false }>): ToolOutcome {
  return failed(result.reason, result.visibleReason)
}

/** Whether any file the rename writes is a protected write (D24). */
export function isProtectedRename(plan: RenamePlan): boolean {
  return plan.files.some((file) => isProtectedPath(file.canonical))
}

/**
 * What the rename's card names: a few of the files, protected ones first so
 * the card never hides the one that makes it ask, and how many more.
 */
export function renameCardPath(plan: RenamePlan): string {
  const ordered = plan.files.toSorted(
    (a, b) => Number(isProtectedPath(b.canonical)) - Number(isProtectedPath(a.canonical)),
  )
  const shown = ordered.slice(0, RENAME_CARD_FILES_SHOWN).map((file) => file.relative)
  const hidden = plan.files.length - shown.length
  const files = shown.join(', ')
  return hidden > 0 ? plural(UI_TEXT.renameCardMore, hidden, { files }) : files
}

/** The rename's files for a hook's payload: workspace-relative, in plan order. */
export function renameHookFiles(plan: RenamePlan): readonly string[] {
  return plan.files.map((file) => file.relative)
}

export interface RenameWriteContext {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: ToolIo
  /** The session's fingerprints of what the model last read or wrote (D27). */
  readonly seen: Map<string, string>
  /** The turn's: a Stop before the first write writes nothing. */
  readonly signal: AbortSignal
  /** Synchronous bookkeeping for each actual write, including a partial outcome. */
  readonly onWritten?: (file: RenameFile) => void
}

type Recheck =
  | { readonly ok: true; readonly key: string }
  | { readonly ok: false; readonly outcome: ToolOutcome; readonly changedPath?: string }

/**
 * Whether the file is still exactly as the plan read it: confined to the
 * same real path, with no unsaved changes, the same text on disk. The key
 * is the path its fingerprint is kept under (as the file tools resolve it).
 */
async function recheck(file: RenameFile, context: RenameWriteContext): Promise<Recheck> {
  const { io } = context
  const resolved = await confineWorkspacePath(
    context.workspaceRoot,
    file.relative,
    context.platform,
    io,
  )
  if (!resolved.ok || resolved.checkedAbsolute !== file.checkedAbsolute) {
    return { ok: false, outcome: failed(MODEL_TEXT.pathChangedAfterApproval) }
  }
  // By the real path: an editor may hold the file under a link's path.
  if ((await unsavedDocumentPath(io, file, context.platform)) !== undefined) {
    return { ok: false, outcome: failed(`${file.relative} ${MODEL_TEXT.fileHasUnsavedChanges}`) }
  }
  const current = await io.readFile(file.checkedAbsolute, file.checkedAbsolute)
  return current === file.before
    ? { ok: true, key: resolved.absolute }
    : {
        ok: false,
        outcome: failed(fill(MODEL_TEXT.renameChanged, { path: file.relative })),
        changedPath: file.relative,
      }
}

/** The patch across the files written, for the row, Edit Review and rewind. */
function renamePatch(files: readonly RenameFile[]): NonNullable<ToolOutcome['patch']> {
  const patchFiles: PatchFile[] = files.map((file) => ({
    path: file.relative,
    hunks: [...file.hunks],
    created: false,
  }))
  const lines = files.flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines))
  return {
    document: JSON.stringify({ files: patchFiles }),
    summary: {
      files: files.length,
      added: lines.filter((line) => line.startsWith(ADD_MARKER)).length,
      removed: lines.filter((line) => line.startsWith(REMOVE_MARKER)).length,
    },
  }
}

/** A rename stopped partway: what stopped it, what was written, and its revertable patch. */
function partial(
  template: string,
  values: Readonly<Record<string, string>>,
  plan: RenamePlan,
  written: readonly RenameFile[],
): ToolOutcome {
  const reason = fill(template, {
    ...values,
    written: String(written.length),
    total: String(plan.files.length),
    paths: written.map((done) => done.relative).join(', '),
  })
  return { ...failed(reason), ...(written.length > 0 && { patch: renamePatch(written) }) }
}

/**
 * Writes an approved rename. Every file is checked again first: nothing is
 * written if one moved, changed or gained unsaved changes after the plan,
 * or if the turn was stopped meanwhile. Each file is then checked once more
 * right before its own write, so a change made while the others were being
 * written is never overwritten; that, or a write that fails, stops the rest
 * and says which files were written, and the row can revert them. Once the
 * first file is written the rest follow even if Stop comes, so the rename is
 * not left half done by the button.
 */
export async function applyRename(
  plan: RenamePlan,
  context: RenameWriteContext,
): Promise<ToolOutcome> {
  for (const file of plan.files) {
    const result = await recheck(file, context)
    if (!result.ok) {
      return result.outcome
    }
  }
  context.signal.throwIfAborted()
  const written: RenameFile[] = []
  for (const file of plan.files) {
    const result = await recheck(file, context)
    if (!result.ok) {
      return written.length === 0
        ? result.outcome
        : partial(
            MODEL_TEXT.renameChangedPartway,
            { path: result.changedPath ?? file.relative },
            plan,
            written,
          )
    }
    // Stop may arrive while the final per-file recheck awaits I/O. Once a
    // write starts, finish the rename so the button cannot leave it half done.
    if (written.length === 0) {
      context.signal.throwIfAborted()
    }
    try {
      await context.io.writeFile(file.checkedAbsolute, file.after, file.checkedAbsolute)
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error)
      return partial(MODEL_TEXT.renamePartial, { path: file.relative, reason }, plan, written)
    }
    written.push(file)
    context.seen.set(result.key, fingerprint(file.after))
    context.onWritten?.(file)
  }
  const output = fill(MODEL_TEXT.renameDone, {
    from: plan.from,
    to: plan.to,
    edits: String(plan.edits),
    files: String(plan.files.length),
    paths: plan.files.map((file) => file.relative).join(', '),
  })
  return { output, visibleOutput: output, patch: renamePatch(written) }
}
