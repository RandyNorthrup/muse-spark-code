// The in-process tool harness of the Model API backend (PLAN.md M7): the
// function tools the model sees, their argument validation, and their
// execution over an injected `ToolIo` (the host supplies the file system
// and the shell). Every path is confined to the workspace root; edits
// leave a patch document shaped like Muse Code's so the transcript rows,
// Open diff and Revert (M5) work unchanged.

import { Buffer } from 'node:buffer'
import path from 'node:path'
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
  CODE_INTEL_TOOLS,
  IMAGE_EXTENSIONS,
  LIST_FILES_DEFAULT_LIMIT,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  MODEL_API_SUBAGENT_TOOLS,
  MODEL_API_TOOLS,
  MODEL_TEXT,
  PDF_EXTENSION,
  PDF_MEDIA_TYPE,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LINE_CHARS,
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
  type CheckCommandSetting,
  UI_TEXT,
  VERIFY_TOOLS,
} from '../../../shared/constants'
import { ADD_MARKER, type PatchFile, REMOVE_MARKER } from '../../../shared/patchDocument'
import { fill, formatNumber, plural } from '../../../shared/l10n/text'
import type { DocumentPart, ImagePart } from '../../agent/agentBackend'
import { changeHunk } from '../../codeIntel/codeText'
import { MODEL_API_CODE_INTEL_DEFINITIONS } from '../../codeIntel/definitions'
import { readImageInfo } from '../../imageDimensions'
import { isPdf, pdfPageCount } from '../../pdf'
import { fingerprint } from '../../verify/fingerprint'
import { WEB_FETCH_DESCRIPTION, WEB_FETCH_PARAMETERS } from '../../web/webFetchDefinition'
import { confineWorkspacePath } from '../../workspacePath'
import { compileGlob } from './glob'
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
import { SUBAGENT_TOOL_DEFINITIONS } from './subagentTools'
import { runChecksDefinition, THEN_RUN_PROPERTY } from './verifyTools'

export interface ShellResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly isTimedOut: boolean
  /** Stopped because the turn was (the Stop button, PLAN.md D25). */
  readonly isCancelled: boolean
  /** The command exceeded its per-stream byte budget (M51 hooks). */
  readonly isOutputTooLarge?: boolean
}

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
  readFile(absolutePath: string, expectedCanonicalPath?: string): Promise<string | undefined>
  /**
   * The file's bytes (M44: an image to edit); undefined when it does not
   * exist. Rejects, before reading, a file larger than `maxBytes`.
   */
  readBytes(
    absolutePath: string,
    maxBytes: number,
    expectedCanonicalPath?: string,
  ): Promise<Uint8Array | undefined>
  /** Replaces the file whole (a temporary file renamed into place), folders created. */
  writeFile(absolutePath: string, content: string, expectedCanonicalPath?: string): Promise<void>
  /**
   * `writeFile`, only while the file still holds the text whose fingerprint
   * is `expectedFingerprint`, compared immediately before the rename (M68,
   * `fsAtomic.writeFileIfUnchanged`): `changed`, and nothing written, when not.
   */
  writeFileIfUnchanged(
    absolutePath: string,
    expectedFingerprint: string,
    content: string,
    options: {
      readonly expectedCanonicalPath: string
      /** Refused when an editor holds unsaved text at any of them, checked just before the rename. */
      readonly unsavedAt: readonly string[]
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
  reserveFile(absolutePath: string, expectedCanonicalPath?: string): Promise<FileReservation>
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
   */
  runShell(
    command: string,
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
    limit?: ShellTimeLimit,
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
   * The canonical form of an absolute path: links, junctions and short
   * names resolved through the nearest existing ancestor (PLAN.md D24).
   * Rejects when the file system refuses to say (permissions, link loops).
   */
  realPath(absolutePath: string): Promise<string>
}

/** A new file held empty until its bytes arrive, or removed if they never do. */
export interface FileReservation {
  /** Writes the bytes into the file and lets it go. */
  fill(bytes: Uint8Array): Promise<void>
  /** Lets the file go and removes it (it is still empty). */
  release(): Promise<void>
}

export interface ToolContext {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: ToolIo
  /** The checked write destination shown to the permission gate before approval. */
  readonly approvedTarget?: {
    readonly absolute: string
    readonly checkedAbsolute: string
  }
  /** The turn's: aborting it stops a running command (PLAN.md D25). */
  readonly signal?: AbortSignal
  /** The shell's time limit, lifted when the command moves to the background (M46). */
  readonly limit?: ShellTimeLimit
  /**
   * The session's record of each file as the model last read or wrote it
   * (absolute path to a fingerprint): `write_file` replaces only what the
   * model has seen (D27).
   */
  readonly seen: Map<string, string>
  /** Format on edit (M68); present only while it is on. */
  readonly formatter?: EditFormatter
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
  /** The text the file's formatter makes of what the edit wrote, or undefined for none. */
  readonly format: (target: FormatTarget, text: string) => Promise<string | undefined>
  /** A formatted text that could not be written back, for the log. */
  readonly warn: (message: string) => void
}

/** What a conditional write did (M68): wrote the file, or found it changed and left it. */
export type ConditionalWrite = 'written' | 'changed'

/** A PDF or an image `read_file` read whole for the model to see (M54, PLAN.md D47). */
export interface VisibleFile {
  /** Workspace-relative, as the model named it. */
  readonly path: string
  readonly part: ImagePart | DocumentPart
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
  // M49 (PLAN.md D41): a memory write is judged as an edit, never a protected one.
  [MODEL_API_TOOLS.readMemory]: 'read',
  [MODEL_API_TOOLS.addMemory]: 'edit',
  [MODEL_API_TOOLS.editMemory]: 'edit',
  // The goal tools change only the session's goal (M45): no card, in any mode.
  [MODEL_API_TOOLS.createGoal]: 'interactive',
  [MODEL_API_TOOLS.getGoal]: 'interactive',
  [MODEL_API_TOOLS.updateGoal]: 'interactive',
  [MODEL_API_TOOLS.reportProgress]: 'interactive',
  // M68: the call itself asks nothing; each check it runs takes the shell
  // tool's permission path, one command at a time.
  [VERIFY_TOOLS.runChecks]: 'interactive',
  // M69 (PLAN.md D49): a network tool, asked per host.
  [MODEL_API_TOOLS.webFetch]: 'network',
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
const editFileArgs = z.object({ path: z.string(), find: z.string(), replace: z.string() })
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
  /** False in Restricted Mode: no shell tool is offered (PLAN.md D13). */
  readonly hasShell: boolean
  /** True when the workspace context holds at least one skill. */
  readonly hasSkills: boolean
  /** True while paid image generation is on (M34, PLAN.md D30). */
  readonly hasImageGeneration?: boolean
  /** Child sessions cannot spawn again (M48, PLAN.md D45). */
  readonly hasSubagents?: boolean
  /** Child sessions cannot ask the panel or set its task list. */
  readonly isSubagent?: boolean
  /** Muse Code's memory tools, trusted workspaces only (M49, PLAN.md D41). */
  readonly hasMemory?: boolean
  /** The user's check commands (M68): `run_checks` is offered with the shell while there are any. */
  readonly checks?: readonly CheckCommandSetting[]
  /** Web fetch, trusted workspaces only, when the host has a fetch (M69, PLAN.md D49). */
  readonly hasWebFetch?: boolean
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
  const thenRun = options.hasShell ? THEN_RUN_PROPERTY : {}
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
      'Replace one exact occurrence of `find` with `replace` in a file. `find` must match exactly once; include enough surrounding lines to make it unique.',
      {
        path: PATH_PROPERTY,
        find: { type: 'string', description: 'The exact text to replace' },
        replace: { type: 'string', description: 'The replacement text' },
        ...thenRun,
      },
      ['path', 'find', 'replace'],
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
    ...(options.hasMemory === true
      ? MEMORY_TOOL_DEFINITIONS.map((tool) =>
          define(tool.name, tool.description, tool.properties, tool.required),
        )
      : []),
    ...(options.hasWebFetch === true
      ? [define(MODEL_API_TOOLS.webFetch, WEB_FETCH_DESCRIPTION, WEB_FETCH_PARAMETERS, ['url'])]
      : []),
    ...(options.hasCodeIntel === true
      ? MODEL_API_CODE_INTEL_DEFINITIONS.map((tool) =>
          define(CODE_INTEL_TOOLS[tool.tool], tool.description, tool.properties, tool.required),
        )
      : []),
  ]
}

// --- helpers ---

function clip(text: string): string {
  return text.length > TOOL_OUTPUT_MAX_CHARS
    ? `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}${TOOL_OUTPUT_CLIP_MARKER}`
    : text
}

const LAST_BMP_CODE_POINT = 0xff_ff
// A shell result has two streams, each given half of the output budget; a
// clipped stream keeps half of its share from each end.
const SHELL_STREAMS = 2
const HALVES = 2

/** `index` moved back off the middle of a surrogate pair, so no character is split. */
function codePointBoundary(text: string, index: number): number {
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
  const formatted = await formatter?.format(target, written)
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
      { expectedCanonicalPath: target.checkedAbsolute, unsavedAt: paths },
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
  return isFormatted ? `${line}. ${MODEL_TEXT.formattedAfterEdit}` : line
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

/** The PDF, checked by its header, for the model to read whole (M54). */
function pdfOutcome(relative: string, bytes: Uint8Array): ToolOutcome {
  if (!isPdf(bytes)) {
    return failure(
      `${relative} ${MODEL_TEXT.notPdf}`,
      fill(UI_TEXT.toolReadPdfInvalid, { path: relative }),
    )
  }
  const pageCount = pdfPageCount(bytes)
  const output = fill(MODEL_TEXT.readPdf, {
    path: relative,
    pages:
      pageCount === undefined
        ? MODEL_TEXT.pagesUnknown
        : fill(MODEL_TEXT.pagesKnown, { count: String(pageCount) }),
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
      path: relative,
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
      `${relative} ${MODEL_TEXT.notImage}`,
      fill(UI_TEXT.toolReadImageInvalid, { path: relative }),
    )
  }
  const output = fill(MODEL_TEXT.readImage, {
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
      path: relative,
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

async function readFile(
  args: z.infer<typeof readFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const resolved = await confineWorkspacePath(
    context.workspaceRoot,
    args.path,
    context.platform,
    context.io,
  )
  if (!resolved.ok) {
    return failure(resolved.reason)
  }
  const visual = visualKindOf(resolved.relative)
  if (visual !== undefined) {
    return await readVisual(resolved, visual, context)
  }
  const raw = await context.io.readFile(resolved.checkedAbsolute, resolved.checkedAbsolute)
  if (raw === undefined) {
    return failure(`file not found: ${resolved.relative}`)
  }
  context.seen.set(resolved.absolute, fingerprint(raw))
  const lines = splitLines(modelText(raw, shapeOf(raw)))
  const start = Math.max((args.offset ?? 1) - 1, 0)
  const limit = Math.max(args.limit ?? READ_FILE_DEFAULT_LIMIT, 1)
  const shown = lines.slice(start, start + limit).map((line, index) => {
    const number = String(start + index + 1)
    const body =
      line.length > READ_FILE_MAX_LINE_CHARS ? `${line.slice(0, READ_FILE_MAX_LINE_CHARS)}…` : line
    return `${number}|${body}`
  })
  const remaining = lines.length - (start + shown.length)
  const tail = remaining > 0 ? `\n[${String(remaining)} more lines]` : ''
  const body = `Read text file \`${resolved.relative}\`.\n${shown.join('\n')}${tail}`
  return { output: clip(body), visibleOutput: clip(body) }
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
  if (
    context.approvedTarget !== undefined &&
    (resolved.absolute !== context.approvedTarget.absolute ||
      resolved.checkedAbsolute !== context.approvedTarget.checkedAbsolute)
  ) {
    return { ok: false, outcome: failure(MODEL_TEXT.pathChangedAfterApproval) }
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

/** Why an edit must not touch this file now, or undefined (D27). */
function editRefusal(
  file: { readonly relative: string; readonly absolute: string; readonly checkedAbsolute: string },
  context: ToolContext,
): ToolOutcome | undefined {
  // Writing under an editor's unsaved changes makes VS Code ask which to keep.
  return context.io.hasUnsavedChanges(file.absolute) ||
    context.io.hasUnsavedChanges(file.checkedAbsolute)
    ? failure(`${file.relative} ${MODEL_TEXT.fileHasUnsavedChanges}`)
    : undefined
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
  const { before, relative, absolute, checkedAbsolute } = file
  if (before === undefined) {
    await context.io.writeFile(checkedAbsolute, args.content, checkedAbsolute)
    const created = await formatWritten(args.content, file, context)
    context.seen.set(absolute, fingerprint(created))
    return patchOutcome(
      relative,
      undefined,
      created,
      `created ${relative}`,
      editedLine(
        `created ${relative} (${String(args.content.length)} characters)`,
        created !== args.content,
      ),
    )
  }
  // Claude Code's rule: a file is replaced only as the model last saw it (D27).
  if (context.seen.get(absolute) !== fingerprint(before)) {
    return failure(`${relative} ${MODEL_TEXT.fileChangedSinceRead}`)
  }
  // The file keeps its BOM, its line breaks and its final line break (D27).
  const shape = shapeOf(before)
  const normalized = toLf(args.content)
  const text =
    normalized !== '' && shape.hasTrailingBreak && !normalized.endsWith(LF)
      ? `${normalized}${LF}`
      : normalized
  const after = fileText(text, shape)
  await context.io.writeFile(checkedAbsolute, after, checkedAbsolute)
  const final = await formatWritten(after, file, context)
  context.seen.set(absolute, fingerprint(final))
  return patchOutcome(
    relative,
    modelText(before, shape),
    final === after ? text : modelText(final, shapeOf(final)),
    `wrote ${relative}`,
    editedLine(`wrote ${relative} (${String(args.content.length)} characters)`, final !== after),
  )
}

async function editFile(
  args: z.infer<typeof editFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const file = await located(args.path, context)
  if (!file.ok) {
    return file.outcome
  }
  const { before, relative, absolute, checkedAbsolute } = file
  if (before === undefined) {
    return failure(`file not found: ${relative}`)
  }
  const refusal = editRefusal(file, context)
  if (refusal !== undefined) {
    return refusal
  }
  if (args.find === '') {
    return failure('find must not be empty')
  }
  // The model reads LF lines without the BOM: the match runs on that text,
  // and the file gets its own BOM and line breaks back (D27).
  const shape = shapeOf(before)
  const current = modelText(before, shape)
  const find = shape.isCrlf ? toLf(args.find) : args.find
  const replace = shape.isCrlf ? toLf(args.replace) : args.replace
  const first = current.indexOf(find)
  if (first === -1) {
    return failure(`find text not found in ${relative}`)
  }
  if (current.includes(find, first + find.length)) {
    return failure(`find text occurs more than once in ${relative}; include more context`)
  }
  const updated = `${current.slice(0, first)}${replace}${current.slice(first + find.length)}`
  const after = fileText(updated, shape)
  await context.io.writeFile(checkedAbsolute, after, checkedAbsolute)
  const final = await formatWritten(after, file, context)
  context.seen.set(absolute, fingerprint(final))
  return patchOutcome(
    relative,
    current,
    final === after ? updated : modelText(final, shapeOf(final)),
    'edited',
    editedLine(`edited ${relative}`, final !== after),
  )
}

async function listMatching(
  context: ToolContext,
  glob: string | undefined,
): Promise<readonly string[]> {
  if (glob === undefined) {
    return await context.io.listFiles()
  }
  // Compiled before the listing, so a refused glob costs no file walk.
  const matches = compileGlob(glob)
  const files = await context.io.listFiles()
  return files.filter((file) => matches(file))
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
    files: searched.map((relative) => ({
      relative,
      absolute: p.join(context.workspaceRoot, ...relative.split('/')),
    })),
  })
  if (!outcome.ok) {
    return failure(outcome.reason)
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
  return { output: clip(body), visibleOutput: clip(body) }
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
  return { output: clip(body), visibleOutput: clip(body) }
}

async function shell(args: z.infer<typeof shellArgs>, context: ToolContext): Promise<ToolOutcome> {
  const timeoutMs = Math.min(
    Math.max(args.timeout_ms ?? SHELL_DEFAULT_TIMEOUT_MS, 1),
    SHELL_MAX_TIMEOUT_MS,
  )
  const result = await context.io.runShell(
    args.command,
    context.workspaceRoot,
    timeoutMs,
    context.signal,
    context.limit,
  )
  return shellOutcome(result, timeoutMs)
}

/**
 * What a finished command printed: each stream keeps its beginning and its
 * end within its share of the output budget (D27).
 */
export function shellText(result: ShellResult, maxChars: number = TOOL_OUTPUT_MAX_CHARS): string {
  const streamBudget = Math.floor(maxChars / SHELL_STREAMS)
  return [result.stdout.trimEnd(), result.stderr.trimEnd()]
    .filter((part) => part !== '')
    .map((part) => clipMiddle(part, streamBudget))
    .join('\n')
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
): ToolOutcome {
  let exit = `exit code ${String(result.exitCode ?? 'unknown')}`
  if (result.isCancelled) {
    exit = SHELL_STOPPED_BY_USER
  } else if (result.isTimedOut) {
    exit = `stopped after ${String(timeoutMs)} ms`
  }
  const body = `${shellText(result, maxChars)}\n[${exit}]`.trim()
  return {
    output: body,
    visibleOutput: body,
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
