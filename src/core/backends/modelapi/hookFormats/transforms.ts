// The named stdin field builders a contract table may use (contract.ts
// TransformName). Each is small and total: it returns a value, "absent", or a
// refusal with a reason. Nothing here guesses a field the source did not give.
import path from 'node:path'
import * as z from 'zod/mini'
import { type AdapterOptions, type ToolClass, type TransformName } from './contract'
import { isRecord, splitMcpName, textField } from './core'

export type TransformResult =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'absent' }
  | { readonly kind: 'refused'; readonly reason: string }

export interface TransformContext {
  readonly payload: Readonly<Record<string, unknown>>
  readonly options: AdapterOptions | undefined
  readonly toolNames: Readonly<Record<string, string>> | undefined
}

const ABSENT: TransformResult = { kind: 'absent' }
const MCP_TEMPLATE_KEY = '$mcp'

function value(item: unknown): TransformResult {
  return { kind: 'value', value: item }
}

function refused(reason: string): TransformResult {
  return { kind: 'refused', reason }
}

export function toolClassOf(tool: string): ToolClass {
  if (tool === 'bash' || tool === 'powershell') return 'shell'
  if (tool === 'read_file') return 'read'
  if (tool === 'write_file') return 'write'
  if (tool === 'edit_file') return 'edit'
  return splitMcpName(tool) === undefined ? 'other' : 'mcp'
}

function platformOf(options: AdapterOptions | undefined): NodeJS.Platform {
  return options?.platform ?? process.platform
}

function pathApi(platform: NodeJS.Platform): path.PlatformPath {
  return platform === 'win32' ? path.win32 : path.posix
}

/**
 * Windows forms whose meaning depends on hidden per-drive state or leaves the
 * filesystem namespace: drive-relative `D:x` / `D:`, drive-less rooted `\x`,
 * UNC `\\server\share` and device `\\?\` / `\\.\` paths. Refused everywhere.
 */
export function isAmbiguousWindowsPath(candidate: string, platform: NodeJS.Platform): boolean {
  return (
    platform === 'win32' &&
    (/^[a-z]:($|[^\\/])/i.test(candidate) ||
      /^[\\/]{2}/.test(candidate) ||
      /^[\\/](?![\\/])/.test(candidate))
  )
}

function absoluteRoot(ctx: TransformContext): string | undefined {
  const platform = platformOf(ctx.options)
  const p = pathApi(platform)
  const root = ctx.options?.workspaceRoot ?? textField(ctx.payload, 'cwd')
  return root === undefined || isAmbiguousWindowsPath(root, platform) || !p.isAbsolute(root)
    ? undefined
    : p.resolve(root)
}

type CheckedPath =
  | { readonly ok: true; readonly text: string; readonly p: path.PlatformPath }
  | { readonly ok: false; readonly result: TransformResult }

/** A non-empty string path in an unambiguous form for the target platform. */
function checkedPath(candidate: unknown, ctx: TransformContext, label: string): CheckedPath {
  if (typeof candidate !== 'string' || candidate === '') return { ok: false, result: ABSENT }
  const platform = platformOf(ctx.options)
  return isAmbiguousWindowsPath(candidate, platform)
    ? {
        ok: false,
        result: refused(`${label} is an ambiguous Windows path (drive-relative, UNC or device)`),
      }
    : { ok: true, text: candidate, p: pathApi(platform) }
}

/** A path the tool would read, made absolute against the workspace root. */
function absolutePath(candidate: unknown, ctx: TransformContext): TransformResult {
  const checked = checkedPath(candidate, ctx, 'path')
  if (!checked.ok) return checked.result
  const { text, p } = checked
  if (p.isAbsolute(text)) return value(p.resolve(text))
  const root = absoluteRoot(ctx)
  return root === undefined
    ? refused('a relative path needs an absolute workspace root')
    : value(p.resolve(root, text))
}

function isInside(root: string, target: string, p: path.PlatformPath): boolean {
  const relative = p.relative(root, target)
  return !(relative === '..' || relative.startsWith(`..${p.sep}`) || p.isAbsolute(relative))
}

/**
 * The agent's working directory: absolute and inside the workspace root
 * (`options.workspaceRoot`, else the payload's own cwd). Lexical only; lane W
 * realpath-confines links and junctions before spawning anything there.
 */
function containedCwd(candidate: unknown, ctx: TransformContext): TransformResult {
  const checked = checkedPath(candidate, ctx, 'cwd')
  if (!checked.ok) return checked.result
  const { text, p } = checked
  const root = absoluteRoot(ctx)
  if (root === undefined) return refused('cwd needs an absolute workspace root')
  const absolute = p.resolve(root, text)
  return isInside(root, absolute, p) ? value(absolute) : refused('cwd is not workspace-confined')
}

/**
 * The hook DEFINITION's working directory (vsc/hooks-reference.md:61 "relative
 * to the repository root"; lane-common round 2 P): relative and confined, as
 * round 2 established. Lane W uses it before spawning; it is not stdin.
 */
export function confineHookCwd(
  cwd: string,
  workspaceRoot: string | undefined,
  platform: NodeJS.Platform,
): string | undefined {
  const p = pathApi(platform)
  if (platform === 'win32' && (/^[a-z]:($|[^\\/])/i.test(cwd) || /^[\\/]{2}/.test(cwd)))
    return undefined
  if (workspaceRoot === undefined) {
    if (p.isAbsolute(cwd)) return undefined
    const normalized = p.normalize(cwd)
    return normalized === '..' || normalized.startsWith(`..${p.sep}`) ? undefined : normalized
  }
  if (!p.isAbsolute(workspaceRoot)) return undefined
  // resolve drops trailing separators but keeps filesystem roots; win32
  // relative compares drives and segments case-insensitively.
  const root = p.resolve(workspaceRoot)
  const absolute = p.resolve(root, cwd)
  if (!isInside(root, absolute, p)) return undefined
  const relative = p.relative(root, absolute)
  return relative === '' ? '.' : relative
}

function toolName(candidate: unknown, ctx: TransformContext): TransformResult {
  if (typeof candidate !== 'string') return ABSENT
  const names = ctx.toolNames ?? {}
  const direct = names[candidate]
  if (direct !== undefined) return value(direct)
  const mcp = splitMcpName(candidate)
  const template = names[MCP_TEMPLATE_KEY]
  if (mcp !== undefined && template !== undefined)
    return value(template.split('{server}').join(mcp.server).split('{tool}').join(mcp.tool))
  // A tool with no vendor equivalent keeps its runtime name
  // (gh/copilot_reference_hooks-configuration.md:448).
  return value(candidate)
}

function timestamp(candidate: unknown, isIso: boolean): TransformResult {
  if (candidate === undefined) return ABSENT
  const epoch = typeof candidate === 'string' ? Date.parse(candidate) : candidate
  if (typeof epoch !== 'number' || !Number.isFinite(epoch)) return refused('invalid timestamp')
  const date = new Date(epoch)
  if (!Number.isFinite(date.getTime())) return refused('invalid timestamp')
  return value(isIso ? date.toISOString() : epoch)
}

function editsArray(candidate: unknown): TransformResult {
  if (!isRecord(candidate)) return ABSENT
  const old = textField(candidate, 'find') ?? textField(candidate, 'old_string')
  const replacement = textField(candidate, 'replace') ?? textField(candidate, 'new_string')
  return old === undefined || replacement === undefined
    ? ABSENT
    : value([{ old_string: old, new_string: replacement }])
}

function absoluteAttachments(candidate: unknown, ctx: TransformContext): TransformResult {
  if (!Array.isArray(candidate)) return ABSENT
  const out: Record<string, unknown>[] = []
  for (const entry of candidate as readonly unknown[]) {
    if (!isRecord(entry)) return refused('attachment is not an object')
    const file = absolutePath(entry['file_path'], ctx)
    if (file.kind !== 'value') return refused('attachment file_path is not absolute')
    out.push({ ...entry, file_path: file.value })
  }
  return value(out)
}

// BeforeTool.read_file(.line-range), .run_shell_command and .grep_search
// captures establish these arguments. hooks-best-practices.md:174-184 shows
// write_file's file_path/content. Unknown fields refuse rather than disappear.
const GEMINI_SHELL_INPUT = z.strictObject({
  command: z.string(),
  description: z.optional(z.string()),
})
const GEMINI_READ_INPUT = z.strictObject({
  path: z.string(),
  offset: z.optional(z.int().check(z.gte(1))),
  limit: z.optional(z.int().check(z.gte(1))),
})
const GEMINI_WRITE_INPUT = z.strictObject({ path: z.string(), content: z.string() })
const GEMINI_SEARCH_INPUT = z.strictObject({ pattern: z.string() })

function geminiToolInput(candidate: unknown, ctx: TransformContext): TransformResult {
  if (candidate === undefined) return ABSENT
  const tool = textField(ctx.payload, 'tool_name')
  if (tool !== undefined && splitMcpName(tool) !== undefined)
    return isRecord(candidate) ? value(candidate) : refused('MCP arguments must be an object')
  if (tool === 'bash' || tool === 'powershell') {
    const parsed = GEMINI_SHELL_INPUT.safeParse(candidate)
    return parsed.success ? value(parsed.data) : refused('unsupported shell arguments')
  }
  if (tool === 'read_file') {
    const parsed = GEMINI_READ_INPUT.safeParse(candidate)
    if (!parsed.success) return refused('unsupported read_file arguments')
    const { path: file, offset, limit } = parsed.data
    const end = limit === undefined ? undefined : (offset ?? 1) + (limit - 1)
    if (end !== undefined && !Number.isSafeInteger(end)) return refused('invalid read range')
    return value({
      file_path: file,
      ...(offset !== undefined && { start_line: offset }),
      ...(end !== undefined && { end_line: end }),
    })
  }
  if (tool === 'write_file') {
    const parsed = GEMINI_WRITE_INPUT.safeParse(candidate)
    return parsed.success
      ? value({ file_path: parsed.data.path, content: parsed.data.content })
      : refused('unsupported write_file arguments')
  }
  if (tool === 'search') {
    const parsed = GEMINI_SEARCH_INPUT.safeParse(candidate)
    return parsed.success ? value(parsed.data) : refused('unsupported search arguments')
  }
  // replace has no captured full argument schema; list_directory is not Muse's
  // recursive glob operation. Neither may silently run without its guard.
  return refused(`unsupported Gemini tool arguments: ${tool ?? 'missing tool'}`)
}

export function applyTransform(
  name: TransformName,
  candidate: unknown,
  ctx: TransformContext,
): TransformResult {
  switch (name) {
    case 'copy': {
      return candidate === undefined ? ABSENT : value(candidate)
    }
    case 'text': {
      return typeof candidate === 'string' ? value(candidate) : ABSENT
    }
    case 'absolutePath': {
      return absolutePath(candidate, ctx)
    }
    case 'containedCwd': {
      return containedCwd(candidate, ctx)
    }
    case 'json': {
      return candidate === undefined ? ABSENT : value(JSON.stringify(candidate))
    }
    case 'toolName': {
      return toolName(candidate, ctx)
    }
    case 'mcpServer':
    case 'mcpTool': {
      const mcp = typeof candidate === 'string' ? splitMcpName(candidate) : undefined
      if (mcp === undefined) return ABSENT
      return value(name === 'mcpServer' ? mcp.server : mcp.tool)
    }
    case 'epochMs':
    case 'isoTime': {
      return timestamp(candidate, name === 'isoTime')
    }
    case 'editsArray': {
      return editsArray(candidate)
    }
    case 'wrapArray': {
      return typeof candidate === 'string' ? value([candidate]) : ABSENT
    }
    case 'absoluteAttachments': {
      return absoluteAttachments(candidate, ctx)
    }
    case 'geminiToolInput': {
      return geminiToolInput(candidate, ctx)
    }
  }
}
