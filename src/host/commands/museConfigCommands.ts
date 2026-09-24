// `Muse Spark: MCP Servers` and `Muse Spark: Hooks` (M31, PLAN.md D30):
// what Muse Code will load from its settings and the workspace, shown
// read-only (D17: the extension never writes the CLI's settings). A server
// can be signed in to or out of through `muse mcp login|logout` in a
// terminal, and every file is one click away. Every VS Code and process
// interaction is injected.

import {
  type McpServerView,
  type McpSettingsView,
  readHookSources,
  readMcpServers,
} from '../../core/backends/musecode/museConfigView'
import { UI_TEXT } from '../../shared/constants'
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
  readonly runMcpCommand: (action: McpAction, server: string) => boolean
  /** Stops the hosts so the next message starts Muse Code with the new settings. */
  readonly restart: () => Promise<void>
  readonly showInformation: (message: string) => void
  readonly showWarning: (message: string) => void
}

const OPEN_SETTINGS = 'action:openSettings'
const RESTART = 'action:restart'
const DOCS = 'action:docs'
const SERVER_PREFIX = 'server:'
const PROJECT_HOOKS = 'hooks:project'
const USER_HOOKS = 'hooks:user'
const MANAGED_HOOKS = 'hooks:managed'
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

function serverDetail(server: McpServerView): string {
  const parts: string[] = [server.mode === 'optional' ? UI_TEXT.mcpOptional : UI_TEXT.mcpRequired]
  if (!server.isEnabled) {
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

function serverItem(server: McpServerView): PickItem {
  return {
    id: `${SERVER_PREFIX}${server.name}`,
    label: server.name,
    description: `${server.transport}${DETAIL_SEPARATOR}${server.target}`,
    detail: serverDetail(server),
  }
}

/** The pick's placeholder: what the file holds, or why nothing can be shown. */
function mcpSummary(view: McpSettingsView, settingsPath: string): string {
  switch (view.status) {
    case 'missing': {
      return `${UI_TEXT.mcpNoSettings} ${settingsPath}`
    }
    case 'unreadable': {
      return `${UI_TEXT.mcpUnreadable} ${view.reason}`
    }
    case 'read': {
      return view.servers.length === 0
        ? `${UI_TEXT.mcpNone} ${settingsPath}`
        : `${String(view.servers.length)} ${UI_TEXT.mcpCount} ${settingsPath}`
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
  deps.showInformation(`${UI_TEXT.museSettingsMissing} ${deps.settingsPath}`)
}

async function serverActions(deps: MuseConfigDeps, server: McpServerView): Promise<void> {
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
    if (!deps.runMcpCommand(choice, server.name)) {
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
  const choice = await deps.pick(
    [
      ...servers.map((server) => serverItem(server)),
      { id: OPEN_SETTINGS, label: UI_TEXT.mcpOpenSettings, detail: deps.settingsPath },
      { id: RESTART, label: UI_TEXT.mcpRestart, detail: UI_TEXT.mcpRestartDetail },
      { id: DOCS, label: UI_TEXT.mcpDocs },
    ],
    UI_TEXT.mcpTitle,
    mcpSummary(view, deps.settingsPath),
  )
  if (choice === undefined) {
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
      deps.showInformation(UI_TEXT.mcpRestarted)
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
  } else {
    detail = deps.isWorkspaceTrusted() ? UI_TEXT.hooksProjectTrusted : UI_TEXT.hooksProjectUntrusted
  }
  return {
    id: PROJECT_HOOKS,
    label: UI_TEXT.hooksProject,
    description: UI_TEXT.hooksProjectFile,
    detail,
  }
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
    managedDetail = deps.fileExists(managed) ? UI_TEXT.hooksManagedSet : UI_TEXT.hooksManagedMissing
  }
  const choice = await deps.pick(
    [
      projectHooksItem(deps),
      {
        id: USER_HOOKS,
        label: UI_TEXT.hooksUser,
        description: UI_TEXT.hooksUserBlock,
        detail:
          sources.userHookCount === undefined
            ? UI_TEXT.hooksUserNone
            : `${String(sources.userHookCount)} ${UI_TEXT.hooksUserCount}`,
      },
      {
        id: MANAGED_HOOKS,
        label: UI_TEXT.hooksManaged,
        description: managed ?? UI_TEXT.hooksManagedKey,
        detail: managedDetail,
      },
      { id: DOCS, label: UI_TEXT.hooksDocs },
    ],
    UI_TEXT.hooksTitle,
    UI_TEXT.hooksWarning,
  )
  switch (choice) {
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
