// The in-process tool harness of the Model API backend (PLAN.md M7): the
// function tools the model sees, their argument validation, and their
// execution over an injected `ToolIo` (the host supplies the file system
// and the shell). Every path is confined to the workspace root; edits
// leave a patch document shaped like Muse Code's so the transcript rows,
// Open diff and Revert (M5) work unchanged.

import type { ContentSource } from '../../schedules/provenance'
import { Buffer } from 'node:buffer'
import path from 'node:path'
import { setImmediate as yieldToHost } from 'node:timers/promises'
import * as z from 'zod/mini'
import {
  type PatchSummary,
  type Question,
  questionSchema,
  type ThenRunResult,
  todoItemSchema,
  type VerifySummary,
} from '../../../shared/agentEvents'
import {
  type CheckCommandSetting,
  CODE_INTEL_TOOLS,
  FILE_REFUSAL_MODEL_TEXT,
  EDIT_MATCH_YIELD_LINES,
  IMAGE_EXTENSIONS,
  LIST_FILES_DEFAULT_LIMIT,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MODEL_API_MODEL_TEXT,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
  PDF_EXTENSION,
  PDF_MEDIA_TYPE,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LINE_CHARS,
  READ_FILE_CONTEXT_CHAR_FRACTION,
  SEARCH_HIT_MAX_CHARS,
  SEARCH_MAX_CANDIDATES,
  SEARCH_MAX_FILE_BYTES,
  SEARCH_MAX_HITS,
  SEARCH_MAX_RESULTS,
  SEARCH_PATTERN_MAX_LENGTH,
  SEARCH_TIMEOUT_MS,
  SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_MAX_TIMEOUT_MS,
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_ELIDED_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
  UI_TEXT,
  VERIFY_TOOLS,
} from '../../../shared/constants'
import { ADD_MARKER, type PatchFile, REMOVE_MARKER } from '../../../shared/patchDocument'
import { fill, formatNumber, plural } from '../../../shared/l10n/text'
import type { DocumentPart, ImagePart } from '../../agent/agentBackend'
import type { Owner } from '../../checkpoints/toolWrites'
import { changeHunk } from '../../codeIntel/codeText'
import { MODEL_API_CODE_INTEL_DEFINITIONS } from '../../codeIntel/definitions'
import { readImageInfo } from '../../imageDimensions'
import type { MemoryWrites } from '../../memory/memoryStore'
import { isPdf, pdfPageCount } from '../../pdf'
import { posixQuoted, powerShellQuoted } from '../../shellQuote'
import { fingerprint } from '../../verify/fingerprint'
import { WEB_FETCH_DESCRIPTION, WEB_FETCH_PARAMETERS } from '../../web/webFetchDefinition'
import {
  BROWSER_CHECK_DESCRIPTION,
  BROWSER_CHECK_PARAMETERS,
  BROWSER_CHECK_REQUIRED,
} from '../../browser/browserTool'
import { confineWorkspacePath, normalizeModelPath } from '../../workspacePath'
import { compileGlob, GLOB_LIMITS } from './globLimits'
import type { GlobLimits } from './glob'
import type { HookHttpResult } from './hookHandlers'
import type { FileRules } from './permissionPolicy'
import {
  EDIT_IMAGE_DESCRIPTION,
  EDIT_IMAGE_PARAMETERS,
  GENERATE_IMAGE_DESCRIPTION,
  GENERATE_IMAGE_PARAMETERS,
} from './imageToolDefinitions'
import { GOAL_TOOL_DEFINITIONS } from './goals'
import { MEMORY_TOOL_DEFINITIONS } from './memoryTools'

import type { ToolClass } from './permissions'
import type { FunctionOutputPart, FunctionToolDefinition } from './schemas'
import { LEGAL_SCAN_DESCRIPTION, LEGAL_SCAN_PARAMETERS } from './legalScanTool'
import { RECALL_TOOL_DEFINITION } from './observationPack'
import { SUBAGENT_TOOL_DEFINITIONS } from './subagentTools'
import type { TEAM_TOOL_DEFINITIONS } from '../../team/teamTools'
import { runChecksDefinition, THEN_RUN_PROPERTY } from './verifyTools'

import type { ShellResult } from '../../shellResult'
export type { ShellResult } from '../../shellResult'

/**
 * A running command's time limit, which its caller can lift (M46, PLAN.md
 * D39): a command the user moved to the background runs until it ends or is
 * stopped. The runner binds itself once its clock is running.
 */
export class ShellTimeLimit {
  private onLift: (() => void) | undefined
  private isLifted = false

  /** The runner's hook; called at once when the limit is already lifted. */
  public bind(onLift: () => void): void {
    if (this.isLifted) {
      onLift()
      return
    }
    this.onLift = onLift
  }

  public lift(): void {
    this.isLifted = true
    this.onLift?.()
    this.onLift = undefined
  }
}

/** One `search` run: the model's pattern over the files that passed the glob. */
export interface SearchJob {
  readonly pattern: string
  /** The workspace root: a file whose canonical path leaves it is skipped (D24). */
  readonly root: string
  readonly files: readonly { readonly relative: string; readonly absolute: string }[]
  /** The canonical limits travel with the job so the worker stays small. */
  readonly maxFileBytes: number
  readonly maxHits: number
  /** One hit is cut here (M101): a minified line cannot fill the whole budget. */
  readonly maxHitChars: number
  /**
   * The deny-read globs of the permission settings (M78), lower case: a
   * file whose canonical path one covers is skipped, as a link to it is.
   */
  readonly denyRead: readonly string[]
  /** The glob limits, so the worker's bundle carries no constants table. */
  readonly globLimits: GlobLimits
}

export interface SearchHit {
  readonly file: string
  /** 1-based. */
  readonly line: number
  readonly text: string
}

export type SearchOutcome =
  | {
      readonly ok: true
      readonly hits: readonly SearchHit[]
      /** The search ran out of time: these are the hits found before it stopped (D27). */
      readonly isPartial?: boolean
    }
  | { readonly ok: false; readonly reason: string }

/** What the search worker posts: each file's hits as they are found, then the end (D27). */
export type SearchWorkerMessage =
  | { readonly type: 'hits'; readonly hits: readonly SearchHit[] }
  | { readonly type: 'done'; readonly outcome: SearchOutcome }

/** What the host lends the tools: files, a matcher it can stop, and a shell. */
export interface ToolIo {
  /**
   * The file's text, a UTF-8 BOM kept; undefined when it does not exist.
   * Rejects for a file that is not UTF-8 text (binary, UTF-16, Latin-1…):
   * decoding it lossily and writing it back would corrupt it (PLAN.md D27).
   */
  /** A canonical proof comes only from trusted workspace confinement, not tool arguments. */
  readFile(
    absolutePath: string,
    expectedCanonicalPath?: string,
    observeSource?: (source: Extract<ContentSource, { kind: 'file' }>) => void,
  ): Promise<string | undefined>
  /**
   * The file's bytes (M44: an image to edit); undefined when it does not
   * exist. Rejects, before reading, a file larger than `maxBytes`.
   */
  readBytes(
    absolutePath: string,
    maxBytes: number,
    expectedCanonicalPath?: string,
    observeSource?: (source: Extract<ContentSource, { kind: 'file' }>) => void,
  ): Promise<Uint8Array | undefined>
  /** Replaces the file whole (a temporary file renamed into place), folders created. */
  writeFile(
    absolutePath: string,
    content: string,
    expectedCanonicalPath?: string,
    assertCanWrite?: () => void,
  ): Promise<void>
  /**
   * `writeFile`, only while the file still holds the text whose fingerprint
   * is `expectedFingerprint`, compared immediately before the rename (M68,
   * `fsAtomic.writeFileIfUnchanged`): `changed`, and nothing written, when not.
   * A function instead asks whether the file is still as expected; it may
   * expect no file (M86's recorder: a new file's folders are then created).
   */
  writeFileIfUnchanged(
    absolutePath: string,
    expectedFingerprint: string | (() => Promise<boolean>),
    content: string,
    options: {
      readonly expectedCanonicalPath: string
      /** Refused when an editor holds unsaved text at any of them, checked just before the rename. */
      readonly unsavedAt: readonly string[]
      /** The caller's live admission, checked synchronously beside final native publication. */
      readonly assertCanWrite?: () => void
      /**
       * Runs once the content is staged beside the file, before the file is
       * replaced: M86's recorder journals its intent here. A throw leaves the
       * file as it was.
       */
      readonly staged?: (file: StagedFile) => Promise<void>
    },
  ): Promise<ConditionalWrite>
  /** Whether anything (a file, a folder, a link) is at the path. */
  pathExists(absolutePath: string): Promise<boolean>
  /**
   * Creates a new, empty file and holds it (M34: a generated image), its
   * folders created. Rejects when something is already there: nothing is
   * overwritten. The file is taken before the image is bought, so a path
   * taken meanwhile costs nothing (the review of PR #27).
   */
  reserveFile(
    absolutePath: string,
    expectedCanonicalPath?: string,
    beforeCreate?: (createdFolders: number) => Promise<void>,
  ): Promise<FileReservation>
  /** Whether an editor holds unsaved changes to the file (D27). */
  hasUnsavedChanges(absolutePath: string): boolean
  /** Absolute paths of the files open in an editor with unsaved changes, as the editor names them. */
  unsavedFiles(): readonly string[]
  /** Workspace-relative, forward-slash paths of every listed file. */
  listFiles(): Promise<readonly string[]>
  /** Evaluates the pattern off the host thread with a time budget (ReDoS containment). */
  searchFiles(job: SearchJob): Promise<SearchOutcome>
  /**
   * A timeout or the signal kills the whole process tree (PLAN.md D25);
   * `limit` lets the caller lift the timeout while it runs (M46).
   * `assertCanRun` is the owner's final admission, asked at the real entry
   * after every wait of the adapter and the checkpoint wrapper: a throw
   * refuses the command, which starts nothing (`isEntryRefused`).
   */
  runShell(
    command: string,
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
    limit?: ShellTimeLimit,
    assertCanRun?: () => void,
    /** D89.5: only an interactive top-level shell may use named credential pass-through. */
    isInteractive?: boolean,
  ): Promise<ShellResult>
  /** An explicitly enabled M51 hook, with JSON stdin and a cleared environment. */
  runHook?(
    command: string,
    payload: string,
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
    extraEnvNames?: readonly string[],
  ): Promise<ShellResult>
  /**
   * An M91 http hook's POST of its bounded JSON payload, through the host's
   * pinned-request path (HTTPS to the pinned address, no redirects followed;
   * fixed headers only). Absent until the host wires it: http hooks then skip.
   */
  runHookHttp?: (url: string, payload: string, signal: AbortSignal) => Promise<HookHttpResult>
  /**
   * The canonical form of an absolute path: links, junctions and short
   * names resolved through the nearest existing ancestor (PLAN.md D24).
   * Rejects when the file system refuses to say (permissions, link loops).
   */
  realPath(absolutePath: string): Promise<string>
}

/**
 * A new file held empty until its bytes arrive, or removed if they never do.
 * Each step acts only while the path still names the reserved file and it is
 * still empty (M86): `changed` when not, and the file is left as it is.
 */
export interface FileReservation {
  /** Writes the bytes into the file and lets it go. A failure part way is not cleaned up. */
  fill(bytes: Uint8Array): Promise<ReservationStep>
  /** Lets the file go and removes it. */
  release(): Promise<ReservationStep>
}

/** What a reservation's step did: done, or found the file changed and left it. */
export type ReservationStep = 'done' | 'changed'

/** A conditional write's content, staged beside its file before the file is replaced. */
export interface StagedFile {
  /** The staged file's permission bits, read from its handle: what the file will have. */
  readonly mode: number
  /** How many of the file's folders, its own and up, the write created for it (0: none). */
  readonly createdFolders: number
}

/**
 * What one turn's tools write through while it runs (M86, PLAN.md D63): an io
 * and memory writes bound to the turn, each write recorded for a restore.
 */
export interface TurnWrites {
  readonly io: ToolIo
  readonly memory: MemoryWrites
}

/**
 * Whether a turn's writes are recorded for a restore (M86, PLAN.md D63), and
 * what its tools write through while they are. A child turn inherits its top
 * turn's (spec 3.2).
 */
export type TurnCheckpoint =
  | { readonly kind: 'recording'; readonly owner: Owner; readonly writes: TurnWrites }
  /** Checkpoints are not on: nothing of the turn is recorded. */
  | { readonly kind: 'off' }
  /** Its record could not be made: it runs unrecorded, and a restore over it is refused. */
  | { readonly kind: 'failed' }

/**
 * A child turn's top turn (M86, spec 3.2): the parent's turn that spawned
 * the child, whose decision it inherits. Reload keeps only the decision,
 * never the old window's io. An unknown historical decision fails closed.
 */
export interface TopTurn {
  readonly checkpoint: TurnCheckpoint | undefined
  readonly recordsFiles?: boolean | undefined
}

/** How a turn ended, for its checkpoint (M86, spec 8). */
export interface TurnEnd {
  /** What its admission gave it; undefined when the admission failed. */
  readonly checkpoint: TurnCheckpoint | undefined
  /**
   * Whether it invoked the shell tool, a check or then_run, a hook or an MCP
   * tool, or had a command of the conversation running in the background:
   * what those changed a restore never undoes, and says so.
   */
  readonly ranProcesses: boolean
}

export interface ToolContext {
  readonly isInteractiveShell?: boolean
  /** Selected model's context window, supplied by the engine (M101). */
  readonly contextTokens?: number | undefined
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  /**
   * The shell tool's start directory (M91 lane S, PLAN.md D70): the
   * session's kept directory. Absent runs at the workspace root, as before.
   * Only the shell tool reads it; every other tool stays at the root.
   */
  readonly shellCwd?: string | undefined
  readonly io: ToolIo
  /** The checked write destination shown to the permission gate before approval. */
  readonly approvedTarget?: {
    readonly absolute: string
    readonly checkedAbsolute: string
  }
  /** The turn's: aborting it stops a running command (PLAN.md D25). */
  readonly signal?: AbortSignal
  /**
   * The permission settings' file rules (M78): paths the tools refuse, and
   * folders outside the workspace `read_file` may read. None when absent.
   * They are the policy the call was let in under, which an await may have
   * outlived: each outcome names what it touched (`touched`), and the host's
   * dispatcher judges those names again under the policy as it stands.
   */
  readonly files?: FileRules
  /** The shell's time limit, lifted when the command moves to the background (M46). */
  readonly limit?: ShellTimeLimit
  /**
   * Keep shell output whole instead of eliding its middle (M101): set while
   * the session packs observations, so a packed shell result stays
   * recoverable through `recall_output`. Oversized originals are packed
   * before their first model send.
   */
  readonly wholeShellOutput?: boolean
  /**
   * The session's record of each file as the model last read or wrote it
   * (absolute path to a fingerprint): `write_file` replaces only what the
   * model has seen (D27).
   */
  readonly seen: Map<string, string>
  /** Format on edit (M68); present only while it is on. */
  readonly formatter?: EditFormatter
  /** Captured owner admission, rechecked by the actual writer after its awaits. */
  readonly assertCanWrite?: (target: FormatTarget) => void
  /** Captured shell owner at the final native entry, after adapter waits. */
  readonly assertCanRun?: () => void
}

/** A file an edit just wrote, as format on edit sees it (M68). */
export interface FormatTarget {
  /** The path as the model named it, and its real form. */
  readonly absolute: string
  readonly checkedAbsolute: string
  /** Workspace-relative as the model named it, and after links are resolved. */
  readonly relative: string
  readonly canonical: string
}

/** Format on edit (M68): the formatter over a written file, and where its failures go. */
export interface EditFormatter {
  /** Captured turn ownership and live file policy, rechecked at conditional publication. */
  readonly assertCanWrite?: (target: FormatTarget) => void
  /** The text the file's formatter makes of what the edit wrote, or undefined for none. */
  readonly format: (target: FormatTarget, text: string) => Promise<string | undefined>
  /** A formatted text that could not be written back, for the log. */
  readonly warn: (message: string) => void
}

/** What a conditional write did (M68): wrote the file, or found it changed and left it. */
export type ConditionalWrite = 'written' | 'changed'

/**
 * A PDF or an image for the model to see, in a user message after the
 * round's outputs (M54, PLAN.md D47): one `read_file` read whole, or the
 * browser check's screenshot (M81).
 */
export interface VisibleFile {
  /** The model's line before it: what it is and where it came from. */
  readonly lead: string
  /** The model's line in its place when the round ended before it was sent. */
  readonly notDelivered: string
  readonly part: ImagePart | DocumentPart
}

/**
 * The workspace files a call touched (M78), for the dispatcher's live policy
 * fence: the policy as it stands when the outcome is built must still allow
 * every one of them, or nothing from the call reaches the model. An outcome
 * that names no files, or may carry text from files it cannot name (a
 * command's output, a server's, a child's), is incomplete: it fails closed,
 * refused if the file policy changed at all since the call was let in.
 */
export interface TouchedFiles {
  /** Each file as named and after links are resolved, workspace-relative (or absolute under an extra root). */
  readonly names: readonly string[]
  /** True only when the outcome provably carries nothing from any file but `names`. */
  readonly complete: boolean
  /** The permission profile's extra root a file was read under. */
  readonly extraRoot?: string
  /** A read recorded as seen (D27), by absolute path: forgotten when its outcome is refused. */
  readonly seen?: string
  /**
   * The file-policy revisions under which earlier work this outcome carries
   * was done (a child's, since its spawn): each must still stand, or the
   * outcome is refused. Undefined is a revision nobody recorded.
   */
  readonly revisions?: readonly (string | undefined)[]
}

export interface ToolOutcome {
  /** What the model receives as the function result. */
  readonly output: string
  /** The result as content parts instead, when it holds pictures (an MCP tool's, M50). */
  readonly outputParts?: readonly FunctionOutputPart[]
  /** What the transcript row shows. */
  readonly visibleOutput: string
  readonly failureReason?: string
  /** Edit-family tools: the stored patch document and its summary. */
  readonly patch?: { readonly document: string; readonly summary: PatchSummary }
  /** `read_file` of a PDF or an image: the file itself, sent after the round's outputs. */
  readonly visibleFile?: VisibleFile
  /** `run_checks` (M68): what the row sums up. */
  readonly verifySummary?: VerifySummary
  /** An edit's `then_run` (M68): the command's result beside the edit's. */
  readonly thenRun?: ThenRunResult
  /** The workspace files the call read or wrote (M78); none for a call that touches no file. */
  readonly touched?: TouchedFiles
}

const TOOL_CLASSES: Readonly<Record<string, ToolClass>> = {
  [MODEL_API_TOOLS.readFile]: 'read',
  [MODEL_API_TOOLS.search]: 'read',
  [MODEL_API_TOOLS.listFiles]: 'read',
  [MODEL_API_TOOLS.writeFile]: 'edit',
  [MODEL_API_TOOLS.editFile]: 'edit',
  [MODEL_API_TOOLS.bash]: 'shell',
  [MODEL_API_TOOLS.powershell]: 'shell',
  [MODEL_API_TOOLS.askUser]: 'interactive',
  [MODEL_API_TOOLS.todoWrite]: 'interactive',
  [MODEL_API_TOOLS.readSkill]: 'read',
  [MODEL_API_TOOLS.generateImage]: 'paid',
  [MODEL_API_TOOLS.editImage]: 'paid',
  [MODEL_API_SUBAGENT_TOOLS.spawn]: 'spawn',
  [MODEL_API_SUBAGENT_TOOLS.status]: 'interactive',
  [MODEL_API_SUBAGENT_TOOLS.wait]: 'interactive',
  [MODEL_API_SUBAGENT_TOOLS.sendMessage]: 'interactive',
  [MODEL_API_SUBAGENT_TOOLS.readResult]: 'interactive',
  [MODEL_API_SUBAGENT_TOOLS.cancel]: 'interactive',
  // The team runner owns delegation and merge consent (D75), just as each
  // run_checks command owns its approval. No ordinary card grants a paid use.
  roster: 'read',
  collect: 'read',
  delegate: 'interactive',
  cancel: 'interactive',
  merge: 'interactive',
  // M49 (PLAN.md D41): a memory write is judged as an edit, never a protected one.
  [MODEL_API_TOOLS.readMemory]: 'read',
  [MODEL_API_TOOLS.addMemory]: 'edit',
  [MODEL_API_TOOLS.editMemory]: 'edit',
  // The goal tools change only the session's goal (M45): no card, in any mode.
  [MODEL_API_TOOLS.createGoal]: 'interactive',
  [MODEL_API_TOOLS.getGoal]: 'interactive',
  [MODEL_API_TOOLS.updateGoal]: 'interactive',
  [MODEL_API_TOOLS.reportProgress]: 'interactive',
  // M73 (PLAN.md D49): reading a packed output back is a read of the
  // session's own earlier output: no card, in any mode.
  [MODEL_API_TOOLS.recallOutput]: 'read',
  // M68: the call itself asks nothing; each check it runs takes the shell
  // tool's permission path, one command at a time.
  [VERIFY_TOOLS.runChecks]: 'interactive',
  // M69 (PLAN.md D49): a network tool, asked per host.
  [MODEL_API_TOOLS.webFetch]: 'network',
  // M81 (PLAN.md D49): it starts a browser that reaches the page's host, so
  // it asks per host as web fetch does; Plan refuses it.
  [MODEL_API_TOOLS.browserCheck]: 'network',
  // M97 (PLAN.md D76): the deterministic scan reads, in every mode; it
  // never writes, runs a command or installs.
  [MODEL_API_TOOLS.legalScan]: 'read',
  // M67 (PLAN.md D49): the language services read, in every mode; a rename is an edit.
  [CODE_INTEL_TOOLS.findDefinition]: 'read',
  [CODE_INTEL_TOOLS.findReferences]: 'read',
  [CODE_INTEL_TOOLS.workspaceSymbols]: 'read',
  [CODE_INTEL_TOOLS.documentSymbols]: 'read',
  [CODE_INTEL_TOOLS.hover]: 'read',
  [CODE_INTEL_TOOLS.callHierarchy]: 'read',
  [CODE_INTEL_TOOLS.repoMap]: 'read',
  [CODE_INTEL_TOOLS.renameSymbol]: 'edit',
}

export function classifyTool(name: string): ToolClass | undefined {
  return TOOL_CLASSES[name]
}

/** Every tool the dispatcher knows by name (M78): what a fence must cover, external tools aside. */
export function classifiedToolNames(): readonly string[] {
  return Object.keys(TOOL_CLASSES)
}

/** The shell tool for the platform: PowerShell on Windows, bash elsewhere. */
export function shellToolFor(platform: NodeJS.Platform): { name: string; shellName: string } {
  return platform === 'win32'
    ? { name: MODEL_API_TOOLS.powershell, shellName: 'PowerShell' }
    : { name: MODEL_API_TOOLS.bash, shellName: 'bash' }
}

// --- argument schemas (validated before anything runs) ---

const readFileArgs = z.object({
  path: z.string(),
  offset: z.optional(z.number()),
  limit: z.optional(z.number()),
})
const writeFileArgs = z.object({ path: z.string(), content: z.string() })
const editEntryArgs = z.object({ find: z.string(), replace: z.string() })
const editFileArgs = z.object({
  path: z.string(),
  find: z.optional(z.string()),
  replace: z.optional(z.string()),
  edits: z.optional(z.array(editEntryArgs)),
})
const OUTPUT_MODES = ['content', 'files_with_matches', 'count'] as const
const searchArgs = z.object({
  pattern: z.string(),
  glob: z.optional(z.string()),
  output_mode: z.optional(z.enum(OUTPUT_MODES)),
  max_results: z.optional(z.number()),
})
const listFilesArgs = z.object({ glob: z.optional(z.string()), limit: z.optional(z.number()) })
const shellArgs = z.object({
  command: z.string(),
  description: z.optional(z.string()),
  timeout_ms: z.optional(z.number()),
})
export const askUserArgs = z.object({ questions: z.array(questionSchema) })
export const readSkillArgs = z.object({ id: z.string() })
export const webFetchArgs = z.object({ url: z.string() })
export const todoWriteArgs = z.object({ items: z.array(todoItemSchema) })

const PATH_PROPERTY = { type: 'string', description: 'Workspace-relative path' }
const SHELL_STOPPED_BY_USER = 'stopped by the user'

export interface ToolDefinitionOptions {
  /** M115 G: validated lazy schedule declarations, supplied only when the
   * host's charter/capability admission offers them. No engine import here. */
  readonly scheduleTools?: readonly FunctionToolDefinition[]
  /** False in Restricted Mode: no shell tool is offered (PLAN.md D13). */
  readonly hasShell: boolean
  /**
   * Whether the edit tools take `then_run`, which runs any command line:
   * with the shell unless a custom agent's tool list holds no shell tool (M76).
   */
  readonly hasThenRun?: boolean
  /** True when the workspace context holds at least one skill. */
  readonly hasSkills: boolean
  /** True while paid image generation is on (M34, PLAN.md D30). */
  readonly hasImageGeneration?: boolean
  /** Child sessions cannot spawn again (M48, PLAN.md D45). */
  readonly hasSubagents?: boolean
  /** A team conversation declares the team's five tools instead (M96, PLAN.md D75). */
  readonly teamTools?: typeof TEAM_TOOL_DEFINITIONS
  /** Child sessions cannot ask the panel or set its task list. */
  readonly isSubagent?: boolean
  /** Muse Code's memory tools, trusted workspaces only (M49, PLAN.md D41). */
  readonly hasMemory?: boolean
  /** `recall_output` (M73): true only while the session packs observations. */
  readonly hasPackedRecall?: boolean
  /** The user's check commands (M68): `run_checks` is offered with the shell while there are any. */
  readonly checks?: readonly CheckCommandSetting[]
  /** Web fetch, trusted workspaces only, when the host has a fetch (M69, PLAN.md D49). */
  readonly hasWebFetch?: boolean
  /** The browser check, trusted workspaces only, when the host can run one (M81, PLAN.md D49). */
  readonly hasBrowserCheck?: boolean
  /** The deterministic legal scan (M97, PLAN.md D76): a scanner is behind it. */
  readonly hasLegalScan?: boolean
  /** The code intelligence tools, while VS Code's language services are at hand (M67). */
  readonly hasCodeIntel?: boolean
}

const DEFAULT_TOOL_OPTIONS: ToolDefinitionOptions = { hasShell: true, hasSkills: false }

/** The function tools offered to the model (dev.meta.ai/docs/tool-calling). */
export function toolDefinitions(
  platform: NodeJS.Platform,
  options: ToolDefinitionOptions = DEFAULT_TOOL_OPTIONS,
): readonly FunctionToolDefinition[] {
  const shell = shellToolFor(platform)
  // `then_run` needs the shell, so it is offered only with it (M68).
  const thenRun = (options.hasThenRun ?? options.hasShell) ? THEN_RUN_PROPERTY : {}
  const checks = options.hasShell ? (options.checks ?? []) : []
  const runChecks = checks.length === 0 ? undefined : runChecksDefinition(checks)
  const define = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: readonly string[],
  ): FunctionToolDefinition => ({
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required: [...required],
      additionalProperties: false,
    },
    strict: false,
  })
  return [
    define(
      MODEL_API_TOOLS.readFile,
      'Read a file from the workspace. A text file comes back numbered by line (use offset and limit for long files); a PDF or an image (PNG, JPEG, GIF, WebP) comes back whole, for you to see.',
      {
        path: PATH_PROPERTY,
        offset: { type: 'integer', description: '1-based first line to return' },
        limit: { type: 'integer', description: 'Maximum lines to return' },
      },
      ['path'],
    ),
    define(
      MODEL_API_TOOLS.editFile,
      'Replace one exact occurrence of `find` with `replace` in a file. `find` must match exactly once; include enough surrounding lines to make it unique. Pass `edits` (a list of `find`/`replace` pairs) instead for several replacements in one call: every entry must match exactly once, entries must not overlap, and either all of them are applied or none is.',
      {
        path: PATH_PROPERTY,
        find: { type: 'string', description: 'The exact text to replace' },
        replace: { type: 'string', description: 'The replacement text' },
        edits: {
          type: 'array',
          description: 'Several replacements, applied together or not at all',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string', description: 'The exact text to replace' },
              replace: { type: 'string', description: 'The replacement text' },
            },
            required: ['find', 'replace'],
          },
        },
        ...thenRun,
      },
      ['path'],
    ),
    define(
      MODEL_API_TOOLS.writeFile,
      'Create or overwrite a file with the given content.',
      { path: PATH_PROPERTY, content: { type: 'string' }, ...thenRun },
      ['path', 'content'],
    ),
    define(
      MODEL_API_TOOLS.search,
      'Search file contents with a regular expression, optionally within files matching a glob.',
      {
        pattern: { type: 'string', description: 'JavaScript regular expression' },
        glob: { type: 'string', description: 'Only files matching this glob, e.g. src/**/*.ts' },
        output_mode: {
          type: 'string',
          enum: [...OUTPUT_MODES],
          description:
            'content (default): matching lines; files_with_matches: paths; count: matches per file',
        },
        max_results: { type: 'integer' },
      },
      ['pattern'],
    ),
    define(
      MODEL_API_TOOLS.listFiles,
      'List workspace files, optionally those matching a glob.',
      { glob: { type: 'string' }, limit: { type: 'integer' } },
      [],
    ),
    ...(options.hasShell
      ? [
          define(
            shell.name,
            `Run one ${shell.shellName} command line in the workspace root and return its output.`,
            {
              command: { type: 'string' },
              description: { type: 'string', description: 'One line saying what the command does' },
              timeout_ms: {
                type: 'integer',
                description: 'Milliseconds before the command is stopped',
              },
            },
            ['command', 'description'],
          ),
        ]
      : []),
    ...(runChecks === undefined
      ? []
      : [define(runChecks.name, runChecks.description, runChecks.properties, runChecks.required)]),
    ...(options.hasImageGeneration === true
      ? [
          define(
            MODEL_API_TOOLS.generateImage,
            GENERATE_IMAGE_DESCRIPTION,
            GENERATE_IMAGE_PARAMETERS,
            ['prompt', 'path'],
          ),
          define(MODEL_API_TOOLS.editImage, EDIT_IMAGE_DESCRIPTION, EDIT_IMAGE_PARAMETERS, [
            'prompt',
            'images',
            'path',
          ]),
        ]
      : []),
    ...(options.hasSkills
      ? [
          define(
            MODEL_API_TOOLS.readSkill,
            'Load the full instructions of a skill listed in your instructions, by its id. Call it before starting a task the skill covers.',
            { id: { type: 'string', description: 'The skill id from the Skills list' } },
            ['id'],
          ),
        ]
      : []),
    ...(options.isSubagent === true
      ? []
      : [
          define(
            MODEL_API_TOOLS.askUser,
            'Ask the user one or more questions and wait for the answers. Use it for decisions only the user can make.',
            {
              questions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    header: { type: 'string', description: 'Short label (a few words)' },
                    question: { type: 'string' },
                    selection: {
                      type: 'object',
                      properties: { mode: { type: 'string', enum: ['single', 'multiple'] } },
                      required: ['mode'],
                    },
                    options: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: { label: { type: 'string' }, description: { type: 'string' } },
                        required: ['label'],
                      },
                    },
                  },
                  required: ['id', 'header', 'question', 'selection', 'options'],
                },
              },
            },
            ['questions'],
          ),
          define(
            MODEL_API_TOOLS.todoWrite,
            'Replace your task list, shown to the user while you work.',
            {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    text: { type: 'string' },
                    status: { type: 'string', enum: ['pending', 'inProgress', 'completed'] },
                    activeForm: {
                      type: 'string',
                      description: 'Present-tense form shown while in progress',
                    },
                  },
                  required: ['text', 'status'],
                },
              },
            },
            ['items'],
          ),
          // Muse Code's goal tools (M45, PLAN.md D38), offered in every session as
          // `muse serve` offers them.
          ...GOAL_TOOL_DEFINITIONS.map((tool) =>
            define(tool.name, tool.description, tool.properties, tool.required),
          ),
        ]),
    ...(options.hasSubagents === true
      ? SUBAGENT_TOOL_DEFINITIONS.map((tool) =>
          define(tool.name, tool.description, tool.properties, tool.required),
        )
      : []),
    // M96 (PLAN.md D75): the orchestrator's five, never beside M48's six.
    ...(options.teamTools ?? []).map((tool) =>
      define(tool.name, tool.description, tool.properties, tool.required),
    ),
    ...(options.hasMemory === true
      ? MEMORY_TOOL_DEFINITIONS.map((tool) =>
          define(tool.name, tool.description, tool.properties, tool.required),
        )
      : []),
    // M73 (PLAN.md D49): pages a packed output back. The host runs it
    // against the session's store, so it is not in `executeTool`.
    ...(options.hasPackedRecall === true ? [RECALL_TOOL_DEFINITION] : []),
    ...(options.hasWebFetch === true
      ? [define(MODEL_API_TOOLS.webFetch, WEB_FETCH_DESCRIPTION, WEB_FETCH_PARAMETERS, ['url'])]
      : []),
    ...(options.hasBrowserCheck === true
      ? [
          define(
            MODEL_API_TOOLS.browserCheck,
            BROWSER_CHECK_DESCRIPTION,
            BROWSER_CHECK_PARAMETERS,
            BROWSER_CHECK_REQUIRED,
          ),
        ]
      : []),
    ...(options.hasCodeIntel === true
      ? MODEL_API_CODE_INTEL_DEFINITIONS.map((tool) =>
          define(CODE_INTEL_TOOLS[tool.tool], tool.description, tool.properties, tool.required),
        )
      : []),
    ...(options.hasLegalScan === true
      ? [define(MODEL_API_TOOLS.legalScan, LEGAL_SCAN_DESCRIPTION, LEGAL_SCAN_PARAMETERS, [])]
      : []),
    ...(options.scheduleTools ?? []),
  ]
}

// --- helpers ---

/** Keep the Muse cap; smaller loaded windows leave room for the prompt and replay (M101). */
export function readFileCharacterBudget(contextTokens: number | undefined): number {
  return contextTokens === undefined || !Number.isSafeInteger(contextTokens) || contextTokens <= 0
    ? TOOL_OUTPUT_MAX_CHARS
    : Math.max(
        1,
        Math.min(
          TOOL_OUTPUT_MAX_CHARS,
          Math.floor(contextTokens * READ_FILE_CONTEXT_CHAR_FRACTION),
        ),
      )
}

function clip(text: string, maxChars = TOOL_OUTPUT_MAX_CHARS): string {
  // Cut on a code point boundary, so the clip never splits a surrogate pair (M101).
  return text.length > maxChars
    ? `${text.slice(0, codePointBoundary(text, maxChars))}${TOOL_OUTPUT_CLIP_MARKER}`
    : text
}

const LAST_BMP_CODE_POINT = 0xff_ff
// A shell result has two streams, each given half of the output budget; a
// clipped stream keeps half of its share from each end.
const SHELL_STREAMS = 2
const HALVES = 2

/** `index` moved back off the middle of a surrogate pair, so no character is split. */
export function codePointBoundary(text: string, index: number): number {
  // A code point past the Basic Multilingual Plane starts at `index - 1` and
  // ends after `index`: cutting at `index` would split it.
  return (text.codePointAt(index - 1) ?? 0) > LAST_BMP_CODE_POINT ? index - 1 : index
}

/** The text's beginning and end within `max` characters, the elision marked between (D27). */
function clipMiddle(text: string, max: number): string {
  if (text.length <= max) {
    return text
  }
  const keep = Math.max(max - TOOL_OUTPUT_ELIDED_MARKER.length, 0)
  const headEnd = codePointBoundary(text, Math.ceil(keep / HALVES))
  const tailStart = codePointBoundary(text, text.length - Math.floor(keep / HALVES))
  return `${text.slice(0, headEnd)}${TOOL_OUTPUT_ELIDED_MARKER}${text.slice(tailStart)}`
}

function failure(reason: string, visibleReason = reason): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: visibleReason, failureReason: visibleReason }
}

function argumentFailure(error: z.core.$ZodError): ToolOutcome {
  return failure(`invalid arguments: ${z.prettifyError(error)}`)
}

const LINE_BREAK = /\r?\n/
const BOM = '\u{FEFF}'
const CRLF = '\r\n'
const LF = '\n'

function splitLines(text: string): string[] {
  const lines = text.split(LINE_BREAK)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** How a file's text is laid out, so an edit writes it back the same way (PLAN.md D27). */
interface TextShape {
  readonly hasBom: boolean
  /** Every line break is CRLF; a file that mixes them is edited as it is. */
  readonly isCrlf: boolean
  readonly hasTrailingBreak: boolean
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}

function shapeOf(raw: string): TextShape {
  const hasBom = raw.startsWith(BOM)
  const body = hasBom ? raw.slice(BOM.length) : raw
  const breaks = occurrences(body, LF)
  return {
    hasBom,
    isCrlf: breaks > 0 && occurrences(body, CRLF) === breaks,
    hasTrailingBreak: body.endsWith(LF),
  }
}

/** Every CRLF as LF. */
function toLf(text: string): string {
  return text.split(CRLF).join(LF)
}

/** The text as the model reads it: no BOM, and LF breaks where the file is all CRLF. */
function modelText(raw: string, shape: TextShape): string {
  const body = shape.hasBom ? raw.slice(BOM.length) : raw
  return shape.isCrlf ? toLf(body) : body
}

/** The model's text (either break) as the file holds text: its BOM and its line breaks. */
function fileText(text: string, shape: TextShape): string {
  const body = shape.isCrlf ? toLf(text).split(LF).join(CRLF) : text
  return shape.hasBom ? `${BOM}${body}` : body
}

/**
 * Format on edit (M68): what the edit wrote, as the file's formatter leaves
 * it, written back when it changed; the text on disk either way. It runs
 * before the fingerprint is taken, so `then_run` checks the formatted file.
 * The edit has landed by now: a formatted text that cannot be written back
 * (the write is atomic, so the file still holds what the edit wrote) is
 * logged and the edit stands as written (the M68 review).
 */
async function formatWritten(
  written: string,
  target: FormatTarget,
  context: ToolContext,
): Promise<string> {
  const { formatter } = context
  let formatted: string | undefined
  try {
    formatted = await formatter?.format(target, written)
  } catch (error: unknown) {
    formatter?.warn(
      `Format on edit failed; the edit stays as written: ${error instanceof Error ? error.message : String(error)}`,
    )
    return written
  }
  if (formatter === undefined || formatted === undefined || formatted === written) {
    return written
  }
  // Only over what the edit wrote, at the real path the edit wrote it, by the
  // one conditional write (the Codex review of PR #54): a change made while
  // the formatter ran stands. The write also refuses a path whose real form
  // moved. Text the user typed into an editor since stands too (the review
  // of e4b035a3): the editor would save it over the formatted file.
  // By the path as named and its real form: an editor may hold either.
  const paths = [target.absolute, target.checkedAbsolute]
  if (paths.some((path) => context.io.hasUnsavedChanges(path))) {
    formatter.warn(`Format on edit skipped ${target.relative}: it has unsaved changes in an editor`)
    return written
  }
  try {
    const wrote = await context.io.writeFileIfUnchanged(
      target.checkedAbsolute,
      fingerprint(written),
      formatted,
      {
        expectedCanonicalPath: target.checkedAbsolute,
        unsavedAt: paths,
        assertCanWrite: () => {
          context.signal?.throwIfAborted()
          formatter.assertCanWrite?.(target)
        },
      },
    )
    if (wrote === 'changed') {
      formatter.warn(
        `Format on edit skipped ${target.relative}: it no longer holds what the edit wrote (changed, replaced or removed while the formatter ran)`,
      )
      return written
    }
  } catch (error: unknown) {
    formatter.warn(
      `Format on edit could not write ${target.relative}; the edit stays as written: ${error instanceof Error ? error.message : String(error)}`,
    )
    return written
  }
  return formatted
}

/** The model's result line, and the note when the formatter changed the file. */
function editedLine(line: string, isFormatted: boolean): string {
  return isFormatted ? `${line}. ${MODEL_API_MODEL_TEXT.formattedAfterEdit}` : line
}

/**
 * An edit's row and patch. The hunk is the changed lines (common prefix and
 * suffix trimmed) with their context, in unified-diff numbering (PLAN.md
 * D27, `changeHunk`, shared with M67's rename): an insertion's `oldStart` is
 * the line it follows, never a marker of a created file, and a Revert checks
 * the context, so it refuses a file that has moved on.
 */
function patchOutcome(
  relativePath: string,
  before: string | undefined,
  after: string,
  visibleOutput: string,
  output: string,
): ToolOutcome {
  const hunk = changeHunk(before ?? '', after)
  const hunks = hunk === undefined ? [] : [hunk]
  // Said outright (D27): a Revert trashes only a file this edit created.
  const file: PatchFile = { path: relativePath, hunks, created: before === undefined }
  const lines = hunk?.lines ?? []
  const added = lines.filter((line) => line.startsWith(ADD_MARKER)).length
  const removed = lines.filter((line) => line.startsWith(REMOVE_MARKER)).length
  const diff =
    hunk === undefined ? '' : `\n--- original\n+++ updated\n@@\n${hunk.lines.join('\n')}\n`
  return {
    output,
    visibleOutput: `${visibleOutput}${diff}`,
    patch: { document: JSON.stringify({ files: [file] }), summary: { files: 1, added, removed } },
  }
}

// --- executors ---

/** What `read_file` sends whole by the path's name (M54): a PDF, an image, or neither. */
function visualKindOf(relative: string): 'pdf' | 'image' | undefined {
  const extension = path.extname(relative).toLowerCase()
  if (extension === PDF_EXTENSION) {
    return 'pdf'
  }
  return Object.hasOwn(IMAGE_EXTENSIONS, extension) ? 'image' : undefined
}

/** The model's lines around a file `read_file` read (M54). */
function readFileLines(relative: string): Pick<VisibleFile, 'lead' | 'notDelivered'> {
  return {
    lead: fill(MODEL_API_MODEL_TEXT.toolFileFollows, { path: relative }),
    notDelivered: fill(MODEL_API_MODEL_TEXT.toolFileNotDelivered, { path: relative }),
  }
}

/** The PDF, checked by its header, for the model to read whole (M54). */
function pdfOutcome(relative: string, bytes: Uint8Array): ToolOutcome {
  if (!isPdf(bytes)) {
    return failure(
      `${relative} ${MODEL_API_MODEL_TEXT.notPdf}`,
      fill(UI_TEXT.toolReadPdfInvalid, { path: relative }),
    )
  }
  const pageCount = pdfPageCount(bytes)
  const output = fill(MODEL_API_MODEL_TEXT.readPdf, {
    path: relative,
    pages:
      pageCount === undefined
        ? MODEL_API_MODEL_TEXT.pagesUnknown
        : fill(MODEL_API_MODEL_TEXT.pagesKnown, { count: String(pageCount) }),
    bytes: String(bytes.byteLength),
  })
  const visiblePages =
    pageCount === undefined
      ? UI_TEXT.toolReadPdfPagesUnknown
      : plural(UI_TEXT.toolReadPdfPages, pageCount, { count: formatNumber(pageCount) })
  const visibleOutput = fill(UI_TEXT.toolReadPdf, {
    path: relative,
    pages: visiblePages,
    bytes: formatNumber(bytes.byteLength),
  })
  return {
    output,
    visibleOutput,
    visibleFile: {
      ...readFileLines(relative),
      part: {
        type: 'file',
        base64Data: Buffer.from(bytes).toString('base64'),
        mediaType: PDF_MEDIA_TYPE,
        name: path.basename(relative),
        sizeBytes: bytes.byteLength,
        pageCount,
      },
    },
  }
}

/** The image, checked by its header, for the model to see (M54). */
function imageOutcome(relative: string, bytes: Uint8Array): ToolOutcome {
  const info = readImageInfo(bytes)
  if (info === undefined) {
    return failure(
      `${relative} ${MODEL_API_MODEL_TEXT.notImage}`,
      fill(UI_TEXT.toolReadImageInvalid, { path: relative }),
    )
  }
  const output = fill(MODEL_API_MODEL_TEXT.readImage, {
    path: relative,
    mediaType: info.mediaType,
    width: String(info.width),
    height: String(info.height),
    bytes: String(bytes.byteLength),
  })
  const visibleOutput = fill(UI_TEXT.toolReadImage, {
    path: relative,
    mediaType: info.mediaType,
    width: formatNumber(info.width),
    height: formatNumber(info.height),
    bytes: formatNumber(bytes.byteLength),
  })
  return {
    output,
    visibleOutput,
    visibleFile: {
      ...readFileLines(relative),
      part: {
        type: 'image',
        base64Data: Buffer.from(bytes).toString('base64'),
        mediaType: info.mediaType,
        width: info.width,
        height: info.height,
      },
    },
  }
}

/**
 * A PDF or an image read whole (M54, PLAN.md D47), within what an attachment
 * of its kind may be; the file itself reaches the model after the round.
 */
async function readVisual(
  file: { readonly relative: string; readonly checkedAbsolute: string },
  kind: 'pdf' | 'image',
  context: ToolContext,
): Promise<ToolOutcome> {
  let bytes: Uint8Array | undefined
  try {
    bytes = await context.io.readBytes(
      file.checkedAbsolute,
      kind === 'pdf' ? MAX_DOCUMENT_BYTES : MAX_IMAGE_BYTES,
      file.checkedAbsolute,
    )
  } catch (error: unknown) {
    // Stop still belongs to the host's cancellation path, not a file error row.
    if (context.signal?.aborted === true) {
      throw error
    }
    const modelReason = error instanceof Error ? error.message : String(error)
    return failure(modelReason, fill(UI_TEXT.toolVisualReadFailed, { path: file.relative }))
  }
  if (bytes === undefined) {
    return failure(
      `file not found: ${file.relative}`,
      fill(UI_TEXT.toolVisualFileMissing, { path: file.relative }),
    )
  }
  return kind === 'pdf' ? pdfOutcome(file.relative, bytes) : imageOutcome(file.relative, bytes)
}

/** Whether the permission settings deny the tools this confined path (M78). */
function isDenied(
  resolved: { readonly relative: string; readonly canonical: string },
  context: ToolContext,
): boolean {
  return context.files?.isDenied([resolved.relative, resolved.canonical]) === true
}

/**
 * The path `read_file` reads: in the workspace, or given absolute under an
 * extra root of the permission profile (M78), confined to that root as the
 * workspace confines its own (links resolved). Such a file is named by its
 * absolute path, forward slashes, and carries the root it was confined to.
 */
async function readablePath(
  given: string,
  context: ToolContext,
): Promise<Awaited<ReturnType<typeof confineWorkspacePath>> & { readonly extraRoot?: string }> {
  const inWorkspace = await confineWorkspacePath(
    context.workspaceRoot,
    given,
    context.platform,
    context.io,
  )
  const p = context.platform === 'win32' ? path.win32 : path.posix
  const normalized = normalizeModelPath(given, context.platform)
  if (inWorkspace.ok || !normalized.ok || !p.isAbsolute(normalized.path)) {
    return inWorkspace
  }
  const roots = context.files?.extraRoots ?? []
  for (const root of roots) {
    const underRoot = await confineWorkspacePath(root, given, context.platform, context.io)
    if (underRoot.ok) {
      return { ...underRoot, relative: underRoot.absolute.replaceAll(p.sep, '/'), extraRoot: root }
    }
  }
  return inWorkspace
}

async function readFile(
  args: z.infer<typeof readFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const resolved = await readablePath(args.path, context)
  if (!resolved.ok) {
    return failure(resolved.reason)
  }
  if (isDenied(resolved, context)) {
    return failure(`${resolved.relative} ${MODEL_API_MODEL_TEXT.pathDeniedByPolicy}`)
  }
  // Every outcome from here on, a failure included, comes from the file.
  const touched: TouchedFiles = {
    names: [resolved.relative, resolved.canonical],
    complete: true,
    ...(resolved.extraRoot !== undefined && { extraRoot: resolved.extraRoot }),
  }
  const visual = visualKindOf(resolved.relative)
  if (visual !== undefined) {
    return { ...(await readVisual(resolved, visual, context)), touched }
  }
  const raw = await context.io.readFile(resolved.checkedAbsolute, resolved.checkedAbsolute)
  if (raw === undefined) {
    return { ...failure(`file not found: ${resolved.relative}`), touched }
  }
  context.seen.set(resolved.absolute, fingerprint(raw))
  const lines = splitLines(modelText(raw, shapeOf(raw)))
  const start = Math.max((args.offset ?? 1) - 1, 0)
  // An offset past the last line is an error, not an empty read (M101): the
  // model otherwise pages past the end without noticing.
  if (start >= lines.length && (lines.length > 0 || start > 0)) {
    return {
      ...failure(
        fill(MODEL_API_MODEL_TEXT.readPastEnd, {
          offset: String(start + 1),
          path: resolved.relative,
          lines: String(lines.length),
        }),
        fill(UI_TEXT.toolReadPastEnd, { offset: formatNumber(start + 1), path: resolved.relative }),
      ),
      touched,
    }
  }
  const limit = Math.max(args.limit ?? READ_FILE_DEFAULT_LIMIT, 1)
  const maxChars = readFileCharacterBudget(context.contextTokens)
  const header = `Read text file \`${resolved.relative}\`.\n`
  const shown: string[] = []
  let used = header.length
  const continuation = (count: number) =>
    start + count < lines.length
      ? `\n[lines ${String(start + 1)}-${String(start + count)} of ${String(lines.length)}; offset=${String(start + count + 1)}]`
      : ''
  const selected = lines.slice(start, start + limit)
  for (const [index, line] of selected.entries()) {
    const body =
      line.length > READ_FILE_MAX_LINE_CHARS
        ? `${line.slice(0, codePointBoundary(line, READ_FILE_MAX_LINE_CHARS))}…`
        : line
    const numbered = `${String(start + index + 1)}|${body}`
    const nextSize = used + numbered.length + (shown.length > 0 ? 1 : 0)
    if (nextSize + continuation(shown.length + 1).length > maxChars) break
    shown.push(numbered)
    used = nextSize
  }
  const body = `${header}${shown.join('\n')}${continuation(shown.length)}`
  // A refused read leaves no trace: the host forgets `seen` with the outcome.
  return {
    output: clip(body),
    visibleOutput: `${fill(UI_TEXT.toolReadText, { path: resolved.relative })}\n${shown.join('\n')}${start + shown.length < lines.length ? `\n[${fill(UI_TEXT.toolReadRange, { start: formatNumber(start + 1), end: formatNumber(start + shown.length), total: formatNumber(lines.length), offset: String(start + shown.length + 1) })}]` : ''}`,
    touched: { ...touched, seen: resolved.absolute },
  }
}

/** The confined path and the file's current text (undefined when absent), or the refusal. */
async function located(
  given: string,
  context: ToolContext,
): Promise<
  | {
      readonly ok: true
      readonly relative: string
      readonly canonical: string
      readonly absolute: string
      readonly checkedAbsolute: string
      readonly before: string | undefined
    }
  | { readonly ok: false; readonly outcome: ToolOutcome }
> {
  const resolved = await confineWorkspacePath(
    context.workspaceRoot,
    given,
    context.platform,
    context.io,
  )
  if (!resolved.ok) {
    return { ok: false, outcome: failure(resolved.reason) }
  }
  if (isDenied(resolved, context)) {
    return {
      ok: false,
      outcome: failure(`${resolved.relative} ${MODEL_API_MODEL_TEXT.pathDeniedByPolicy}`),
    }
  }
  if (
    context.approvedTarget !== undefined &&
    (resolved.absolute !== context.approvedTarget.absolute ||
      resolved.checkedAbsolute !== context.approvedTarget.checkedAbsolute)
  ) {
    return { ok: false, outcome: failure(FILE_REFUSAL_MODEL_TEXT.pathChangedAfterApproval) }
  }
  const before = await context.io.readFile(resolved.checkedAbsolute, resolved.checkedAbsolute)
  return {
    ok: true,
    relative: resolved.relative,
    canonical: resolved.canonical,
    absolute: resolved.absolute,
    checkedAbsolute: resolved.checkedAbsolute,
    before,
  }
}

/** A file an edit wrote, as the dispatcher's fence judges it (M78). */
function touchedBy(file: { readonly relative: string; readonly canonical: string }): TouchedFiles {
  return { names: [file.relative, file.canonical], complete: true }
}

/** Why an edit must not touch this file now, or undefined (D27). */
function editRefusal(
  file: { readonly relative: string; readonly absolute: string; readonly checkedAbsolute: string },
  context: ToolContext,
): ToolOutcome | undefined {
  // Writing under an editor's unsaved changes makes VS Code ask which to keep.
  return context.io.hasUnsavedChanges(file.absolute) ||
    context.io.hasUnsavedChanges(file.checkedAbsolute)
    ? failure(`${file.relative} ${FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges}`)
    : undefined
}

function writeAdmission(target: FormatTarget, context: ToolContext): () => void {
  return () => {
    context.signal?.throwIfAborted()
    if (
      context.io.hasUnsavedChanges(target.absolute) ||
      context.io.hasUnsavedChanges(target.checkedAbsolute)
    )
      throw new Error(`${target.relative} ${FILE_REFUSAL_MODEL_TEXT.fileHasUnsavedChanges}`)
    context.assertCanWrite?.(target)
  }
}

async function publishText(
  file: FormatTarget,
  written: string,
  context: ToolContext,
): Promise<string> {
  await context.io.writeFile(
    file.checkedAbsolute,
    written,
    file.checkedAbsolute,
    writeAdmission(file, context),
  )
  const final = await formatWritten(written, file, context)
  context.seen.set(file.absolute, fingerprint(final))
  return final
}

async function writeFile(
  args: z.infer<typeof writeFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const file = await located(args.path, context)
  if (!file.ok) {
    return file.outcome
  }
  const refusal = editRefusal(file, context)
  if (refusal !== undefined) {
    return refusal
  }
  const { before, relative, absolute } = file
  const touched = touchedBy(file)
  if (before === undefined) {
    const created = await publishText(file, args.content, context)
    return {
      ...patchOutcome(
        relative,
        undefined,
        created,
        `created ${relative}`,
        editedLine(
          `created ${relative} (${String(args.content.length)} characters)`,
          created !== args.content,
        ),
      ),
      touched,
    }
  }
  // Claude Code's rule: a file is replaced only as the model last saw it (D27).
  if (context.seen.get(absolute) !== fingerprint(before)) {
    return failure(`${relative} ${MODEL_API_MODEL_TEXT.fileChangedSinceRead}`)
  }
  // The file keeps its BOM, its line breaks and its final line break (D27).
  const shape = shapeOf(before)
  const normalized = toLf(args.content)
  const text =
    normalized !== '' && shape.hasTrailingBreak && !normalized.endsWith(LF)
      ? `${normalized}${LF}`
      : normalized
  const after = fileText(text, shape)
  const final = await publishText(file, after, context)
  return {
    ...patchOutcome(
      relative,
      modelText(before, shape),
      final === after ? text : modelText(final, shapeOf(final)),
      `wrote ${relative}`,
      editedLine(`wrote ${relative} (${String(args.content.length)} characters)`, final !== after),
    ),
    touched,
  }
}

/**
 * One line for fuzzy matching (M101, Pi's edit-diff): NFKC, Unicode spaces
 * as spaces, curly quotes and dashes as their plain forms, no trailing
 * whitespace.
 */
function fuzzyLine(line: string): string {
  return line
    .normalize('NFKC')
    .replaceAll(/[\u{00A0}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}]/gu, ' ')
    .replaceAll(/[\u{2018}\u{2019}\u{201A}\u{201B}]/gu, "'")
    .replaceAll(/[\u{201C}\u{201D}\u{201E}\u{201F}]/gu, '"')
    .replaceAll(/[\u{2013}\u{2014}\u{2212}]/gu, '-')
    .trimEnd()
}

/**
 * The character range a `find` uniquely matches, exact first, then the
 * normalised line fallback (M101): at most one run of normalised lines may
 * match, and the untouched lines are copied back from the original, so only
 * the matched range changes. Undefined with the refusal when it does not.
 */
async function matchRange(
  current: string,
  find: string,
  signal: AbortSignal | undefined,
): Promise<
  { readonly start: number; readonly end: number } | { readonly refusal: 'notFound' | 'ambiguous' }
> {
  const first = current.indexOf(find)
  if (first !== -1) {
    // Several exact matches stay refused: the model adds context. The
    // normalised fallback is only for formatting the exact text missed.
    return current.includes(find, first + 1)
      ? {
          refusal: 'ambiguous',
        }
      : { start: first, end: first + find.length }
  }
  const lines = current.split('\n')
  const starts: number[] = []
  const normalized: string[] = []
  for (const [index, line] of lines.entries()) {
    if (index % EDIT_MATCH_YIELD_LINES === 0) {
      await yieldToHost(undefined, { signal })
    }
    starts.push(index === 0 ? 0 : (starts[index - 1] ?? 0) + (lines[index - 1]?.length ?? 0) + 1)
    normalized.push(fuzzyLine(line))
  }
  const want = find.split('\n').map((line) => fuzzyLine(line))
  const hasTrailingBreak = find.endsWith('\n')
  if (hasTrailingBreak) want.pop()
  // KMP prefix lengths: each normalized line is compared a bounded number
  // of times, including repeated-line near misses (M101 review finding 4).
  const prefixLengths: number[] = [0]
  for (let index = 1, matched = 0; index < want.length; index += 1) {
    while (matched > 0 && want[index] !== want[matched]) matched = prefixLengths[matched - 1] ?? 0
    if (want[index] === want[matched]) matched += 1
    prefixLengths.push(matched)
  }
  const matches: number[] = []
  if (want.some((line) => line !== '')) {
    for (let index = 0, matched = 0; index < normalized.length; index += 1) {
      if (index % EDIT_MATCH_YIELD_LINES === 0) await yieldToHost(undefined, { signal })
      while (matched > 0 && normalized[index] !== want[matched])
        matched = prefixLengths[matched - 1] ?? 0
      if (normalized[index] === want[matched]) matched += 1
      if (matched !== want.length) {
        continue
      }

      if (!hasTrailingBreak || index + 1 < lines.length) matches.push(index - want.length + 1)
      if (matches.length > 1) break
      matched = prefixLengths[matched - 1] ?? 0
    }
  }
  if (matches.length === 1) {
    const at = matches[0] ?? 0
    const end = at + want.length
    return {
      start: starts[at] ?? 0,
      end:
        end < lines.length
          ? (starts[end] ?? current.length) - (hasTrailingBreak ? 0 : 1)
          : current.length,
    }
  }
  return {
    refusal: matches.length === 0 ? 'notFound' : 'ambiguous',
  }
}

async function editFile(
  args: z.infer<typeof editFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const file = await located(args.path, context)
  if (!file.ok) {
    return file.outcome
  }
  const { before, relative } = file
  if (before === undefined) {
    return failure(`file not found: ${relative}`)
  }
  const refusal = editRefusal(file, context)
  if (refusal !== undefined) {
    return refusal
  }
  // One call edits once (`find`/`replace`) or several times (`edits`),
  // never both; an empty `edits` edits nothing and is refused outright.
  if (args.edits?.length === 0) {
    return failure(MODEL_API_MODEL_TEXT.editEmptyList, UI_TEXT.toolEditInvalid)
  }
  const hasEdits = args.edits !== undefined
  if (hasEdits && (args.find !== undefined || args.replace !== undefined)) {
    return failure(MODEL_API_MODEL_TEXT.editMixedShape, UI_TEXT.toolEditInvalid)
  }
  const singles =
    args.edits ??
    (args.find !== undefined && args.replace !== undefined
      ? [{ find: args.find, replace: args.replace }]
      : undefined)
  if (singles === undefined) {
    return failure(MODEL_API_MODEL_TEXT.editPairRequired, UI_TEXT.toolEditInvalid)
  }
  for (const entry of singles) {
    if (entry.find === '') {
      return failure(MODEL_API_MODEL_TEXT.editFindEmpty, UI_TEXT.toolEditInvalid)
    }
    // A no-op edit writes the file for nothing; refuse it (M101).
    if (entry.find === entry.replace) {
      return failure(MODEL_API_MODEL_TEXT.editNoChange, UI_TEXT.toolEditNoChange)
    }
  }
  // The model reads LF lines without the BOM: the match runs on that text,
  // and the file gets its own BOM and line breaks back (D27).
  const shape = shapeOf(before)
  const current = modelText(before, shape)
  // Every entry resolved against the original text first (M101): overlaps
  // are refused and one write applies all of them, so either all land or
  // none does.
  const ranges: { readonly start: number; readonly end: number; readonly replace: string }[] = []
  for (const [index, entry] of singles.entries()) {
    const find = shape.isCrlf ? toLf(entry.find) : entry.find
    const matched = await matchRange(current, find, context.signal)
    if ('refusal' in matched) {
      const prefix = hasEdits ? `edits[${String(index)}]: ` : ''
      const model =
        matched.refusal === 'notFound'
          ? MODEL_API_MODEL_TEXT.editNotFound
          : MODEL_API_MODEL_TEXT.editAmbiguous
      const visible =
        matched.refusal === 'notFound' ? UI_TEXT.toolEditNotFound : UI_TEXT.toolEditAmbiguous
      return failure(
        `${prefix}${fill(model, { path: relative })}`,
        `${prefix}${fill(visible, { path: relative })}`,
      )
    }
    ranges.push({
      start: matched.start,
      end: matched.end,
      replace: shape.isCrlf ? toLf(entry.replace) : entry.replace,
    })
  }
  const ordered = ranges.toSorted((a, b) => a.start - b.start)
  for (const [index, range] of ordered.entries()) {
    const previous = ordered[index - 1]
    if (previous !== undefined && range.start < previous.end) {
      return failure(MODEL_API_MODEL_TEXT.editOverlap, UI_TEXT.toolEditOverlap)
    }
  }
  let updated = ''
  let at = 0
  for (const range of ordered) {
    updated += `${current.slice(at, range.start)}${range.replace}`
    at = range.end
  }
  updated += current.slice(at)
  const after = fileText(updated, shape)
  const final = await publishText(file, after, context)
  return {
    ...patchOutcome(
      relative,
      current,
      final === after ? updated : modelText(final, shapeOf(final)),
      hasEdits ? `edited ${relative} (${String(singles.length)} edits)` : 'edited',
      editedLine(
        hasEdits ? `edited ${relative} (${String(singles.length)} edits)` : `edited ${relative}`,
        final !== after,
      ),
    ),
    touched: touchedBy(file),
  }
}

async function listMatching(
  context: ToolContext,
  glob: string | undefined,
): Promise<readonly string[]> {
  // Compiled before the listing, so a refused glob costs no file walk.
  const matches = glob === undefined ? undefined : compileGlob(glob)
  const files = await context.io.listFiles()
  // What the permission settings deny is neither listed nor searched (M78).
  return files.filter(
    (file) => (matches === undefined || matches(file)) && context.files?.isDenied([file]) !== true,
  )
}

/** The lines a search reports for its mode, capped at `limit`. */
function searchLines(
  hits: readonly SearchHit[],
  mode: (typeof OUTPUT_MODES)[number],
  limit: number,
): readonly string[] {
  if (mode === 'content') {
    return hits.slice(0, limit).map((hit) => `${hit.file}:${String(hit.line)}: ${hit.text}`)
  }
  const perFile = new Map<string, number>()
  for (const hit of hits) {
    perFile.set(hit.file, (perFile.get(hit.file) ?? 0) + 1)
  }
  return Array.from(perFile, ([file, count]) =>
    mode === 'count' ? `${file}: ${String(count)}` : file,
  ).slice(0, limit)
}

async function search(
  args: z.infer<typeof searchArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  if (args.pattern.length > SEARCH_PATTERN_MAX_LENGTH) {
    return failure(`pattern longer than ${String(SEARCH_PATTERN_MAX_LENGTH)} characters`)
  }
  const mode = args.output_mode ?? 'content'
  const limit = Math.max(Math.min(args.max_results ?? SEARCH_MAX_RESULTS, SEARCH_MAX_RESULTS), 1)
  const p = context.platform === 'win32' ? path.win32 : path.posix
  let candidates: readonly string[]
  try {
    candidates = await listMatching(context, args.glob)
  } catch (error: unknown) {
    return failure(error instanceof Error ? error.message : String(error))
  }
  // A workspace too large to search in the budget is searched in part, and
  // the model is told so rather than handed a silent subset (D27).
  const searched = candidates.slice(0, SEARCH_MAX_CANDIDATES)
  const outcome = await context.io.searchFiles({
    pattern: args.pattern,
    root: context.workspaceRoot,
    maxFileBytes: SEARCH_MAX_FILE_BYTES,
    maxHits: SEARCH_MAX_HITS,
    maxHitChars: SEARCH_HIT_MAX_CHARS,
    denyRead: context.files?.denyGlobs ?? [],
    globLimits: GLOB_LIMITS,
    files: searched.map((relative) => ({
      relative,
      absolute: p.join(context.workspaceRoot, ...relative.split('/')),
    })),
  })
  // Every candidate, searched or not: its name may be in a hit or a count.
  const touched: TouchedFiles = { names: candidates, complete: true }
  if (!outcome.ok) {
    return { ...failure(outcome.reason), touched }
  }
  const results = searchLines(outcome.hits, mode, limit)
  const notes = [
    ...(searched.length < candidates.length
      ? [
          `[searched the first ${String(searched.length)} of ${String(candidates.length)} files; narrow the search with glob]`,
        ]
      : []),
    ...(outcome.isPartial === true
      ? [
          `[the search stopped after ${String(SEARCH_TIMEOUT_MS)} ms; these results are partial, narrow the pattern or the glob]`,
        ]
      : []),
  ]
  const found = results.length === 0 ? 'No matches.' : results.join('\n')
  const body = [found, ...notes].join('\n')
  return { output: clip(body), visibleOutput: clip(body), touched }
}

async function listFiles(
  args: z.infer<typeof listFilesArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const limit = Math.max(args.limit ?? LIST_FILES_DEFAULT_LIMIT, 1)
  let files: readonly string[]
  try {
    files = await listMatching(context, args.glob)
  } catch (error: unknown) {
    return failure(error instanceof Error ? error.message : String(error))
  }
  const shown = files.slice(0, limit)
  const tail =
    files.length > shown.length ? `\n[${String(files.length - shown.length)} more files]` : ''
  const body = shown.length === 0 ? 'No files.' : `${shown.join('\n')}${tail}`
  // Every file listed, shown or counted.
  return {
    output: clip(body),
    visibleOutput: clip(body),
    touched: { names: files, complete: true },
  }
}

async function shell(args: z.infer<typeof shellArgs>, context: ToolContext): Promise<ToolOutcome> {
  const timeoutMs = Math.min(
    Math.max(args.timeout_ms ?? SHELL_DEFAULT_TIMEOUT_MS, 1),
    SHELL_MAX_TIMEOUT_MS,
  )
  const result = await context.io.runShell(
    args.command,
    context.shellCwd ?? context.workspaceRoot,
    timeoutMs,
    context.signal,
    context.limit,
    context.assertCanRun,
    context.isInteractiveShell === true,
  )
  return shellOutcome(result, timeoutMs, TOOL_OUTPUT_MAX_CHARS, context.wholeShellOutput === true)
}

/**
 * What a shell command carries so the session's kept directory survives it
 * (M91 lane S, PLAN.md D70; the lead's side-file decision): the trailer
 * reports the call's sequence and the shell's final directory to the
 * session's side file, then restores the command's own exit. The trailer
 * changes neither the output (it writes a file, not a stream) nor how the
 * command ended:
 * - bash keeps `$?` across the trailer and exits with it, so a failing
 *   command still fails; a trailer the command never reaches (`exit`,
 *   `set -e`, a parse error, a kill) leaves a stale sequence, which reads
 *   back as "no report".
 * - Windows PowerShell reports a `-Command`'s last statement, so a bare
 *   trailer would turn a failure into a success (probed: a failing cmdlet
 *   exits 1, a succeeding trailer after it exits 0). The trailer reads
 *   `$?` and `$LASTEXITCODE` first and exits with the same outcome: a
 *   success stays 0, a native failure keeps its code, anything else fails
 *   as 1. The 5.1-safe statements (no ternary) write through .NET, so a
 *   directory with spaces, quotes or `$` needs no quoting at all.
 * The host reads the file back (never the output, which can be truncated)
 * and keeps a directory inside the workspace, else resets to the root with
 * a note. Approval cards, session rules and hook payloads see the user's
 * own command, which the host wraps after admission.
 */
export function shellDirectoryTrailer(
  platform: NodeJS.Platform,
  sideFile: string,
  sequence: number,
): string {
  return platform === 'win32'
    ? `; $__m91code=$LASTEXITCODE; $__m91ok=$?; try { [System.IO.File]::WriteAllText(${powerShellQuoted(sideFile)}, '${String(sequence)}' + "\`n" + (Get-Location).Path) } catch {}; $__m91exit=1; if ($__m91code) { $__m91exit=$__m91code }; if ($__m91ok) { exit 0 } else { exit $__m91exit }`
    : String.raw`; __m91status=$?; { printf '%s\n' '${String(sequence)}'; pwd; } > ${posixQuoted(sideFile)} || true; exit $__m91status`
}

/**
 * A side file's report for `sequence`: the shell's final directory.
 * Undefined when the trailer never ran (an `exit`, a kill, a timeout, a
 * parse error) or the file holds another call's report: the caller then
 * keeps the previous directory. Newlines inside a name survive: everything
 * after the first line is the directory, less its one trailing newline.
 */
export function parseShellDirectoryReport(
  text: string | undefined,
  sequence: number,
): string | undefined {
  if (text === undefined) {
    return undefined
  }
  const lines = text.split('\n')
  if (lines[0] !== String(sequence)) {
    return undefined
  }
  const reported = lines
    .slice(1)
    .join('\n')
    .replace(/\r?\n$/, '')
  return reported === '' ? undefined : reported
}

/**
 * What a finished command printed: each stream keeps its beginning and its
 * end within its share of the output budget (D27).
 */
export function shellText(
  result: ShellResult,
  maxChars: number = TOOL_OUTPUT_MAX_CHARS,
  shouldKeepWhole = false,
): string {
  const parts = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter((part) => part !== '')
  // The runner already bounds each stream. Preserve that original in
  // replay; the packer projects oversized results before their first send.
  if (shouldKeepWhole) return parts.join('\n')
  const streamBudget = Math.floor(maxChars / SHELL_STREAMS)
  return parts.map((part) => clipMiddle(part, streamBudget)).join('\n')
}

/**
 * A finished command as the model and the row read it (the shell tool, and
 * the user's own `!` command on this backend, M46): what it printed, then an
 * exit line that is never clipped, so a flood of output still says how the
 * command ended (D27). A check's output takes its share of one budget (M68).
 */
export function shellOutcome(
  result: ShellResult,
  timeoutMs: number,
  maxChars: number = TOOL_OUTPUT_MAX_CHARS,
  shouldKeepWhole = false,
): ToolOutcome {
  let exit = `exit code ${String(result.exitCode ?? 'unknown')}`
  if (result.isCancelled) {
    exit = SHELL_STOPPED_BY_USER
  } else if (result.isTimedOut) {
    exit = `stopped after ${String(timeoutMs)} ms`
  }
  const body = `${shellText(result, maxChars, shouldKeepWhole)}\n[${exit}]`.trim()
  // The row keeps the elided text it always showed; only what the model
  // receives rides whole into the packed replay.
  const shown = shouldKeepWhole ? `${shellText(result, maxChars)}\n[${exit}]`.trim() : body
  return {
    output: body,
    visibleOutput: shown,
    ...((result.isTimedOut || result.isCancelled) && { failureReason: exit }),
  }
}

/**
 * Runs a file or shell tool. `ask_user` and `todo_write` are the session's
 * (they need the transcript), so they are refused here.
 */
export async function executeTool(
  name: string,
  argsJson: string,
  context: ToolContext,
): Promise<ToolOutcome> {
  let raw: unknown
  try {
    raw = JSON.parse(argsJson)
  } catch {
    return failure('arguments are not valid JSON')
  }
  switch (name) {
    case MODEL_API_TOOLS.readFile: {
      const parsed = readFileArgs.safeParse(raw)
      return parsed.success ? await readFile(parsed.data, context) : argumentFailure(parsed.error)
    }
    case MODEL_API_TOOLS.writeFile: {
      const parsed = writeFileArgs.safeParse(raw)
      return parsed.success ? await writeFile(parsed.data, context) : argumentFailure(parsed.error)
    }
    case MODEL_API_TOOLS.editFile: {
      const parsed = editFileArgs.safeParse(raw)
      return parsed.success ? await editFile(parsed.data, context) : argumentFailure(parsed.error)
    }
    case MODEL_API_TOOLS.search: {
      const parsed = searchArgs.safeParse(raw)
      return parsed.success ? await search(parsed.data, context) : argumentFailure(parsed.error)
    }
    case MODEL_API_TOOLS.listFiles: {
      const parsed = listFilesArgs.safeParse(raw)
      return parsed.success ? await listFiles(parsed.data, context) : argumentFailure(parsed.error)
    }
    case MODEL_API_TOOLS.bash:
    case MODEL_API_TOOLS.powershell: {
      if (name !== shellToolFor(context.platform).name) {
        return failure(`unknown tool ${name}`)
      }
      const parsed = shellArgs.safeParse(raw)
      return parsed.success ? await shell(parsed.data, context) : argumentFailure(parsed.error)
    }
    default: {
      return failure(`unknown tool ${name}`)
    }
  }
}

/** The questions of an `ask_user` call, or the reason they are unusable. */
export function parseQuestions(argsJson: string): readonly Question[] | string {
  try {
    const parsed = askUserArgs.safeParse(JSON.parse(argsJson))
    return parsed.success
      ? parsed.data.questions
      : `invalid arguments: ${z.prettifyError(parsed.error)}`
  } catch {
    return 'arguments are not valid JSON'
  }
}
