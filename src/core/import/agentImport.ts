// Import from Claude Code, Codex and Cursor (M83, PLAN.md D49): the other
// agents' MCP servers, hooks, custom agents, slash commands and rules files,
// found in those tools' own folders and converted to Muse Code's shapes
// (`importConvert.ts`).
//
// The scope rule. The user's own folders (`~/.claude`, `~/.claude.json`,
// `~/.codex`, `~/.cursor`, or `CLAUDE_CONFIG_DIR` and `CODEX_HOME`) are
// offered only for the user's files: Muse Code's settings file, the
// personal skills and agents. A repository's folders are read only in a
// trusted workspace, every path confined to the workspace (a link or
// junction that leads out is refused, PLAN.md D24), and are offered only
// for that project's files: its skills, agents, `AGENTS.md` and
// `.muse/hooks.json`. Muse Code reads MCP servers only from the user's own
// settings, so a repository's servers are shown and not offered; the
// user's own rules files are Muse Code's `/rules import`, so they are shown
// and not offered either.
//
// Preview first: the scan and the plan only read. `applyImportWrites`
// creates files that do not exist (never replacing one, even one that
// appears in between) and appends rules sections, each destination checked
// against its root again. MCP servers and hooks are offered as unsaved
// target editor edits (D17, D30, D64); the user reviews and saves them.
//
// Exposure: imported content goes only to a place no more exposed than
// its source (D64). Content is never inspected for credentials.
//
// Pure: every file access is injected. No model call.

import * as z from 'zod/mini'
import {
  AGENT_FILE_MAX_BYTES,
  AGENT_FILE_NAME,
  AGENT_IMPORT_CLAUDE_STATE_MAX_BYTES,
  AGENT_IMPORT_FOLDER_MAX_DEPTH,
  AGENT_IMPORT_CURSOR_RULE_EXTENSION,
  AGENT_IMPORT_DIR_MAX_ENTRIES,
  AGENT_IMPORT_FILE_MAX_BYTES,
  AGENT_IMPORT_ID_MAX_CHARS,
  AGENT_IMPORT_JSON_EXTENSION,
  AGENT_IMPORT_MARKDOWN_EXTENSION,
  AGENT_IMPORT_PATHS,
  AGENT_IMPORT_ROOT_CHANGED_CODE,
  AGENT_IMPORT_SOURCE_NAMES,
  type AgentImportKind,
  type AgentImportSource,
  EFFORT_LEVELS,
  MODEL_API_MODEL_PREFIX,
  MODEL_API_TOOLS,
  PERMISSION_MODES,
  PERSONAL_AGENTS_DIR_SEGMENTS,
  PERSONAL_SKILLS_DIR_SEGMENTS,
  PROJECT_AGENTS_DIR_SEGMENTS,
  PROJECT_HOOKS_SEGMENTS,
  PROJECT_SKILLS_DIR_SEGMENTS,
  RULES_FILE_MAX_BYTES,
  RULES_FILE_NAMES,
  SKILL_FILE_MAX_BYTES,
  SKILL_FILE_NAME,
  SKILL_ID_PATTERN,
  SPARK_HOOKS_SEGMENTS,
  UI_TEXT,
} from '../../shared/constants'
import { readMcpServerEntries } from '../backends/musecode/museConfigView'
import { decodeContextText } from '../context/contextFiles'
import { confineWorkspacePath, type RealPathIo, resolveWorkspacePath } from '../workspacePath'
import type { EditedFile } from '../verify/diagnosticsReport'
import { pathModule } from '../workspaceRoot'
import {
  appendSeparator,
  clineEventForFile,
  commandToSkill,
  type Conversion,
  type ConversionRefusal,
  convertClaudeSparkHook,
  convertClineHook,
  convertCodexHook,
  convertCodexServer,
  convertCopilotHook,
  convertCursorHook,
  convertGeminiHook,
  convertHook,
  convertJsonServer,
  convertKiroHook,
  convertWindsurfHook,
  copilotFlavorOf,
  type ForeignHooksRead,
  type FoundHook,
  type FoundServer,
  geminiSequentialEvents,
  type HookSwitches,
  type KiroHooksRead,
  type MuseHook,
  type MuseMcpEntry,
  hasCodexNotify,
  readClaudeHooks,
  readClaudeState,
  readCodexConfig,
  isCodexHooksOff,
  readCodexHooksToml,
  readCopilotHooks,
  readCursorHooks,
  hasDisableAllHooks,
  readGeminiSwitches,
  readKiroHooks,
  readMcpFile,
  readWindsurfHooks,
  withSwitches,
  rulesHeading,
  rulesSection,
  splitFrontMatter,
} from './importConvert'
import { openCodeNpmPlugins, pluginFolder } from './pluginImport'

export type ImportOrigin = 'user' | 'project'

export type ImportRead =
  | { readonly status: 'missing' }
  | { readonly status: 'notFile' }
  | { readonly status: 'tooLarge' }
  | { readonly status: 'read'; readonly bytes: Uint8Array }

export interface ImportDirEntry {
  readonly name: string
  /** A directory, or a link or junction that leads to one. */
  readonly isDirectory: boolean
}

export interface ImportIo extends RealPathIo {
  /** The file, unread when it is over `maxBytes`; throws on a failure other than "not there". */
  readFile(absolutePath: string, maxBytes: number, projectRoot?: string): Promise<ImportRead>
  /** Safe git metadata query; false outside a repository, throws if classification fails. */
  isIgnored(absolutePath: string, workspaceRoot: string): Promise<boolean>
  /** The directory's entries; undefined when it is missing; throws on any other failure. */
  listDirectory(absolutePath: string): Promise<readonly ImportDirEntry[] | undefined>
  /**
   * Whether the file has an execute bit (Cline v1's on switch off Windows);
   * without this, no Cline script there counts as on.
   */
  isExecutable?(absolutePath: string): Promise<boolean>
}

export interface ImportScanInput {
  readonly io: ImportIo
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  /** `CLAUDE_CONFIG_DIR` as the environment gives it. */
  readonly claudeConfigDir: string | undefined
  /** `CODEX_HOME` as the environment gives it. */
  readonly codexHome: string | undefined
  /** `COPILOT_HOME` as the environment gives it: it replaces `~/.copilot`. */
  readonly copilotHome?: string | undefined
  /** `XDG_CONFIG_HOME` as the environment gives it: Amp's system plugins live beneath it. */
  readonly xdgConfigHome?: string | undefined
  readonly workspaceRoot: string | undefined
  /** All folders open in the window, read live at each classification. */
  readonly workspaceRoots?: () => readonly string[]
  readonly isWorkspaceTrusted: () => boolean
  readonly isActive: () => boolean
  readonly sources: readonly AgentImportSource[]
}

export type ImportSkipReason =
  | ConversionRefusal
  /** A repository's MCP server: Muse Code reads servers only from the user's settings. */
  | 'projectServer'
  /** The user's own rules file: Muse Code's `/rules import` takes it. */
  | 'userRules'
  | 'exists'
  | 'duplicate'
  /** The destination leads outside its root. */
  | 'outside'
  /** The destination file is there but could not be read, so what it holds is unknown. */
  | 'unreadable'
  /** The section would take `AGENTS.md` past the size Muse Code loads. */
  | 'tooLarge'
  /** The workspace folder is not the one the preview was made for any more. */
  | 'changed'
  | 'failed'
  | 'personalToProject'
  | 'ignoredToTracked'

export type ImportFileRoot = 'skills' | 'agents'

export type ImportTarget =
  | {
      readonly kind: 'file'
      readonly root: ImportFileRoot
      readonly scope: ImportOrigin
      /** Beneath the root, forward slashes: `<id>/SKILL.md` or `<id>.md`. */
      readonly relativePath: string
      /** The exact text written. */
      readonly content: string
    }
  | {
      readonly kind: 'rules'
      /** The workspace's `AGENTS.md`. */
      readonly file: string
      readonly heading: string
      readonly section: string
    }
  | { readonly kind: 'server'; readonly name: string; readonly entry: MuseMcpEntry }
  | { readonly kind: 'hook'; readonly file: ImportCopyFile; readonly hook: MuseHook }
  | {
      readonly kind: 'none'
      readonly reason: ImportSkipReason
      /** Set only with `field`: the source's field with no equivalent here. */
      readonly field?: string | undefined
    }

export interface ImportCandidate {
  readonly id: string
  readonly source: AgentImportSource
  readonly origin: ImportOrigin
  readonly kind: AgentImportKind
  readonly label: string
  /** The file it was found in. */
  readonly originPath: string
  readonly sourceExposure: ImportExposure | undefined
  readonly target: ImportTarget
  /** The source entry's fields that are not carried over. */
  readonly dropped: readonly string[]
  /** A plain-words line the preview shows under this entry, if any. */
  readonly previewNote?: string | undefined
}

export interface ImportScan {
  readonly candidates: readonly ImportCandidate[]
  /** For the log: fixed reasons only, never names, paths or content. */
  readonly warnings: readonly string[]
}

/**
 * Where the copied entries go: Muse Code's settings file, the project's
 * hooks file, or the extension's own `spark-hooks.json` (M91, PLAN.md D70)
 * beside the settings file and in the project. Foreign formats convert only
 * into the spark files, with a `format` tag for lane P's adapters.
 */
export type ImportCopyFile = 'settings' | 'hooks' | 'sparkUser' | 'sparkProject'

interface Scan {
  readonly input: ImportScanInput
  readonly p: ReturnType<typeof pathModule>
  readonly warnings: string[]
  readonly candidates: ImportCandidate[]
  readonly taken: Set<string>
  /** Per id base, the first suffix not yet tried: duplicate labels register in O(1) amortized. */
  readonly nextSuffix: Map<string, number>
  /**
   * Each source file read once per scan: a source's switches (Claude's and
   * Copilot's `disableAllHooks`, Gemini's `hooksConfig`, Codex's
   * `[features]`) are read before its hooks, from the same text.
   */
  readonly reads: Map<string, Promise<SourceRead>>
}

type SourceRead =
  | { readonly status: 'missing' }
  | { readonly status: 'text'; readonly text: string }
  /** There but refused or unreadable; the warning is already logged. */
  | { readonly status: 'failed' }

interface Found {
  readonly source: AgentImportSource
  readonly origin: ImportOrigin
  readonly kind: AgentImportKind
  readonly label: string
  readonly originPath: string
  readonly target: ImportTarget
  readonly dropped?: readonly string[]
  readonly previewNote?: string | undefined
}

const USER_RULES_REFUSAL: ImportTarget = { kind: 'none', reason: 'userRules' }
const PROJECT_SERVER_REFUSAL: ImportTarget = { kind: 'none', reason: 'projectServer' }
const ID_SEPARATOR = ':'
const NAME_JOINER = '-'
const LINE_BREAK = /\r?\n/
const HOME_MARK = '~'
const TEXT_ENCODER = new TextEncoder()

/** A path for the log and the preview: workspace-relative, `~/…` under the home folder, else whole. */
export function importDisplayPath(
  absolutePath: string,
  context: {
    readonly platform: NodeJS.Platform
    readonly homeDir: string
    readonly workspaceRoot: string | undefined
  },
): string {
  const p = pathModule(context.platform)
  const beneath = (root: string | undefined): string | undefined => {
    if (root === undefined) {
      return undefined
    }
    const relative = p.relative(root, absolutePath)
    return relative === '' || relative.startsWith('..') || p.isAbsolute(relative)
      ? undefined
      : relative.split(p.sep).join('/')
  }
  const inWorkspace = beneath(context.workspaceRoot)
  if (inWorkspace !== undefined) {
    return inWorkspace
  }
  const inHome = beneath(context.homeDir)
  return inHome === undefined ? absolutePath : `${HOME_MARK}/${inHome}`
}

function shown(scan: Scan, absolutePath: string): string {
  return importDisplayPath(absolutePath, scan.input)
}

/** An error's code (`EACCES`) for the log; never its message, which can quote a path or a file. */
export function importErrorCode(error: unknown): string {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : 'error'
}

/** Only fixed refusal words survive failure accounting. */
function writeRefusal(code: string): ImportSkipReason {
  switch (code) {
    case AGENT_IMPORT_ROOT_CHANGED_CODE: {
      return 'changed'
    }
    case 'personalToProject':
    case 'ignoredToTracked':
    case 'outside': {
      return code
    }
    default: {
      return 'failed'
    }
  }
}

function add(scan: Scan, found: Found): void {
  const base = [found.kind, found.source, found.origin, found.label].join(ID_SEPARATOR)
  const taken = scan.taken
  let id = base
  if (taken.has(id)) {
    // Every suffix below the stored one was taken when tried, and `taken` only grows.
    let index = scan.nextSuffix.get(base) ?? 2
    do {
      id = `${base}${ID_SEPARATOR}${String(index)}`
      index += 1
    } while (taken.has(id))
    scan.nextSuffix.set(base, index)
  }
  taken.add(id)
  scan.candidates.push({
    ...found,
    id,
    sourceExposure: undefined,
    dropped: found.dropped ?? [],
    ...(found.previewNote !== undefined && { previewNote: found.previewNote }),
  })
}

/** A converter's refusal as the entry's target, naming its field when it names one. */
function refusalOf(refusal: Exclude<Conversion<unknown>, { readonly ok: true }>): ImportTarget {
  return {
    kind: 'none',
    reason: refusal.reason,
    ...(refusal.field !== undefined && { field: refusal.field }),
  }
}

export type ImportExposure = 'personal' | 'project-local' | 'project-tracked'

interface ExposureContext {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly workspaceRoot: string | undefined
  readonly workspaceRoots?: () => readonly string[]
  readonly io: Pick<ImportIo, 'realPath' | 'isIgnored'>
}

/** Canonical containment decides scope; git decides ignored versus tracked. */
export async function importExposure(
  absolutePath: string,
  context: ExposureContext,
): Promise<ImportExposure | undefined> {
  const { io, platform, workspaceRoot } = context
  const file = await io.realPath(absolutePath)
  const workspaces =
    context.workspaceRoots?.() ?? (workspaceRoot === undefined ? [] : [workspaceRoot])
  for (const workspace of workspaces) {
    const root = await io.realPath(workspace)
    if (resolveWorkspacePath(root, file, platform).ok) {
      return (await io.isIgnored(file, root)) ? 'project-local' : 'project-tracked'
    }
  }
  const home = await io.realPath(context.homeDir)
  return resolveWorkspacePath(home, file, platform).ok ? 'personal' : undefined
}

/** No item may move to a more exposed class. No content inspection. */
export function exposureRefusal(
  source: ImportExposure | undefined,
  target: ImportExposure | undefined,
): ImportSkipReason | undefined {
  if (source === undefined || target === undefined) return 'outside'
  if (source === 'personal' && target !== 'personal') return 'personalToProject'
  return source === 'project-local' && target === 'project-tracked' ? 'ignoredToTracked' : undefined
}

/** Live permission to read this source; personal sources remain available without trust. */
function canReadOrigin(scan: Scan, origin: ImportOrigin): boolean {
  return scan.input.isActive() && (origin === 'user' || scan.input.isWorkspaceTrusted())
}

async function isConfined(
  scan: Scan,
  absolutePath: string,
  origin: ImportOrigin,
): Promise<boolean> {
  if (!canReadOrigin(scan, origin)) {
    return false
  }
  if (origin === 'user' && !scan.input.isWorkspaceTrusted()) {
    const file = await scan.input.io.realPath(absolutePath)
    const roots =
      scan.input.workspaceRoots?.() ??
      (scan.input.workspaceRoot === undefined ? [] : [scan.input.workspaceRoot])
    for (const workspace of roots) {
      const canonical = await scan.input.io.realPath(workspace)
      if (resolveWorkspacePath(canonical, file, scan.input.platform).ok) return false
    }
  }
  const root = scan.input.workspaceRoot
  if (origin === 'user' || root === undefined) {
    return origin === 'user'
  }
  const confined = await confineWorkspacePath(
    root,
    absolutePath,
    scan.input.platform,
    scan.input.io,
  )
  if (!confined.ok) {
    scan.warnings.push(`leads outside the workspace, skipped`)
  }
  return confined.ok
}

async function readSourceOnce(
  scan: Scan,
  absolutePath: string,
  origin: ImportOrigin,
  maxBytes: number,
): Promise<SourceRead> {
  if (!(await isConfined(scan, absolutePath, origin)) || !canReadOrigin(scan, origin)) {
    return { status: 'failed' }
  }
  let read: ImportRead
  try {
    read = await scan.input.io.readFile(
      absolutePath,
      maxBytes,
      origin === 'project' ? scan.input.workspaceRoot : undefined,
    )
  } catch {
    scan.warnings.push(`could not be read (failed)`)
    return { status: 'failed' }
  }
  switch (read.status) {
    case 'missing': {
      return { status: 'missing' }
    }
    case 'notFile': {
      scan.warnings.push(`is not a file, skipped`)
      return { status: 'failed' }
    }
    case 'tooLarge': {
      scan.warnings.push(`is over the ${String(maxBytes)} byte limit, skipped`)
      return { status: 'failed' }
    }
    case 'read': {
      const decoded = decodeContextText(read.bytes)
      if (!decoded.ok) {
        scan.warnings.push(`${decoded.reason}, skipped`)
        return { status: 'failed' }
      }
      return { status: 'text', text: decoded.text }
    }
  }
}

/** A source file, read once per scan behind the live trust gate; missing, its text, or failed. */
async function readSource(
  scan: Scan,
  absolutePath: string,
  origin: ImportOrigin,
  maxBytes: number = AGENT_IMPORT_FILE_MAX_BYTES,
): Promise<SourceRead> {
  const key = [origin, String(maxBytes), absolutePath].join('\0')
  let pending = scan.reads.get(key)
  if (pending === undefined) {
    pending = readSourceOnce(scan, absolutePath, origin, maxBytes)
    scan.reads.set(key, pending)
  }
  const read = await pending
  return canReadOrigin(scan, origin) ? read : { status: 'failed' }
}

/** A file's text; undefined when it is missing or cannot be used, with a warning for the latter. */
async function readText(
  scan: Scan,
  absolutePath: string,
  origin: ImportOrigin,
  maxBytes: number = AGENT_IMPORT_FILE_MAX_BYTES,
): Promise<string | undefined> {
  const read = await readSource(scan, absolutePath, origin, maxBytes)
  return read.status === 'text' ? read.text : undefined
}

async function listEntries(
  scan: Scan,
  directory: string,
  origin: ImportOrigin,
): Promise<readonly ImportDirEntry[]> {
  if (!(await isConfined(scan, directory, origin)) || !canReadOrigin(scan, origin)) {
    return []
  }
  let entries: readonly ImportDirEntry[] | undefined
  try {
    entries = await scan.input.io.listDirectory(directory)
  } catch {
    scan.warnings.push(`could not be listed (failed)`)
    return []
  }
  if (entries === undefined) {
    return []
  }
  if (entries.length > AGENT_IMPORT_DIR_MAX_ENTRIES) {
    scan.warnings.push(
      `holds ${String(entries.length)} entries; the first ${String(AGENT_IMPORT_DIR_MAX_ENTRIES)} are read`,
    )
  }
  return entries
    .toSorted((a, b) => a.name.localeCompare(b.name, 'en'))
    .slice(0, AGENT_IMPORT_DIR_MAX_ENTRIES)
}

/** A skill id or agent file name from foreign name parts: lower-cased, anything else a dash. */
function slugOf(parts: readonly string[]): string {
  const slug = parts
    .join(NAME_JOINER)
    .toLowerCase()
    .replaceAll(/[^a-z0-9_-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, AGENT_IMPORT_ID_MAX_CHARS)
  return SKILL_ID_PATTERN.test(slug) ? slug : ''
}

function stemOf(fileName: string, extension: string): string {
  return fileName.slice(0, fileName.length - extension.length)
}

function hasExtension(fileName: string, extension: string): boolean {
  return fileName.toLowerCase().endsWith(extension)
}

// --- MCP servers ---

function addServers(
  scan: Scan,
  options: {
    readonly source: AgentImportSource
    readonly origin: ImportOrigin
    readonly originPath: string
    readonly servers: readonly FoundServer[]
    readonly convert: (raw: unknown) => Conversion<MuseMcpEntry>
  },
): void {
  for (const server of options.servers) {
    const found = {
      source: options.source,
      origin: options.origin,
      kind: 'mcpServer',
      label: server.name,
      originPath: options.originPath,
    } as const
    if (options.origin === 'project') {
      add(scan, { ...found, target: PROJECT_SERVER_REFUSAL })
      continue
    }
    const converted = options.convert(server.raw)
    if (converted.ok) {
      add(scan, {
        ...found,
        target: { kind: 'server', name: server.name, entry: converted.value },
        dropped: converted.dropped,
      })
    } else {
      add(scan, { ...found, target: refusalOf(converted) })
    }
  }
}

async function collectMcpFile(
  scan: Scan,
  source: AgentImportSource,
  origin: ImportOrigin,
  file: string,
): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const servers = readMcpFile(text)
  if (servers === undefined) {
    scan.warnings.push(`is not an MCP servers file, skipped`)
    return
  }
  addServers(scan, { source, origin, originPath: file, servers, convert: convertJsonServer })
}

async function collectClaudeState(scan: Scan, file: string): Promise<void> {
  const text = await readText(scan, file, 'user', AGENT_IMPORT_CLAUDE_STATE_MAX_BYTES)
  if (text === undefined) {
    return
  }
  const state = readClaudeState(text, scan.input.workspaceRoot, scan.input.platform)
  if (state === undefined) {
    scan.warnings.push(`is not a readable Claude Code state file, skipped`)
    return
  }
  // A local-scope server is the user's own, for this project; Muse Code has user scope only.
  addServers(scan, {
    source: 'claudeCode',
    origin: 'user',
    originPath: file,
    servers: [...state.user, ...state.local],
    convert: convertJsonServer,
  })
}

// --- Hooks ---
//
// Codex hooks convert into Muse Code's own files and run on both backends.
// Claude Code's extension events and every other agent's format convert into
// `spark-hooks.json` with a `format` tag for lane P's adapters. Labels are
// event and hook names only: the preview never shows command text.

/** The spark file an origin converts into: beside the settings, or in the project. */
function sparkFileOf(origin: ImportOrigin): 'sparkUser' | 'sparkProject' {
  return origin === 'user' ? 'sparkUser' : 'sparkProject'
}

function addHook(
  scan: Scan,
  found: Omit<Found, 'kind' | 'target' | 'dropped'> & { readonly previewNote?: string | undefined },
  converted: Conversion<MuseHook>,
  file: ImportCopyFile,
): void {
  add(scan, {
    ...found,
    kind: 'hook',
    target: converted.ok ? { kind: 'hook', file, hook: converted.value } : refusalOf(converted),
    dropped: converted.ok ? converted.dropped : [],
    ...(found.previewNote !== undefined && { previewNote: found.previewNote }),
  })
}

async function collectHooks(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
  isOff: boolean,
): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const hooks = readClaudeHooks(text)
  if (hooks === undefined) {
    scan.warnings.push(`is not a readable settings file, skipped`)
    return
  }
  const switched = withSwitches(hooks, { isOff })
  for (const hook of switched) {
    const base = {
      source: 'claudeCode',
      origin,
      label: hook.event,
      originPath: file,
    } as const
    const converted = convertHook(hook)
    if (converted.ok || converted.reason !== 'unmapped') {
      addHook(scan, base, converted, origin === 'user' ? 'settings' : 'hooks')
      continue
    }
    addHook(scan, base, convertClaudeSparkHook(hook), sparkFileOf(origin))
  }
}

async function collectCodexHooks(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
  isOff: boolean,
): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const hooks = readClaudeHooks(text)
  if (hooks === undefined) {
    scan.warnings.push(`is not a readable Codex hooks file, skipped`)
    return
  }
  const switched = withSwitches(hooks, { isOff })
  for (const hook of switched) {
    addHook(
      scan,
      { source: 'codex', origin, label: hook.event, originPath: file },
      convertCodexHook(hook),
      origin === 'user' ? 'settings' : 'hooks',
    )
  }
}

/**
 * One read of a Codex `config.toml` for its servers, its `notify` program
 * and its inline `hooks` table: a file that is not TOML warns once, whatever
 * was wanted from it.
 */
async function collectCodexConfigFile(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
  isOff: boolean,
): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const servers = readCodexConfig(text)
  if (servers === undefined) {
    scan.warnings.push(`is not a readable Codex configuration, skipped`)
    return
  }
  addServers(scan, {
    source: 'codex',
    origin,
    originPath: file,
    servers,
    convert: convertCodexServer,
  })
  if (hasCodexNotify(text)) {
    add(scan, {
      source: 'codex',
      origin,
      kind: 'hook',
      label: 'notify',
      originPath: file,
      target: { kind: 'none', reason: 'notify' },
    })
  }
  const hooks = readCodexHooksToml(text)
  if (hooks === undefined) {
    scan.warnings.push(`is not a readable Codex hooks table, skipped`)
    return
  }
  const switched = withSwitches(hooks, { isOff })
  for (const hook of switched) {
    addHook(
      scan,
      { source: 'codex', origin, label: hook.event, originPath: file },
      convertCodexHook(hook),
      origin === 'user' ? 'settings' : 'hooks',
    )
  }
}

/** One foreign hooks file's entries as spark candidates, each with its import record. */
function collectForeignHooks(
  scan: Scan,
  options: {
    readonly source: AgentImportSource
    readonly origin: ImportOrigin
    readonly originPath: string
    readonly found: readonly FoundHook[]
    readonly convert: (hook: FoundHook) => Conversion<MuseHook>
  },
): void {
  for (const hook of options.found) {
    addHook(
      scan,
      {
        source: options.source,
        origin: options.origin,
        label: hook.event,
        originPath: options.originPath,
      },
      options.convert(hook),
      sparkFileOf(options.origin),
    )
  }
}

/** A file in a format this version does not read: one refused candidate naming the file. */
function addUnknownFormat(
  scan: Scan,
  source: AgentImportSource,
  origin: ImportOrigin,
  file: string,
): void {
  add(scan, {
    source,
    origin,
    kind: 'hook',
    label: scan.p.basename(file),
    originPath: file,
    target: { kind: 'none', reason: 'unknownFormat' },
  })
}

/** The texts of a source's switch files, for the switches read before its hooks. */
async function switchTexts(
  scan: Scan,
  files: readonly { readonly file: string; readonly origin: ImportOrigin }[],
): Promise<readonly string[]> {
  const texts: string[] = []
  for (const { file, origin } of files) {
    const text = await readText(scan, file, origin)
    if (text !== undefined) {
      texts.push(text)
    }
  }
  return texts
}

/**
 * Gemini's switches over every settings file read: `hooksConfig` off in any
 * one, or a name disabled in any one, keeps those hooks off. Gemini merges
 * user and project settings, and an import is never more on than its source.
 */
function mergedGeminiSwitches(texts: readonly string[]): HookSwitches {
  const switches = texts.map((text) => readGeminiSwitches(text))
  return {
    isOff: switches.some((entry) => entry.isOff),
    offNames: new Set(switches.flatMap((entry) => [...(entry.offNames ?? [])])),
  }
}

async function collectGeminiHooks(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
  switches: HookSwitches,
): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const read = readClaudeHooks(text)
  if (read === undefined) {
    scan.warnings.push(`is not a readable Gemini settings file, skipped`)
    return
  }
  const hooks = withSwitches(read, switches)
  const sequential = geminiSequentialEvents(hooks)
  collectForeignHooks(scan, {
    source: 'gemini',
    origin,
    originPath: file,
    found: hooks,
    convert: (hook) => convertGeminiHook(hook, sequential),
  })
}

async function collectCursorHooks(scan: Scan, origin: ImportOrigin, file: string): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const read: ForeignHooksRead = readCursorHooks(text)
  switch (read.status) {
    case 'ok': {
      collectForeignHooks(scan, {
        source: 'cursor',
        origin,
        originPath: file,
        found: read.hooks,
        convert: convertCursorHook,
      })
      return
    }
    case 'unknownFormat': {
      addUnknownFormat(scan, 'cursor', origin, file)
      return
    }
    case 'unreadable': {
      scan.warnings.push(`is not a readable hooks file, skipped`)
    }
  }
}

/**
 * One Copilot-location hooks file or inline settings block. Each entry
 * keeps its contract: a VS Code Local file (PascalCase, no `version`) or a
 * Copilot CLI one. `disableAllHooks` in the file, or in a settings file of
 * the same scan (`isOff`), keeps every entry off.
 */
async function collectCopilotHooks(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
  options: { readonly isSettingsBlock: boolean; readonly isOff: boolean },
): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const read = readCopilotHooks(text)
  switch (read.status) {
    case 'ok': {
      const switched = withSwitches(read.hooks, { isOff: options.isOff })
      for (const hook of switched) {
        const flavor = copilotFlavorOf(hook.event, read.isVersioned, options.isSettingsBlock)
        addHook(
          scan,
          { source: 'copilot', origin, label: hook.event, originPath: file },
          convertCopilotHook(hook, flavor),
          sparkFileOf(origin),
        )
      }
      return
    }
    case 'unknownFormat': {
      addUnknownFormat(scan, 'copilot', origin, file)
      return
    }
    case 'unreadable': {
      // An inline settings block is optional: a settings file without one is not a warning.
      if (!options.isSettingsBlock) {
        scan.warnings.push(`is not a readable hooks file, skipped`)
      }
    }
  }
}

/** Every `*.json` hooks file in a hooks folder. */
async function collectHooksFolder(
  scan: Scan,
  origin: ImportOrigin,
  directory: string,
  collect: (scan: Scan, origin: ImportOrigin, file: string) => Promise<void>,
): Promise<void> {
  const entries = await listEntries(scan, directory, origin)
  for (const entry of entries) {
    if (!entry.isDirectory && hasExtension(entry.name, AGENT_IMPORT_JSON_EXTENSION)) {
      await collect(scan, origin, scan.p.join(directory, entry.name))
    }
  }
}

/** A Windsurf hooks file's entries, or why it gave none. */
async function readWindsurfFile(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
): Promise<'missing' | 'failed' | readonly FoundHook[]> {
  const read = await readSource(scan, file, origin)
  if (read.status !== 'text') {
    return read.status
  }
  const hooks = readWindsurfHooks(read.text)
  if (hooks === undefined) {
    scan.warnings.push(`is not a readable Windsurf hooks file, skipped`)
    return 'failed'
  }
  return hooks
}

function addWindsurfHooks(
  scan: Scan,
  origin: ImportOrigin,
  file: string,
  hooks: readonly FoundHook[],
): void {
  collectForeignHooks(scan, {
    source: 'windsurf',
    origin,
    originPath: file,
    found: hooks,
    convert: convertWindsurfHook,
  })
}

async function collectKiroHooks(scan: Scan, origin: ImportOrigin, file: string): Promise<void> {
  const text = await readText(scan, file, origin)
  if (text === undefined) {
    return
  }
  const read: KiroHooksRead = readKiroHooks(text)
  switch (read.status) {
    case 'ok': {
      for (const hook of read.hooks) {
        addHook(
          scan,
          {
            source: 'kiro',
            origin,
            label: hook.name ?? hook.trigger,
            originPath: file,
            ...((hook.trigger === 'PreTaskExec' || hook.trigger === 'PostTaskExec') && {
              previewNote: UI_TEXT.agentImportKiroTaskNote,
            }),
          },
          convertKiroHook(hook),
          sparkFileOf(origin),
        )
      }
      return
    }
    case 'unknownFormat': {
      addUnknownFormat(scan, 'kiro', origin, file)
      return
    }
    case 'unreadable': {
      scan.warnings.push(`is not a readable Kiro hooks file, skipped`)
    }
  }
}

/** Whether a canonical path lies in any folder open in the window. */
async function isInOpenWorkspace(scan: Scan, absolutePath: string): Promise<boolean> {
  const file = await scan.input.io.realPath(absolutePath)
  const roots =
    scan.input.workspaceRoots?.() ??
    (scan.input.workspaceRoot === undefined ? [] : [scan.input.workspaceRoot])
  for (const workspace of roots) {
    const canonical = await scan.input.io.realPath(workspace)
    if (resolveWorkspacePath(canonical, file, scan.input.platform).ok) return true
  }
  return false
}

/**
 * A Cline script checked one by one, as the JSON readers check a file: its
 * canonical path confined to its scope behind the live trust gate, a
 * regular file (no link beneath a project root), and a personal script never
 * one that leads into a folder open in the window (a personal hook would run
 * that project's code everywhere). `refused` is offered with its reason;
 * `skip` is missing or already warned.
 */
async function checkClineScript(
  scan: Scan,
  file: string,
  origin: ImportOrigin,
): Promise<'ok' | 'refused' | 'skip'> {
  try {
    if (
      origin === 'user' &&
      scan.input.isWorkspaceTrusted() &&
      (await isInOpenWorkspace(scan, file))
    ) {
      return 'refused'
    }
  } catch {
    scan.warnings.push(`could not be resolved (failed)`)
    return 'skip'
  }
  if (!(await isConfined(scan, file, origin)) || !canReadOrigin(scan, origin)) {
    return 'skip'
  }
  let read: ImportRead
  try {
    // Zero bytes: only whether it is a regular file is read, never the script.
    read = await scan.input.io.readFile(
      file,
      0,
      origin === 'project' ? scan.input.workspaceRoot : undefined,
    )
  } catch {
    scan.warnings.push(`could not be read (failed)`)
    return 'skip'
  }
  if (read.status === 'notFile') {
    scan.warnings.push(`is not a file, skipped`)
  }
  return read.status === 'read' || read.status === 'tooLarge' ? 'ok' : 'skip'
}

/** Whether Cline would run the script: off Windows only while it is executable. */
async function isClineScriptOn(scan: Scan, file: string): Promise<boolean | undefined> {
  if (scan.input.platform === 'win32') {
    return true
  }
  try {
    return (await scan.input.io.isExecutable?.(file)) ?? false
  } catch {
    scan.warnings.push(`could not be checked (failed)`)
    return undefined
  }
}

async function collectClineHooks(
  scan: Scan,
  origin: ImportOrigin,
  directory: string,
): Promise<void> {
  const entries = await listEntries(scan, directory, origin)
  for (const entry of entries) {
    if (entry.isDirectory) {
      continue
    }
    const classified = clineEventForFile(entry.name, scan.input.platform)
    if (classified.kind === 'ignore') {
      continue
    }
    const file = scan.p.join(directory, entry.name)
    if (classified.kind === 'unknownFormat') {
      addUnknownFormat(scan, 'cline', origin, file)
      continue
    }
    const base = { source: 'cline', origin, label: entry.name, originPath: file } as const
    const checked = await checkClineScript(scan, file, origin)
    if (checked === 'skip') {
      continue
    }
    if (checked === 'refused') {
      add(scan, { ...base, kind: 'hook', target: { kind: 'none', reason: 'outside' } })
      continue
    }
    const isOn = await isClineScriptOn(scan, file)
    if (isOn !== undefined) {
      addHook(scan, base, convertClineHook(classified.sourceEvent, file, isOn), sparkFileOf(origin))
    }
  }
}

// --- Commands and agents ---

interface MarkdownSpec {
  readonly source: AgentImportSource
  readonly origin: ImportOrigin
  readonly kind: 'agent' | 'command'
  readonly directory: string
  /** 1 reads the folder's own files; more follows subfolders as name prefixes. */
  readonly depth: number
}

const AGENT_FIELDS: ReadonlySet<string> = new Set([
  'name',
  'description',
  'tools',
  'model',
  'effort',
  'permission-mode',
])
const AGENT_TOOLS: ReadonlySet<string> = new Set(Object.values(MODEL_API_TOOLS))
const AGENT_EFFORTS: ReadonlySet<string> = new Set(EFFORT_LEVELS)
const AGENT_PERMISSION_MODES: ReadonlySet<string> = new Set(PERMISSION_MODES)
const AGENT_LIST_SEPARATOR = ','
const COMMAND_FIELDS: ReadonlySet<string> = new Set(['name', 'description', 'argument-hint'])
const BLOCK_SCALAR = /^[|>][+-]?$/
const HEADER_FENCE = '---'
const HEADER_FIELD = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/

/** Foreign YAML that the scalar-only native catalog cannot preserve is left alone. */
function hasUnsupportedHeader(text: string): boolean {
  const lines = text.split(LINE_BREAK)
  if (lines[0]?.trim() !== HEADER_FENCE) {
    return false
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === HEADER_FENCE)
  if (end === -1) {
    return true
  }
  const keys = new Set<string>()
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue
    }
    const at = line.indexOf(':')
    const key = line.slice(0, at).trim().toLowerCase()
    if (at <= 0 || line.trimStart() !== line || keys.has(key)) {
      return true
    }
    keys.add(key)
  }
  return false
}

/** The written front matter as the agent format reads it: exact key spelling, one value per line. */
function agentHeader(text: string): ReadonlyMap<string, string> | undefined {
  const lines = text.split(LINE_BREAK)
  if (lines[0]?.trim() !== HEADER_FENCE) {
    return undefined
  }
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === HEADER_FENCE)
  const fields = new Map<string, string>()
  const headerLines = lines.slice(1, end === -1 ? 0 : end)
  for (const line of headerLines) {
    const match = HEADER_FIELD.exec(line)
    const key = match?.[1]
    if (key === undefined || fields.has(key) || !AGENT_FIELDS.has(key)) {
      return undefined
    }
    fields.set(key, (match?.[2] ?? '').trim())
  }
  return end === -1 ? undefined : fields
}

function isPlainValue(value: string | undefined): value is string {
  return value !== undefined && value !== '' && !BLOCK_SCALAR.test(value)
}

/**
 * The agent format M76 reads (`<id>/AGENT.md`, PLAN.md D49), checked here on
 * the bytes that would be written, so a foreign restriction the format does
 * not carry never becomes a broader agent: a file with an unknown field, an
 * unsupported value or a tool this extension does not have is shown, not
 * written. M76's own parser replaces this check once that milestone lands.
 */
function isImportableAgent(text: string): boolean {
  if (TEXT_ENCODER.encode(text).length > AGENT_FILE_MAX_BYTES || hasUnsupportedHeader(text)) {
    return false
  }
  const header = agentHeader(text)
  if (header === undefined) {
    return false
  }
  const quoted = (key: string): string | undefined => {
    const value = header.get(key)
    const first = value?.at(0)
    return value !== undefined &&
      value.length >= 2 &&
      (first === '"' || first === "'") &&
      value.endsWith(first)
      ? value.slice(1, -1).trim()
      : value
  }
  const tools = quoted('tools')
    ?.split(AGENT_LIST_SEPARATOR)
    .map((tool) => tool.trim())
  const model = quoted('model')
  const effort = quoted('effort')
  const mode = quoted('permission-mode')
  return (
    isPlainValue(quoted('name')) &&
    isPlainValue(quoted('description')) &&
    (!header.has('tools') ||
      (tools !== undefined && tools.length > 0 && tools.every((tool) => AGENT_TOOLS.has(tool)))) &&
    (!header.has('model') || (isPlainValue(model) && model.startsWith(MODEL_API_MODEL_PREFIX))) &&
    (!header.has('effort') || (effort !== undefined && AGENT_EFFORTS.has(effort))) &&
    (!header.has('permission-mode') || (mode !== undefined && AGENT_PERMISSION_MODES.has(mode)))
  )
}

async function collectMarkdownFile(
  scan: Scan,
  spec: MarkdownSpec,
  file: string,
  nameParts: readonly string[],
): Promise<void> {
  const text = await readText(scan, file, spec.origin)
  if (text === undefined) {
    return
  }
  const { fields, body } = splitFrontMatter(text)
  // Folder prefixes namespace both kinds; an agent keeps its front matter
  // name in the copied body and uses it as the final component of its file id.
  const agentName = fields['name'] ?? ''
  const agentParts = agentName === '' ? nameParts : [...nameParts.slice(0, -1), agentName]
  const id = slugOf(spec.kind === 'agent' ? agentParts : nameParts)
  if (id === '' || body === '') {
    scan.warnings.push(`has no usable name or holds nothing, skipped`)
    return
  }
  const found = {
    source: spec.source,
    origin: spec.origin,
    kind: spec.kind,
    label: (spec.kind === 'agent' ? agentParts : nameParts).join('/'),
    originPath: file,
  } as const
  if (spec.kind === 'agent') {
    const content = `${text.trimEnd()}\n`
    add(scan, {
      ...found,
      target: isImportableAgent(content)
        ? {
            kind: 'file',
            root: 'agents',
            scope: spec.origin,
            relativePath: `${id}/${AGENT_FILE_NAME}`,
            content,
          }
        : { kind: 'none', reason: 'unsupported' },
    })
    return
  }
  const content = commandToSkill(id, fields, body)
  add(scan, {
    ...found,
    // Muse Code skips a SKILL.md over its size limit; one that would be is not offered.
    target:
      TEXT_ENCODER.encode(content).length > SKILL_FILE_MAX_BYTES ||
      hasUnsupportedHeader(text) ||
      Object.keys(fields).some((key) => !COMMAND_FIELDS.has(key)) ||
      Object.values(fields).some((value) => BLOCK_SCALAR.test(value))
        ? { kind: 'none', reason: 'unsupported' }
        : {
            kind: 'file',
            root: 'skills',
            scope: spec.origin,
            relativePath: `${id}/${SKILL_FILE_NAME}`,
            content,
          },
  })
}

async function collectMarkdown(
  scan: Scan,
  spec: MarkdownSpec,
  prefix: readonly string[] = [],
): Promise<void> {
  const entries = await listEntries(scan, spec.directory, spec.origin)
  for (const entry of entries) {
    const full = scan.p.join(spec.directory, entry.name)
    if (entry.isDirectory) {
      if (prefix.length + 1 < spec.depth) {
        await collectMarkdown(scan, { ...spec, directory: full }, [...prefix, entry.name])
      }
    } else if (hasExtension(entry.name, AGENT_IMPORT_MARKDOWN_EXTENSION)) {
      await collectMarkdownFile(scan, spec, full, [
        ...prefix,
        stemOf(entry.name, AGENT_IMPORT_MARKDOWN_EXTENSION),
      ])
    }
  }
}

// --- Rules ---

/** A user's own rules file, shown so the user knows Muse Code's `/rules import` takes it. */
async function collectUserRules(
  scan: Scan,
  source: AgentImportSource,
  file: string,
): Promise<void> {
  const text = await readText(scan, file, 'user')
  if (text === undefined || text.trim() === '') {
    return
  }
  add(scan, {
    source,
    origin: 'user',
    kind: 'rules',
    label: scan.p.basename(file),
    originPath: file,
    target: USER_RULES_REFUSAL,
  })
}

async function collectProjectRules(
  scan: Scan,
  source: AgentImportSource,
  file: string,
  hasFrontMatter: boolean,
): Promise<void> {
  const root = scan.input.workspaceRoot
  const text = root === undefined ? undefined : await readText(scan, file, 'project')
  if (root === undefined || text === undefined) {
    return
  }
  const { fields, body } = hasFrontMatter
    ? splitFrontMatter(text)
    : { fields: {}, body: text.trim() }
  if (body === '') {
    scan.warnings.push(`holds nothing, skipped`)
    return
  }
  const heading = rulesHeading(AGENT_IMPORT_SOURCE_NAMES[source], shown(scan, file))
  const section = rulesSection(heading, body, fields)
  const [agentsFile] = RULES_FILE_NAMES
  add(scan, {
    source,
    origin: 'project',
    kind: 'rules',
    label: scan.p.basename(file),
    originPath: file,
    target: {
      kind: 'rules',
      file: scan.p.join(root, agentsFile),
      heading,
      section,
    },
  })
}

async function collectCursorRules(scan: Scan, directory: string): Promise<void> {
  const entries = await listEntries(scan, directory, 'project')
  for (const entry of entries) {
    if (!entry.isDirectory && hasExtension(entry.name, AGENT_IMPORT_CURSOR_RULE_EXTENSION)) {
      await collectProjectRules(scan, 'cursor', scan.p.join(directory, entry.name), true)
    }
  }
}

// --- The three tools ---

/** A tool's home from its environment variable: absolute, or unset when empty; relative is refused. */
function homeFromVariable(
  scan: Scan,
  value: string | undefined,
  variable: string,
  fallback: string,
): string | undefined {
  if (value === undefined || value === '') {
    return fallback
  }
  if (scan.p.isAbsolute(value)) {
    return value
  }
  scan.warnings.push(`${variable} is not an absolute path, so that tool's own files are not read`)
  return undefined
}

async function scanClaudeCode(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.claudeCode
  const configDir = homeFromVariable(
    scan,
    input.claudeConfigDir,
    names.configDirVariable,
    p.join(input.homeDir, names.dir),
  )
  const root = input.workspaceRoot
  const projectDir = root === undefined ? undefined : p.join(root, names.dir)
  const settingsFiles = [
    ...(configDir === undefined
      ? []
      : [{ file: p.join(configDir, names.userSettingsFile), origin: 'user' as const }]),
    ...(projectDir === undefined || !isProjectRead
      ? []
      : names.projectSettingsFiles.map((settings) => ({
          file: p.join(projectDir, settings),
          origin: 'project' as const,
        }))),
  ]
  if (configDir !== undefined) {
    const stateDir =
      input.claudeConfigDir === undefined || input.claudeConfigDir === ''
        ? input.homeDir
        : configDir
    await collectClaudeState(scan, p.join(stateDir, names.stateFile))
  }
  // `disableAllHooks` anywhere in this scan keeps every Claude Code hook off.
  const settingsTexts = await switchTexts(scan, settingsFiles)
  const isOff = settingsTexts.some((text) => hasDisableAllHooks(text))
  if (configDir !== undefined) {
    await collectHooks(scan, 'user', p.join(configDir, names.userSettingsFile), isOff)
    await collectMarkdown(scan, {
      source: 'claudeCode',
      origin: 'user',
      kind: 'agent',
      directory: p.join(configDir, names.agentsDir),
      depth: AGENT_IMPORT_FOLDER_MAX_DEPTH,
    })
    await collectMarkdown(scan, {
      source: 'claudeCode',
      origin: 'user',
      kind: 'command',
      directory: p.join(configDir, names.commandsDir),
      depth: AGENT_IMPORT_FOLDER_MAX_DEPTH,
    })
    await collectUserRules(scan, 'claudeCode', p.join(configDir, names.rulesFile))
  }
  if (root === undefined || projectDir === undefined || !isProjectRead) {
    return
  }
  await collectMcpFile(scan, 'claudeCode', 'project', p.join(root, names.projectMcpFile))
  for (const settings of names.projectSettingsFiles) {
    await collectHooks(scan, 'project', p.join(projectDir, settings), isOff)
  }
  await collectMarkdown(scan, {
    source: 'claudeCode',
    origin: 'project',
    kind: 'agent',
    directory: p.join(projectDir, names.agentsDir),
    depth: AGENT_IMPORT_FOLDER_MAX_DEPTH,
  })
  await collectMarkdown(scan, {
    source: 'claudeCode',
    origin: 'project',
    kind: 'command',
    directory: p.join(projectDir, names.commandsDir),
    depth: AGENT_IMPORT_FOLDER_MAX_DEPTH,
  })
  await collectProjectRules(scan, 'claudeCode', p.join(root, names.rulesFile), false)
  await collectProjectRules(scan, 'claudeCode', p.join(projectDir, names.rulesFile), false)
}

async function scanCodex(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.codex
  const home = homeFromVariable(
    scan,
    input.codexHome,
    names.homeVariable,
    p.join(input.homeDir, names.dir),
  )
  const root = input.workspaceRoot
  const projectDir = root === undefined || !isProjectRead ? undefined : p.join(root, names.dir)
  // `[features] hooks = false` in either layer keeps every Codex hook off.
  const configTexts = await switchTexts(scan, [
    ...(home === undefined
      ? []
      : [{ file: p.join(home, names.configFile), origin: 'user' as const }]),
    ...(projectDir === undefined
      ? []
      : [{ file: p.join(projectDir, names.configFile), origin: 'project' as const }]),
  ])
  const isOff = configTexts.some((text) => isCodexHooksOff(text))
  if (home !== undefined) {
    await collectCodexConfigFile(scan, 'user', p.join(home, names.configFile), isOff)
    await collectCodexHooks(scan, 'user', p.join(home, names.hooksFile), isOff)
    await collectMarkdown(scan, {
      source: 'codex',
      origin: 'user',
      kind: 'command',
      directory: p.join(home, names.promptsDir),
      depth: 1,
    })
    await collectUserRules(scan, 'codex', p.join(home, names.rulesFile))
  }
  // A repository's root AGENTS.md is Muse Code's own rules file already.
  if (projectDir === undefined) {
    return
  }
  await collectCodexConfigFile(scan, 'project', p.join(projectDir, names.configFile), isOff)
  await collectCodexHooks(scan, 'project', p.join(projectDir, names.hooksFile), isOff)
}

async function scanCursor(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.cursor
  const userDir = p.join(input.homeDir, names.dir)
  await collectMcpFile(scan, 'cursor', 'user', p.join(userDir, names.mcpFile))
  await collectCursorHooks(scan, 'user', p.join(userDir, names.hooksFile))
  const folders = [
    { kind: 'agent', directory: names.agentsDir },
    { kind: 'command', directory: names.commandsDir },
  ] as const
  for (const folder of folders) {
    await collectMarkdown(scan, {
      source: 'cursor',
      origin: 'user',
      kind: folder.kind,
      directory: p.join(userDir, folder.directory),
      depth: 1,
    })
  }
  const root = input.workspaceRoot
  if (root === undefined || !isProjectRead) {
    return
  }
  const projectDir = p.join(root, names.dir)
  await collectMcpFile(scan, 'cursor', 'project', p.join(projectDir, names.mcpFile))
  await collectCursorHooks(scan, 'project', p.join(projectDir, names.hooksFile))
  for (const folder of folders) {
    await collectMarkdown(scan, {
      source: 'cursor',
      origin: 'project',
      kind: folder.kind,
      directory: p.join(projectDir, folder.directory),
      depth: 1,
    })
  }
  await collectCursorRules(scan, p.join(projectDir, names.rulesDir))
  await collectProjectRules(scan, 'cursor', p.join(root, names.legacyRulesFile), false)
}

async function scanGemini(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.gemini
  const root = input.workspaceRoot
  const files = [
    { file: p.join(input.homeDir, names.dir, names.settingsFile), origin: 'user' as const },
    ...(root === undefined || !isProjectRead
      ? []
      : [{ file: p.join(root, names.dir, names.settingsFile), origin: 'project' as const }]),
  ]
  const switches = mergedGeminiSwitches(await switchTexts(scan, files))
  for (const { file, origin } of files) {
    await collectGeminiHooks(scan, origin, file, switches)
  }
}

async function scanCopilot(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.copilot
  const userDir = homeFromVariable(
    scan,
    input.copilotHome,
    names.homeVariable,
    p.join(input.homeDir, names.userDir),
  )
  const root = input.workspaceRoot
  const projectSettings =
    root === undefined || !isProjectRead
      ? []
      : names.projectSettingsFiles.map((settings) => ({
          file: p.join(root, names.projectDir, names.projectSettingsDir, settings),
          origin: 'project' as const,
        }))
  const settings = [
    ...(userDir === undefined
      ? []
      : [{ file: p.join(userDir, names.userSettingsFile), origin: 'user' as const }]),
    ...projectSettings,
  ]
  // `disableAllHooks` in a settings file skips every hook from every source.
  const settingsTexts = await switchTexts(scan, settings)
  const isOff = settingsTexts.some((text) => hasDisableAllHooks(text))
  const hooksFile =
    (isSettingsBlock: boolean) =>
    async (target: Scan, origin: ImportOrigin, file: string): Promise<void> => {
      await collectCopilotHooks(target, origin, file, { isSettingsBlock, isOff })
    }
  if (userDir !== undefined) {
    await collectHooksFolder(scan, 'user', p.join(userDir, names.userHooksDir), hooksFile(false))
  }
  if (root !== undefined && isProjectRead) {
    await collectHooksFolder(
      scan,
      'project',
      p.join(root, names.projectDir, names.projectHooksDir),
      hooksFile(false),
    )
  }
  for (const { file, origin } of settings) {
    await hooksFile(true)(scan, origin, file)
  }
}

async function scanWindsurf(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.windsurf
  const userFile = p.join(input.homeDir, names.userDir, ...names.userHooksSegments)
  const user = await readWindsurfFile(scan, 'user', userFile)
  if (typeof user !== 'string') {
    addWindsurfHooks(scan, 'user', userFile, user)
  }
  const root = input.workspaceRoot
  if (root === undefined || !isProjectRead) {
    return
  }
  // `.devin/hooks.json` is the active file; the legacy `.windsurf/hooks.json`
  // runs only when that one is absent or defines no hooks.
  const primary = p.join(root, names.dir, names.hooksFile)
  const active = await readWindsurfFile(scan, 'project', primary)
  if (typeof active !== 'string' && active.length > 0) {
    addWindsurfHooks(scan, 'project', primary, active)
    return
  }
  if (active === 'failed') {
    return
  }
  const legacy = p.join(root, names.legacyDir, names.hooksFile)
  const fallback = await readWindsurfFile(scan, 'project', legacy)
  if (typeof fallback !== 'string') {
    addWindsurfHooks(scan, 'project', legacy, fallback)
  }
}

async function scanKiro(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.kiro
  const userDir = p.join(input.homeDir, names.userDir, names.hooksDir)
  await collectHooksFolder(scan, 'user', userDir, collectKiroHooks)
  const root = input.workspaceRoot
  if (root !== undefined && isProjectRead) {
    await collectHooksFolder(
      scan,
      'project',
      p.join(root, names.dir, names.hooksDir),
      collectKiroHooks,
    )
  }
}

async function scanCline(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.cline
  await collectClineHooks(
    scan,
    'user',
    p.join(input.homeDir, names.userDir, ...names.userHooksSegments),
  )
  const root = input.workspaceRoot
  if (root !== undefined && isProjectRead) {
    await collectClineHooks(scan, 'project', p.join(root, names.projectDir, names.projectHooksDir))
  }
}

// --- Amp and OpenCode plugins (M91b): the logic is pluginImport.ts's ---

async function collectPlugins(
  scan: Scan,
  format: 'amp' | 'opencode',
  origin: ImportOrigin,
  directory: string,
): Promise<void> {
  const findings = await pluginFolder(format, origin, directory, {
    list: (folder) => listEntries(scan, folder, origin),
    read: (file, maxBytes) => readText(scan, file, origin, maxBytes),
    isInOpenWorkspace: (file) => isInOpenWorkspace(scan, file),
    isWorkspaceTrusted: () => scan.input.isWorkspaceTrusted(),
    join: (...parts) => scan.p.join(...parts),
    extensionOf: (file) => scan.p.extname(file),
  })
  for (const finding of findings) {
    const base = { source: format, origin, label: finding.label, originPath: finding.file }
    if (finding.kind === 'outside') {
      add(scan, { ...base, kind: 'hook', target: { kind: 'none', reason: 'outside' } })
    } else {
      addHook(scan, base, finding.converted, sparkFileOf(origin))
    }
  }
}

async function collectOpenCodeNpm(scan: Scan, origin: ImportOrigin, file: string): Promise<void> {
  const text = await readText(scan, file, origin)
  const names = text === undefined ? [] : openCodeNpmPlugins(text)
  if (names === undefined) {
    scan.warnings.push(`is not a readable OpenCode configuration, skipped`)
  }
  const labels = names ?? []
  for (const label of labels) {
    const target = { kind: 'none', reason: 'unsupported' } as const
    add(scan, { source: 'opencode', origin, kind: 'hook', label, originPath: file, target })
  }
}

async function scanAmp(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.amp
  const home = p.join(input.homeDir, names.userConfigDir)
  const config = homeFromVariable(scan, input.xdgConfigHome, names.configHomeVariable, home)
  if (config !== undefined) {
    await collectPlugins(scan, 'amp', 'user', p.join(config, ...names.userSegments))
  }
  const root = input.workspaceRoot
  if (root !== undefined && isProjectRead) {
    await collectPlugins(scan, 'amp', 'project', p.join(root, ...names.projectSegments))
  }
}

async function scanOpenCode(scan: Scan, isProjectRead: boolean): Promise<void> {
  const { p, input } = scan
  const names = AGENT_IMPORT_PATHS.opencode
  await collectPlugins(scan, 'opencode', 'user', p.join(input.homeDir, ...names.userSegments))
  await collectOpenCodeNpm(scan, 'user', p.join(input.homeDir, ...names.userConfigSegments))
  const root = input.workspaceRoot
  if (root === undefined || !isProjectRead) {
    return
  }
  await collectPlugins(scan, 'opencode', 'project', p.join(root, ...names.projectSegments))
  await collectOpenCodeNpm(scan, 'project', p.join(root, names.configFile))
}

/**
 * Whether the repository's folders are read: a trusted workspace that is
 * not the home folder itself (whose tool folders are the user's own).
 */
async function shouldReadProject(scan: Scan): Promise<boolean> {
  const { input } = scan
  if (!input.isActive() || !input.isWorkspaceTrusted() || input.workspaceRoot === undefined) {
    return false
  }
  try {
    const [workspace, home] = await Promise.all([
      input.io.realPath(input.workspaceRoot),
      input.io.realPath(input.homeDir),
    ])
    return workspace !== home
  } catch {
    scan.warnings.push(`the workspace folder could not be resolved (failed)`)
    return false
  }
}

/**
 * Every entry the chosen tools hold, importable or not: what cannot be
 * imported is a candidate too, with its reason, so the user sees it.
 */
export async function scanAgentImports(input: ImportScanInput): Promise<ImportScan> {
  const scan: Scan = {
    input,
    p: pathModule(input.platform),
    warnings: [],
    candidates: [],
    taken: new Set(),
    nextSuffix: new Map(),
    reads: new Map(),
  }
  const isProjectRead = await shouldReadProject(scan)
  const scanners: Readonly<Record<AgentImportSource, typeof scanCodex>> = {
    claudeCode: scanClaudeCode,
    codex: scanCodex,
    cursor: scanCursor,
    gemini: scanGemini,
    copilot: scanCopilot,
    windsurf: scanWindsurf,
    kiro: scanKiro,
    cline: scanCline,
    amp: scanAmp,
    opencode: scanOpenCode,
  }
  for (const source of input.sources) {
    await scanners[source](scan, isProjectRead)
  }
  const candidates: ImportCandidate[] = []
  const exposures = new Map<string, Promise<ImportExposure | undefined>>()
  for (const candidate of scan.candidates) {
    if (!canReadOrigin(scan, candidate.origin)) continue
    try {
      if (!exposures.has(candidate.originPath))
        exposures.set(candidate.originPath, importExposure(candidate.originPath, input))
      const sourceExposure = await exposures.get(candidate.originPath)
      candidates.push({
        ...candidate,
        sourceExposure,
        ...(sourceExposure === undefined && {
          target: { kind: 'none', reason: 'outside' } as const,
        }),
      })
    } catch {
      candidates.push({ ...candidate, target: { kind: 'none', reason: 'unreadable' } })
    }
  }
  return { candidates, warnings: scan.warnings }
}

// --- Plan ---

/**
 * A folder as the plan saw it: its canonical path and its device and file
 * number. The approval wait can be long, so a write compares the folder
 * with this again (a path a link now leads elsewhere, or a folder replaced
 * by another, is not the folder that was previewed).
 */
export interface ImportRootIdentity {
  readonly canonical: string
  /** Empty when the file system gives no file number: the canonical path alone is compared. */
  readonly fileId: string
}

/** The workspace folder a project write stays under, with the identity the plan saw. */
export interface ImportProjectRoot {
  readonly path: string
  readonly identity: ImportRootIdentity
}

export interface ImportDestinations {
  readonly platform: NodeJS.Platform
  readonly homeDir: string
  readonly workspaceRoot: string | undefined
  readonly workspaceRoots?: () => readonly string[]
  /** Undefined when the folder could not be identified: no project file is planned then. */
  readonly workspaceIdentity: ImportRootIdentity | undefined
  /** `<config>/muse`: the personal skills and agents go beneath it. */
  readonly personalRoot: string
  readonly museSettingsFile: string
}

/** A destination file as the plan found it. */
export type ImportPlanFile =
  | { readonly status: 'missing' }
  | { readonly status: 'read'; readonly text: string }
  /** There, but over the read limit, not text, or refused: what it holds is unknown. */
  | { readonly status: 'unreadable' }
  /** It leads outside its root through a link or junction. */
  | { readonly status: 'outside' }

export interface ImportPlanState {
  readonly io: ImportIo
  /** Whether anything (a file, a folder, a link) is at the path. */
  readonly isPresent: (absolutePath: string) => Promise<boolean>
  /** The workspace `AGENTS.md`. */
  readonly rulesFile: ImportPlanFile
  /** Muse Code's settings file. */
  readonly museSettings: ImportPlanFile
  /** The project's `.muse/hooks.json`: only whether it is there, and where it leads, matter. */
  readonly hooksFile: 'missing' | 'present' | 'outside'
}

export interface ImportWrite {
  readonly sourceExposure: ImportExposure
  readonly homeDir: string
  readonly workspaceRoot: string | undefined
  readonly workspaceRoots?: () => readonly string[]
  readonly candidateIds: readonly string[]
  readonly absolutePath: string
  readonly content: string
  /** `create` never replaces a file; `append` adds rules sections. */
  readonly mode: 'create' | 'append'
  /** An append's sections, each checked against the file again when it is written. */
  readonly sections: readonly ImportSection[]
  /** The root the path must stay under: the workspace, or `<config>/muse`. */
  readonly root: string
  /** A project path is confined by its canonical form, links resolved (D24). */
  readonly isProject: boolean
  /** The workspace folder's identity at the plan, compared again at every write; project writes only. */
  readonly rootIdentity: ImportRootIdentity | undefined
}

export interface ImportSection {
  readonly candidateId: string
  readonly heading: string
  readonly text: string
}

export interface ImportCopy {
  readonly isProject: boolean
  readonly sourceExposure: ImportExposure
  readonly homeDir: string
  readonly workspaceRoot: string | undefined
  readonly workspaceRoots?: () => readonly string[]
  readonly file: ImportCopyFile
  readonly absolutePath: string
  /** JSON, values unchanged: the whole file when it does not exist yet, else the members to merge in. */
  readonly text: string
  readonly isNewFile: boolean
  readonly candidateIds: readonly string[]
}

export interface ImportSkip {
  readonly candidateId: string
  readonly reason: ImportSkipReason
  /** Set only with `field`: the source's field with no equivalent here. */
  readonly field?: string | undefined
}

export interface ImportPlan {
  readonly writes: readonly ImportWrite[]
  readonly copies: readonly ImportCopy[]
  readonly skipped: readonly ImportSkip[]
  /** The workspace folder the project writes and copies were planned for. */
  readonly projectRoot: ImportProjectRoot | undefined
  /** Muse Code's settings use the legacy `mcp_servers` key, which must not sit beside `mcpServers`. */
  readonly hasLegacyMcpKey: boolean
}

const JSON_INDENT = 2
const SETTINGS_SCHEMA_VERSION = 1

function fileRoot(
  destinations: ImportDestinations,
  scope: ImportOrigin,
  root: ImportFileRoot,
): string | undefined {
  const p = pathModule(destinations.platform)
  if (scope === 'user') {
    const [, leaf] = root === 'skills' ? PERSONAL_SKILLS_DIR_SEGMENTS : PERSONAL_AGENTS_DIR_SEGMENTS
    return p.join(destinations.personalRoot, leaf)
  }
  return destinations.workspaceRoot === undefined
    ? undefined
    : p.join(
        destinations.workspaceRoot,
        ...(root === 'skills' ? PROJECT_SKILLS_DIR_SEGMENTS : PROJECT_AGENTS_DIR_SEGMENTS),
      )
}

type HookBlock = Record<string, Readonly<Record<string, unknown>>[]>

function copyJson(
  members: Readonly<Record<string, unknown>>,
  header: Readonly<Record<string, unknown>>,
): string {
  return JSON.stringify({ ...header, ...members }, undefined, JSON_INDENT)
}

/** Reconcile the accepted copy with live existence without changing its imported members. */
export function copyForCurrentFile(copy: ImportCopy, isNewFile: boolean): ImportCopy {
  if (copy.isNewFile === isNewFile) {
    return copy
  }
  if (copy.file !== 'settings') {
    return { ...copy, isNewFile }
  }
  const members = z.record(z.string(), z.unknown()).parse(JSON.parse(copy.text))
  delete members['schema_version']
  return {
    ...copy,
    isNewFile,
    text: copyJson(members, isNewFile ? { schema_version: SETTINGS_SCHEMA_VERSION } : {}),
  }
}

/** Whether a rules file already holds a section under this heading line. */
function hasHeading(text: string | undefined, heading: string): boolean {
  return text?.split(LINE_BREAK).includes(heading) === true
}

function joinSections(sections: readonly ImportSection[]): string {
  return `${sections.map((section) => section.text).join('\n\n')}\n`
}

/** Whether the rules file stays within the size Muse Code loads once the sections are appended. */
function isWithinRulesLimit(current: string, sections: readonly ImportSection[]): boolean {
  const after = `${current}${appendSeparator(current)}${joinSections(sections)}`
  return TEXT_ENCODER.encode(after).length <= RULES_FILE_MAX_BYTES
}

/** The project's hooks file refuses copies only when it leads outside the workspace. */
function hooksFileRefusal(state: ImportPlanState['hooksFile']): 'outside' | undefined {
  return state === 'outside' ? state : undefined
}

/** Why a destination file refuses what the plan would add to it; undefined when it does not. */
function fileRefusal(file: ImportPlanFile): 'outside' | 'unreadable' | undefined {
  return file.status === 'outside' || file.status === 'unreadable' ? file.status : undefined
}

/**
 * Why a hook copy's file refuses it; spark files carry no pre-read state,
 * so their standing is checked live when the copy is offered.
 */
function hookCopyRefusal(
  state: ImportPlanState,
  file: ImportCopyFile,
): 'outside' | 'unreadable' | undefined {
  switch (file) {
    case 'settings': {
      return fileRefusal(state.museSettings)
    }
    case 'hooks': {
      return hooksFileRefusal(state.hooksFile)
    }
    case 'sparkUser':
    case 'sparkProject': {
      return undefined
    }
  }
}

interface PlanBuilder {
  readonly destinations: ImportDestinations
  readonly state: ImportPlanState
  readonly writes: ImportWrite[]
  readonly skipped: ImportSkip[]
  readonly claimed: Set<string>
  readonly sections: Map<string, ImportSection[]>
  readonly existingServers: ReadonlySet<string>
  readonly servers: Map<string, MuseMcpEntry>
  readonly hooks: Record<ImportCopyFile, HookBlock>
  readonly copyIds: Record<ImportCopyFile, string[]>
  readonly exposures: Map<string, ImportExposure>
  readonly targetExposures: Map<string, ImportExposure>
}

function skip(
  builder: PlanBuilder,
  candidate: ImportCandidate,
  reason: ImportSkipReason,
  field?: string,
): void {
  builder.skipped.push({
    candidateId: candidate.id,
    reason,
    ...(field !== undefined && { field }),
  })
}

async function planFile(
  builder: PlanBuilder,
  candidate: ImportCandidate,
  target: Extract<ImportTarget, { readonly kind: 'file' }>,
): Promise<void> {
  const { destinations } = builder
  const root = fileRoot(destinations, target.scope, target.root)
  if (root === undefined) {
    skip(builder, candidate, 'outside')
    return
  }
  const absolutePath = pathModule(destinations.platform).join(
    root,
    ...target.relativePath.split('/'),
  )
  // Only a known project class moves a write onto the workspace; a miss keeps the scope's root.
  const targetExposure = builder.targetExposures.get(absolutePath)
  const isProject =
    target.scope === 'project' ||
    targetExposure === 'project-local' ||
    targetExposure === 'project-tracked'
  // Confined to the workspace itself: a linked `.agents` folder that leads out is refused.
  const confinedTo = isProject ? destinations.workspaceRoot : destinations.personalRoot
  if (confinedTo === undefined || (isProject && destinations.workspaceIdentity === undefined)) {
    skip(builder, candidate, 'outside')
    return
  }
  if (builder.claimed.has(absolutePath)) {
    skip(builder, candidate, 'duplicate')
    return
  }
  if (await builder.state.isPresent(absolutePath)) {
    skip(builder, candidate, 'exists')
    return
  }
  builder.claimed.add(absolutePath)
  builder.writes.push({
    candidateIds: [candidate.id],
    sourceExposure: candidate.sourceExposure ?? 'personal',
    homeDir: destinations.homeDir,
    workspaceRoot: destinations.workspaceRoot,
    ...(destinations.workspaceRoots !== undefined && {
      workspaceRoots: destinations.workspaceRoots,
    }),
    absolutePath,
    content: target.content,
    mode: 'create',
    sections: [],
    root: confinedTo,
    isProject,
    rootIdentity: isProject ? destinations.workspaceIdentity : undefined,
  })
}

function planRules(
  builder: PlanBuilder,
  candidate: ImportCandidate,
  target: Extract<ImportTarget, { readonly kind: 'rules' }>,
): void {
  const file = builder.state.rulesFile
  const refusal =
    builder.destinations.workspaceIdentity === undefined ? 'outside' : fileRefusal(file)
  if (refusal !== undefined) {
    skip(builder, candidate, refusal)
    return
  }
  const current = file.status === 'read' ? file.text : ''
  const planned = builder.sections.get(target.file) ?? []
  const section = { candidateId: candidate.id, heading: target.heading, text: target.section }
  if (planned.some((entry) => entry.heading === target.heading)) {
    skip(builder, candidate, 'duplicate')
  } else if (hasHeading(current, target.heading)) {
    skip(builder, candidate, 'exists')
  } else if (isWithinRulesLimit(current, [...planned, section])) {
    planned.push(section)
    builder.sections.set(target.file, planned)
  } else {
    skip(builder, candidate, 'tooLarge')
  }
}

function planServer(
  builder: PlanBuilder,
  candidate: ImportCandidate,
  target: Extract<ImportTarget, { readonly kind: 'server' }>,
): void {
  const refusal = fileRefusal(builder.state.museSettings)
  if (refusal !== undefined) {
    skip(builder, candidate, refusal)
  } else if (builder.existingServers.has(target.name)) {
    skip(builder, candidate, 'exists')
  } else if (builder.servers.has(target.name)) {
    skip(builder, candidate, 'duplicate')
  } else {
    builder.servers.set(target.name, target.entry)
    builder.copyIds.settings.push(candidate.id)
  }
}

async function planCandidate(builder: PlanBuilder, candidate: ImportCandidate): Promise<void> {
  const { target } = candidate
  if (target.kind !== 'none') {
    const { destinations } = builder
    const p = pathModule(destinations.platform)
    let file: string
    switch (target.kind) {
      case 'file': {
        file = p.join(
          fileRoot(destinations, target.scope, target.root) ?? '',
          ...target.relativePath.split('/'),
        )
        break
      }
      case 'rules': {
        file = target.file
        break
      }
      case 'server': {
        file = destinations.museSettingsFile
        break
      }
      case 'hook': {
        switch (target.file) {
          case 'settings': {
            file = destinations.museSettingsFile

            break
          }
          case 'hooks': {
            file = p.join(destinations.workspaceRoot ?? '', ...PROJECT_HOOKS_SEGMENTS)

            break
          }
          case 'sparkUser': {
            file = p.join(destinations.personalRoot, SPARK_HOOKS_SEGMENTS.user[1])

            break
          }
          default: {
            const projectSpark =
              destinations.workspaceRoot === undefined
                ? undefined
                : p.join(destinations.workspaceRoot, ...SPARK_HOOKS_SEGMENTS.project)
            if (projectSpark === undefined) {
              skip(builder, candidate, 'outside')
              return
            }
            file = projectSpark
          }
        }
        break
      }
    }
    let reason: ImportSkipReason | undefined
    try {
      const targetExposure = await importExposure(file, { ...destinations, io: builder.state.io })
      reason = exposureRefusal(candidate.sourceExposure, targetExposure)
      if (reason === undefined && targetExposure !== undefined)
        builder.targetExposures.set(file, targetExposure)
    } catch {
      reason = 'unreadable'
    }
    if (reason !== undefined) {
      skip(builder, candidate, reason)
      return
    }
    if (candidate.sourceExposure !== undefined)
      builder.exposures.set(candidate.id, candidate.sourceExposure)
  }
  switch (target.kind) {
    case 'none': {
      skip(builder, candidate, target.reason, target.field)
      return
    }
    case 'file': {
      await planFile(builder, candidate, target)
      return
    }
    case 'rules': {
      planRules(builder, candidate, target)
      return
    }
    case 'server': {
      planServer(builder, candidate, target)
      return
    }
    case 'hook': {
      // Spark files carry no pre-read state: their standing is checked live
      // when the copy is offered, like every other copy target.
      const refusal = hookCopyRefusal(builder.state, target.file)
      if (refusal !== undefined) {
        skip(builder, candidate, refusal)
        return
      }
      const block = builder.hooks[target.file]
      block[target.hook.event] = [...(block[target.hook.event] ?? []), target.hook.group]
      builder.copyIds[target.file].push(candidate.id)
    }
  }
}

/** The least exposed source bounds a grouped publication; an unknown member counts as personal. */
function sourceExposureOf(builder: PlanBuilder, ids: readonly string[]): ImportExposure {
  const classes = new Set(ids.map((id) => builder.exposures.get(id)))
  if (classes.has('personal') || classes.has(undefined)) return 'personal'
  return classes.has('project-local') ? 'project-local' : 'project-tracked'
}

/** A spark copy's file: the user's beside the settings, the project's under the workspace. */
function sparkCopyFile(
  destinations: ImportDestinations,
  file: 'sparkUser' | 'sparkProject',
): string | undefined {
  const p = pathModule(destinations.platform)
  if (file === 'sparkUser') {
    return p.join(destinations.personalRoot, SPARK_HOOKS_SEGMENTS.user[1])
  }
  return destinations.workspaceRoot === undefined
    ? undefined
    : p.join(destinations.workspaceRoot, ...SPARK_HOOKS_SEGMENTS.project)
}

function copiesOf(builder: PlanBuilder): readonly ImportCopy[] {
  const { destinations, state, servers, hooks, copyIds } = builder
  const copies: ImportCopy[] = []
  if (copyIds.settings.length > 0) {
    const isNewFile = state.museSettings.status === 'missing'
    copies.push({
      file: 'settings',
      isProject: builder.targetExposures.get(destinations.museSettingsFile) !== 'personal',
      sourceExposure: sourceExposureOf(builder, copyIds.settings),
      homeDir: destinations.homeDir,
      workspaceRoot: destinations.workspaceRoot,
      ...(destinations.workspaceRoots !== undefined && {
        workspaceRoots: destinations.workspaceRoots,
      }),
      absolutePath: destinations.museSettingsFile,
      text: copyJson(
        {
          ...(servers.size > 0 && { mcpServers: Object.fromEntries(servers) }),
          ...(Object.keys(hooks.settings).length > 0 && { hooks: hooks.settings }),
        },
        isNewFile ? { schema_version: SETTINGS_SCHEMA_VERSION } : {},
      ),
      isNewFile,
      candidateIds: copyIds.settings,
    })
  }
  const root = destinations.workspaceRoot
  if (root !== undefined && copyIds.hooks.length > 0) {
    copies.push({
      file: 'hooks',
      isProject: true,
      sourceExposure: sourceExposureOf(builder, copyIds.hooks),
      homeDir: destinations.homeDir,
      workspaceRoot: destinations.workspaceRoot,
      ...(destinations.workspaceRoots !== undefined && {
        workspaceRoots: destinations.workspaceRoots,
      }),
      absolutePath: pathModule(destinations.platform).join(root, ...PROJECT_HOOKS_SEGMENTS),
      text: copyJson({ hooks: hooks.hooks }, {}),
      isNewFile: state.hooksFile === 'missing',
      candidateIds: copyIds.hooks,
    })
  }
  for (const spark of ['sparkUser', 'sparkProject'] as const) {
    const absolutePath = sparkCopyFile(destinations, spark)
    // Whether the file exists is read live when the copy is offered; the
    // plan marks it new and the offer reconciles it without changing members.
    if (absolutePath !== undefined && copyIds[spark].length > 0) {
      copies.push({
        file: spark,
        isProject: spark === 'sparkProject',
        sourceExposure: sourceExposureOf(builder, copyIds[spark]),
        homeDir: destinations.homeDir,
        workspaceRoot: destinations.workspaceRoot,
        ...(destinations.workspaceRoots !== undefined && {
          workspaceRoots: destinations.workspaceRoots,
        }),
        absolutePath,
        text: copyJson({ hooks: hooks[spark] }, {}),
        isNewFile: true,
        candidateIds: copyIds[spark],
      })
    }
  }
  return copies
}

/**
 * The accepted selection as file writes and copy texts. A destination that
 * exists is skipped, never replaced; two checked entries with one
 * destination keep the first; a rules section already in `AGENTS.md` is
 * not added again; a server Muse Code already defines is left alone.
 */
export async function planImportApply(
  selected: readonly ImportCandidate[],
  destinations: ImportDestinations,
  state: ImportPlanState,
): Promise<ImportPlan> {
  const museSettings = readMcpServerEntries(
    state.museSettings.status === 'read' ? state.museSettings.text : undefined,
  )
  const builder: PlanBuilder = {
    destinations,
    state:
      museSettings.status === 'unreadable'
        ? { ...state, museSettings: { status: 'unreadable' } }
        : state,
    writes: [],
    skipped: [],
    claimed: new Set(),
    sections: new Map(),
    existingServers: new Set(
      museSettings.status === 'read' ? museSettings.entries.map((entry) => entry.view.name) : [],
    ),
    servers: new Map(),
    hooks: { settings: {}, hooks: {}, sparkUser: {}, sparkProject: {} },
    copyIds: { settings: [], hooks: [], sparkUser: [], sparkProject: [] },
    exposures: new Map(),
    targetExposures: new Map(),
  }
  for (const candidate of selected) {
    await planCandidate(builder, candidate)
  }
  const root = destinations.workspaceRoot
  const identity = destinations.workspaceIdentity
  const appends: ImportWrite[] =
    root === undefined || identity === undefined
      ? []
      : Array.from(builder.sections, ([file, planned]) => ({
          candidateIds: planned.map((section) => section.candidateId),
          sourceExposure: sourceExposureOf(
            builder,
            planned.map((section) => section.candidateId),
          ),
          homeDir: destinations.homeDir,
          workspaceRoot: destinations.workspaceRoot,
          ...(destinations.workspaceRoots !== undefined && {
            workspaceRoots: destinations.workspaceRoots,
          }),
          absolutePath: file,
          content: joinSections(planned),
          mode: 'append',
          sections: planned,
          root,
          isProject: true,
          rootIdentity: identity,
        }))
  return {
    writes: [...builder.writes, ...appends],
    copies: copiesOf(builder),
    skipped: builder.skipped,
    projectRoot:
      root === undefined || identity === undefined ? undefined : { path: root, identity },
    hasLegacyMcpKey:
      museSettings.status === 'read' && (museSettings.isLegacy || museSettings.hasKeyConflict),
  }
}

// --- Apply ---

export interface ImportWriter extends RealPathIo {
  isIgnored(absolutePath: string, workspaceRoot: string): Promise<boolean>
  /** The folder's identity now: its canonical path and its file number. */
  identifyRoot(absolutePath: string): Promise<ImportRootIdentity>
  /**
   * Refuses a root that is no longer the folder the plan saw, and links or
   * junctions beneath it, the final path included.
   */
  assertSafePath(absolutePath: string, project: ImportProjectRoot): Promise<void>
  /** Creates the file and its folders; 'exists' when anything is already at the path. */
  createFile(
    absolutePath: string,
    content: string,
    project?: ImportProjectRoot,
    beforePublish?: () => void | Promise<void>,
  ): Promise<'created' | 'exists'>
  /** The file's text; undefined when it does not exist. */
  readText(absolutePath: string, project?: ImportProjectRoot): Promise<string | undefined>
  appendText(
    absolutePath: string,
    content: string,
    options?: {
      readonly project?: ImportProjectRoot
      readonly expectedText?: string
      readonly beforePublish?: () => void | Promise<void>
      readonly assertCanWrite?: () => void
    },
  ): Promise<void>
}

export interface ImportApplyResult {
  readonly written: readonly ImportWrite[]
  readonly skipped: readonly ImportSkip[]
  /** For the log: the path and the error code of each failed write. */
  readonly failures: readonly { readonly absolutePath: string; readonly code: string }[]
}

/** Host-owned workspace notices; a successful publication alone belongs to its captured owner. */
export type ImportWriteNotice = (file: EditedFile) => (wasWritten: boolean) => void

export interface ImportApplyOptions {
  /**
   * Throws once a write must not publish: the window is closing, trust was
   * revoked, or the checkpoint lease is gone. Called again before every
   * native step that can publish.
   */
  readonly beforeWrite?: (isProject: boolean) => void
  readonly beginProjectEdit?: ImportWriteNotice
  /** Refuses a project publication in checkpoint storage (M86); records no bytes. */
  readonly beforeProjectWrite?: (absolutePath: string) => void | Promise<void>
  /** Whether the window still shows the folder the plan was made for. */
  readonly isRootCurrent?: (root: ImportProjectRoot) => Promise<boolean>
}

interface ApplyState {
  readonly writer: ImportWriter
  readonly platform: NodeJS.Platform
  readonly options: ImportApplyOptions
  readonly written: ImportWrite[]
  readonly skipped: ImportSkip[]
}

/** A project write's root as planned; undefined for a user write, and for a project write with none (refused). */
function projectOf(write: ImportWrite): ImportProjectRoot | undefined {
  return write.isProject && write.rootIdentity !== undefined
    ? { path: write.root, identity: write.rootIdentity }
    : undefined
}

async function fileWithinRoot(
  write: ImportWrite,
  project: ImportProjectRoot | undefined,
  state: ApplyState,
): Promise<EditedFile | undefined> {
  if (!write.isProject) {
    const resolved = resolveWorkspacePath(write.root, write.absolutePath, state.platform)
    return resolved.ok ? { relative: resolved.relative, absolute: resolved.absolute } : undefined
  }
  if (project === undefined) {
    return undefined
  }
  const confined = await confineWorkspacePath(
    write.root,
    write.absolutePath,
    state.platform,
    state.writer,
  )
  if (!confined.ok) {
    return undefined
  }
  await state.writer.assertSafePath(write.absolutePath, project)
  return { relative: confined.canonical, absolute: confined.checkedAbsolute }
}

/**
 * One native publication behind its storage and window guards, with the
 * notice completed either way and counting only a write. Explicit imports
 * remain outside the model's recorder (M86).
 */
async function wasPublished(
  write: ImportWrite,
  file: EditedFile,
  state: ApplyState,
  didWrite: (beforePublish: () => Promise<void>) => Promise<boolean>,
): Promise<boolean> {
  const { options } = state
  const beforePublish = async (): Promise<void> => {
    const targetExposure = await importExposure(write.absolutePath, {
      ...write,
      platform: state.platform,
      io: state.writer,
    })
    const reason =
      exposureRefusal(write.sourceExposure, targetExposure) ??
      (targetExposure !== 'personal' && !write.isProject
        ? AGENT_IMPORT_ROOT_CHANGED_CODE
        : undefined)
    if (reason !== undefined)
      throw Object.assign(new Error('Import exposure refused'), { code: reason })
    options.beforeWrite?.(write.isProject)
  }
  await beforePublish()
  if (write.isProject) {
    await options.beforeProjectWrite?.(write.absolutePath)
    await beforePublish()
  }
  const complete = write.isProject ? options.beginProjectEdit?.(file) : undefined
  let wasWritten = false
  try {
    wasWritten = await didWrite(beforePublish)
    return wasWritten
  } finally {
    complete?.(wasWritten)
  }
}

/**
 * The sections not yet in the rules file, appended while the file stays
 * within the size Muse Code loads; the rest are skipped. The file is read
 * again here, so a section the user added meanwhile is not doubled (a second
 * import in this window waits for this one, `agentImportCommands.ts`).
 */
async function appendSections(
  write: ImportWrite,
  project: ImportProjectRoot | undefined,
  file: EditedFile,
  state: ApplyState,
): Promise<void> {
  const { writer } = state
  const current = (await writer.readText(write.absolutePath, project)) ?? ''
  const fresh: ImportSection[] = []
  const refused: ImportSkip[] = []
  for (const section of write.sections) {
    if (hasHeading(current, section.heading)) {
      refused.push({ candidateId: section.candidateId, reason: 'exists' })
    } else if (isWithinRulesLimit(current, [...fresh, section])) {
      fresh.push(section)
    } else {
      refused.push({ candidateId: section.candidateId, reason: 'tooLarge' })
    }
  }
  state.skipped.push(...refused)
  if (fresh.length === 0) {
    return
  }
  const content = joinSections(fresh)
  await wasPublished(write, file, state, async (beforePublish) => {
    await writer.appendText(write.absolutePath, `${appendSeparator(current)}${content}`, {
      ...(project !== undefined && { project }),
      expectedText: current,
      beforePublish,
      assertCanWrite: () => state.options.beforeWrite?.(write.isProject),
    })
    return true
  })
  state.written.push({
    ...write,
    candidateIds: fresh.map((section) => section.candidateId),
    content,
    sections: fresh,
  })
}

async function createOne(
  write: ImportWrite,
  project: ImportProjectRoot | undefined,
  file: EditedFile,
  state: ApplyState,
): Promise<void> {
  const isCreated = await wasPublished(
    write,
    file,
    state,
    async (beforePublish) =>
      (await state.writer.createFile(write.absolutePath, write.content, project, beforePublish)) ===
      'created',
  )
  if (isCreated) {
    state.written.push(write)
  } else {
    state.skipped.push(
      ...write.candidateIds.map((candidateId) => ({ candidateId, reason: 'exists' as const })),
    )
  }
}

/**
 * The plan's writes, each destination checked against its root again at
 * the moment of writing (a link planted since the preview, or a root that is
 * no longer the previewed folder, is refused), a file created only where
 * nothing is, and rules sections appended.
 */
export async function applyImportWrites(
  writes: readonly ImportWrite[],
  writer: ImportWriter,
  platform: NodeJS.Platform,
  options: ImportApplyOptions = {},
): Promise<ImportApplyResult> {
  const state: ApplyState = { writer, platform, options, written: [], skipped: [] }
  const failures: { absolutePath: string; code: string }[] = []
  const skipAll = (write: ImportWrite, reason: ImportSkipReason): void => {
    state.skipped.push(...write.candidateIds.map((candidateId) => ({ candidateId, reason })))
  }
  for (const write of writes) {
    const project = projectOf(write)
    try {
      if (
        project !== undefined &&
        options.isRootCurrent !== undefined &&
        !(await options.isRootCurrent(project))
      ) {
        skipAll(write, 'changed')
        continue
      }
      const file = await fileWithinRoot(write, project, state)
      if (file === undefined) {
        skipAll(write, 'outside')
        continue
      }
      options.beforeWrite?.(write.isProject)
      await (write.mode === 'append'
        ? appendSections(write, project, file, state)
        : createOne(write, project, file, state))
    } catch (error: unknown) {
      const code = importErrorCode(error)
      failures.push({ absolutePath: write.absolutePath, code })
      // A rules write that refused some of its sections already accounted for them.
      const accounted = new Set(state.skipped.map((skipped) => skipped.candidateId))
      const reason = writeRefusal(code)
      state.skipped.push(
        ...write.candidateIds
          .filter((candidateId) => !accounted.has(candidateId))
          .map((candidateId) => ({ candidateId, reason }) as const),
      )
    }
  }
  return { written: state.written, skipped: state.skipped, failures }
}
