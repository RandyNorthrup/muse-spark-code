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
  AGENT_IMPORT_HOOK_EVENTS,
  AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER,
  HOOK_MAX_TIMEOUT_SECONDS,
  MCP_TRANSPORTS,
  MODEL_TEXT,
  MUSE_MCP_OPTIONAL_MODE,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'

/** Why an entry that was found is not converted. */
export type ConversionRefusal = 'disabled' | 'unsupported' | 'unmapped'

export type Conversion<T> =
  | { readonly ok: true; readonly value: T; readonly dropped: readonly string[] }
  | { readonly ok: false; readonly reason: ConversionRefusal }

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

/** Every handler of a Claude Code settings file's `hooks` block; undefined when the file is not one. */
export function readClaudeHooks(text: string): readonly FoundHook[] | undefined {
  const parsed = settingsHooksSchema.safeParse(parseJson(text))
  if (!parsed.success) {
    return undefined
  }
  const found: FoundHook[] = []
  const events = Object.entries(parsed.data.hooks ?? {})
  for (const [event, groups] of events) {
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

/**
 * One Claude Code hook handler as Muse Code's; refused when it would widen
 * or cannot run. Values stay unchanged in the allowed target.
 */
export function convertHook(hook: FoundHook): Conversion<MuseHook> {
  if (!AGENT_IMPORT_HOOK_EVENTS.includes(hook.event)) {
    return { ok: false, reason: 'unmapped' }
  }
  const handler = hookHandlerSchema.safeParse(hook.raw)
  const raw: unknown = hook.raw
  const hasOnlyKnownFields =
    typeof raw === 'object' &&
    raw !== null &&
    Object.keys(raw).every((key) => HANDLER_FIELDS.has(key))
  if (!hasOnlyKnownFields || !handler.success) {
    return { ok: false, reason: 'unsupported' }
  }
  const { type, command, timeout, statusMessage } = handler.data
  if (
    type !== COMMAND_HANDLER ||
    !hasCommand(command) ||
    (timeout !== undefined &&
      (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > HOOK_MAX_TIMEOUT_SECONDS))
  ) {
    return { ok: false, reason: 'unsupported' }
  }
  const isMatcherKept =
    hook.matcher !== undefined &&
    !MATCH_EVERYTHING.has(hook.matcher) &&
    !AGENT_IMPORT_HOOK_EVENTS_WITHOUT_MATCHER.includes(hook.event)
  return {
    ok: true,
    value: {
      event: hook.event,
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
