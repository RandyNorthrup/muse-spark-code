// What Muse Code will load from its own settings file, read-only (M31,
// PLAN.md D30; the extension never writes that file, D17): the MCP servers
// and the hook sources. MSP has no method for either.
//
// Two spellings exist. Meta's docs show `mcp_servers` with `transport`; the
// 1.3.0 binary's own migrate skill writes `mcpServers` with `type` and calls
// `mcp_servers` legacy, and records two faults that make Muse drop every
// user MCP server while the rest of the settings still apply: both keys in
// one file, and `required` beside `mode` on one server. Both spellings are
// read and both faults reported.
//
// Nothing secret is shown: `env` and `headers` are reduced to their names
// and a URL to its scheme and host. The Model API backend (M50, PLAN.md D42)
// starts the same servers from the same reading: `readMcpServerEntries`
// hands it each entry whole beside its view, and the view stays secret-free.
//
// Pure: the host reads the file and shows the view.

import path from 'node:path'
import { MCP_TRANSPORTS, UI_TEXT } from '../../../shared/constants'

const CAMEL_KEY = 'mcpServers'
const LEGACY_KEY = 'mcp_servers'
const HOOKS_KEY = 'hooks'
const MANAGED_HOOKS_KEY = 'managed_hooks_path'
const STDIO = MCP_TRANSPORTS.stdio
const STREAMABLE_HTTP = MCP_TRANSPORTS.streamableHttp
const HTTP_TRANSPORTS: ReadonlySet<string> = new Set(['streamable-http', 'streamable_http', 'http'])
const OPTIONAL_MODE = 'optional'
const REQUIRED_MODE = 'required'

export interface McpServerView {
  readonly name: string
  /** `stdio`, `streamable-http`, or the file's own word for anything else. */
  readonly transport: string
  /** The command's file name, or the URL's scheme and host. */
  readonly target: string
  /** What Muse Code's startup gate reads: only `mode: "optional"` is optional. */
  readonly mode: typeof OPTIONAL_MODE | typeof REQUIRED_MODE
  readonly isEnabled: boolean
  /** Only the names; the values stay in the file. */
  readonly envNames: readonly string[]
  readonly headerNames: readonly string[]
  /** `required` and `mode` both set: Muse drops every user server for it. */
  readonly hasModeConflict: boolean
}

export type McpSettingsView =
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly reason: string }
  | {
      readonly status: 'read'
      readonly servers: readonly McpServerView[]
      /** Both `mcpServers` and `mcp_servers`: Muse loads neither. */
      readonly hasKeyConflict: boolean
      /** Every server comes from the legacy `mcp_servers` key. */
      readonly isLegacy: boolean
    }

/** One server as the file holds it: its view, and the entry itself, secrets included. */
export interface McpServerEntry {
  readonly view: McpServerView
  readonly entry: Readonly<Record<string, unknown>>
}

/** `McpSettingsView` with each server's whole entry (M50); never shown. */
export type McpSettingsEntries =
  | { readonly status: 'missing' }
  | { readonly status: 'unreadable'; readonly reason: string }
  | {
      readonly status: 'read'
      readonly entries: readonly McpServerEntry[]
      readonly hasKeyConflict: boolean
      readonly isLegacy: boolean
    }

export interface HookSourcesView {
  /** Hooks in the settings file's own `hooks` block; undefined when there is none. */
  readonly userHookCount: number | undefined
  /** `managed_hooks_path`, when the settings name one. */
  readonly managedHooksPath: string | undefined
}

type JsonObject = Readonly<Record<string, unknown>>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(entry: JsonObject, key: string): string | undefined {
  const value = entry[key]
  return typeof value === 'string' ? value : undefined
}

function namesOf(value: unknown): readonly string[] {
  return isObject(value) ? Object.keys(value) : []
}

function transportOf(entry: JsonObject): string {
  const declared = stringField(entry, 'type') ?? stringField(entry, 'transport')
  if (declared === undefined) {
    // Claude Code's and Muse's convention: a bare command is stdio.
    return entry['url'] === undefined ? STDIO : STREAMABLE_HTTP
  }
  return HTTP_TRANSPORTS.has(declared) ? STREAMABLE_HTTP : declared
}

/** `https://host`, never a path, query or credentials. */
function urlTarget(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return UI_TEXT.mcpInvalidUrl
  }
}

function commandTarget(command: unknown): string {
  const first: unknown = Array.isArray(command) ? command[0] : command
  if (typeof first !== 'string' || first === '') {
    return UI_TEXT.mcpNoCommand
  }
  // A Windows path's separators are read on every platform.
  return path.win32.basename(path.posix.basename(first))
}

function serverView(name: string, entry: JsonObject): McpServerView {
  const transport = transportOf(entry)
  const url = stringField(entry, 'url')
  return {
    name,
    transport,
    target: transport === STREAMABLE_HTTP ? urlTarget(url ?? '') : commandTarget(entry['command']),
    mode: stringField(entry, 'mode') === OPTIONAL_MODE ? OPTIONAL_MODE : REQUIRED_MODE,
    isEnabled: entry['enabled'] !== false,
    envNames: namesOf(entry['env']),
    headerNames: namesOf(entry['headers']),
    hasModeConflict: 'required' in entry && 'mode' in entry,
  }
}

function parsed(text: string): JsonObject | string {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }
  return isObject(value) ? value : 'the file does not hold a JSON object'
}

/** Each server the settings file declares, whole; `text` undefined when there is no file. */
export function readMcpServerEntries(text: string | undefined): McpSettingsEntries {
  if (text === undefined) {
    return { status: 'missing' }
  }
  const settings = parsed(text)
  if (typeof settings === 'string') {
    return { status: 'unreadable', reason: settings }
  }
  const camel = settings[CAMEL_KEY]
  const legacy = settings[LEGACY_KEY]
  const entries = [camel, legacy].flatMap((block) =>
    isObject(block)
      ? Object.entries(block).flatMap(([name, entry]) =>
          isObject(entry) ? [{ view: serverView(name, entry), entry }] : [],
        )
      : [],
  )
  return {
    status: 'read',
    entries,
    hasKeyConflict: camel !== undefined && legacy !== undefined,
    isLegacy: camel === undefined && legacy !== undefined,
  }
}

/** The MCP servers the settings file declares; `text` undefined when there is no file. */
export function readMcpServers(text: string | undefined): McpSettingsView {
  const read = readMcpServerEntries(text)
  if (read.status !== 'read') {
    return read
  }
  const { entries, hasKeyConflict, isLegacy } = read
  return { status: 'read', servers: entries.map(({ view }) => view), hasKeyConflict, isLegacy }
}

function hookCount(block: unknown): number | undefined {
  if (Array.isArray(block)) {
    return block.length
  }
  return isObject(block) ? Object.keys(block).length : undefined
}

/** The hook sources the settings file names; nothing when it is missing or unreadable. */
export function readHookSources(text: string | undefined): HookSourcesView {
  const settings = text === undefined ? undefined : parsed(text)
  if (settings === undefined || typeof settings === 'string') {
    return { userHookCount: undefined, managedHooksPath: undefined }
  }
  const managed = stringField(settings, MANAGED_HOOKS_KEY)
  return {
    userHookCount: hookCount(settings[HOOKS_KEY]),
    managedHooksPath: managed === undefined || managed === '' ? undefined : managed,
  }
}

/** One hooks file as the Hooks picker lists it (M91, PLAN.md D70). */
export interface HookFileView {
  /** Handlers across every event's groups. */
  readonly count: number
  /** The source formats of the hooks imported from other agents, sorted. */
  readonly formats: readonly string[]
  /** Every event the file names. */
  readonly events: readonly string[]
  /** The events with a group that carries no `format` tag. */
  readonly nativeEvents: readonly string[]
}

/** A `.muse/hooks.json` or `spark-hooks.json`; undefined when it is missing or unreadable. */
export function readHookFile(text: string | undefined): HookFileView | undefined {
  const document = text === undefined ? undefined : parsed(text)
  const table =
    document === undefined || typeof document === 'string' ? undefined : document[HOOKS_KEY]
  if (!isObject(table)) {
    return undefined
  }
  let count = 0
  const formats = new Set<string>()
  const nativeEvents: string[] = []
  for (const [event, groups] of Object.entries(table)) {
    const list: readonly unknown[] = Array.isArray(groups) ? groups : []
    for (const group of list) {
      if (!isObject(group)) {
        continue
      }
      const format = group['format']
      if (typeof format === 'string') {
        formats.add(format)
      } else if (!nativeEvents.includes(event)) {
        nativeEvents.push(event)
      }
      const handlers = group[HOOKS_KEY]
      count += Array.isArray(handlers) ? handlers.length : 0
    }
  }
  return {
    count,
    formats: [...formats].toSorted((first, second) => first.localeCompare(second)),
    events: Object.keys(table),
    nativeEvents,
  }
}
