// The other agents' shapes converted to Muse Code's (M83, PLAN.md D49).
// Every file is parsed and then checked with a zod schema before a field
// is used; a parse failure is reported in fixed words, never with the
// parser's message, which can quote the file (and a secret in it).
//
// - MCP servers: Claude Code's `.claude.json` (user and local scope) and
//   `.mcp.json`, Cursor's `mcp.json`, Codex's `config.toml`. The converted
//   entry is the one Muse Code 1.4.0-R4302.1's bundled `migrate` skill
//   writes: `type: "stdio"` with `command`, `args`, `env`, or `type:
//   "streamable-http"` with `url` and `headers`, always `mode:
//   "optional"`; Codex's `enabled`, `tool_timeout_sec`,
//   `startup_timeout_sec`, `enabled_tools` and `disabled_tools` copy under
//   the same names. A server that is turned off is skipped, and so is one
//   that needs what Muse Code lacks (`sse`, `ws` and `sdk` transports,
//   OAuth, header helpers) or has a blank command. Every other field is
//   named as not carried over. Only the active transport's fields are
//   copied; values stay unchanged under the exposure rule (PLAN.md D64).
// - Hooks: Claude Code's settings `hooks` block, whose shape Muse Code
//   shares (M51). An event Muse Code also has converts with its matcher
//   kept (Muse Code's matchers take Claude Code's tool names for its own
//   tools), except where Claude Code ignores a matcher; a handler converts
//   only as a plain `command` with `timeout`, `async` and `statusMessage`,
//   so nothing it narrowed (`if`, `args`, `shell`) is widened.
// - Commands become SKILL.md files, rules files AGENTS.md sections.
// Pure; no `vscode` import.

import { parse as parseToml } from 'smol-toml'
import * as z from 'zod/mini'
import {
  AGENT_IMPORT_CLAUDE_SPARK_EVENTS,
  AGENT_IMPORT_CLINE_EVENTS,
  AGENT_IMPORT_CODEX_EVENTS,
  AGENT_IMPORT_COPILOT_EVENTS,
  AGENT_IMPORT_CURSOR_EVENTS,
  AGENT_IMPORT_CURSOR_TOOLS,
  AGENT_IMPORT_FORMATS,
  AGENT_IMPORT_GEMINI_EVENTS,
  AGENT_IMPORT_GEMINI_TOOLS,
  AGENT_IMPORT_HOOK_EVENTS,
  AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER,
  AGENT_IMPORT_JSON_EXTENSION,
  AGENT_IMPORT_KIRO_EVENTS,
  AGENT_IMPORT_KIRO_FILE_MATCHER,
  AGENT_IMPORT_KIRO_FILE_TRIGGERS,
  AGENT_IMPORT_KIRO_TASK_EVENTS,
  AGENT_IMPORT_KIRO_TOOLS,
  AGENT_IMPORT_WINDSURF_EVENTS,
  HOOK_MAX_TIMEOUT_SECONDS,
  MCP_TRANSPORTS,
  MODEL_TEXT,
  MUSE_MCP_OPTIONAL_MODE,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/**
 * Why an entry that was found is not converted. The lane-0 preview keys name
 * the reason in the user's language: `weaker` is `agentImportSkippedWeaker`,
 * `chooses` is `agentImportSkippedChooses`, `needsMatcher` is
 * `agentImportSkippedNeedsMatcher`, `unknownFormat` is
 * `agentImportSkippedUnknownFormat`, `keptWaiting` is `agentImportKeptWaiting`,
 * `notify` is `agentImportSkippedNotify`, and `field` is
 * `agentImportSkippedField` with the refusing field in `Conversion.field`.
 */
export type ConversionRefusal =
  | 'disabled'
  | 'unsupported'
  | 'unmapped'
  | 'weaker'
  | 'chooses'
  | 'needsMatcher'
  | 'unknownFormat'
  | 'keptWaiting'
  | 'notify'
  | 'field'

export type Conversion<T> =
  | { readonly ok: true; readonly value: T; readonly dropped: readonly string[] }
  | {
      readonly ok: false
      readonly reason: ConversionRefusal
      /** Set only with `field`: the source's field with no equivalent here. */
      readonly field?: string | undefined
    }

/** A whole entry refused for one field it sets; the preview names the field. */
function fieldRefusal(field: string): Conversion<never> {
  return { ok: false, reason: 'field', field }
}

/** A Muse Code `mcpServers` entry, its active values unchanged. */
export type MuseMcpEntry = Readonly<Record<string, unknown>>

/** A server as the file names it, before conversion. */
export interface FoundServer {
  readonly name: string
  readonly raw: unknown
}

type JsonObject = Readonly<Record<string, unknown>>

const MATCH_EVERYTHING: ReadonlySet<string> = new Set(['', '*'])
const HTTP_TYPES: ReadonlySet<string> = new Set(['http', 'streamable-http', 'streamable_http'])
const COMMAND_HANDLER = 'command'
const OAUTH = 'oauth'
const LINE_BREAK = /\r?\n/
const FENCE = '---'
const FIELD_SEPARATOR = ':'
const WHITESPACE_RUN = /\s+/g

function describeFields(raw: JsonObject, carried: ReadonlySet<string>): readonly string[] {
  return Object.keys(raw).filter((key) => !carried.has(key))
}

// --- MCP servers ---

const serverTable = z.record(z.string(), z.unknown())
const stringList = z.array(z.string())
const stringTable = z.record(z.string(), z.string())

const jsonServerSchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  args: z.optional(stringList),
  env: z.optional(stringTable),
  url: z.optional(z.string()),
  headers: z.optional(stringTable),
  enabled: z.optional(z.boolean()),
})
const JSON_STDIO: ReadonlySet<string> = new Set(['type', 'command', 'args', 'env', 'enabled'])
const JSON_HTTP: ReadonlySet<string> = new Set(['type', 'url', 'headers', 'enabled'])
const JSON_UNSUPPORTED = ['oauth', 'headersHelper'] as const

const codexServerSchema = z.looseObject({
  command: z.optional(z.string()),
  args: z.optional(stringList),
  env: z.optional(stringTable),
  url: z.optional(z.string()),
  http_headers: z.optional(stringTable),
  enabled: z.optional(z.boolean()),
  auth: z.optional(z.string()),
  tool_timeout_sec: z.optional(z.number()),
  startup_timeout_sec: z.optional(z.number()),
  enabled_tools: z.optional(stringList),
  disabled_tools: z.optional(stringList),
})
const CODEX_COPIED = [
  'enabled',
  'tool_timeout_sec',
  'startup_timeout_sec',
  'enabled_tools',
  'disabled_tools',
] as const
const CODEX_STDIO: ReadonlySet<string> = new Set(['command', 'args', 'env', ...CODEX_COPIED])
const CODEX_HTTP: ReadonlySet<string> = new Set(['url', 'http_headers', ...CODEX_COPIED])
const CODEX_UNSUPPORTED = ['http_headers_helper'] as const

type StringTable = Readonly<Record<string, string>>

/** Only the active transport's fields are copied, unchanged. */
function stdioEntry(
  server: { readonly command: string; readonly args?: readonly string[] | undefined },
  env: StringTable | undefined,
): Conversion<Record<string, unknown>> {
  return {
    ok: true,
    value: {
      type: MCP_TRANSPORTS.stdio,
      command: server.command,
      ...(server.args !== undefined && { args: server.args }),
      ...(env !== undefined && { env }),
      mode: MUSE_MCP_OPTIONAL_MODE,
    },
    dropped: [],
  }
}

function httpEntry(
  url: string,
  headers: StringTable | undefined,
): Conversion<Record<string, unknown>> {
  try {
    new URL(url)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }
  return {
    ok: true,
    value: {
      type: MCP_TRANSPORTS.streamableHttp,
      url,
      ...(headers !== undefined && { headers }),
      mode: MUSE_MCP_OPTIONAL_MODE,
    },
    dropped: [],
  }
}

/** A converted entry with the source's fields that are not carried over, and anything it copies as it is. */
function withFields(
  conversion: Conversion<Record<string, unknown>>,
  dropped: readonly string[],
  copied: Readonly<Record<string, unknown>> = {},
): Conversion<MuseMcpEntry> {
  return conversion.ok
    ? { ok: true, value: { ...conversion.value, ...copied }, dropped }
    : conversion
}

function hasCommand(command: string | undefined): command is string {
  return command !== undefined && command.trim() !== ''
}

type Admission<T> =
  | { readonly isAdmitted: true; readonly server: T }
  | { readonly isAdmitted: false; readonly refusal: Conversion<never> }

/** A server entry checked by its schema: unreadable or needing what Muse Code lacks, or turned off. */
function admit<T extends { readonly enabled?: boolean | undefined }>(
  schema: z.ZodMiniType<T>,
  raw: unknown,
  isUnsupported: (server: T) => boolean,
): Admission<T> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return { isAdmitted: false, refusal: { ok: false, reason: 'unsupported' } }
  }
  if (parsed.data.enabled === false) {
    return { isAdmitted: false, refusal: { ok: false, reason: 'disabled' } }
  }
  return isUnsupported(parsed.data)
    ? { isAdmitted: false, refusal: { ok: false, reason: 'unsupported' } }
    : { isAdmitted: true, server: parsed.data }
}

/** A Claude Code or Cursor server entry as Muse Code's, its active values unchanged. */
export function convertJsonServer(raw: unknown): Conversion<MuseMcpEntry> {
  const admission = admit(jsonServerSchema, raw, (entry) =>
    JSON_UNSUPPORTED.some((key) => Object.hasOwn(entry, key)),
  )
  if (!admission.isAdmitted) {
    return admission.refusal
  }
  const { server } = admission
  // Claude Code's rule: no type is stdio; Cursor's remote servers give a URL alone.
  const declared =
    server.type ?? (server.command === undefined && server.url !== undefined ? 'http' : 'stdio')
  const { command } = server
  if (declared === MCP_TRANSPORTS.stdio && hasCommand(command)) {
    return withFields(
      stdioEntry({ command, args: server.args }, server.env),
      describeFields(server, JSON_STDIO),
    )
  }
  return HTTP_TYPES.has(declared) && server.url !== undefined
    ? withFields(httpEntry(server.url, server.headers), describeFields(server, JSON_HTTP))
    : { ok: false, reason: 'unsupported' }
}

/** A Codex `[mcp_servers.<name>]` table as Muse Code's entry, its active values unchanged. */
export function convertCodexServer(raw: unknown): Conversion<MuseMcpEntry> {
  const admission = admit(
    codexServerSchema,
    raw,
    (entry) => entry.auth === OAUTH || CODEX_UNSUPPORTED.some((key) => Object.hasOwn(entry, key)),
  )
  if (!admission.isAdmitted) {
    return admission.refusal
  }
  const { server } = admission
  const copied = Object.fromEntries(
    CODEX_COPIED.flatMap((key) => (server[key] === undefined ? [] : [[key, server[key]]])),
  )
  if (server.url !== undefined) {
    return withFields(
      httpEntry(server.url, server.http_headers),
      describeFields(server, CODEX_HTTP),
      copied,
    )
  }
  const { command } = server
  return hasCommand(command)
    ? withFields(
        stdioEntry({ command, args: server.args }, server.env),
        describeFields(server, CODEX_STDIO),
        copied,
      )
    : { ok: false, reason: 'unsupported' }
}

/** A file's text as JSON; undefined when it is not. */
function parseJson(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text)
    return value
  } catch {
    return undefined
  }
}

function serversOf(table: Readonly<Record<string, unknown>> | undefined): readonly FoundServer[] {
  return table === undefined ? [] : Object.entries(table).map(([name, raw]) => ({ name, raw }))
}

const mcpFileSchema = z.looseObject({ mcpServers: z.optional(serverTable) })

/** The servers of a `.mcp.json` or Cursor `mcp.json`; undefined when the file is not one. */
export function readMcpFile(text: string): readonly FoundServer[] | undefined {
  const parsed = mcpFileSchema.safeParse(parseJson(text))
  return parsed.success ? serversOf(parsed.data.mcpServers) : undefined
}

const claudeStateSchema = z.looseObject({
  mcpServers: z.optional(serverTable),
  projects: z.optional(z.record(z.string(), z.unknown())),
})
const claudeProjectSchema = z.looseObject({ mcpServers: z.optional(serverTable) })

function windowsPathKey(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase()
}

/** Claude Code keys a project by its path with forward slashes, in either drive-letter case. */
function isSameProjectPath(key: string, root: string, platform: NodeJS.Platform): boolean {
  return platform === 'win32' ? windowsPathKey(key) === windowsPathKey(root) : key === root
}

/**
 * Claude Code's `.claude.json`: the user-scope servers and, for the open
 * workspace, the local-scope ones (the user's own for that project). Only
 * those two keys are read; the file's account and usage data are not.
 */
export function readClaudeState(
  text: string,
  workspaceRoot: string | undefined,
  platform: NodeJS.Platform,
): { readonly user: readonly FoundServer[]; readonly local: readonly FoundServer[] } | undefined {
  const parsed = claudeStateSchema.safeParse(parseJson(text))
  if (!parsed.success) {
    return undefined
  }
  const projects = parsed.data.projects ?? {}
  const local =
    workspaceRoot === undefined
      ? []
      : Object.entries(projects)
          .filter(([key]) => isSameProjectPath(key, workspaceRoot, platform))
          .flatMap(([, entry]) => {
            const project = claudeProjectSchema.safeParse(entry)
            return project.success ? serversOf(project.data.mcpServers) : []
          })
  return { user: serversOf(parsed.data.mcpServers), local }
}

const codexConfigSchema = z.looseObject({ mcp_servers: z.optional(serverTable) })

/** The `[mcp_servers.<name>]` tables of a Codex `config.toml`; undefined when it is not TOML. */
export function readCodexConfig(text: string): readonly FoundServer[] | undefined {
  let document: unknown
  try {
    document = parseToml(text)
  } catch {
    return undefined
  }
  const parsed = codexConfigSchema.safeParse(document)
  return parsed.success ? serversOf(parsed.data.mcp_servers) : undefined
}

// --- Hooks ---

const settingsHooksSchema = z.looseObject({
  hooks: z.optional(z.record(z.string(), z.array(z.unknown()))),
})
const hookGroupSchema = z.looseObject({
  matcher: z.optional(z.string()),
  hooks: z.array(z.unknown()),
})
const hookHandlerSchema = z.object({
  type: z.string(),
  command: z.optional(z.string()),
  timeout: z.optional(z.number()),
  async: z.optional(z.boolean()),
  statusMessage: z.optional(z.string()),
})
const HANDLER_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'command',
  'timeout',
  'async',
  'statusMessage',
])

/** One Claude Code hook handler with the event and matcher of its group. */
export interface FoundHook {
  readonly event: string
  readonly matcher: string | undefined
  readonly raw: unknown
}

/** A converted hook: the event and the group Muse Code's `hooks` block takes. */
export interface MuseHook {
  readonly event: string
  readonly group: Readonly<Record<string, unknown>>
}

/** Every handler of a Claude-shaped `hooks` block; undefined when the file is not one. */
export function readClaudeHooks(text: string): readonly FoundHook[] | undefined {
  const parsed = settingsHooksSchema.safeParse(parseJson(text))
  return parsed.success ? foundHooksOf(parsed.data.hooks ?? {}) : undefined
}

/** The handlers of an already-parsed `{event: groups[]}` hooks table. */
function foundHooksOf(table: Readonly<Record<string, readonly unknown[]>>): readonly FoundHook[] {
  const found: FoundHook[] = []
  for (const [event, groups] of Object.entries(table)) {
    for (const rawGroup of groups) {
      const group = hookGroupSchema.safeParse(rawGroup)
      if (!group.success) {
        found.push({ event, matcher: undefined, raw: undefined })
        continue
      }
      for (const raw of group.data.hooks) {
        found.push({ event, matcher: group.data.matcher, raw })
      }
    }
  }
  return found
}

function isTimeoutSeconds(timeout: unknown): timeout is number {
  return (
    typeof timeout === 'number' &&
    Number.isSafeInteger(timeout) &&
    timeout >= 0 &&
    timeout <= HOOK_MAX_TIMEOUT_SECONDS
  )
}

/** A foreign timeout in seconds, bounded by what hooks may take; undefined when absent. */
function boundedTimeoutSeconds(timeout: unknown): number | undefined {
  if (timeout === undefined) {
    return undefined
  }
  return typeof timeout !== 'number' || !(timeout >= 0) || Number.isNaN(timeout)
    ? undefined
    : Math.min(Math.ceil(timeout), HOOK_MAX_TIMEOUT_SECONDS)
}

function hasOnlyFields(raw: unknown, fields: ReadonlySet<string>): boolean {
  return typeof raw === 'object' && raw !== null && Object.keys(raw).every((key) => fields.has(key))
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeRegExp(text: string): string {
  return text.replaceAll(REGEXP_SPECIAL, String.raw`\$&`)
}

/**
 * A matcher with the source's tool names rewritten to ours. Tokens the map
 * does not name pass through: like Muse Code, an unknown tool name simply
 * never matches. The `mcp_` rule renames Gemini's `mcp_<server>_<tool>` to
 * Muse Code's `mcp__<server>__<tool>`.
 */
function translateMatcher(
  matcher: string,
  tools: Readonly<Record<string, string>>,
  shouldRenameMcpTools: boolean,
): string {
  let out = matcher
  for (const [from, to] of Object.entries(tools)) {
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(from)}(?![A-Za-z0-9_])`, 'g')
    out = out.replaceAll(pattern, () => to)
  }
  return shouldRenameMcpTools
    ? out.replaceAll(/(?<![A-Za-z0-9_])mcp_([A-Za-z0-9_]+)/g, (_, name: string) => {
        return `mcp__${name.replaceAll('_', '__')}`
      })
    : out
}

/**
 * One command handler as a Muse Code group under this event; refused when it
 * would widen or cannot run. Values stay unchanged in the allowed target.
 */
function convertCommandGroup(hook: FoundHook, event: string): Conversion<MuseHook> {
  const handler = hookHandlerSchema.safeParse(hook.raw)
  if (!hasOnlyFields(hook.raw, HANDLER_FIELDS) || !handler.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const { type, command, timeout, statusMessage } = handler.data
  if (
    type !== COMMAND_HANDLER ||
    !hasCommand(command) ||
    (timeout !== undefined && !isTimeoutSeconds(timeout))
  ) {
    return { ok: false, reason: 'unsupported' }
  }
  const isMatcherKept =
    hook.matcher !== undefined &&
    !MATCH_EVERYTHING.has(hook.matcher) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(event)
  return {
    ok: true,
    value: {
      event,
      group: {
        ...(isMatcherKept && { matcher: hook.matcher }),
        hooks: [
          {
            type: COMMAND_HANDLER,
            command,
            ...(timeout !== undefined && { timeout }),
            ...(handler.data.async !== undefined && { async: handler.data.async }),
            ...(statusMessage !== undefined && { statusMessage }),
          },
        ],
      },
    },
    dropped: [],
  }
}

/**
 * One Claude Code hook handler as Muse Code's; refused when it would widen
 * or cannot run. Values stay unchanged in the allowed target.
 */
export function convertHook(hook: FoundHook): Conversion<MuseHook> {
  return AGENT_IMPORT_HOOK_EVENTS.includes(hook.event)
    ? convertCommandGroup(hook, hook.event)
    : { ok: false, reason: 'unmapped' }
}

/**
 * One Claude Code handler for an extension event as the `spark-hooks.json`
 * entry: the same native shape, no format tag. `WorktreeCreate` and
 * `ConfigChange` can block where they come from but only observe here, so
 * they stay refused; `FileChanged` without a matcher watches nothing.
 */
export function convertClaudeSparkHook(hook: FoundHook): Conversion<MuseHook> {
  if (!AGENT_IMPORT_CLAUDE_SPARK_EVENTS.includes(hook.event)) {
    return { ok: false, reason: 'unmapped' }
  }
  if (hook.event === 'WorktreeCreate' || hook.event === 'ConfigChange') {
    return { ok: false, reason: 'weaker' }
  }
  return hook.event === 'FileChanged' &&
    (hook.matcher === undefined || MATCH_EVERYTHING.has(hook.matcher))
    ? { ok: false, reason: 'needsMatcher' }
    : convertCommandGroup(hook, hook.event)
}

// --- Codex hooks (M91, PLAN.md D70) ---

const codexHandlerSchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  commandWindows: z.optional(z.string()),
  timeout: z.optional(z.number()),
  async: z.optional(z.boolean()),
  statusMessage: z.optional(z.string()),
  additionalContextLimit: z.optional(z.unknown()),
})
const CODEX_HANDLER_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'command',
  'commandWindows',
  'timeout',
  'async',
  'statusMessage',
  'additionalContextLimit',
])
const CODEX_TOML_HOOKS_KEY = 'hooks'
const CODEX_NOTIFY_KEY = 'notify'

/**
 * The `hooks` table of a Codex `config.toml`; an empty list when it names
 * none, undefined when the text is not a readable hooks table.
 */
export function readCodexHooksToml(text: string): readonly FoundHook[] | undefined {
  let document: unknown
  try {
    document = parseToml(text)
  } catch {
    return undefined
  }
  if (typeof document !== 'object' || document === null) {
    return undefined
  }
  const table = (document as Readonly<Record<string, unknown>>)[CODEX_TOML_HOOKS_KEY]
  if (table === undefined) {
    return []
  }
  const parsed = settingsHooksSchema.safeParse({ hooks: table })
  return parsed.success ? foundHooksOf(parsed.data.hooks ?? {}) : undefined
}

/** Whether a Codex `config.toml` names a legacy `notify` program: listed, never converted. */
export function hasCodexNotify(text: string): boolean {
  let document: unknown
  try {
    document = parseToml(text)
  } catch {
    return false
  }
  return (
    typeof document === 'object' &&
    document !== null &&
    (document as Readonly<Record<string, unknown>>)[CODEX_NOTIFY_KEY] !== undefined
  )
}

/**
 * One Codex hook handler as Muse Code's file entry: the same shape Muse
 * Code runs, so it runs on both backends. `apply_patch` matchers name
 * `Edit|Write` here; `commandWindows` is kept; `Interrupt` converts only
 * with `async:true`. Prompt, agent and MCP handlers and
 * `additionalContextLimit` are refused; `notify` is listed, not converted.
 */
export function convertCodexHook(hook: FoundHook): Conversion<MuseHook> {
  if (!AGENT_IMPORT_CODEX_EVENTS.includes(hook.event)) {
    return { ok: false, reason: 'unmapped' }
  }
  if (!hasOnlyFields(hook.raw, CODEX_HANDLER_FIELDS)) {
    return { ok: false, reason: 'unsupported' }
  }
  const handler = codexHandlerSchema.safeParse(hook.raw)
  if (!handler.success) {
    return { ok: false, reason: 'unsupported' }
  }
  if (handler.data.additionalContextLimit !== undefined) {
    return fieldRefusal('additionalContextLimit')
  }
  const { type, command, commandWindows, timeout, statusMessage } = handler.data
  if (
    type !== COMMAND_HANDLER ||
    !hasCommand(command) ||
    (commandWindows !== undefined && !hasCommand(commandWindows)) ||
    (timeout !== undefined && !isTimeoutSeconds(timeout))
  ) {
    return { ok: false, reason: 'unsupported' }
  }
  if (hook.event === 'Interrupt' && handler.data.async !== true) {
    return { ok: false, reason: 'unsupported' }
  }
  const matcher =
    hook.matcher === undefined
      ? undefined
      : translateMatcher(hook.matcher, { apply_patch: 'Edit|Write' }, false)
  const isMatcherKept =
    matcher !== undefined &&
    !MATCH_EVERYTHING.has(matcher) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(hook.event)
  return {
    ok: true,
    value: {
      event: hook.event,
      group: {
        ...(isMatcherKept && { matcher }),
        hooks: [
          {
            type: COMMAND_HANDLER,
            command,
            ...(commandWindows !== undefined && { commandWindows }),
            ...(timeout !== undefined && { timeout }),
            ...(handler.data.async !== undefined && { async: handler.data.async }),
            ...(statusMessage !== undefined && { statusMessage }),
          },
        ],
      },
    },
    dropped: [],
  }
}

// --- Foreign hooks into spark-hooks.json (M91, PLAN.md D70) ---
//
// Every other agent's format converts into `spark-hooks.json` with a `format`
// tag naming its source. The Model API runtime's adapters (lane P) translate
// the entry's stdin and stdout; the Muse Code backend never runs them.
// Renaming the event alone would fail open: a foreign guard's output does not
// validate against Muse Code's strict schema, so the tag keeps the entry on
// the adapter path. A group carrying `format` is never run natively.

/** A versioned foreign hooks file: parsed, in a newer format, or unreadable. */
export type ForeignHooksRead =
  | { readonly status: 'ok'; readonly hooks: readonly FoundHook[] }
  | { readonly status: 'unknownFormat' }
  | { readonly status: 'unreadable' }

/** The entries of a versioned `{"hooks":{…}}` file, or why it is not one. */
function readVersionedHooks(
  text: string,
  version: unknown,
):
  | { readonly status: 'ok'; readonly table: Readonly<Record<string, readonly unknown[]>> }
  | { readonly status: 'unknownFormat' }
  | { readonly status: 'unreadable' } {
  if (version !== undefined && version !== 1) {
    return { status: 'unknownFormat' }
  }
  const parsed = settingsHooksSchema.safeParse(parseJson(text))
  return !parsed.success || parsed.data.hooks === undefined
    ? { status: 'unreadable' }
    : { status: 'ok', table: parsed.data.hooks }
}

function foreignEntries(table: Readonly<Record<string, readonly unknown[]>>): readonly FoundHook[] {
  const found: FoundHook[] = []
  for (const [event, entries] of Object.entries(table)) {
    if (!Array.isArray(entries)) {
      continue
    }
    for (const raw of entries) {
      found.push({ event, matcher: undefined, raw })
    }
  }
  return found
}

/** A converted foreign hook: the mapped event and the adapter-run group. */
function sparkHook(
  event: string,
  format: string,
  matcher: string | undefined,
  hooks: readonly Readonly<Record<string, unknown>>[],
  extra?: Readonly<Record<string, unknown>>,
  isAsync?: boolean,
): Conversion<MuseHook> {
  return {
    ok: true,
    value: {
      event,
      group: {
        ...(matcher !== undefined && { matcher }),
        format,
        hooks,
        ...(isAsync === true && { async: isAsync }),
        ...extra,
      },
    },
    dropped: [],
  }
}

// --- Gemini CLI ---

const geminiEntrySchema = z.looseObject({
  name: z.optional(z.string()),
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  timeout: z.optional(z.number()),
})
const GEMINI_ENTRY_FIELDS: ReadonlySet<string> = new Set(['name', 'type', 'command', 'timeout'])
const GEMINI_MS_PER_SECOND = 1000

/**
 * One Gemini CLI hook entry as the `spark-hooks.json` entry: the mapped
 * event with a `Gemini` format tag. `BeforeModel` and `AfterModel` map to
 * one call each here (Gemini fires them per chunk); fields that modify the
 * request or response have no equivalent at import and stay refused by the
 * adapter, while block and observation are kept. `BeforeToolSelection`
 * chooses a tool, which no hook may do here. Milliseconds round up to whole
 * seconds, at most 600.
 */
export function convertGeminiHook(hook: FoundHook): Conversion<MuseHook> {
  const event = AGENT_IMPORT_GEMINI_EVENTS[hook.event]
  if (event === undefined) {
    return { ok: false, reason: hook.event === 'BeforeToolSelection' ? 'chooses' : 'unmapped' }
  }
  if (!hasOnlyFields(hook.raw, GEMINI_ENTRY_FIELDS)) {
    return { ok: false, reason: 'unsupported' }
  }
  const entry = geminiEntrySchema.safeParse(hook.raw)
  if (!entry.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const { type, command } = entry.data
  if ((type !== undefined && type !== COMMAND_HANDLER) || !hasCommand(command)) {
    return { ok: false, reason: 'unsupported' }
  }
  const seconds =
    entry.data.timeout === undefined
      ? undefined
      : boundedTimeoutSeconds(entry.data.timeout / GEMINI_MS_PER_SECOND)
  if (seconds === undefined && entry.data.timeout !== undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  const translated =
    hook.matcher === undefined
      ? undefined
      : translateMatcher(hook.matcher, AGENT_IMPORT_GEMINI_TOOLS, true)
  // Matchers choose tools, never models: model-call events carry none.
  const isMatcherKept =
    translated !== undefined &&
    !MATCH_EVERYTHING.has(translated) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(event) &&
    event !== 'PreLLMCall' &&
    event !== 'PostLLMCall'
  const converted = sparkHook(
    event,
    AGENT_IMPORT_FORMATS.gemini,
    isMatcherKept ? translated : undefined,
    [
      {
        type: COMMAND_HANDLER,
        command,
        ...(seconds !== undefined && { timeout: seconds }),
      },
    ],
    undefined,
    event === 'PreCompact',
  )
  if (!converted.ok) {
    return converted
  }
  return {
    ...converted,
    dropped: entry.data.name === undefined ? [] : ['name'],
  }
}

// --- Cursor ---

const cursorEntrySchema = z.looseObject({
  command: z.optional(z.string()),
  matcher: z.optional(z.unknown()),
  permission: z.optional(z.string()),
  failClosed: z.optional(z.boolean()),
  followup_message: z.optional(z.string()),
  timeout: z.optional(z.number()),
})
const CURSOR_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'command',
  'matcher',
  'permission',
  'failClosed',
  'followup_message',
  'timeout',
])
/** Cursor's kind events by our event and their fixed matcher. */
const CURSOR_KIND_MATCHERS: Readonly<
  Record<string, { readonly event: string; readonly matcher: string }>
> = {
  beforeShellExecution: { event: 'PreToolUse', matcher: 'Bash' },
  afterShellExecution: { event: 'PostToolUse', matcher: 'Bash' },
  beforeMCPExecution: { event: 'PreToolUse', matcher: 'mcp__.*' },
  afterMCPExecution: { event: 'PostToolUse', matcher: 'mcp__.*' },
  beforeReadFile: { event: 'PreToolUse', matcher: 'Read' },
  afterFileEdit: { event: 'PostToolUse', matcher: 'Edit|Write' },
}
const cursorToolMatcherSchema = z.looseObject({ tool: z.string() })

/** A Cursor entry matcher naming its tool, either spelling. */
function cursorMatcherName(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    return raw
  }
  const parsed = cursorToolMatcherSchema.safeParse(raw)
  return parsed.success ? parsed.data.tool : undefined
}

/** A Cursor `{"version":1,"hooks":{…}}` file; a wrong version is a newer format. */
export function readCursorHooks(text: string): ForeignHooksRead {
  const document = parseJson(text)
  const version =
    typeof document === 'object' && document !== null
      ? (document as Readonly<Record<string, unknown>>)['version']
      : undefined
  const read = readVersionedHooks(text, version)
  return read.status === 'ok' ? { status: 'ok', hooks: foreignEntries(read.table) } : read
}

/**
 * One Cursor hook entry as the `spark-hooks.json` entry with a `Cursor`
 * format tag. `permission` maps to the decision, `ask` forces a card, and
 * `failClosed` rules are kept for the adapter; `followup_message` becomes a
 * `Stop` block there. `subagentStart` can block where it comes from but only
 * observes here, so it stays refused; the Tab hooks wait for inline
 * completions this extension does not have yet.
 */
export function convertCursorHook(hook: FoundHook): Conversion<MuseHook> {
  const mapped = AGENT_IMPORT_CURSOR_EVENTS[hook.event]
  if (mapped === undefined) {
    if (hook.event === 'subagentStart') {
      return { ok: false, reason: 'weaker' }
    }
    return {
      ok: false,
      reason:
        hook.event === 'beforeTabFileRead' || hook.event === 'afterTabFileEdit'
          ? 'keptWaiting'
          : 'unmapped',
    }
  }
  if (!hasOnlyFields(hook.raw, CURSOR_ENTRY_FIELDS)) {
    return { ok: false, reason: 'unsupported' }
  }
  const entry = cursorEntrySchema.safeParse(hook.raw)
  if (!entry.success || !hasCommand(entry.data.command)) {
    return { ok: false, reason: 'unsupported' }
  }
  let matcher: string | undefined
  const kind = CURSOR_KIND_MATCHERS[hook.event]
  if (entry.data.matcher !== undefined) {
    const named = cursorMatcherName(entry.data.matcher)
    if (named === undefined) {
      return { ok: false, reason: 'unsupported' }
    }
    matcher = translateMatcher(named, AGENT_IMPORT_CURSOR_TOOLS, false)
  } else if (kind !== undefined) {
    matcher = kind.matcher
  } else if (hook.matcher !== undefined) {
    matcher = translateMatcher(hook.matcher, AGENT_IMPORT_CURSOR_TOOLS, false)
  }
  const isMatcherKept =
    matcher !== undefined &&
    !MATCH_EVERYTHING.has(matcher) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(mapped) &&
    mapped !== 'PostLLMCall'
  const seconds = boundedTimeoutSeconds(entry.data.timeout)
  if (seconds === undefined && entry.data.timeout !== undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  return sparkHook(
    mapped,
    AGENT_IMPORT_FORMATS.cursor,
    isMatcherKept ? matcher : undefined,
    [
      {
        type: COMMAND_HANDLER,
        command: entry.data.command,
        ...(seconds !== undefined && { timeout: seconds }),
      },
    ],
    {
      ...(entry.data.permission !== undefined && { permission: entry.data.permission }),
      ...(entry.data.failClosed !== undefined && { failClosed: entry.data.failClosed }),
      ...(entry.data.followup_message !== undefined && {
        followup_message: entry.data.followup_message,
      }),
    },
    mapped === 'PostLLMCall',
  )
}

// --- Copilot and VS Code ---

const copilotEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  bash: z.optional(z.string()),
  powershell: z.optional(z.string()),
  cwd: z.optional(z.string()),
  env: z.optional(z.unknown()),
  timeoutSec: z.optional(z.number()),
  matcher: z.optional(z.string()),
})
const COPILOT_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'bash',
  'powershell',
  'cwd',
  'env',
  'timeoutSec',
  'matcher',
])

/** A Copilot `{"version":1,"hooks":{…}}` file or inline `hooks` block. */
export function readCopilotHooks(text: string): ForeignHooksRead {
  const document = parseJson(text)
  const version =
    typeof document === 'object' && document !== null
      ? (document as Readonly<Record<string, unknown>>)['version']
      : undefined
  const read = readVersionedHooks(text, version)
  return read.status === 'ok' ? { status: 'ok', hooks: foreignEntries(read.table) } : read
}

/**
 * One Copilot hook entry as the `spark-hooks.json` entry with a `Copilot`
 * format tag, either spelling of the event name. `bash` and `powershell`
 * become the command and its Windows spelling; `cwd` stays for the adapter,
 * which runs it only when relative and confined to the workspace. `env`
 * stays refused for its secret risk. `preToolUse` errors fail closed at the
 * adapter. `userPromptTransformed` rewrites the prompt, which no hook may do
 * here.
 */
export function convertCopilotHook(hook: FoundHook): Conversion<MuseHook> {
  const lowered = hook.event.toLowerCase()
  if (lowered === 'userprompttransformed') {
    return { ok: false, reason: 'unsupported' }
  }
  const event = AGENT_IMPORT_COPILOT_EVENTS[lowered]
  if (event === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  if (!hasOnlyFields(hook.raw, COPILOT_ENTRY_FIELDS)) {
    return { ok: false, reason: 'unsupported' }
  }
  const entry = copilotEntrySchema.safeParse(hook.raw)
  if (!entry.success) {
    return { ok: false, reason: 'unsupported' }
  }
  if (entry.data.env !== undefined) {
    return fieldRefusal('env')
  }
  const { type, bash, powershell, cwd, matcher } = entry.data
  if (type !== undefined && type !== COMMAND_HANDLER) {
    return { ok: false, reason: 'unsupported' }
  }
  const command = hasCommand(bash) ? bash : undefined
  const commandWindows = hasCommand(powershell) ? powershell : undefined
  // A blank spelling is refused only when nothing runnable remains; a blank
  // beside a runnable spelling is ignored.
  if (command === undefined && commandWindows === undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  if (cwd !== undefined && typeof cwd !== 'string') {
    return { ok: false, reason: 'unsupported' }
  }
  const seconds = boundedTimeoutSeconds(entry.data.timeoutSec)
  if (seconds === undefined && entry.data.timeoutSec !== undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  const isMatcherKept =
    matcher !== undefined &&
    !MATCH_EVERYTHING.has(matcher) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(event)
  return sparkHook(event, AGENT_IMPORT_FORMATS.copilot, isMatcherKept ? matcher : undefined, [
    {
      type: COMMAND_HANDLER,
      ...(command !== undefined && { command }),
      ...(commandWindows !== undefined && { commandWindows }),
      ...(seconds !== undefined && { timeout: seconds }),
      ...(cwd !== undefined && { cwd }),
    },
  ])
}

// --- Windsurf ---

const windsurfEntrySchema = z.looseObject({
  command: z.optional(z.string()),
  powershell: z.optional(z.string()),
  show_output: z.optional(z.boolean()),
})
const WINDSURF_ENTRY_FIELDS: ReadonlySet<string> = new Set(['command', 'powershell', 'show_output'])

/** A Windsurf `{"hooks":{…}}` file. */
export function readWindsurfHooks(text: string): readonly FoundHook[] | undefined {
  const parsed = settingsHooksSchema.safeParse(parseJson(text))
  return !parsed.success || parsed.data.hooks === undefined
    ? undefined
    : foreignEntries(parsed.data.hooks)
}

/**
 * One Windsurf hook entry as the `spark-hooks.json` entry with a `Windsurf`
 * format tag and the matcher for its kind. Exit codes only: pre hooks stay
 * synchronous so a block still blocks. The transcript answer has no
 * equivalent here and stays refused.
 */
export function convertWindsurfHook(hook: FoundHook): Conversion<MuseHook> {
  const mapped = AGENT_IMPORT_WINDSURF_EVENTS[hook.event]
  if (mapped === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  if (!hasOnlyFields(hook.raw, WINDSURF_ENTRY_FIELDS)) {
    return { ok: false, reason: 'unsupported' }
  }
  const entry = windsurfEntrySchema.safeParse(hook.raw)
  if (!entry.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const command = hasCommand(entry.data.command) ? entry.data.command : undefined
  const commandWindows = hasCommand(entry.data.powershell) ? entry.data.powershell : undefined
  if (command === undefined && commandWindows === undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  const converted = sparkHook(
    mapped.event,
    AGENT_IMPORT_FORMATS.windsurf,
    mapped.matcher,
    [
      {
        type: COMMAND_HANDLER,
        ...(command !== undefined && { command }),
        ...(commandWindows !== undefined && { commandWindows }),
      },
    ],
    undefined,
    mapped.async,
  )
  if (!converted.ok) {
    return converted
  }
  return {
    ...converted,
    dropped: entry.data.show_output === undefined ? [] : ['show_output'],
  }
}

// --- Kiro v1 ---

/** One Kiro v1 hooks-array entry with its trigger and action. */
export interface KiroHook {
  readonly name: string | undefined
  readonly trigger: string
  readonly matcher: string | undefined
  readonly action: unknown
}

export type KiroHooksRead =
  | { readonly status: 'ok'; readonly hooks: readonly KiroHook[] }
  | { readonly status: 'unknownFormat' }
  | { readonly status: 'unreadable' }

const kiroFileSchema = z.looseObject({
  version: z.optional(z.unknown()),
  hooks: z.optional(z.array(z.unknown())),
})
const kiroEntrySchema = z.looseObject({
  name: z.optional(z.string()),
  trigger: z.optional(z.string()),
  matcher: z.optional(z.string()),
  action: z.optional(z.unknown()),
})
const kiroCommandActionSchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  timeout: z.optional(z.number()),
})
const KIRO_COMMAND_ACTION_FIELDS: ReadonlySet<string> = new Set(['type', 'command', 'timeout'])
const kiroAgentActionSchema = z.looseObject({
  type: z.optional(z.string()),
  prompt: z.optional(z.string()),
})
const KIRO_AGENT_ACTION_FIELDS: ReadonlySet<string> = new Set(['type', 'prompt'])

/** A Kiro `.kiro/hooks/*.json` v1 file; any other version is a newer format. */
export function readKiroHooks(text: string): KiroHooksRead {
  const parsed = kiroFileSchema.safeParse(parseJson(text))
  if (!parsed.success || parsed.data.hooks === undefined) {
    return { status: 'unreadable' }
  }
  if (parsed.data.version !== 'v1') {
    return { status: 'unknownFormat' }
  }
  return {
    status: 'ok',
    hooks: parsed.data.hooks.map((raw): KiroHook => {
      const entry = kiroEntrySchema.safeParse(raw)
      if (!entry.success || entry.data.trigger === undefined || entry.data.action === undefined) {
        return { name: undefined, trigger: '', matcher: undefined, action: undefined }
      }
      return {
        name: entry.data.name,
        trigger: entry.data.trigger,
        matcher: entry.data.matcher,
        action: entry.data.action,
      }
    }),
  }
}

/**
 * One Kiro v1 entry as the `spark-hooks.json` entry with a `Kiro` format
 * tag. File triggers map to `PostToolUse` on file tools; the Kiro adapter
 * (lane P) applies Kiro's path regex itself, so its scope stays the same.
 * Spec-task triggers map to the todo-item events. Agent actions become
 * `prompt` handlers under lane H's paid-feature gates.
 */
export function convertKiroHook(hook: KiroHook): Conversion<MuseHook> {
  if (hook.trigger === '' || hook.action === undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  if (hook.trigger === 'Manual') {
    return { ok: false, reason: 'unsupported' }
  }
  const task = AGENT_IMPORT_KIRO_TASK_EVENTS[hook.trigger]
  const isFile = AGENT_IMPORT_KIRO_FILE_TRIGGERS.includes(hook.trigger)
  const direct = AGENT_IMPORT_KIRO_EVENTS[hook.trigger]
  const event = task ?? direct ?? (isFile ? 'PostToolUse' : undefined)
  if (event === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  if (task !== undefined && hook.matcher !== undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  const action: unknown = hook.action
  if (
    !hasOnlyFields(action, KIRO_COMMAND_ACTION_FIELDS) &&
    !hasOnlyFields(action, KIRO_AGENT_ACTION_FIELDS)
  ) {
    return { ok: false, reason: 'unsupported' }
  }
  if (typeof action !== 'object' || action === null) {
    return { ok: false, reason: 'unsupported' }
  }
  const kind = (action as Readonly<Record<string, unknown>>)['type']
  if (kind === 'command') {
    const parsed = kiroCommandActionSchema.safeParse(action)
    if (!parsed.success || !hasCommand(parsed.data.command)) {
      return { ok: false, reason: 'unsupported' }
    }
    const seconds = boundedTimeoutSeconds(parsed.data.timeout)
    if (seconds === undefined && parsed.data.timeout !== undefined) {
      return { ok: false, reason: 'unsupported' }
    }
    if (isFile) {
      return sparkHook(
        event,
        AGENT_IMPORT_FORMATS.kiro,
        AGENT_IMPORT_KIRO_FILE_MATCHER,
        [
          {
            type: COMMAND_HANDLER,
            command: parsed.data.command,
            ...(seconds !== undefined && { timeout: seconds }),
          },
        ],
        {
          ...(hook.matcher !== undefined && { pathPattern: hook.matcher }),
        },
      )
    }
    const translated =
      hook.matcher === undefined
        ? undefined
        : translateMatcher(hook.matcher, AGENT_IMPORT_KIRO_TOOLS, false)
    const isMatcherKept =
      translated !== undefined &&
      !MATCH_EVERYTHING.has(translated) &&
      !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(event)
    return sparkHook(event, AGENT_IMPORT_FORMATS.kiro, isMatcherKept ? translated : undefined, [
      {
        type: COMMAND_HANDLER,
        command: parsed.data.command,
        ...(seconds !== undefined && { timeout: seconds }),
      },
    ])
  }
  if (kind === 'agent') {
    const parsed = kiroAgentActionSchema.safeParse(action)
    if (!parsed.success || parsed.data.prompt === undefined || parsed.data.prompt.trim() === '') {
      return { ok: false, reason: 'unsupported' }
    }
    return sparkHook(event, AGENT_IMPORT_FORMATS.kiro, undefined, [
      { type: 'prompt', prompt: parsed.data.prompt },
    ])
  }
  return { ok: false, reason: 'unsupported' }
}

// --- Cline v1 ---

export type ClineFileKind =
  | { readonly kind: 'event'; readonly event: string }
  | { readonly kind: 'unknownFormat' }
  | { readonly kind: 'ignore' }

/**
 * A `.clinerules/hooks/` entry: a per-event script, a newer SDK/CLI JSON
 * format, or a file that is not a hook. The stem names the event; a JSON
 * spelling of one is the newer format, refused with a reason.
 */
export function clineEventForFile(fileName: string): ClineFileKind {
  const dot = fileName.lastIndexOf('.')
  const stem = dot <= 0 ? fileName : fileName.slice(0, dot)
  const event = AGENT_IMPORT_CLINE_EVENTS[stem]
  if (event !== undefined) {
    return fileName.toLowerCase().endsWith(AGENT_IMPORT_JSON_EXTENSION)
      ? { kind: 'unknownFormat' }
      : { kind: 'event', event }
  }
  return {
    kind: fileName.toLowerCase().endsWith(AGENT_IMPORT_JSON_EXTENSION) ? 'unknownFormat' : 'ignore',
  }
}

/**
 * One Cline v1 per-event script as the `spark-hooks.json` entry with a
 * `Cline` format tag. The script stays where it is; the entry runs it by its
 * absolute path, so the preview lists the event only, never command text.
 */
export function convertClineHook(sourceEvent: string, command: string): Conversion<MuseHook> {
  const event = AGENT_IMPORT_CLINE_EVENTS[sourceEvent]
  if (event === undefined || command === '') {
    return { ok: false, reason: 'unmapped' }
  }
  return sparkHook(event, AGENT_IMPORT_FORMATS.cline, undefined, [
    { type: COMMAND_HANDLER, command },
  ])
}

// --- Markdown: commands, agents, rules ---

const frontMatterSchema = z.record(z.string(), z.string())

/**
 * A foreign Markdown file's front matter as raw fields (first spelling of
 * a key wins, keys lower-cased) and the body after it. A file without a
 * closed fence has no fields; the whole text is its body.
 */
export function splitFrontMatter(text: string): {
  readonly fields: Readonly<Record<string, string>>
  readonly body: string
} {
  const lines = text.split(LINE_BREAK)
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === FENCE)
  if (end === -1 || lines[0]?.trim() !== FENCE) {
    return { fields: {}, body: text.trim() }
  }
  const fields: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const at = line.indexOf(FIELD_SEPARATOR)
    const key = line.slice(0, at).trim().toLowerCase()
    if (key !== '' && at > 0 && !Object.hasOwn(fields, key)) {
      fields[key] = unquote(line.slice(at + 1).trim())
    }
  }
  const checked = frontMatterSchema.safeParse(fields)
  return {
    fields: checked.success ? checked.data : {},
    body: lines
      .slice(end + 1)
      .join('\n')
      .trim(),
  }
}

function unquote(value: string): string {
  const first = value.at(0)
  return value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)
    ? value.slice(1, -1)
    : value
}

/** One line in a YAML single-quoted scalar, which has no escapes but a doubled quote. */
function yamlScalar(value: string): string {
  const line = value.replaceAll(WHITESPACE_RUN, ' ').trim()
  return `'${line.replaceAll("'", "''")}'`
}

/** A foreign command as a SKILL.md: the selector, its description and hint, and the body. */
export function commandToSkill(
  skillId: string,
  fields: Readonly<Record<string, string>>,
  body: string,
): string {
  const description = fields['description'] ?? ''
  const hint = fields['argument-hint'] ?? ''
  const lines = [
    FENCE,
    `name: ${skillId}`,
    `description: ${yamlScalar(description === '' ? skillId : description)}`,
    ...(hint === '' ? [] : [`argument-hint: ${yamlScalar(hint)}`]),
    FENCE,
  ]
  return `${lines.join('\n')}\n\n${body}\n`
}

/** The heading line an imported rules section starts with; the import skips one already there. */
export function rulesHeading(sourceName: string, displayPath: string): string {
  return `## ${fill(MODEL_TEXT.importedRulesHeading, { source: sourceName, path: displayPath })}`
}

/** A rules file as an AGENTS.md section; a Cursor rule's description and globs stay with it. */
export function rulesSection(
  heading: string,
  body: string,
  fields: Readonly<Record<string, string>> = {},
): string {
  const description = fields['description'] ?? ''
  const globs = fields['globs'] ?? ''
  const notes = [
    ...(description === '' ? [] : [fill(MODEL_TEXT.importedRulesWhen, { description })]),
    ...(globs === '' ? [] : [fill(MODEL_TEXT.importedRulesFiles, { globs })]),
  ]
  return [heading, ...(notes.length === 0 ? [] : [notes.join('\n')]), body].join('\n\n')
}

/** What goes between a rules file's current text and appended sections. */
export function appendSeparator(current: string): string {
  if (current === '' || current.endsWith('\n\n')) {
    return ''
  }
  return current.endsWith('\n') ? '\n' : '\n\n'
}
