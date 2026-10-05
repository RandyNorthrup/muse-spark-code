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
  AGENT_IMPORT_CLINE_WINDOWS_EXTENSION,
  AGENT_IMPORT_CODEX_EVENTS,
  AGENT_IMPORT_COPILOT_CLAUDE_TOOLS,
  AGENT_IMPORT_COPILOT_EVENTS,
  AGENT_IMPORT_COPILOT_PASCAL_EVENTS,
  AGENT_IMPORT_COPILOT_TOOLS,
  AGENT_IMPORT_CURSOR_EVENTS,
  AGENT_IMPORT_CURSOR_MATCHER_SUBJECTS,
  AGENT_IMPORT_CURSOR_TOOLS,
  AGENT_IMPORT_DEFAULT_TIMEOUT_SECONDS,
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
  AGENT_IMPORT_MCP_SERVER_MAX_CHARS,
  AGENT_IMPORT_MODEL_TEXT,
  AGENT_IMPORT_SETUP_TRIGGERS,
  AGENT_IMPORT_SPARK_NAME_MATCHED,
  AGENT_IMPORT_SPARK_PATH_MATCHED,
  AGENT_IMPORT_VSCODE_EVENTS,
  AGENT_IMPORT_WINDSURF_EVENTS,
  HOOK_MATCHER_MAX_CHARS,
  HOOK_MAX_TIMEOUT_SECONDS,
  MCP_FUNCTION_NAME_MAX_CHARS,
  MCP_TRANSPORTS,
  MILLISECONDS_PER_SECOND,
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

/** The first runnable spelling: a platform's own, else the cross-platform fallback. */
function firstCommand(...commands: readonly (string | undefined)[]): string | undefined {
  return commands.find((command) => hasCommand(command))
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

/// --- Hooks ---
//
// M91 round 2 (RVM91I): the readers never drop a field. A `FoundHook` keeps
// its source entry whole (`raw`), the Claude-shaped group around it without
// its `hooks` list (`group`), and whether a file-level switch in the source
// turns it off (`disabled`). Each converter accounts for every field: it is
// carried, dropped by name (documentation only), or the entry is refused
// naming it. Nothing the source uses to narrow, confirm, bound or disable a
// hook is lost on the way: an imported guard is never weaker than its source.

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
/** Claude Code's and Codex's group fields; Muse Code's own parser takes these. */
const NATIVE_GROUP_FIELDS: ReadonlySet<string> = new Set(['matcher', 'hooks', 'description'])

/** One hook entry as its file wrote it, kept whole. */
export interface FoundHook {
  /** The source's own event name, verbatim. */
  readonly event: string
  /** A Claude-shaped group's matcher. */
  readonly matcher: string | undefined
  /** The handler or entry, every field as written. */
  readonly raw: unknown
  /** A Claude-shaped group around `raw`, without its `hooks` list. */
  readonly group?: JsonObject | undefined
  /** A file-level switch in the source turns this hook off. */
  readonly disabled?: boolean | undefined
}

/** A converted hook: the event and the group its file takes. */
export interface MuseHook {
  readonly event: string
  readonly group: JsonObject
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function documentOf(text: string): JsonObject | undefined {
  const value = parseJson(text)
  return isJsonObject(value) ? value : undefined
}

/** Every handler of a Claude-shaped `hooks` block; undefined when the file is not one. */
export function readClaudeHooks(text: string): readonly FoundHook[] | undefined {
  const parsed = settingsHooksSchema.safeParse(parseJson(text))
  return parsed.success ? foundHooksOf(parsed.data.hooks ?? {}) : undefined
}

/** The handlers of an already-parsed `{event: groups[]}` hooks table, each group kept whole. */
function foundHooksOf(table: Readonly<Record<string, readonly unknown[]>>): readonly FoundHook[] {
  const found: FoundHook[] = []
  for (const [event, groups] of Object.entries(table)) {
    for (const rawGroup of groups) {
      const group = hookGroupSchema.safeParse(rawGroup)
      if (!group.success || !isJsonObject(rawGroup)) {
        found.push({ event, matcher: undefined, raw: undefined })
        continue
      }
      const { hooks: _hooks, ...rest } = rawGroup
      for (const raw of group.data.hooks) {
        found.push({ event, matcher: group.data.matcher, raw, group: rest })
      }
    }
  }
  return found
}

/**
 * The hooks a file-level switch turns off, marked so: `isOff` turns every
 * one off; `offNames` the entries whose `name` (Gemini's `hooksConfig.disabled`)
 * or whose command it lists.
 */
export interface HookSwitches {
  readonly isOff: boolean
  readonly offNames?: ReadonlySet<string> | undefined
}

export function withSwitches(
  hooks: readonly FoundHook[],
  switches: HookSwitches,
): readonly FoundHook[] {
  return hooks.map((hook) => {
    const entry = isJsonObject(hook.raw) ? hook.raw : {}
    const isNamed = [entry['name'], entry['command']].some(
      (value) => typeof value === 'string' && switches.offNames?.has(value) === true,
    )
    return isNamed || switches.isOff ? { ...hook, disabled: true } : hook
  })
}

/**
 * Claude Code's and Copilot's `disableAllHooks: true` (the Copilot
 * reference's "Disable all hooks"; Claude Code's settings): every hook in
 * that scope stays on disk and never runs.
 */
export function hasDisableAllHooks(text: string): boolean {
  return documentOf(text)?.['disableAllHooks'] === true
}

const geminiHooksConfigSchema = z.looseObject({
  enabled: z.optional(z.boolean()),
  disabled: z.optional(z.array(z.string())),
})

/**
 * Gemini CLI's `hooksConfig` (raw-codex-gemini.md:79): `enabled: false`
 * turns every hook off; `disabled` lists hook names turned off.
 */
export function readGeminiSwitches(text: string): HookSwitches {
  const config = documentOf(text)?.['hooksConfig']
  const parsed = geminiHooksConfigSchema.safeParse(config)
  if (config === undefined) {
    return { isOff: false }
  }
  // An unreadable switch block counts as off: the hooks it governs are unknown.
  if (!parsed.success) {
    return { isOff: true }
  }
  return {
    isOff: parsed.data.enabled === false,
    offNames: new Set(parsed.data.disabled),
  }
}

const codexFeaturesSchema = z.looseObject({
  hooks: z.optional(z.unknown()),
  codex_hooks: z.optional(z.unknown()),
})

/**
 * Codex's `[features] hooks = false` (deprecated alias `codex_hooks`,
 * raw-codex-gemini.md:9): hooks are on by default, and this turns them off.
 */
export function isCodexHooksOff(text: string): boolean {
  let document: unknown
  try {
    document = parseToml(text)
  } catch {
    return false
  }
  const features = isJsonObject(document) ? document['features'] : undefined
  const parsed = codexFeaturesSchema.safeParse(features)
  return parsed.success && (parsed.data.hooks === false || parsed.data.codex_hooks === false)
}

function isTimeoutSeconds(timeout: unknown): timeout is number {
  return (
    typeof timeout === 'number' &&
    Number.isSafeInteger(timeout) &&
    timeout >= 0 &&
    timeout <= HOOK_MAX_TIMEOUT_SECONDS
  )
}

/**
 * A foreign timeout in whole seconds, rounded up; undefined when it is not a
 * number of seconds this runtime can honour (negative, or past 600: cutting
 * a source's bound short would make a slow guard fail where it blocked).
 */
function sourceTimeoutSeconds(seconds: unknown): number | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
    return undefined
  }
  const whole = Math.ceil(seconds)
  return whole <= HOOK_MAX_TIMEOUT_SECONDS ? whole : undefined
}

function hasOnlyFields(raw: unknown, fields: ReadonlySet<string>): boolean {
  return isJsonObject(raw) && Object.keys(raw).every((key) => fields.has(key))
}

/** The first field of an entry outside the set its converter accounts for. */
function unknownField(raw: JsonObject, fields: ReadonlySet<string>): string | undefined {
  return Object.keys(raw).find((key) => !fields.has(key))
}

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g

function escapeRegExp(text: string): string {
  return text.replaceAll(REGEXP_SPECIAL, String.raw`\$&`)
}

// --- Matcher translation ---
//
// A foreign matcher is translated exactly or refused. The translation never
// rewrites a regex textually: it decides which of the source's known tool
// names the matcher selects under the source's own rules, and writes the
// names of ours that those reach. Built-in tools come out as a name list
// (Muse Code's exact form); MCP tools as anchored patterns over our
// `mcp__<server>__<tool>` names (mcp/functions.ts:75-83: the server part
// has no `__`, the tool part keeps its underscores).

const LITERAL_TOKEN = /^[A-Za-z0-9_]+$/
const MATCH_ALL_REGEX: ReadonlySet<string> = new Set(['', '*', '.*', '^.*$'])
const ANCHORED_GROUP = /^\^\((?:\?:)?([^()]*)\)\$$/
const ANCHORED_ONE = /^\^([^()|]*)\$$/
const EXACT_NAME = /^[A-Za-z0-9_]+$/
/** Our MCP server part: letters, digits and dashes, single underscores inside. */
const OUR_MCP_SERVER = '[A-Za-z0-9-]+(?:_[A-Za-z0-9-]+)*'
const OUR_MCP_PREFIX = 'mcp__'
const CANONICAL_SERVER = /^[A-Za-z0-9-]+$/
const CANONICAL_TOOL = /^[A-Za-z0-9_-]+$/

/** What a source token selects among our tools: exact names and MCP patterns. */
interface Selection {
  readonly names: readonly string[]
  readonly patterns: readonly string[]
}

interface ToolVocabulary {
  /** Source tool names and aliases by the names of ours they reach ([] for one we lack). */
  readonly tools: Readonly<Record<string, readonly string[]>>
  /**
   * The source tests its regex unanchored (`new RegExp(m).test(name)`): a
   * token also selects every name containing it, MCP names included.
   */
  readonly isUnanchored: boolean
  /** A token the source spells for an MCP tool; undefined when it is not one, null to refuse. */
  readonly mcpToken?:
    ((token: string, isAnchored: boolean) => Selection | null | undefined) | undefined
  /** Under unanchored rules, the MCP names containing a plain token, as one of our patterns. */
  readonly mcpContaining?: ((token: string) => string) | undefined
  /** Forms that select every tool. */
  readonly everything: ReadonlySet<string>
}

type MatcherTranslation =
  { readonly ok: true; readonly matcher: string | undefined } | { readonly ok: false }

const REFUSED_MATCHER: MatcherTranslation = { ok: false }

/** The tokens of a literal alternation, anchors noted; undefined when it is a regex. */
function literalTokens(
  matcher: string,
  extraToken?: RegExp,
): { readonly tokens: readonly string[]; readonly isAnchored: boolean } | undefined {
  const grouped = ANCHORED_GROUP.exec(matcher) ?? ANCHORED_ONE.exec(matcher)
  const inner = grouped?.[1] ?? matcher
  const tokens = inner.split('|')
  const isLiteral = tokens.every(
    (token) => LITERAL_TOKEN.test(token) || (extraToken?.test(token) ?? false),
  )
  return isLiteral ? { tokens, isAnchored: grouped !== null } : undefined
}

function joinSelection(selections: readonly Selection[]): MatcherTranslation {
  const names = [...new Set(selections.flatMap((selection) => selection.names))].toSorted((a, b) =>
    a.localeCompare(b, 'en'),
  )
  const patterns = [...new Set(selections.flatMap((selection) => selection.patterns))]
  if (names.length === 0 && patterns.length === 0) {
    // Every tool it names is one this extension does not have: it would never run.
    return REFUSED_MATCHER
  }
  const matcher =
    patterns.length === 0
      ? names.join('|')
      : [...(names.length === 0 ? [] : [`^(?:${names.join('|')})$`]), ...patterns].join('|')
  return matcher.length <= HOOK_MATCHER_MAX_CHARS ? { ok: true, matcher } : REFUSED_MATCHER
}

/**
 * A foreign tool-name matcher as ours, exactly, or refused. A token must name
 * a documented tool (or alias, or MCP tool by the source's own spelling);
 * under unanchored rules it also selects the documented names that contain
 * it and the MCP tools whose names contain it.
 */
function translateToolMatcher(
  matcher: string | undefined,
  vocabulary: ToolVocabulary,
  extraToken?: RegExp,
): MatcherTranslation {
  if (matcher === undefined || vocabulary.everything.has(matcher)) {
    return { ok: true, matcher: undefined }
  }
  const literal = literalTokens(matcher, extraToken)
  if (literal === undefined) {
    return REFUSED_MATCHER
  }
  const isAnchored = literal.isAnchored || !vocabulary.isUnanchored
  const known = Object.keys(vocabulary.tools)
  const selections: Selection[] = []
  for (const token of literal.tokens) {
    const mcp = vocabulary.mcpToken?.(token, literal.isAnchored)
    if (mcp === null) {
      return REFUSED_MATCHER
    }
    if (mcp !== undefined) {
      selections.push(mcp)
      continue
    }
    if (!Object.hasOwn(vocabulary.tools, token)) {
      // Not a documented name: what it selects among MCP or unknown tools is unknowable.
      return REFUSED_MATCHER
    }
    const reached = isAnchored ? [token] : known.filter((name) => name.includes(token))
    selections.push({
      names: reached.flatMap((name) => vocabulary.tools[name] ?? []),
      patterns:
        isAnchored || vocabulary.mcpContaining === undefined
          ? []
          : [vocabulary.mcpContaining(token)],
    })
  }
  return joinSelection(selections)
}

/** Gemini's `mcp_<server>_<tool>` spelling is ambiguous at an underscore, so only anchored, single-split names translate. */
const GEMINI_VOCABULARY: ToolVocabulary = {
  tools: AGENT_IMPORT_GEMINI_TOOLS,
  isUnanchored: true,
  everything: MATCH_ALL_REGEX,
  mcpToken: (token, isAnchored) => {
    if (!token.startsWith('mcp_')) {
      return
    }
    const [server, tool, ...rest] = token.slice('mcp_'.length).split('_')
    return !isAnchored ||
      server === undefined ||
      tool === undefined ||
      rest.length > 0 ||
      !CANONICAL_SERVER.test(server) ||
      server.length > AGENT_IMPORT_MCP_SERVER_MAX_CHARS ||
      !CANONICAL_TOOL.test(tool) ||
      `${OUR_MCP_PREFIX}${server}__${tool}`.length > MCP_FUNCTION_NAME_MAX_CHARS
      ? null
      : { names: [`${OUR_MCP_PREFIX}${server}__${tool}`], patterns: [] }
  },
  // Unanchored Gemini names cannot round-trip across normalized MCP identities.
}

const CURSOR_MCP_TOKEN = /^MCP:[A-Za-z0-9_-]+$/
const CURSOR_VOCABULARY: ToolVocabulary = {
  tools: AGENT_IMPORT_CURSOR_TOOLS,
  isUnanchored: true,
  everything: MATCH_ALL_REGEX,
  // Cursor names an MCP tool `MCP:<tool>`, never its server (cursor_com_docs_hooks_md.out:773).
  mcpToken: (token, isAnchored) => {
    if (!CURSOR_MCP_TOKEN.test(token)) {
      return
    }
    const tool = escapeRegExp(token.slice('MCP:'.length))
    return {
      names: [],
      patterns: [`^${OUR_MCP_PREFIX}${OUR_MCP_SERVER}__${tool}${isAnchored ? '$' : ''}`],
    }
  },
  mcpContaining: (token) =>
    'MCP'.includes(token)
      ? `^${OUR_MCP_PREFIX}`
      : `^${OUR_MCP_PREFIX}${OUR_MCP_SERVER}__.*${escapeRegExp(token)}`,
}

const KIRO_MCP_TOKEN = /^@[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?$/
/**
 * Kiro's tool matchers name tools, aliases and categories; `@mcp`, `@builtin`
 * and `@<server>[/<tool>]` select by source, and Kiro tests `@` forms as a
 * regex, so `@git` also selects a server named `github`.
 */
const KIRO_VOCABULARY: ToolVocabulary = {
  tools: AGENT_IMPORT_KIRO_TOOLS,
  isUnanchored: false,
  everything: new Set(['', '*']),
  mcpToken: (token, isAnchored) => {
    if (!KIRO_MCP_TOKEN.test(token)) {
      return
    }
    if (isAnchored && ['@mcp', '@builtin', '@powers'].includes(token)) return null
    if (token === '@mcp') {
      return { names: [], patterns: [`^${OUR_MCP_PREFIX}`] }
    }
    if (token === '@builtin') {
      return { names: [], patterns: [`^(?!${OUR_MCP_PREFIX})`] }
    }
    if (token === '@powers') {
      return { names: [], patterns: [] }
    }
    const [server, tool] = token.slice(1).split('/', 2)
    if (
      server === undefined ||
      !CANONICAL_SERVER.test(server) ||
      server.length > AGENT_IMPORT_MCP_SERVER_MAX_CHARS
    ) {
      return null
    }
    if (tool === undefined) {
      return isAnchored ? null : { names: [], patterns: [`^${OUR_MCP_PREFIX}${server}`] }
    }
    return CANONICAL_TOOL.test(tool) &&
      `${OUR_MCP_PREFIX}${server}__${tool}`.length <= MCP_FUNCTION_NAME_MAX_CHARS
      ? { names: [], patterns: [`^${OUR_MCP_PREFIX}${server}__${tool}${isAnchored ? '$' : ''}`] }
      : null
  },
}

const COPILOT_VOCABULARY: ToolVocabulary = {
  tools: AGENT_IMPORT_COPILOT_TOOLS,
  isUnanchored: false,
  everything: new Set(['', '.*']),
}

/** Copilot PascalCase `PreToolUse`/`PermissionRequest`: Claude's matcher rules, runtime or Claude names. */
const COPILOT_CLAUDE_VOCABULARY: ToolVocabulary = {
  tools: { ...AGENT_IMPORT_COPILOT_TOOLS, ...AGENT_IMPORT_COPILOT_CLAUDE_TOOLS },
  isUnanchored: false,
  everything: new Set(['', '*', '**', '.*', '^.*$']),
}

/**
 * A matcher on a non-tool subject: kept only as a list of the source's own
 * values that ours shares (`PreCompact`'s trigger, `SessionStart`'s source),
 * else refused. Undefined `values` means our event has no such subject.
 */
function translateValueMatcher(
  matcher: string | undefined,
  values: readonly string[] | undefined,
  everything: ReadonlySet<string>,
): MatcherTranslation {
  if (matcher === undefined || everything.has(matcher)) {
    return { ok: true, matcher: undefined }
  }
  const literal = literalTokens(matcher)
  if (values === undefined || literal === undefined) {
    return REFUSED_MATCHER
  }
  return literal.tokens.every((token) => values.includes(token))
    ? { ok: true, matcher: literal.tokens.join('|') }
    : REFUSED_MATCHER
}

const PRE_COMPACT_TRIGGERS = ['manual', 'auto'] as const

/**
 * Whether a matcher tested against one fixed value runs: Cursor's
 * `beforeReadFile` against `Read` and the like. Undefined when it is a regex
 * the import does not evaluate.
 */
function matchesFixedSubject(
  matcher: string,
  subject: string,
  isUnanchored: boolean,
): boolean | undefined {
  if (MATCH_ALL_REGEX.has(matcher)) {
    return true
  }
  const literal = literalTokens(matcher)
  return literal === undefined
    ? undefined
    : literal.tokens.some((token) =>
        !isUnanchored || literal.isAnchored ? token === subject : subject.includes(token),
      )
}

// --- Claude Code and Codex: Muse Code's own shape ---

/** A converted native group's matcher: dropped where the source ignores one. */
function nativeMatcher(event: string, matcher: string | undefined): string | undefined {
  return matcher !== undefined &&
    !MATCH_EVERYTHING.has(matcher) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(event)
    ? matcher
    : undefined
}

/** The group refusal every Claude-shaped converter shares: a disabled hook, or a group field it cannot honour. */
function groupRefusal(hook: FoundHook, fields: ReadonlySet<string>): Conversion<never> | undefined {
  if (hook.disabled === true) {
    return { ok: false, reason: 'disabled' }
  }
  const field = hook.group === undefined ? undefined : unknownField(hook.group, fields)
  return field === undefined ? undefined : fieldRefusal(field)
}

/**
 * One command handler as a Muse Code group under this event; refused when it
 * would widen or cannot run. Values stay unchanged in the allowed target.
 */
function convertCommandGroup(
  hook: FoundHook,
  event: string,
  matcher: string | undefined,
  isCodex = false,
): Conversion<MuseHook> {
  const refused = groupRefusal(hook, NATIVE_GROUP_FIELDS)
  if (refused !== undefined) {
    return refused
  }
  const fields = isCodex ? CODEX_HANDLER_FIELDS : HANDLER_FIELDS
  const handler = isCodex
    ? codexHandlerSchema.safeParse(hook.raw)
    : hookHandlerSchema.safeParse(hook.raw)
  if (!hasOnlyFields(hook.raw, fields) || !handler.success) {
    return { ok: false, reason: 'unsupported' }
  }
  if ('additionalContextLimit' in handler.data && handler.data.additionalContextLimit !== undefined)
    return fieldRefusal('additionalContextLimit')
  const { type, command, timeout, statusMessage } = handler.data
  const commandWindows = 'commandWindows' in handler.data ? handler.data.commandWindows : undefined
  if (
    type !== COMMAND_HANDLER ||
    !hasCommand(command) ||
    (commandWindows !== undefined && !hasCommand(commandWindows)) ||
    (timeout !== undefined && !isTimeoutSeconds(timeout)) ||
    (isCodex && hook.event === 'Interrupt' && handler.data.async !== true)
  ) {
    return { ok: false, reason: 'unsupported' }
  }
  return {
    ok: true,
    value: {
      event,
      group: {
        ...(matcher !== undefined && { matcher }),
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
    dropped: hook.group?.['description'] === undefined ? [] : ['description'],
  }
}

/**
 * One Claude Code hook handler as Muse Code's; refused when it would widen
 * or cannot run. Values stay unchanged in the allowed target.
 */
export function convertHook(hook: FoundHook): Conversion<MuseHook> {
  return AGENT_IMPORT_HOOK_EVENTS.includes(hook.event)
    ? convertCommandGroup(hook, hook.event, nativeMatcher(hook.event, hook.matcher))
    : { ok: false, reason: 'unmapped' }
}

/** A Claude extension event's matcher under `spark-hooks.json`'s grammar, or refused. */
function sparkMatcher(event: string, matcher: string | undefined): MatcherTranslation {
  if (matcher === undefined || MATCH_EVERYTHING.has(matcher)) {
    return { ok: true, matcher: undefined }
  }
  if (matcher.length > HOOK_MATCHER_MAX_CHARS) {
    return REFUSED_MATCHER
  }
  if (event === 'Setup') {
    return matcher.split('|').every((name) => AGENT_IMPORT_SETUP_TRIGGERS.includes(name))
      ? { ok: true, matcher }
      : REFUSED_MATCHER
  }
  if (AGENT_IMPORT_SPARK_PATH_MATCHED.includes(event)) {
    return { ok: true, matcher }
  }
  return AGENT_IMPORT_SPARK_NAME_MATCHED.includes(event) &&
    EXACT_NAME.test(matcher.replaceAll('|', '_'))
    ? { ok: true, matcher }
    : REFUSED_MATCHER
}

/**
 * One Claude Code handler for an extension event as the `spark-hooks.json`
 * entry: the same native shape, no format tag. `WorktreeCreate` and
 * `ConfigChange` can block where they come from but only observe here, so
 * they stay refused; `FileChanged` without a matcher watches nothing. A
 * matcher that file's grammar refuses is refused here, by name.
 */
export function convertClaudeSparkHook(hook: FoundHook): Conversion<MuseHook> {
  if (!AGENT_IMPORT_CLAUDE_SPARK_EVENTS.includes(hook.event)) {
    return { ok: false, reason: 'unmapped' }
  }
  if (hook.event === 'WorktreeCreate' || hook.event === 'ConfigChange') {
    return { ok: false, reason: 'weaker' }
  }
  if (
    hook.event === 'FileChanged' &&
    (hook.matcher === undefined || MATCH_EVERYTHING.has(hook.matcher))
  ) {
    return { ok: false, reason: 'needsMatcher' }
  }
  const matcher = sparkMatcher(hook.event, hook.matcher)
  return matcher.ok
    ? convertCommandGroup(hook, hook.event, matcher.matcher)
    : fieldRefusal(MATCHER_FIELD)
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
const CODEX_APPLY_PATCH = 'apply_patch'
const CODEX_APPLY_PATCH_NAMES = 'Edit|Write'
const WHOLE_APPLY_PATCH = /(?<![A-Za-z0-9_])apply_patch(?![A-Za-z0-9_])/g

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
  if (!isJsonObject(document)) {
    return undefined
  }
  const table = document[CODEX_TOML_HOOKS_KEY]
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
  return isJsonObject(document) && document[CODEX_NOTIFY_KEY] !== undefined
}

/**
 * A Codex matcher in Muse Code's grammar (the same as Codex's: a name list,
 * else an unanchored regex), with `apply_patch` naming `Edit|Write`. In a
 * regex the names are grouped, so `^apply_patch$` stays anchored on both.
 */
function codexMatcher(matcher: string): string {
  if (EXACT_NAME.test(matcher.replaceAll('|', '_'))) {
    const names = matcher
      .split('|')
      .flatMap((name) => (name === CODEX_APPLY_PATCH ? CODEX_APPLY_PATCH_NAMES.split('|') : [name]))
    return [...new Set(names)].join('|')
  }
  return matcher.replaceAll(WHOLE_APPLY_PATCH, () => `(?:${CODEX_APPLY_PATCH_NAMES})`)
}

/**
 * One Codex hook handler as Muse Code's file entry: the same shape Muse
 * Code runs, so it runs on both backends. `apply_patch` matchers name
 * `Edit|Write` here; `commandWindows` is kept; `Interrupt` converts only
 * with `async:true`. Prompt, agent and MCP handlers and
 * `additionalContextLimit` are refused; `notify` is listed, not converted;
 * `[features] hooks = false` marks every hook disabled.
 */
export function convertCodexHook(hook: FoundHook): Conversion<MuseHook> {
  if (!AGENT_IMPORT_CODEX_EVENTS.includes(hook.event)) {
    return { ok: false, reason: 'unmapped' }
  }
  return convertCommandGroup(
    hook,
    hook.event,
    nativeMatcher(hook.event, hook.matcher === undefined ? undefined : codexMatcher(hook.matcher)),
    true,
  )
}

// --- Foreign hooks into spark-hooks.json (M91, PLAN.md D70) ---
//
// Every other agent's format converts into `spark-hooks.json`. The group is
// the import record lane P's adapters and lane W's dispatcher read:
//
//   format       the source format, as lane P's HOOK_FORMATS names it
//   sourceEvent  the source's own event name, verbatim
//   flavor       where a vendor has two contracts: Copilot `copilot` (CLI)
//                or `vscode` (Local); Cursor uses sourceEvent alone
//   sourceEntry  the source entry verbatim (a Claude-shaped source: its
//                group with this one handler), lossless
//   matcher      our tool matcher, translated exactly
//   pathPattern  Kiro's file-path regex; commandPattern Cursor's shell
//                command-text regex: the adapter applies either before the
//                hook runs, so its scope never widens
//   failClosed   Cursor's own, for the adapter
//   loop_limit   Cursor's stop/subagentStop continuation bound
//   description  Kiro's hook name, for Run Hook…
//   hooks        the handler: command (and commandWindows), timeout, cwd
//
// A group carrying `format` is never run natively; the Muse Code backend
// never reads spark-hooks.json.

/** A versioned foreign hooks file: parsed, in a newer format, or unreadable. */
export type ForeignHooksRead =
  | {
      readonly status: 'ok'
      readonly hooks: readonly FoundHook[]
      /** Copilot: the file has a numeric `version` (a Copilot CLI file, not VS Code Local's). */
      readonly isVersioned: boolean
    }
  | { readonly status: 'unknownFormat' }
  | { readonly status: 'unreadable' }

function foreignEntries(
  table: Readonly<Record<string, readonly unknown[]>>,
  isDisabled: boolean,
): readonly FoundHook[] {
  const found: FoundHook[] = []
  for (const [event, entries] of Object.entries(table)) {
    for (const raw of entries) {
      found.push({ event, matcher: undefined, raw, ...(isDisabled && { disabled: true }) })
    }
  }
  return found
}

/** A `{"version":1,"hooks":{…}}` file; another version is a newer format, `disableAllHooks` turns all off. */
function readVersionedFile(text: string): ForeignHooksRead {
  const document = documentOf(text)
  const version = document?.['version']
  if (version !== undefined && version !== 1) {
    return { status: 'unknownFormat' }
  }
  const parsed = settingsHooksSchema.safeParse(document)
  return document === undefined || !parsed.success || parsed.data.hooks === undefined
    ? { status: 'unreadable' }
    : {
        status: 'ok',
        hooks: foreignEntries(parsed.data.hooks, document['disableAllHooks'] === true),
        isVersioned: version !== undefined,
      }
}

interface SparkRecord {
  readonly format: string
  readonly sourceEvent: string
  readonly sourceEntry: unknown
  readonly flavor?: string | undefined
  readonly matcher?: string | undefined
  readonly extra?: JsonObject | undefined
  readonly isAsync?: boolean | undefined
}

/** A converted foreign hook: the mapped event and its import record. */
function sparkHook(
  event: string,
  record: SparkRecord,
  handler: JsonObject,
  dropped: readonly string[] = [],
): Conversion<MuseHook> {
  return {
    ok: true,
    value: {
      event,
      group: {
        ...(record.matcher !== undefined && { matcher: record.matcher }),
        format: record.format,
        sourceEvent: record.sourceEvent,
        ...(record.flavor !== undefined && { flavor: record.flavor }),
        ...record.extra,
        ...(record.isAsync === true && { async: true }),
        hooks: [handler],
        sourceEntry: record.sourceEntry,
      },
    },
    dropped,
  }
}

const MATCHER_FIELD = 'matcher'
const TIMEOUT_FIELD = 'timeout'

// --- Gemini CLI ---

const geminiEntrySchema = z.looseObject({
  name: z.optional(z.string()),
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  timeout: z.optional(z.number()),
  description: z.optional(z.string()),
})
const GEMINI_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'type',
  'command',
  'timeout',
  'description',
])
const GEMINI_GROUP_FIELDS: ReadonlySet<string> = new Set(['matcher', 'sequential'])
const GEMINI_TOOL_EVENTS: ReadonlySet<string> = new Set(['BeforeTool', 'AfterTool'])
/** Gemini's lifecycle matchers are exact strings on these values (raw-codex-gemini.md:65,72). */
const GEMINI_VALUE_MATCHERS: Readonly<Record<string, readonly string[]>> = {
  SessionStart: ['startup', 'resume', 'clear'],
  PreCompress: [...PRE_COMPACT_TRIGGERS],
}

/** Whether an event's groups in this file ask Gemini to run its hooks in order. */
export function geminiSequentialEvents(hooks: readonly FoundHook[]): ReadonlySet<string> {
  return new Set(
    hooks.filter((hook) => hook.group?.['sequential'] === true).map((hook) => hook.event),
  )
}

function geminiMatcher(event: string, matcher: string | undefined): MatcherTranslation {
  if (GEMINI_TOOL_EVENTS.has(event)) {
    return matcher !== undefined &&
      !MATCH_ALL_REGEX.has(matcher) &&
      literalTokens(matcher, /^mcp_[A-Za-z0-9_]+$/)?.isAnchored !== true
      ? REFUSED_MATCHER
      : translateToolMatcher(matcher, GEMINI_VOCABULARY, /^mcp_[A-Za-z0-9_]+$/)
  }
  const values = GEMINI_VALUE_MATCHERS[event]
  if (values !== undefined) {
    const value = matcher === '' ? undefined : matcher
    return value === undefined || values.includes(value)
      ? { ok: true, matcher: value }
      : REFUSED_MATCHER
  }
  if (event === 'SessionEnd' && matcher !== undefined && matcher !== '') return REFUSED_MATCHER
  // Gemini ignores a matcher on every other event: dropping it is exact.
  return { ok: true, matcher: undefined }
}

/**
 * One Gemini CLI hook entry as the `spark-hooks.json` entry. `BeforeModel`
 * and `AfterModel` map to one call each here (Gemini fires them per chunk);
 * `BeforeToolSelection` narrows only, at call admission. A group with
 * `sequential: true` runs its hooks in order there, which the dispatcher
 * here does not, so every hook of that event is refused (pass `sequential`,
 * from `geminiSequentialEvents`). Milliseconds round up to whole seconds;
 * the documented 60 s default is written when there is none.
 */
export function convertGeminiHook(
  hook: FoundHook,
  sequential: ReadonlySet<string> = geminiSequentialEvents([hook]),
): Conversion<MuseHook> {
  const event = AGENT_IMPORT_GEMINI_EVENTS[hook.event]
  if (event === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  const refused = groupRefusal(hook, GEMINI_GROUP_FIELDS)
  if (refused !== undefined) {
    return refused
  }
  if (sequential.has(hook.event)) {
    return fieldRefusal('sequential')
  }
  if (!isJsonObject(hook.raw)) {
    return { ok: false, reason: 'unsupported' }
  }
  const extra = unknownField(hook.raw, GEMINI_ENTRY_FIELDS)
  if (extra !== undefined) {
    return fieldRefusal(extra)
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
      ? AGENT_IMPORT_DEFAULT_TIMEOUT_SECONDS.gemini
      : sourceTimeoutSeconds(entry.data.timeout / MILLISECONDS_PER_SECOND)
  if (seconds === undefined) {
    return fieldRefusal(TIMEOUT_FIELD)
  }
  const matcher = geminiMatcher(hook.event, hook.matcher)
  if (!matcher.ok) {
    return fieldRefusal(MATCHER_FIELD)
  }
  return sparkHook(
    event,
    {
      format: AGENT_IMPORT_FORMATS.gemini,
      sourceEvent: hook.event,
      sourceEntry: { ...hook.group, hooks: [hook.raw] },
      matcher: matcher.matcher,
      isAsync: event === 'PreCompact',
    },
    { type: COMMAND_HANDLER, command, timeout: seconds },
    [
      ...(entry.data.name === undefined ? [] : ['name']),
      ...(entry.data.description === undefined ? [] : ['description']),
    ],
  )
}

// --- Cursor ---

const cursorEntrySchema = z.looseObject({
  command: z.optional(z.string()),
  type: z.optional(z.string()),
  matcher: z.optional(z.string()),
  failClosed: z.optional(z.boolean()),
  timeout: z.optional(z.number()),
  loop_limit: z.optional(z.nullable(z.number())),
})
/** Cursor's per-script options (cursor_com_docs_hooks_md.out:703-710). */
const CURSOR_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'command',
  'type',
  'matcher',
  'failClosed',
  'timeout',
  'loop_limit',
])
/** Cursor's specialised events by their fixed matcher on our tools. */
const CURSOR_SPECIALIZED: Readonly<Record<string, string>> = {
  beforeShellExecution: 'Bash',
  afterShellExecution: 'Bash',
  beforeMCPExecution: `${OUR_MCP_PREFIX}.*`,
  afterMCPExecution: `${OUR_MCP_PREFIX}.*`,
  beforeReadFile: 'Read',
  afterFileEdit: 'Edit|Write',
}
const CURSOR_SHELL_EVENTS: ReadonlySet<string> = new Set([
  'beforeShellExecution',
  'afterShellExecution',
])
const CURSOR_TOOL_EVENTS: ReadonlySet<string> = new Set([
  'preToolUse',
  'postToolUse',
  'postToolUseFailure',
])
const CURSOR_LOOP_EVENTS: ReadonlySet<string> = new Set(['stop', 'subagentStop'])

/** A Cursor `{"version":1,"hooks":{…}}` file; a wrong version is a newer format. */
export function readCursorHooks(text: string): ForeignHooksRead {
  const read = readVersionedFile(text)
  return read.status === 'ok' && !read.isVersioned ? { status: 'unknownFormat' } : read
}

/**
 * Cursor's matcher as ours, or refused: a tool-type matcher translated
 * exactly; a shell-command matcher kept as the command-text predicate
 * (`commandPattern`) beside the fixed shell matcher; a fixed-subject matcher
 * decided now (it runs always, or never: then refused).
 */
function cursorMatcher(
  sourceEvent: string,
  matcher: string | undefined,
):
  | { readonly ok: true; readonly matcher?: string | undefined; readonly commandPattern?: string }
  | { readonly ok: false } {
  const fixed = CURSOR_SPECIALIZED[sourceEvent]
  const isEverything = matcher === undefined || MATCH_ALL_REGEX.has(matcher)
  if (CURSOR_SHELL_EVENTS.has(sourceEvent)) {
    if (isEverything) {
      return { ok: true, matcher: fixed }
    }
    return matcher.length <= HOOK_MATCHER_MAX_CHARS
      ? { ok: true, matcher: fixed, commandPattern: matcher }
      : { ok: false }
  }
  if (CURSOR_TOOL_EVENTS.has(sourceEvent)) {
    const translated = translateToolMatcher(matcher, CURSOR_VOCABULARY, CURSOR_MCP_TOKEN)
    return translated.ok ? { ok: true, matcher: translated.matcher } : { ok: false }
  }
  if (isEverything) {
    return { ok: true, matcher: fixed }
  }
  const subject = AGENT_IMPORT_CURSOR_MATCHER_SUBJECTS[sourceEvent]
  return subject !== undefined && matchesFixedSubject(matcher, subject, true) === true
    ? { ok: true, matcher: fixed }
    : { ok: false }
}

/**
 * One Cursor hook entry as the `spark-hooks.json` entry. Generic tool events
 * (`preToolUse`) and the specialised ones (`beforeShellExecution`) keep their
 * own event, so the adapter selects each envelope without a flavor tag.
 * `failClosed` and `loop_limit` stay for the adapter. `subagentStart` can
 * block where it comes from but only observes here, so it stays refused; the
 * Tab hooks wait for inline completions.
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
  if (hook.disabled === true) {
    return { ok: false, reason: 'disabled' }
  }
  if (!isJsonObject(hook.raw)) {
    return { ok: false, reason: 'unsupported' }
  }
  if (hook.raw['type'] !== undefined && hook.raw['type'] !== COMMAND_HANDLER) {
    return { ok: false, reason: 'unsupported' }
  }
  const extra = unknownField(hook.raw, CURSOR_ENTRY_FIELDS)
  if (extra !== undefined) {
    return fieldRefusal(extra)
  }
  const entry = cursorEntrySchema.safeParse(hook.raw)
  if (
    !entry.success ||
    !hasCommand(entry.data.command) ||
    (entry.data.type !== undefined && entry.data.type !== COMMAND_HANDLER)
  ) {
    return { ok: false, reason: 'unsupported' }
  }
  if (entry.data.loop_limit !== undefined && !CURSOR_LOOP_EVENTS.has(hook.event)) {
    return fieldRefusal('loop_limit')
  }
  const seconds =
    entry.data.timeout === undefined ? undefined : sourceTimeoutSeconds(entry.data.timeout)
  if (seconds === undefined && entry.data.timeout !== undefined) {
    return fieldRefusal(TIMEOUT_FIELD)
  }
  const matcher = cursorMatcher(hook.event, entry.data.matcher)
  if (!matcher.ok) {
    return fieldRefusal(MATCHER_FIELD)
  }
  const isGenericToolless = AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(mapped)
  return sparkHook(
    mapped,
    {
      format: AGENT_IMPORT_FORMATS.cursor,
      sourceEvent: hook.event,
      sourceEntry: hook.raw,
      matcher: isGenericToolless ? undefined : matcher.matcher,
      extra: {
        ...(matcher.commandPattern !== undefined && { commandPattern: matcher.commandPattern }),
        ...(entry.data.failClosed !== undefined && { failClosed: entry.data.failClosed }),
        ...(entry.data.loop_limit !== undefined && { loop_limit: entry.data.loop_limit }),
      },
      isAsync: mapped === 'PostLLMCall' || mapped === 'AfterAgentThought',
    },
    {
      type: COMMAND_HANDLER,
      command: entry.data.command,
      ...(seconds !== undefined && { timeout: seconds }),
    },
  )
}

// --- Copilot and VS Code ---

const copilotEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  bash: z.optional(z.string()),
  powershell: z.optional(z.string()),
  command: z.optional(z.string()),
  cwd: z.optional(z.string()),
  timeoutSec: z.optional(z.number()),
  timeout: z.optional(z.number()),
  matcher: z.optional(z.string()),
})
/** Copilot CLI's command-hook fields (gh/copilot_reference_hooks-configuration.md:120-131). */
const COPILOT_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'bash',
  'powershell',
  'command',
  'cwd',
  'env',
  'exec',
  'args',
  'timeoutSec',
  'timeout',
  'matcher',
])
const vscodeEntrySchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  windows: z.optional(z.string()),
  linux: z.optional(z.string()),
  osx: z.optional(z.string()),
  cwd: z.optional(z.string()),
  timeout: z.optional(z.number()),
})
/** VS Code Local's command properties (vsc/hooks-reference.md:51-62). */
const VSCODE_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'type',
  'command',
  'windows',
  'linux',
  'osx',
  'cwd',
  'env',
  'timeout',
])
/** Copilot events whose matcher names a tool (its "Matcher filtering" table). */
const COPILOT_TOOL_MATCHED: ReadonlySet<string> = new Set([
  'preToolUse',
  'postToolUse',
  'permissionRequest',
  'PreToolUse',
  'PostToolUse',
  'PermissionRequest',
])
const COPILOT_CLAUDE_MATCHED: ReadonlySet<string> = new Set(['PreToolUse', 'PermissionRequest'])

export type CopilotFlavor = 'copilot' | 'vscode'

/** A Copilot hooks file or an inline settings `hooks` block (no version there). */
export function readCopilotHooks(text: string): ForeignHooksRead {
  return readVersionedFile(text)
}

/**
 * The contract a Copilot-location file is written for (vsc/hooks.md:174-178):
 * PascalCase events without a numeric `version` are VS Code Local's own;
 * anything versioned, or an inline settings block, is Copilot CLI's.
 */
export function copilotFlavorOf(
  event: string,
  isVersioned: boolean,
  isSettingsBlock: boolean,
): CopilotFlavor {
  return !isSettingsBlock && !isVersioned && AGENT_IMPORT_VSCODE_EVENTS.includes(event)
    ? 'vscode'
    : 'copilot'
}

function copilotMatcher(sourceEvent: string, matcher: string | undefined): MatcherTranslation {
  if (COPILOT_CLAUDE_MATCHED.has(sourceEvent)) {
    const literal = matcher === undefined ? undefined : literalTokens(matcher)
    // Regex subjects use Claude names; only literal lists accept runtime aliases.
    const vocabulary =
      literal?.isAnchored === true
        ? { ...COPILOT_CLAUDE_VOCABULARY, tools: AGENT_IMPORT_COPILOT_CLAUDE_TOOLS }
        : COPILOT_CLAUDE_VOCABULARY
    return translateToolMatcher(matcher, vocabulary)
  }
  if (COPILOT_TOOL_MATCHED.has(sourceEvent)) {
    return translateToolMatcher(matcher, COPILOT_VOCABULARY)
  }
  if (sourceEvent === 'preCompact' || sourceEvent === 'PreCompact') {
    return translateValueMatcher(matcher, PRE_COMPACT_TRIGGERS, COPILOT_VOCABULARY.everything)
  }
  // Notification types, agent names: no shared vocabulary here.
  return translateValueMatcher(matcher, undefined, COPILOT_VOCABULARY.everything)
}

/** Copilot's `exec`/`args` run without a shell and `env` may hold secrets: refused by name. */
const COPILOT_REFUSED_FIELDS = ['env', 'exec', 'args'] as const

function convertCopilotCli(hook: FoundHook, entry: JsonObject): Conversion<MuseHook> {
  const event =
    AGENT_IMPORT_COPILOT_EVENTS[hook.event] ?? AGENT_IMPORT_COPILOT_PASCAL_EVENTS[hook.event]
  if (event === undefined) {
    return {
      ok: false,
      reason: hook.event === 'userPromptTransformed' ? 'unsupported' : 'unmapped',
    }
  }
  if (entry['type'] !== undefined && entry['type'] !== COMMAND_HANDLER) {
    return { ok: false, reason: 'unsupported' }
  }
  const extra = unknownField(entry, COPILOT_ENTRY_FIELDS)
  if (extra !== undefined) {
    return fieldRefusal(extra)
  }
  const refusedField = COPILOT_REFUSED_FIELDS.find((field) => entry[field] !== undefined)
  if (refusedField !== undefined) {
    return fieldRefusal(refusedField)
  }
  const parsed = copilotEntrySchema.safeParse(entry)
  if (!parsed.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const { type, bash, powershell, command, cwd } = parsed.data
  if (type !== undefined && type !== COMMAND_HANDLER) {
    return { ok: false, reason: 'unsupported' }
  }
  // `command` is the cross-platform fallback, copied to whichever of `bash`
  // and `powershell` is absent.
  const unix = firstCommand(bash, command)
  const windows = firstCommand(powershell, command)
  if (unix === undefined && windows === undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  // `timeout` is an alias, used only when `timeoutSec` is absent.
  const timeoutValue = parsed.data.timeoutSec ?? parsed.data.timeout
  const seconds =
    timeoutValue === undefined
      ? AGENT_IMPORT_DEFAULT_TIMEOUT_SECONDS.copilot
      : sourceTimeoutSeconds(timeoutValue)
  if (seconds === undefined) {
    return fieldRefusal(parsed.data.timeoutSec === undefined ? TIMEOUT_FIELD : 'timeoutSec')
  }
  const matcher = copilotMatcher(hook.event, parsed.data.matcher)
  if (!matcher.ok) {
    return fieldRefusal(MATCHER_FIELD)
  }
  return sparkHook(
    event,
    {
      format: AGENT_IMPORT_FORMATS.copilot,
      sourceEvent: hook.event,
      flavor: 'copilot',
      sourceEntry: entry,
      matcher: AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(event)
        ? undefined
        : matcher.matcher,
    },
    {
      type: COMMAND_HANDLER,
      ...(unix !== undefined && { command: unix }),
      ...(windows !== undefined && windows !== unix && { commandWindows: windows }),
      timeout: seconds,
      ...(cwd !== undefined && { cwd }),
    },
  )
}

function convertVsCodeLocal(hook: FoundHook, entry: JsonObject): Conversion<MuseHook> {
  const extra = unknownField(entry, VSCODE_ENTRY_FIELDS)
  if (extra !== undefined) {
    return fieldRefusal(extra)
  }
  if (entry['env'] !== undefined) {
    return fieldRefusal('env')
  }
  const parsed = vscodeEntrySchema.safeParse(entry)
  if (!parsed.success || parsed.data.type !== COMMAND_HANDLER) {
    return { ok: false, reason: 'unsupported' }
  }
  const { command, windows, linux, osx, cwd } = parsed.data
  // One command off Windows: Linux and macOS must agree, as our handler has one.
  const onLinux = firstCommand(linux, command)
  const onMac = firstCommand(osx, command)
  if (onLinux !== onMac) {
    return fieldRefusal(hasCommand(linux) ? 'linux' : 'osx')
  }
  const onWindows = firstCommand(windows, command)
  if (onLinux === undefined && onWindows === undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  const seconds =
    parsed.data.timeout === undefined
      ? AGENT_IMPORT_DEFAULT_TIMEOUT_SECONDS.vscode
      : sourceTimeoutSeconds(parsed.data.timeout)
  if (seconds === undefined) {
    return fieldRefusal(TIMEOUT_FIELD)
  }
  return sparkHook(
    hook.event,
    {
      format: AGENT_IMPORT_FORMATS.copilot,
      sourceEvent: hook.event,
      flavor: 'vscode',
      sourceEntry: entry,
    },
    {
      type: COMMAND_HANDLER,
      ...(onLinux !== undefined && { command: onLinux }),
      ...(onWindows !== undefined && onWindows !== onLinux && { commandWindows: onWindows }),
      timeout: seconds,
      ...(cwd !== undefined && { cwd }),
    },
  )
}

/**
 * One Copilot or VS Code hook entry as the `spark-hooks.json` entry, with
 * its flavor (`copilotFlavorOf`) and its event spelled as the source wrote
 * it: camelCase and PascalCase are separate Copilot CLI contracts, and VS
 * Code Local a third. `cwd` stays for the adapter, which runs it only when
 * relative and confined to the workspace; `env`, `exec` and `args` are
 * refused by name. The documented 30 s default is written when there is no
 * timeout.
 */
export function convertCopilotHook(
  hook: FoundHook,
  flavor: CopilotFlavor = 'copilot',
): Conversion<MuseHook> {
  if (hook.disabled === true) {
    return { ok: false, reason: 'disabled' }
  }
  if (!isJsonObject(hook.raw)) {
    return { ok: false, reason: 'unsupported' }
  }
  return flavor === 'vscode' && AGENT_IMPORT_VSCODE_EVENTS.includes(hook.event)
    ? convertVsCodeLocal(hook, hook.raw)
    : convertCopilotCli(hook, hook.raw)
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
    : foreignEntries(parsed.data.hooks, false)
}

/**
 * One Windsurf hook entry as the `spark-hooks.json` entry with the matcher
 * for its kind. Exit codes only: pre hooks stay synchronous so a block still
 * blocks. `working_directory` and the transcript answer have no equivalent
 * here and are refused.
 */
export function convertWindsurfHook(hook: FoundHook): Conversion<MuseHook> {
  const mapped = AGENT_IMPORT_WINDSURF_EVENTS[hook.event]
  if (mapped === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  if (!isJsonObject(hook.raw)) {
    return { ok: false, reason: 'unsupported' }
  }
  const extra = unknownField(hook.raw, WINDSURF_ENTRY_FIELDS)
  if (extra !== undefined) {
    return fieldRefusal(extra)
  }
  const entry = windsurfEntrySchema.safeParse(hook.raw)
  if (!entry.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const command = hasCommand(entry.data.command) ? entry.data.command : undefined
  // Windows runs `powershell`, else falls back to `command`.
  const commandWindows = hasCommand(entry.data.powershell) ? entry.data.powershell : undefined
  if (command === undefined && commandWindows === undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  return sparkHook(
    mapped.event,
    {
      format: AGENT_IMPORT_FORMATS.windsurf,
      sourceEvent: hook.event,
      sourceEntry: hook.raw,
      matcher: mapped.matcher,
      isAsync: mapped.async,
    },
    {
      type: COMMAND_HANDLER,
      ...(command !== undefined && { command }),
      ...(commandWindows !== undefined && { commandWindows }),
    },
    entry.data.show_output === undefined ? [] : ['show_output'],
  )
}

// --- Kiro v1 ---

/** One Kiro v1 hooks-array entry, kept whole. */
export interface KiroHook {
  readonly name: string | undefined
  readonly trigger: string
  /** The entry as written: `timeout`, `enabled`, `confirm` and the rest included. */
  readonly raw: unknown
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
  description: z.optional(z.string()),
  trigger: z.optional(z.string()),
  matcher: z.optional(z.string()),
  action: z.optional(z.unknown()),
  timeout: z.optional(z.number()),
  enabled: z.optional(z.boolean()),
  confirm: z.optional(z.unknown()),
})
/** Kiro's entry fields (raw/kiro_hooks.md:77-90). */
const KIRO_ENTRY_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'trigger',
  'matcher',
  'action',
  'timeout',
  'enabled',
  'confirm',
])
const kiroActionSchema = z.looseObject({
  type: z.optional(z.string()),
  command: z.optional(z.string()),
  prompt: z.optional(z.string()),
})
const KIRO_ACTION_FIELDS: ReadonlySet<string> = new Set(['type', 'command', 'prompt'])
const KIRO_TOOL_TRIGGERS: ReadonlySet<string> = new Set(['PreToolUse', 'PostToolUse'])

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
      return entry.success
        ? { name: entry.data.name, trigger: entry.data.trigger ?? '', raw }
        : { name: undefined, trigger: '', raw }
    }),
  }
}

/** Kiro's matcher by its trigger's subject (raw/kiro_ide_whats-new-v1_hooks.md:44-55). */
function kiroMatcher(
  trigger: string,
  matcher: string | undefined,
):
  | { readonly ok: true; readonly matcher?: string | undefined; readonly pathPattern?: string }
  | { readonly ok: false } {
  if (AGENT_IMPORT_KIRO_FILE_TRIGGERS.includes(trigger)) {
    if (matcher === undefined || matcher === '') {
      return { ok: true, matcher: AGENT_IMPORT_KIRO_FILE_MATCHER }
    }
    return matcher.length <= HOOK_MATCHER_MAX_CHARS
      ? { ok: true, matcher: AGENT_IMPORT_KIRO_FILE_MATCHER, pathPattern: matcher }
      : { ok: false }
  }
  if (KIRO_TOOL_TRIGGERS.has(trigger)) {
    const translated = translateToolMatcher(matcher, KIRO_VOCABULARY, KIRO_MCP_TOKEN)
    return translated.ok ? { ok: true, matcher: translated.matcher } : { ok: false }
  }
  if (trigger === 'UserPromptSubmit') {
    // A prompt-text filter: our UserPromptSubmit takes no matcher, so it is refused.
    return { ok: matcher === undefined || matcher === '' }
  }
  // Session, stop, task and manual triggers take no matcher there.
  return { ok: true }
}

/**
 * One Kiro v1 entry as the `spark-hooks.json` entry. `enabled: false` is
 * refused as disabled; a `confirm` question (and its `confirmCommand`) has
 * no equivalent here, so the entry is refused naming it. File triggers map
 * to `PostToolUse` on file tools with the path regex as `pathPattern`;
 * spec-task triggers map to the todo-item events; `Manual` is refused until
 * its adapter row exists. Agent actions become `prompt` handlers under lane H's
 * paid-feature gates, with the same scope as a command. `hooks[].timeout`
 * is kept (60 s when absent); `0` (no limit) cannot be honoured and is
 * refused.
 */
export function convertKiroHook(hook: KiroHook): Conversion<MuseHook> {
  if (!isJsonObject(hook.raw) || hook.trigger === '') {
    return { ok: false, reason: 'unsupported' }
  }
  const extra = unknownField(hook.raw, KIRO_ENTRY_FIELDS)
  if (extra !== undefined) {
    return fieldRefusal(extra)
  }
  const entry = kiroEntrySchema.safeParse(hook.raw)
  if (!entry.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const task = AGENT_IMPORT_KIRO_TASK_EVENTS[hook.trigger]
  const isFile = AGENT_IMPORT_KIRO_FILE_TRIGGERS.includes(hook.trigger)
  const event =
    task ?? AGENT_IMPORT_KIRO_EVENTS[hook.trigger] ?? (isFile ? 'PostToolUse' : undefined)
  if (event === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  if (entry.data.enabled === false) {
    return { ok: false, reason: 'disabled' }
  }
  if (hook.trigger === 'Manual') return { ok: false, reason: 'unmapped' }
  if (entry.data.confirm !== undefined) {
    return fieldRefusal('confirm')
  }
  const action = entry.data.action
  if (!isJsonObject(action) || unknownField(action, KIRO_ACTION_FIELDS) !== undefined) {
    return { ok: false, reason: 'unsupported' }
  }
  const parsedAction = kiroActionSchema.safeParse(action)
  if (!parsedAction.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const matcher = kiroMatcher(hook.trigger, entry.data.matcher)
  if (!matcher.ok) {
    return fieldRefusal(MATCHER_FIELD)
  }
  const record: SparkRecord = {
    format: AGENT_IMPORT_FORMATS.kiro,
    sourceEvent: hook.trigger,
    sourceEntry: hook.raw,
    matcher: matcher.matcher,
    extra: {
      ...(matcher.pathPattern !== undefined && { pathPattern: matcher.pathPattern }),
      ...(entry.data.name !== undefined && { description: entry.data.name }),
    },
  }
  const dropped = entry.data.description === undefined ? [] : ['description']
  const { type, command, prompt } = parsedAction.data
  if (type === COMMAND_HANDLER && prompt === undefined) {
    if (!hasCommand(command)) {
      return { ok: false, reason: 'unsupported' }
    }
    const seconds = kiroTimeoutSeconds(entry.data.timeout)
    return seconds === undefined
      ? fieldRefusal(TIMEOUT_FIELD)
      : sparkHook(event, record, { type: COMMAND_HANDLER, command, timeout: seconds }, dropped)
  }
  if (type === 'agent' && command === undefined && prompt !== undefined && prompt.trim() !== '') {
    // Kiro ignores `timeout` on agent actions (raw/kiro_hooks.md:86).
    return sparkHook(event, record, { type: 'prompt', prompt }, dropped)
  }
  return { ok: false, reason: 'unsupported' }
}

/**
 * Kiro's `hooks[].timeout` in seconds (60 when absent); `0` turns Kiro's
 * limit off, which this runtime cannot honour, so it is refused.
 */
function kiroTimeoutSeconds(timeout: number | undefined): number | undefined {
  if (timeout === undefined) {
    return AGENT_IMPORT_DEFAULT_TIMEOUT_SECONDS.kiro
  }
  return timeout === 0 ? undefined : sourceTimeoutSeconds(timeout)
}

// --- Cline v1 ---

export type ClineFileKind =
  | { readonly kind: 'event'; readonly sourceEvent: string }
  | { readonly kind: 'unknownFormat' }
  | { readonly kind: 'ignore' }

/**
 * A Cline hooks-folder entry by Cline v1's discovery rules
 * (cline-hooks-901d1b5c97.mdx:166-172): on Windows only `<HookName>.ps1`, on
 * macOS and Linux only an extensionless `<HookName>`; wrong-platform names
 * are ignored, as Cline ignores them. A JSON file is the newer SDK/CLI
 * format, refused with a reason. The kind carries Cline's own script name.
 */
export function clineEventForFile(fileName: string, platform: NodeJS.Platform): ClineFileKind {
  if (fileName.toLowerCase().endsWith(AGENT_IMPORT_JSON_EXTENSION)) {
    return { kind: 'unknownFormat' }
  }
  const extension = AGENT_IMPORT_CLINE_WINDOWS_EXTENSION
  if (platform === 'win32' && !fileName.toLowerCase().endsWith(extension)) {
    return { kind: 'ignore' }
  }
  const stem = platform === 'win32' ? fileName.slice(0, -extension.length) : fileName
  return Object.hasOwn(AGENT_IMPORT_CLINE_EVENTS, stem)
    ? { kind: 'event', sourceEvent: stem }
    : { kind: 'ignore' }
}

/**
 * One Cline v1 per-event script, by Cline's own script name, as the
 * `spark-hooks.json` entry. The script stays where it is; the entry runs it
 * by its absolute path, so the preview lists the event only, never command
 * text. A script the source would not run (`isEnabled` false: not
 * executable on macOS and Linux, Cline's toggle) is refused as disabled.
 */
export function convertClineHook(
  sourceEvent: string,
  command: string,
  isEnabled = true,
): Conversion<MuseHook> {
  const event = AGENT_IMPORT_CLINE_EVENTS[sourceEvent]
  if (
    command === '' ||
    event === undefined ||
    !Object.hasOwn(AGENT_IMPORT_CLINE_EVENTS, sourceEvent)
  ) {
    return { ok: false, reason: 'unmapped' }
  }
  if (!isEnabled) {
    return { ok: false, reason: 'disabled' }
  }
  return sparkHook(
    event,
    {
      format: AGENT_IMPORT_FORMATS.cline,
      sourceEvent,
      sourceEntry: { path: command },
    },
    {
      type: COMMAND_HANDLER,
      timeout: AGENT_IMPORT_DEFAULT_TIMEOUT_SECONDS.cline,
      command: `'${command.replaceAll("'", String.raw`'\''`)}'`,
      commandWindows: `& '${command.replaceAll("'", "''")}'`,
    },
  )
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
  return `## ${fill(AGENT_IMPORT_MODEL_TEXT.importedRulesHeading, { source: sourceName, path: displayPath })}`
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
    ...(description === ''
      ? []
      : [fill(AGENT_IMPORT_MODEL_TEXT.importedRulesWhen, { description })]),
    ...(globs === '' ? [] : [fill(AGENT_IMPORT_MODEL_TEXT.importedRulesFiles, { globs })]),
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
