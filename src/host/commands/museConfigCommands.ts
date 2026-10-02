// `Muse Spark: MCP Servers` and `Muse Spark: Hooks` (M31, PLAN.md D30):
// what Muse Code will load from its settings and the workspace, shown
// read-only (D17: the extension never writes the CLI's settings). A server
// can be signed in to or out of through `muse mcp login|logout` in a
// terminal, and every file is one click away. Every VS Code and process
// interaction is injected.
//
// On the Model API backend the window runs the same servers itself (M50,
// PLAN.md D42): each row says whether it is connected and with how many
// tools, or why it is not running; the extension's own diagnostics server
// has a row too; a server opens the log (its stderr) instead of a sign-in,
// since `muse mcp login` signs in Muse Code only.

import type { McpPoolSnapshot } from '../../core/backends/modelapi/mcp/pool'
import {
  type McpServerView,
  type McpSettingsView,
  readHookSources,
  readMcpServers,
} from '../../core/backends/musecode/museConfigView'
import { IDE_MCP_SERVER_NAME, MODEL_API_HOOKS_SETTING, UI_TEXT } from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import type { PickItem, PickOne } from './pickItem'

export type McpAction = 'login' | 'logout'

export interface MuseConfigDeps {
  readonly settingsPath: string
  /** The settings file's text; undefined when there is no file; throws when it cannot be read. */
  readonly readSettings: () => string | undefined
  /** The workspace's `.muse/hooks.json`; undefined without a workspace. */
  readonly projectHooksPath: string | undefined
  readonly fileExists: (fsPath: string) => boolean
  readonly isWorkspaceTrusted: () => boolean
  readonly pick: PickOne
  readonly openFile: (fsPath: string) => Promise<void>
  readonly openDocs: () => void
  /** `muse mcp <action> <server>` in a terminal; false when the CLI is not installed. */
  readonly runMcpCommand: (action: McpAction, server: string) => boolean | Promise<boolean>
  /** Stops the hosts so the next message starts Muse Code with the new settings. */
  readonly restart: () => Promise<void>
  readonly showInformation: (message: string) => void
  readonly showWarning: (message: string) => void
  /**
   * The Model API backend's servers as this window runs them (M50):
   * undefined while the window runs Muse Code, which starts its own; the
   * function answers undefined until they have been started.
   */
  readonly modelApiServers?: (() => McpPoolSnapshot | undefined) | undefined
  /** The extension's log, where a server's stderr goes. */
  readonly openLog?: (() => void) | undefined
  /** Present only on the Model API backend; false means no hook can run. */
  readonly modelApiHooks?: (() => boolean | undefined) | undefined
  readonly openModelApiHooksSetting?: (() => Promise<void>) | undefined
}

const OPEN_SETTINGS = 'action:openSettings'
const RESTART = 'action:restart'
const DOCS = 'action:docs'
const SHOW_LOG = 'action:log'
const SERVER_PREFIX = 'server:'
const BUILT_IN_PREFIX = 'builtin:'
const PROJECT_HOOKS = 'hooks:project'
const USER_HOOKS = 'hooks:user'
const MANAGED_HOOKS = 'hooks:managed'
const MODEL_API_HOOKS_PICK = 'hooks:modelApiSetting'
const STREAMABLE_HTTP = 'streamable-http'
const LIST_SEPARATOR = ', '
const DETAIL_SEPARATOR = ' · '

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The file's text, or why it could not be read (a permission, a directory). */
function settingsText(deps: MuseConfigDeps): { readonly text?: string; readonly error?: string } {
  try {
    const text = deps.readSettings()
    return text === undefined ? {} : { text }
  } catch (error: unknown) {
    return { error: describe(error) }
  }
}

/** A server's state as the Model API backend runs it, in words (M50). */
function liveState(server: McpServerView, snapshot: McpPoolSnapshot | undefined): string {
  if (!server.isEnabled) {
    return UI_TEXT.mcpDisabled
  }
  if (snapshot?.isStarted !== true) {
    return UI_TEXT.mcpStateNotStarted
  }
  if (snapshot.fault !== undefined) {
    return UI_TEXT.mcpStateNotLoaded
  }
  const state = snapshot.servers.find((candidate) => candidate.name === server.name)?.state
  switch (state?.status) {
    case undefined: {
      return UI_TEXT.mcpStateNotStarted
    }
    case 'starting': {
      return UI_TEXT.mcpStateStarting
    }
    case 'connected': {
      const connected = plural(UI_TEXT.mcpStateConnected, state.toolCount)
      return state.unofferedCount > 0
        ? `${connected}${DETAIL_SEPARATOR}${plural(UI_TEXT.mcpStateUnoffered, state.unofferedCount)}`
        : connected
    }
    case 'failed': {
      return fill(UI_TEXT.mcpStateFailed, { reason: state.reason })
    }
    case 'disabled': {
      return UI_TEXT.mcpDisabled
    }
    case 'restricted': {
      return UI_TEXT.mcpStateRestricted
    }
  }
}

/** The detail line; `live` is the Model API backend's state of the server, first when given. */
function serverDetail(server: McpServerView, live: string | undefined): string {
  let mode: string = UI_TEXT.mcpOptional
  if (server.mode !== 'optional') {
    mode = live === undefined ? UI_TEXT.mcpRequired : UI_TEXT.mcpRequiredModelApi
  }
  const parts: string[] = live === undefined ? [mode] : [live, mode]
  if (live === undefined && !server.isEnabled) {
    parts.push(UI_TEXT.mcpDisabled)
  }
  if (server.envNames.length > 0) {
    parts.push(`${UI_TEXT.mcpEnv} ${server.envNames.join(LIST_SEPARATOR)}`)
  }
  if (server.headerNames.length > 0) {
    parts.push(`${UI_TEXT.mcpHeaders} ${server.headerNames.join(LIST_SEPARATOR)}`)
  }
  if (server.hasModeConflict) {
    parts.push(UI_TEXT.mcpModeConflict)
  }
  return parts.join(DETAIL_SEPARATOR)
}

function serverItem(server: McpServerView, live: string | undefined): PickItem {
  return {
    id: `${SERVER_PREFIX}${server.name}`,
    label: server.name,
    description: `${server.transport}${DETAIL_SEPARATOR}${server.target}`,
    detail: serverDetail(server, live),
  }
}

/** The extension's own diagnostics server, which the Model API backend runs in process. */
function builtInItem(): PickItem {
  return {
    id: `${BUILT_IN_PREFIX}${IDE_MCP_SERVER_NAME}`,
    label: IDE_MCP_SERVER_NAME,
    description: UI_TEXT.mcpBuiltIn,
    detail: UI_TEXT.mcpBuiltInDetail,
  }
}

/** The pick's placeholder: what the file holds, or why nothing can be shown. */
function mcpSummary(view: McpSettingsView, settingsPath: string): string {
  switch (view.status) {
    case 'missing': {
      return fill(UI_TEXT.mcpNoSettings, { path: settingsPath })
    }
    case 'unreadable': {
      return `${UI_TEXT.mcpUnreadable} ${view.reason}`
    }
    case 'read': {
      return view.servers.length === 0
        ? fill(UI_TEXT.mcpNone, { path: settingsPath })
        : plural(UI_TEXT.mcpCount, view.servers.length, { path: settingsPath })
    }
  }
}

/** The faults that make Muse Code load no user server at all, said out loud. */
function warnAboutFaults(deps: MuseConfigDeps, view: McpSettingsView): void {
  if (view.status !== 'read') {
    return
  }
  if (view.hasKeyConflict) {
    deps.showWarning(UI_TEXT.mcpKeyConflict)
  }
  const conflicted = view.servers.filter((server) => server.hasModeConflict)
  if (conflicted.length > 0) {
    deps.showWarning(
      `${UI_TEXT.mcpModeConflictWarning} ${conflicted.map((server) => server.name).join(LIST_SEPARATOR)}`,
    )
  }
}

async function openSettings(deps: MuseConfigDeps): Promise<void> {
  if (deps.fileExists(deps.settingsPath)) {
    await deps.openFile(deps.settingsPath)
    return
  }
  deps.showInformation(fill(UI_TEXT.museSettingsMissing, { path: deps.settingsPath }))
}

/** A server the Model API backend runs: its log, or its entry (M50). */
async function modelApiServerActions(deps: MuseConfigDeps, server: McpServerView): Promise<void> {
  const choice = await deps.pick(
    [
      ...(deps.openLog === undefined
        ? []
        : [{ id: SHOW_LOG, label: UI_TEXT.mcpShowLog, detail: UI_TEXT.mcpShowLogDetail }]),
      { id: OPEN_SETTINGS, label: UI_TEXT.mcpOpenSettings },
    ],
    server.name,
    UI_TEXT.mcpModelApiPlaceholder,
  )
  if (choice === SHOW_LOG) {
    deps.openLog?.()
  } else if (choice === OPEN_SETTINGS) {
    await openSettings(deps)
  }
}

async function serverActions(deps: MuseConfigDeps, server: McpServerView): Promise<void> {
  if (deps.modelApiServers !== undefined) {
    await modelApiServerActions(deps, server)
    return
  }
  const isRemote = server.transport === STREAMABLE_HTTP
  const items: PickItem[] = [
    ...(isRemote
      ? [
          { id: 'login', label: UI_TEXT.mcpSignIn, detail: UI_TEXT.mcpSignInDetail },
          { id: 'logout', label: UI_TEXT.mcpSignOut },
        ]
      : []),
    { id: OPEN_SETTINGS, label: UI_TEXT.mcpOpenSettings },
  ]
  const choice = await deps.pick(
    items,
    server.name,
    isRemote ? UI_TEXT.mcpRemotePlaceholder : UI_TEXT.mcpStdioPlaceholder,
  )
  if (choice === 'login' || choice === 'logout') {
    if (!(await deps.runMcpCommand(choice, server.name))) {
      deps.showWarning(UI_TEXT.mcpCliMissing)
    }
    return
  }
  if (choice === OPEN_SETTINGS) {
    await openSettings(deps)
  }
}

export async function showMcpServers(deps: MuseConfigDeps): Promise<void> {
  const read = settingsText(deps)
  const view: McpSettingsView =
    read.error === undefined
      ? readMcpServers(read.text)
      : { status: 'unreadable', reason: read.error }
  warnAboutFaults(deps, view)
  const servers = view.status === 'read' ? view.servers : []
  const isModelApi = deps.modelApiServers !== undefined
  const snapshot = deps.modelApiServers?.()
  const choice = await deps.pick(
    [
      ...servers.map((server) =>
        serverItem(server, isModelApi ? liveState(server, snapshot) : undefined),
      ),
      ...(isModelApi ? [builtInItem()] : []),
      { id: OPEN_SETTINGS, label: UI_TEXT.mcpOpenSettings, detail: deps.settingsPath },
      isModelApi
        ? {
            id: RESTART,
            label: UI_TEXT.mcpRestartModelApi,
            detail: UI_TEXT.mcpRestartModelApiDetail,
          }
        : { id: RESTART, label: UI_TEXT.mcpRestart, detail: UI_TEXT.mcpRestartDetail },
      { id: DOCS, label: UI_TEXT.mcpDocs },
    ],
    isModelApi ? UI_TEXT.mcpTitleModelApi : UI_TEXT.mcpTitle,
    mcpSummary(view, deps.settingsPath),
  )
  // Nothing to do for the built-in server: it has no entry and no process.
  if (choice === undefined || choice.startsWith(BUILT_IN_PREFIX)) {
    return
  }
  if (choice.startsWith(SERVER_PREFIX)) {
    const name = choice.slice(SERVER_PREFIX.length)
    const server = servers.find((candidate) => candidate.name === name)
    if (server !== undefined) {
      await serverActions(deps, server)
    }
    return
  }
  switch (choice) {
    case OPEN_SETTINGS: {
      await openSettings(deps)
      break
    }
    case RESTART: {
      await deps.restart()
      deps.showInformation(isModelApi ? UI_TEXT.mcpRestartedModelApi : UI_TEXT.mcpRestarted)
      break
    }
    default: {
      deps.openDocs()
    }
  }
}

function projectHooksItem(deps: MuseConfigDeps): PickItem {
  const { projectHooksPath } = deps
  let detail: string
  if (projectHooksPath === undefined || !deps.fileExists(projectHooksPath)) {
    detail = UI_TEXT.hooksProjectNone
  } else if (!deps.isWorkspaceTrusted()) {
    detail = UI_TEXT.hooksProjectUntrusted
  } else if (deps.modelApiHooks?.() === false) {
    detail = UI_TEXT.usagePaidOff
  } else {
    detail = UI_TEXT.hooksProjectTrusted
  }
  return {
    id: PROJECT_HOOKS,
    label: UI_TEXT.hooksProject,
    description: UI_TEXT.hooksProjectFile,
    detail,
  }
}

/**
 * On the Model API backend no hook source loads in an untrusted workspace, so
 * a configured user or managed source says it waits for trust, as the project
 * source does. Muse Code applies its own rules, so its view is unchanged.
 */
function withTrustNote(deps: MuseConfigDeps, detail: string): string {
  return deps.modelApiHooks !== undefined && !deps.isWorkspaceTrusted()
    ? `${detail} · ${UI_TEXT.hooksProjectUntrusted}`
    : detail
}

export async function showHooks(deps: MuseConfigDeps): Promise<void> {
  const read = settingsText(deps)
  if (read.error !== undefined) {
    deps.showWarning(`${UI_TEXT.mcpUnreadable} ${read.error}`)
  }
  const sources = readHookSources(read.text)
  const managed = sources.managedHooksPath
  let managedDetail: string = UI_TEXT.hooksManagedNotSet
  if (managed !== undefined) {
    managedDetail = deps.fileExists(managed)
      ? withTrustNote(deps, UI_TEXT.hooksManagedSet)
      : UI_TEXT.hooksManagedMissing
  }
  const choice = await deps.pick(
    [
      ...(deps.modelApiHooks === undefined
        ? []
        : [
            {
              id: MODEL_API_HOOKS_PICK,
              label: MODEL_API_HOOKS_SETTING,
              description: UI_TEXT.backendModelApi,
              detail: deps.modelApiHooks() === true ? UI_TEXT.usagePaidOn : UI_TEXT.usagePaidOff,
            },
          ]),
      projectHooksItem(deps),
      {
        id: USER_HOOKS,
        label: UI_TEXT.hooksUser,
        description: UI_TEXT.hooksUserBlock,
        detail:
          sources.userHookCount === undefined
            ? UI_TEXT.hooksUserNone
            : withTrustNote(deps, plural(UI_TEXT.hooksUserCount, sources.userHookCount)),
      },
      {
        id: MANAGED_HOOKS,
        label: UI_TEXT.hooksManaged,
        description: managed ?? UI_TEXT.hooksManagedKey,
        detail: managedDetail,
      },
      { id: DOCS, label: UI_TEXT.hooksDocs },
    ],
    deps.modelApiHooks === undefined ? UI_TEXT.hooksTitle : UI_TEXT.hooksTitleModelApi,
    deps.modelApiHooks === undefined ? UI_TEXT.hooksWarning : UI_TEXT.hooksModelApiWarning,
  )
  switch (choice) {
    case MODEL_API_HOOKS_PICK: {
      await deps.openModelApiHooksSetting?.()
      break
    }
    case PROJECT_HOOKS: {
      const target = deps.projectHooksPath
      if (target !== undefined && deps.fileExists(target)) {
        await deps.openFile(target)
      } else {
        deps.showInformation(UI_TEXT.hooksProjectNone)
      }
      break
    }
    case USER_HOOKS: {
      await openSettings(deps)
      break
    }
    case MANAGED_HOOKS: {
      if (managed !== undefined && deps.fileExists(managed)) {
        await deps.openFile(managed)
      } else {
        deps.showInformation(managedDetail)
      }
      break
    }
    case DOCS: {
      deps.openDocs()
      break
    }
    default: {
      break
    }
  }
}
