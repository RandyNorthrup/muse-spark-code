// Import of Amp and OpenCode plugins (M91b, PLAN.md D70): the plugin files
// in their folders become `spark-hooks.json` records, one per mapped hook the
// plugin registers, with the plugin's absolute path. The plugins themselves
// run out of process (pluginHost.ts) with no more power than in their source.
//
// The rules are lane I's, as for Cline's scripts (`checkClineScript`):
// - a personal plugin whose canonical path is in a folder open in the
//   window is refused `outside` (a personal hook would run that project's
//   code everywhere);
// - a project plugin is confined to the workspace and read only while it is
//   trusted (the caller's reader does both);
// - the preview shows metadata only: the file name and the source hook,
//   never code;
// - a directory plugin and an npm plugin are refused with a reason.
//
// Which hooks a plugin registers is read from its text: the literal hook
// names it uses. A registration whose name is not a literal, or a plugin in
// which no name is found, registers every mapped hook: running more often is
// never weaker than the source.

import {
  AGENT_IMPORT_FORMATS,
  AGENT_IMPORT_PATHS,
  PLUGIN_IMPORT_MAX_BYTES,
} from '../../shared/constants'
import {
  PLUGIN_BUS_PREFIX,
  PLUGIN_ROUTES,
  type PluginFormat,
} from '../backends/modelapi/pluginFormats'
import type { Conversion, ConversionRefusal, MuseHook } from './importConvert'
import type { ImportDirEntry } from './agentImport'

/** What the scan offers plugin import: its confined, trust-gated readers. */
export interface PluginScanIo {
  /** The folder's entries; empty when it is missing, unreadable or not confined. */
  readonly list: (directory: string) => Promise<readonly ImportDirEntry[]>
  /** The file's text; undefined when missing, too large, unreadable or not confined. */
  readonly read: (file: string, maxBytes: number) => Promise<string | undefined>
  /** Whether a canonical path lies in a folder open in the window. */
  readonly isInOpenWorkspace: (file: string) => Promise<boolean>
  readonly isWorkspaceTrusted: () => boolean
  readonly join: (...parts: string[]) => string
  readonly extensionOf: (file: string) => string
}

export type PluginFinding =
  | {
      readonly kind: 'hook'
      readonly label: string
      readonly file: string
      readonly converted: Conversion<MuseHook>
    }
  /** A personal plugin that leads into an open folder. */
  | { readonly kind: 'outside'; readonly label: string; readonly file: string }

/**
 * Source hooks the mapping knows but this version cannot fire or refuses, by
 * format, with the reason the preview gives (PLAN.md M91, lane X tables).
 * The extension events (UserPromptExpansion, TaskCreated and TaskCompleted,
 * PermissionDenied, FileChanged, MessageDisplay) have no imported-hook
 * dispatch yet, so their hooks are listed, not converted.
 */
const REFUSED_HOOKS: Readonly<Record<PluginFormat, Readonly<Record<string, ConversionRefusal>>>> = {
  amp: { 'changes.prompt': 'unmapped' },
  opencode: {
    'command.execute.before': 'unmapped',
    [`${PLUGIN_BUS_PREFIX}todo.updated`]: 'unmapped',
    [`${PLUGIN_BUS_PREFIX}permission.replied`]: 'unmapped',
    [`${PLUGIN_BUS_PREFIX}file.watcher.updated`]: 'unmapped',
    [`${PLUGIN_BUS_PREFIX}message.updated`]: 'unmapped',
    'chat.params': 'chooses',
    'chat.headers': 'chooses',
    'experimental.provider.small_model': 'chooses',
    'tool.definition': 'chooses',
    'experimental.chat.messages.transform': 'unsupported',
    'experimental.chat.system.transform': 'unsupported',
    'experimental.compaction.autocontinue': 'unmapped',
    'experimental.text.complete': 'unmapped',
    'shell.env': 'unsupported',
  },
}

const QUOTE_MARKS = ["'", '"', '`'] as const
/** What follows a quoted name that makes it an object key: `"name": …` or `"name"(…)`. */
const KEY_MARKS: ReadonlySet<string> = new Set([':', '('])
const SPACE = /\s/

/**
 * What follows each quoted mention of `name`, whitespace skipped: a plain
 * string search, so no pattern is built from the names.
 */
function followersOf(text: string, name: string): readonly string[] {
  const followers: string[] = []
  for (const quote of QUOTE_MARKS) {
    const needle = `${quote}${name}${quote}`
    let at = text.indexOf(needle)
    while (at !== -1) {
      let next = at + needle.length
      while (next < text.length && SPACE.test(text.charAt(next))) next += 1
      followers.push(text.charAt(next))
      at = text.indexOf(needle, at + needle.length)
    }
  }
  return followers
}

/** Whether the text names `name` as a string literal that is not an object key. */
function hasLiteral(text: string, name: string): boolean {
  return followersOf(text, name).some((mark) => !KEY_MARKS.has(mark))
}

/** Whether the text uses `name`, quoted, as an object key. */
function hasKey(text: string, name: string): boolean {
  return followersOf(text, name).some((mark) => KEY_MARKS.has(mark))
}

/** Amp: `amp.on('<event>', …)`; a first argument that is not a literal is unknown. */
function ampHooks(text: string): { readonly names: ReadonlySet<string>; readonly isOpen: boolean } {
  const names = new Set<string>()
  let isOpen = false
  for (const match of text.matchAll(/\.on\(\s*([^,)]*)/g)) {
    const argument = (match[1] ?? '').trim()
    const literal = /^(['"])([^'"]*)\1$/.exec(argument)
    if (literal?.[2] === undefined) {
      isOpen = true
    } else {
      names.add(literal[2])
    }
  }
  return { names, isOpen }
}

/**
 * OpenCode: the hooks object's keys, quoted (`"tool.execute.before": …`) or
 * bare (`event: …`, `event(…)`); bus types as literals in an `event`
 * handler. A computed key (`[name]: …`) is unknown.
 */
function openCodeHooks(text: string): {
  readonly names: ReadonlySet<string>
  readonly isOpen: boolean
} {
  const names = new Set<string>()
  const known = [
    ...Object.keys(PLUGIN_ROUTES.opencode),
    ...Object.keys(REFUSED_HOOKS.opencode),
  ].filter((name) => !name.startsWith(PLUGIN_BUS_PREFIX))
  for (const name of known) {
    if (hasKey(text, name)) names.add(name)
  }
  const hasBus = /(?:^|[\s,{])(?:event|["']event["'])\s*[:(]/m.test(text)
  const busTypes = [
    ...Object.keys(PLUGIN_ROUTES.opencode),
    ...Object.keys(REFUSED_HOOKS.opencode),
  ].filter((name) => name.startsWith(PLUGIN_BUS_PREFIX))
  let isOpen = /\[\s*[A-Za-z_$][\w$.]*\s*\]\s*:/.test(text)
  if (hasBus) {
    // A bus type that is also a typed hook's key counts only where it is not that key.
    const named = busTypes.filter((name) => hasLiteral(text, name.slice(PLUGIN_BUS_PREFIX.length)))
    for (const name of named) names.add(name)
    // A bus handler that names no mapped type may act on any of them.
    if (named.length === 0) isOpen = true
  }
  return { names, isOpen }
}

/** The source hooks to convert and to refuse, by the plugin's text. */
export function pluginSourceHooks(
  format: PluginFormat,
  text: string,
): { readonly mapped: readonly string[]; readonly refused: readonly string[] } {
  const { names, isOpen } = format === 'amp' ? ampHooks(text) : openCodeHooks(text)
  const routes = Object.keys(PLUGIN_ROUTES[format])
  const refusals = REFUSED_HOOKS[format]
  const found = routes.filter((name) => names.has(name))
  const refused = [...names]
    .filter((name) => Object.hasOwn(refusals, name))
    .toSorted((a, b) => a.localeCompare(b, 'en'))
  return { mapped: isOpen || found.length === 0 ? routes : found, refused }
}

/** One mapped hook's record (lane I's import record, with the plugin path). */
export function pluginRecord(
  format: PluginFormat,
  sourceEvent: string,
  plugin: string,
): Conversion<MuseHook> {
  const routes = PLUGIN_ROUTES[format]
  const route = Object.hasOwn(routes, sourceEvent) ? routes[sourceEvent] : undefined
  if (route === undefined) {
    return { ok: false, reason: 'unmapped' }
  }
  return {
    ok: true,
    dropped: [],
    value: {
      event: route.event,
      group: {
        format: AGENT_IMPORT_FORMATS[format],
        sourceEvent,
        plugin,
        ...(route.matcher !== undefined && { matcher: route.matcher }),
        hooks: [{ type: 'plugin' }],
      },
    },
  }
}

function refusal(reason: ConversionRefusal): Conversion<MuseHook> {
  return { ok: false, reason }
}

/** One plugin file's findings: its records, its refused hooks, or `outside`. */
async function pluginFile(
  format: PluginFormat,
  origin: 'user' | 'project',
  file: string,
  name: string,
  io: PluginScanIo,
): Promise<readonly PluginFinding[]> {
  try {
    if (origin === 'user' && io.isWorkspaceTrusted() && (await io.isInOpenWorkspace(file))) {
      return [{ kind: 'outside', label: name, file }]
    }
  } catch {
    return []
  }
  const text = await io.read(file, PLUGIN_IMPORT_MAX_BYTES)
  if (text === undefined) {
    return []
  }
  const { mapped, refused } = pluginSourceHooks(format, text)
  return [
    ...mapped.map((sourceEvent) => ({
      kind: 'hook' as const,
      label: `${name}: ${sourceEvent}`,
      file,
      converted: pluginRecord(format, sourceEvent, file),
    })),
    ...refused.map((sourceEvent) => ({
      kind: 'hook' as const,
      label: `${name}: ${sourceEvent}`,
      file,
      converted: refusal(REFUSED_HOOKS[format][sourceEvent] ?? 'unmapped'),
    })),
  ]
}

/**
 * One plugin folder's findings. A file plugin is converted; a directory
 * plugin is refused (only single files run here); other files are not
 * plugins and are passed over.
 */
export async function pluginFolder(
  format: PluginFormat,
  origin: 'user' | 'project',
  directory: string,
  io: PluginScanIo,
): Promise<readonly PluginFinding[]> {
  const extensions: readonly string[] = AGENT_IMPORT_PATHS[format].extensions
  const findings: PluginFinding[] = []
  const entries = await io.list(directory)
  for (const entry of entries) {
    const file = io.join(directory, entry.name)
    if (entry.isDirectory) {
      findings.push({ kind: 'hook', label: entry.name, file, converted: refusal('unsupported') })
      continue
    }
    if (!extensions.includes(io.extensionOf(entry.name).toLowerCase())) {
      continue
    }
    findings.push(...(await pluginFile(format, origin, file, entry.name, io)))
  }
  return findings
}

/**
 * OpenCode's npm plugins (`plugin` in opencode.json, oc_plugins.mdx:31-36),
 * each refused; undefined when the file is not JSON.
 */
export function openCodeNpmPlugins(text: string): readonly string[] | undefined {
  let document: unknown
  try {
    document = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof document !== 'object' || document === null || !('plugin' in document)) {
    return []
  }
  const list: unknown = document.plugin
  return Array.isArray(list)
    ? list.filter((entry): entry is string => typeof entry === 'string' && entry !== '')
    : []
}
