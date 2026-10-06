// What the Model API backend starts from Muse Code's settings (M50, PLAN.md
// D42): the servers M31's reader finds (`mcpServers`, or the legacy
// `mcp_servers`), checked as Muse Code 1.3.0 checks them. The keys and rules
// come from its public docs and changelog and from its binary's settings
// types and messages:
//
// - `type` or `transport`: `stdio` (a bare `command` is stdio) or
//   `streamable-http` (`streamable_http`, `http`); anything else (`sse`, `ws`)
//   is not started.
// - stdio: `command` (a string), `args`, `env`, `cwd`, `framing` (`auto`,
//   `content_length`, `line_delimited_json`); it must not set `url`.
// - streamable-http: `url` (http or https) and `headers`; it must not set
//   `command`, `args`, `env` or `framing`.
// - every server: `enabled` (false: not started), `mode` (only `optional`
//   is optional), `startup_timeout_sec`, `tool_timeout_sec`, and the tool
//   filters `enabled_tools` and `disabled_tools` (the migrate skill copies
//   them from Codex; honoured here).
// - `${VAR}` in any string is the extension host's environment variable
//   (the 1.2.1 changelog: "MCP server configs support `${VAR}` environment
//   interpolation"); one that is not set keeps the server from starting,
//   named, never its value.
//
// Two faults make Muse Code load no user server at all, and so none here:
// both keys in one file, and `required` beside `mode` on a server (M31). The
// name `ide` is the extension's own diagnostics server's. Pure.

import {
  MCP_FRAMINGS,
  type McpFraming,
  MCP_STARTUP_TIMEOUT_MS,
  MCP_TIMEOUT_MAX_SECONDS,
  MCP_TOOL_TIMEOUT_MS,
  MCP_TRANSPORTS,
  IDE_MCP_SERVER_NAME,
  MILLISECONDS_PER_SECOND,
} from '../../../../shared/constants'
import type { McpSettingsEntries, McpServerView } from '../../musecode/museConfigView'
import { mcpServerPart } from './functions'
// M96 lane T (LANE-T-SEAM, lane 0): import from shared constants at integration.
import { TEAM_MCP_SERVER_NAME } from '../../../../shared/constants'

export interface McpStdioLaunch {
  readonly transport: typeof MCP_TRANSPORTS.stdio
  readonly command: string
  readonly args: readonly string[]
  readonly env: Readonly<Record<string, string>>
  /** As the entry gives it; relative to the workspace root when not absolute. */
  readonly cwd: string | undefined
  readonly framing: McpFraming
}

export interface McpHttpLaunch {
  readonly transport: typeof MCP_TRANSPORTS.streamableHttp
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
}

export type McpLaunch = McpStdioLaunch | McpHttpLaunch

export interface McpServerSpec {
  readonly name: string
  readonly view: McpServerView
  readonly isRequired: boolean
  readonly isEnabled: boolean
  /** What to start, or why it cannot be. */
  readonly launch:
    | { readonly ok: true; readonly value: McpLaunch }
    | { readonly ok: false; readonly reason: string }
  readonly startupTimeoutMs: number
  readonly toolTimeoutMs: number
  /** Only these tools are offered, when set. */
  readonly enabledTools: ReadonlySet<string> | undefined
  readonly disabledTools: ReadonlySet<string>
}

/** Why no server of the file is loaded. */
export type McpSettingsFault =
  | { readonly kind: 'keys' }
  | { readonly kind: 'mode'; readonly servers: readonly string[] }
  | { readonly kind: 'unreadable'; readonly reason: string }

export type McpServerPlan =
  | { readonly kind: 'servers'; readonly specs: readonly McpServerSpec[] }
  | { readonly kind: 'fault'; readonly fault: McpSettingsFault }

type JsonObject = Readonly<Record<string, unknown>>

const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const HTTP_ONLY_KEYS = ['url', 'headers'] as const
const STDIO_ONLY_KEYS = ['command', 'args', 'env', 'framing'] as const
const HTTP_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/** A reason a server is not started; its entry is wrong. */
class EntryProblem extends Error {}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `${VAR}` replaced from the environment; an unset one is named, never guessed. */
function expand(text: string, lookupEnv: (name: string) => string | undefined): string {
  return text.replaceAll(VARIABLE, (_match, name: string) => {
    const value = lookupEnv(name)
    if (value === undefined) {
      throw new EntryProblem(`the environment variable ${name} is not set`)
    }
    return value
  })
}

function stringField(
  entry: JsonObject,
  key: string,
  lookupEnv: (name: string) => string | undefined,
): string | undefined {
  const value = entry[key]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new EntryProblem(`"${key}" must be a string`)
  }
  return expand(value, lookupEnv)
}

/** A list of strings, each `${VAR}` expanded when `lookupEnv` is given. */
function stringList(
  entry: JsonObject,
  key: string,
  lookupEnv?: (name: string) => string | undefined,
): readonly string[] | undefined {
  const value = entry[key]
  if (value === undefined) {
    return undefined
  }
  const problem = new EntryProblem(`"${key}" must be a list of strings`)
  if (!Array.isArray(value)) {
    throw problem
  }
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      throw problem
    }
    items.push(lookupEnv === undefined ? item : expand(item, lookupEnv))
  }
  return items
}

function stringMap(
  entry: JsonObject,
  key: string,
  lookupEnv: (name: string) => string | undefined,
): Readonly<Record<string, string>> {
  const value = entry[key]
  if (value === undefined) {
    return {}
  }
  if (!isObject(value)) {
    throw new EntryProblem(`"${key}" must be an object of strings`)
  }
  const map: Record<string, string> = {}
  for (const [name, item] of Object.entries(value)) {
    if (typeof item !== 'string') {
      throw new EntryProblem(`"${key}" must be an object of strings`)
    }
    map[name] = expand(item, lookupEnv)
  }
  return map
}

function timeoutMs(entry: JsonObject, key: string, fallbackMs: number): number {
  const value = entry[key]
  if (value === undefined) {
    return fallbackMs
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new EntryProblem(`"${key}" must be a positive number of seconds`)
  }
  return Math.min(value, MCP_TIMEOUT_MAX_SECONDS) * MILLISECONDS_PER_SECOND
}

function refuseKeys(entry: JsonObject, keys: readonly string[], transport: string): void {
  const present = keys.filter((key) => entry[key] !== undefined)
  if (present.length > 0) {
    throw new EntryProblem(`a ${transport} server must not set ${present.join(', ')}`)
  }
}

function isFraming(value: unknown): value is McpFraming {
  const known: readonly unknown[] = MCP_FRAMINGS
  return known.includes(value)
}

function framingOf(entry: JsonObject): McpFraming {
  const value = entry['framing']
  if (value === undefined) {
    return 'auto'
  }
  if (!isFraming(value)) {
    throw new EntryProblem(`"framing" must be one of ${MCP_FRAMINGS.join(', ')}`)
  }
  return value
}

function stdioLaunch(
  entry: JsonObject,
  lookupEnv: (name: string) => string | undefined,
): McpStdioLaunch {
  refuseKeys(entry, HTTP_ONLY_KEYS, MCP_TRANSPORTS.stdio)
  const command = stringField(entry, 'command', lookupEnv)
  if (command === undefined || command.trim() === '') {
    throw new EntryProblem('it has no command')
  }
  return {
    transport: MCP_TRANSPORTS.stdio,
    command,
    args: stringList(entry, 'args', lookupEnv) ?? [],
    env: stringMap(entry, 'env', lookupEnv),
    cwd: stringField(entry, 'cwd', lookupEnv),
    framing: framingOf(entry),
  }
}

function httpLaunch(
  entry: JsonObject,
  lookupEnv: (name: string) => string | undefined,
): McpHttpLaunch {
  refuseKeys(entry, STDIO_ONLY_KEYS, MCP_TRANSPORTS.streamableHttp)
  const url = stringField(entry, 'url', lookupEnv)
  if (url === undefined) {
    throw new EntryProblem('it has no url')
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new EntryProblem('its url is not a URL')
  }
  if (!HTTP_SCHEMES.has(parsed.protocol)) {
    throw new EntryProblem('its url must start with http:// or https://')
  }
  return {
    transport: MCP_TRANSPORTS.streamableHttp,
    url,
    headers: stringMap(entry, 'headers', lookupEnv),
  }
}

function launchOf(
  view: McpServerView,
  entry: JsonObject,
  lookupEnv: (name: string) => string | undefined,
): McpLaunch {
  if (mcpServerPart(view.name) === IDE_MCP_SERVER_NAME) {
    throw new EntryProblem(
      `the name ${IDE_MCP_SERVER_NAME} is the extension's own diagnostics server; rename this entry`,
    )
  }
  // M96 (PLAN.md D75): a user's MCP server may not be named `team`, as it
  // may not be named `ide`.
  if (mcpServerPart(view.name) === TEAM_MCP_SERVER_NAME) {
    throw new EntryProblem(
      `the name ${TEAM_MCP_SERVER_NAME} is the extension's own team server; rename this entry`,
    )
  }
  if (view.transport === MCP_TRANSPORTS.stdio) {
    return stdioLaunch(entry, lookupEnv)
  }
  if (view.transport === MCP_TRANSPORTS.streamableHttp) {
    return httpLaunch(entry, lookupEnv)
  }
  throw new EntryProblem(
    `the transport ${view.transport} is not supported; use stdio or streamable_http`,
  )
}

function specOf(
  view: McpServerView,
  entry: JsonObject,
  lookupEnv: (name: string) => string | undefined,
): McpServerSpec {
  const base = {
    name: view.name,
    view,
    isRequired: view.mode === 'required',
    isEnabled: view.isEnabled,
  }
  try {
    const enabledTools = stringList(entry, 'enabled_tools')
    return {
      ...base,
      launch: { ok: true, value: launchOf(view, entry, lookupEnv) },
      startupTimeoutMs: timeoutMs(entry, 'startup_timeout_sec', MCP_STARTUP_TIMEOUT_MS),
      toolTimeoutMs: timeoutMs(entry, 'tool_timeout_sec', MCP_TOOL_TIMEOUT_MS),
      enabledTools: enabledTools === undefined ? undefined : new Set(enabledTools),
      disabledTools: new Set(stringList(entry, 'disabled_tools')),
    }
  } catch (error: unknown) {
    if (!(error instanceof EntryProblem)) {
      throw error
    }
    return {
      ...base,
      launch: { ok: false, reason: error.message },
      startupTimeoutMs: MCP_STARTUP_TIMEOUT_MS,
      toolTimeoutMs: MCP_TOOL_TIMEOUT_MS,
      enabledTools: undefined,
      disabledTools: new Set(),
    }
  }
}

/** The servers to start from the settings, or the fault that loads none. */
export function planMcpServers(
  settings: McpSettingsEntries,
  lookupEnv: (name: string) => string | undefined,
): McpServerPlan {
  switch (settings.status) {
    case 'missing': {
      return { kind: 'servers', specs: [] }
    }
    case 'unreadable': {
      return { kind: 'fault', fault: { kind: 'unreadable', reason: settings.reason } }
    }
    case 'read': {
      if (settings.hasKeyConflict) {
        return { kind: 'fault', fault: { kind: 'keys' } }
      }
      const conflicted = settings.entries
        .filter(({ view }) => view.hasModeConflict)
        .map(({ view }) => view.name)
      if (conflicted.length > 0) {
        return { kind: 'fault', fault: { kind: 'mode', servers: conflicted } }
      }
      return {
        kind: 'servers',
        specs: settings.entries.map(({ view, entry }) => specOf(view, entry, lookupEnv)),
      }
    }
  }
}
