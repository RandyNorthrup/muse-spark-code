// The in-process tool harness of the Model API backend (PLAN.md M7): the
// function tools the model sees, their argument validation, and their
// execution over an injected `ToolIo` (the host supplies the file system
// and the shell). Every path is confined to the workspace root; edits
// leave a patch document shaped like Muse Code's so the transcript rows,
// Open diff and Revert (M5) work unchanged.

import path from 'node:path'
import * as z from 'zod/mini'
import {
  type PatchSummary,
  type Question,
  questionSchema,
  todoItemSchema,
} from '../../../shared/agentEvents'
import {
  LIST_FILES_DEFAULT_LIMIT,
  MODEL_API_TOOLS,
  READ_FILE_DEFAULT_LIMIT,
  READ_FILE_MAX_LINE_CHARS,
  SEARCH_MAX_RESULTS,
  SEARCH_PATTERN_MAX_LENGTH,
  SHELL_DEFAULT_TIMEOUT_MS,
  SHELL_MAX_TIMEOUT_MS,
  TOOL_OUTPUT_CLIP_MARKER,
  TOOL_OUTPUT_MAX_CHARS,
} from '../../../shared/constants'
import {
  ADD_MARKER,
  type PatchFile,
  type PatchHunk,
  REMOVE_MARKER,
} from '../../../shared/patchDocument'
import { isGlobMatch } from './glob'
import type { ToolClass } from './permissions'
import type { FunctionToolDefinition } from './schemas'

export interface ShellResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly isTimedOut: boolean
}

/** One `search` run: the model's pattern over the files that passed the glob. */
export interface SearchJob {
  readonly pattern: string
  readonly files: readonly { readonly relative: string; readonly absolute: string }[]
}

export interface SearchHit {
  readonly file: string
  /** 1-based. */
  readonly line: number
  readonly text: string
}

export type SearchOutcome =
  | { readonly ok: true; readonly hits: readonly SearchHit[] }
  | { readonly ok: false; readonly reason: string }

/** What the host lends the tools: files, a matcher it can stop, and a shell. */
export interface ToolIo {
  /** undefined when the file does not exist. */
  readFile(absolutePath: string): Promise<string | undefined>
  writeFile(absolutePath: string, content: string): Promise<void>
  /** Workspace-relative, forward-slash paths of every listed file. */
  listFiles(): Promise<readonly string[]>
  /** The names of the subdirectories of an absolute path; empty when it is missing. */
  listDirectory(absolutePath: string): Promise<readonly string[]>
  /** Evaluates the pattern off the host thread with a time budget (ReDoS containment). */
  searchFiles(job: SearchJob): Promise<SearchOutcome>
  runShell(command: string, cwd: string, timeoutMs: number): Promise<ShellResult>
}

export interface ToolContext {
  readonly workspaceRoot: string
  readonly platform: NodeJS.Platform
  readonly io: ToolIo
}

export interface ToolOutcome {
  /** What the model receives as the function result. */
  readonly output: string
  /** What the transcript row shows. */
  readonly visibleOutput: string
  readonly failureReason?: string
  /** Edit-family tools: the stored patch document and its summary. */
  readonly patch?: { readonly document: string; readonly summary: PatchSummary }
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
export const todoWriteArgs = z.object({ items: z.array(todoItemSchema) })

const PATH_PROPERTY = { type: 'string', description: 'Workspace-relative path' }

export interface ToolDefinitionOptions {
  /** False in Restricted Mode: no shell tool is offered (PLAN.md D13). */
  readonly hasShell: boolean
  /** True when the workspace context holds at least one skill. */
  readonly hasSkills: boolean
}

const DEFAULT_TOOL_OPTIONS: ToolDefinitionOptions = { hasShell: true, hasSkills: false }

/** The function tools offered to the model (dev.meta.ai/docs/tool-calling). */
export function toolDefinitions(
  platform: NodeJS.Platform,
  options: ToolDefinitionOptions = DEFAULT_TOOL_OPTIONS,
): readonly FunctionToolDefinition[] {
  const shell = shellToolFor(platform)
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
      'Read a text file from the workspace, numbered by line. Use offset and limit for long files.',
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
      },
      ['path', 'find', 'replace'],
    ),
    define(
      MODEL_API_TOOLS.writeFile,
      'Create or overwrite a file with the given content.',
      { path: PATH_PROPERTY, content: { type: 'string' } },
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
  ]
}

// --- paths ---

export type PathResolution =
  | { readonly ok: true; readonly absolute: string; readonly relative: string }
  | { readonly ok: false; readonly reason: string }

/** Resolves a model-given path inside the workspace, refusing escapes. */
export function resolveWorkspacePath(
  workspaceRoot: string,
  given: string,
  platform: NodeJS.Platform,
): PathResolution {
  const p = platform === 'win32' ? path.win32 : path.posix
  const absolute = p.resolve(workspaceRoot, given)
  const relative = p.relative(workspaceRoot, absolute)
  return relative === '' || relative.startsWith('..') || p.isAbsolute(relative)
    ? { ok: false, reason: `path ${given} is outside the workspace` }
    : { ok: true, absolute, relative: relative.split(p.sep).join('/') }
}

// --- helpers ---

function clip(text: string): string {
  return text.length > TOOL_OUTPUT_MAX_CHARS
    ? `${text.slice(0, TOOL_OUTPUT_MAX_CHARS)}${TOOL_OUTPUT_CLIP_MARKER}`
    : text
}

function failure(reason: string): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: reason, failureReason: reason }
}

function argumentFailure(error: z.core.$ZodError): ToolOutcome {
  return failure(`invalid arguments: ${z.prettifyError(error)}`)
}

const LINE_BREAK = /\r?\n/

function splitLines(text: string): string[] {
  const lines = text.split(LINE_BREAK)
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** The minimal hunk between two texts: common prefix and suffix trimmed. */
function hunkBetween(before: string, after: string): PatchHunk | undefined {
  const old = splitLines(before)
  const updated = splitLines(after)
  let start = 0
  while (start < old.length && start < updated.length && old[start] === updated[start]) {
    start += 1
  }
  let oldEnd = old.length
  let newEnd = updated.length
  while (oldEnd > start && newEnd > start && old[oldEnd - 1] === updated[newEnd - 1]) {
    oldEnd -= 1
    newEnd -= 1
  }
  const removed = old.slice(start, oldEnd)
  const added = updated.slice(start, newEnd)
  if (removed.length === 0 && added.length === 0) {
    return undefined
  }
  return {
    oldStart: removed.length === 0 ? 0 : start + 1,
    oldLines: removed.length,
    newStart: start + 1,
    newLines: added.length,
    lines: [
      ...removed.map((line) => `${REMOVE_MARKER}${line}`),
      ...added.map((line) => `${ADD_MARKER}${line}`),
    ],
  }
}

function patchOutcome(
  relativePath: string,
  before: string | undefined,
  after: string,
  visibleOutput: string,
  output: string,
): ToolOutcome {
  const hunk = hunkBetween(before ?? '', after)
  const hunks = hunk === undefined ? [] : [hunk]
  const file: PatchFile = { path: relativePath, hunks }
  const added = hunk?.newLines ?? 0
  const removed = hunk?.oldLines ?? 0
  const diff =
    hunk === undefined ? '' : `\n--- original\n+++ updated\n@@\n${hunk.lines.join('\n')}\n`
  return {
    output,
    visibleOutput: `${visibleOutput}${diff}`,
    patch: { document: JSON.stringify({ files: [file] }), summary: { files: 1, added, removed } },
  }
}

// --- executors ---

async function readFile(
  args: z.infer<typeof readFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const resolved = resolveWorkspacePath(context.workspaceRoot, args.path, context.platform)
  if (!resolved.ok) {
    return failure(resolved.reason)
  }
  const text = await context.io.readFile(resolved.absolute)
  if (text === undefined) {
    return failure(`file not found: ${resolved.relative}`)
  }
  const lines = splitLines(text)
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
      readonly absolute: string
      readonly before: string | undefined
    }
  | { readonly ok: false; readonly outcome: ToolOutcome }
> {
  const resolved = resolveWorkspacePath(context.workspaceRoot, given, context.platform)
  if (!resolved.ok) {
    return { ok: false, outcome: failure(resolved.reason) }
  }
  const before = await context.io.readFile(resolved.absolute)
  return { ok: true, relative: resolved.relative, absolute: resolved.absolute, before }
}

async function writeFile(
  args: z.infer<typeof writeFileArgs>,
  context: ToolContext,
): Promise<ToolOutcome> {
  const file = await located(args.path, context)
  if (!file.ok) {
    return file.outcome
  }
  await context.io.writeFile(file.absolute, args.content)
  const verb = file.before === undefined ? 'created' : 'wrote'
  return patchOutcome(
    file.relative,
    file.before,
    args.content,
    `${verb} ${file.relative}`,
    `${verb} ${file.relative} (${String(args.content.length)} characters)`,
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
  const { before, relative, absolute } = file
  if (before === undefined) {
    return failure(`file not found: ${relative}`)
  }
  if (args.find === '') {
    return failure('find must not be empty')
  }
  const first = before.indexOf(args.find)
  if (first === -1) {
    return failure(`find text not found in ${relative}`)
  }
  if (before.includes(args.find, first + args.find.length)) {
    return failure(`find text occurs more than once in ${relative}; include more context`)
  }
  const after = `${before.slice(0, first)}${args.replace}${before.slice(first + args.find.length)}`
  await context.io.writeFile(absolute, after)
  return patchOutcome(relative, before, after, 'edited', `edited ${relative}`)
}

async function listMatching(
  context: ToolContext,
  glob: string | undefined,
): Promise<readonly string[]> {
  const files = await context.io.listFiles()
  return glob === undefined ? files : files.filter((file) => isGlobMatch(file, glob))
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
  const outcome = await context.io.searchFiles({
    pattern: args.pattern,
    files: candidates.map((relative) => ({
      relative,
      absolute: p.join(context.workspaceRoot, ...relative.split('/')),
    })),
  })
  if (!outcome.ok) {
    return failure(outcome.reason)
  }
  const results = searchLines(outcome.hits, mode, limit)
  const body = results.length === 0 ? 'No matches.' : results.join('\n')
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
  const result = await context.io.runShell(args.command, context.workspaceRoot, timeoutMs)
  const parts = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter((part) => part !== '')
  const exit = result.isTimedOut
    ? `stopped after ${String(timeoutMs)} ms`
    : `exit code ${String(result.exitCode ?? 'unknown')}`
  const body = clip(`${parts.join('\n')}\n[${exit}]`.trim())
  return {
    output: body,
    visibleOutput: body,
    ...(result.isTimedOut && { failureReason: exit }),
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
