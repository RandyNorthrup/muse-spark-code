// Muse Desktop (M111, D91.12) lane WB: the Electron main process.
// One instance of the app, one window per workspace. The renderer is
// sandboxed with context isolation and no Node integration; it reaches the
// machine only through the zod-validated desktop bridge.

import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  session,
  shell,
  type IpcMainInvokeEvent,
} from 'electron'
import {
  DESKTOP_APP_NAME,
  DESKTOP_COMPOSITOR_WORKSPACE_ENV,
  DESKTOP_LOG_TEXT,
  DESKTOP_SETUP_FLAG,
  DESKTOP_WINDOW_DEFAULT_HEIGHT_PX,
  DESKTOP_WINDOW_DEFAULT_WIDTH_PX,
  DESKTOP_WINDOW_MIN_HEIGHT_PX,
  DESKTOP_WINDOW_MIN_WIDTH_PX,
  DESKTOP_WORKSPACE_FLAG,
} from '../../src/shared/constants'
import {
  externalOpenRequestSchema,
  fileReadRequestSchema,
  fileWriteRequestSchema,
  layoutKeySchema,
  layoutSetRequestSchema,
  openWorkspaceRequestSchema,
  outputClearedSchema,
  statusPublishRequestSchema,
  terminalCreateRequestSchema,
  terminalIdSchema,
  terminalResizeSchema,
  terminalWriteSchema,
  type DesktopWorkspace,
} from '../../src/shared/desktop/bridge'
import {
  isDesktopPermissionGranted,
  isExternalUrlAllowed,
  workspaceKey,
} from '../../src/shared/desktop/workbench'
import {
  confineTerminalCwd,
  listWorkspaceFiles,
  readWorkspaceFile,
  writeWorkspaceFile,
} from './files'
import { LayoutStore, writeStatusSnapshot } from './layoutStore'
import { OutputStore } from './output'
import { ProblemsStore } from './problems'
import { TerminalSessions } from './terminals'

const here = path.dirname(fileURLToPath(import.meta.url))
const rendererFile = path.join(here, 'index.html')
const preloadFile = path.join(here, 'preload.cjs')

interface WindowRecord {
  readonly window: BrowserWindow
  readonly workspace: DesktopWorkspace
  readonly terminals: TerminalSessions
  readonly problems: ProblemsStore
  readonly output: OutputStore
}

const windows = new Map<string, WindowRecord>()
const layoutStore = new LayoutStore(app.getPath('userData'))

function workspaceFromArgs(argv: readonly string[]): { root: string; setupMode: boolean } | null {
  const isSetupMode = argv.includes(DESKTOP_SETUP_FLAG)
  const flagAt = argv.indexOf(DESKTOP_WORKSPACE_FLAG)
  if (flagAt !== -1) {
    const root = argv[flagAt + 1]
    return root === undefined ? null : { root, setupMode: isSetupMode }
  }
  for (const arg of argv) {
    if (arg.startsWith('-')) continue
    try {
      if (statSync(arg).isDirectory()) return { root: arg, setupMode: isSetupMode }
    } catch {
      // Not a folder on disk; it is said below by falling through to setup.
    }
  }
  return null
}

function recordFor(event: IpcMainInvokeEvent): WindowRecord {
  for (const record of windows.values()) {
    if (record.window.webContents === event.sender) return record
  }
  throw new Error('Refused: the calling window is not a workbench window')
}

function openWorkspaceWindow(root: string, isSetupMode: boolean): BrowserWindow {
  const resolved = path.resolve(root)
  const key = workspaceKey(resolved, process.platform)
  const existing = windows.get(key)
  if (existing !== undefined && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore()
    existing.window.focus()
    return existing.window
  }
  const workspace: DesktopWorkspace = {
    root: resolved.replaceAll('\\', '/'),
    name: path.basename(resolved),
    setupMode: isSetupMode,
  }
  const window = new BrowserWindow({
    width: DESKTOP_WINDOW_DEFAULT_WIDTH_PX,
    height: DESKTOP_WINDOW_DEFAULT_HEIGHT_PX,
    minWidth: DESKTOP_WINDOW_MIN_WIDTH_PX,
    minHeight: DESKTOP_WINDOW_MIN_HEIGHT_PX,
    title: `${workspace.name} — ${DESKTOP_APP_NAME}`,
    show: false,
    webPreferences: {
      preload: preloadFile,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })
  const terminals = new TerminalSessions({
    onData: (id, data) => {
      if (!window.isDestroyed()) window.webContents.send('muse-desktop:terminal:data', { id, data })
    },
    onExit: (id, code) => {
      if (!window.isDestroyed()) window.webContents.send('muse-desktop:terminal:exit', { id, code })
    },
  })
  const problems = new ProblemsStore((snapshot) => {
    if (!window.isDestroyed()) window.webContents.send('muse-desktop:problems:changed', snapshot)
  })
  const output = new OutputStore({
    onAppended: (frame) => {
      if (!window.isDestroyed()) window.webContents.send('muse-desktop:output:appended', frame)
    },
    onCleared: (frame) => {
      if (!window.isDestroyed()) window.webContents.send('muse-desktop:output:cleared', frame)
    },
  })
  windows.set(key, { window, workspace, terminals, problems, output })
  window.once('ready-to-show', () => {
    window.show()
  })
  window.on('closed', () => {
    terminals.closeAll()
    windows.delete(key)
  })
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    process.stderr.write(`muse-desktop: ${DESKTOP_LOG_TEXT.navigationDenied} (${url})\n`)
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void window.loadFile(rendererFile)
  return window
}

async function firstWindow(): Promise<void> {
  const fromArgs = workspaceFromArgs(process.argv.slice(1))
  if (fromArgs !== null) {
    openWorkspaceWindow(fromArgs.root, fromArgs.setupMode)
    return
  }
  // Setup mode for first boot: no folder was named, so the person picks one.
  const picked = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  const root = picked.filePaths[0]
  if (root === undefined) {
    app.quit()
    return
  }
  openWorkspaceWindow(root, true)
}

function installIpc(): void {
  ipcMain.handle('muse-desktop:workspace', (event) => recordFor(event).workspace)
  ipcMain.handle('muse-desktop:layout:get', async (_event, raw: unknown) => {
    const key = layoutKeySchema.parse(raw)
    const compositorWorkspace = process.env[DESKTOP_COMPOSITOR_WORKSPACE_ENV]
    const scoped =
      compositorWorkspace !== undefined && key.compositorWorkspace === undefined
        ? { ...key, compositorWorkspace }
        : key
    return await layoutStore.get(scoped)
  })
  ipcMain.handle('muse-desktop:layout:set', async (_event, raw: unknown) => {
    const request = layoutSetRequestSchema.parse(raw)
    await layoutStore.set(request.key, request.layout)
  })
  ipcMain.handle(
    'muse-desktop:files:list',
    async (event) => await listWorkspaceFiles(recordFor(event).workspace.root),
  )
  ipcMain.handle('muse-desktop:files:read', async (event, raw: unknown) => {
    const request = fileReadRequestSchema.parse(raw)
    return await readWorkspaceFile(recordFor(event).workspace.root, request.path)
  })
  ipcMain.handle('muse-desktop:files:write', async (event, raw: unknown) => {
    const request = fileWriteRequestSchema.parse(raw)
    await writeWorkspaceFile(recordFor(event).workspace.root, request.path, request.text)
  })
  ipcMain.handle('muse-desktop:status:publish', async (_event, raw: unknown) => {
    const request = statusPublishRequestSchema.parse(raw)
    await writeStatusSnapshot(app.getPath('userData'), request.workspaceRoot, request.items)
  })
  ipcMain.handle('muse-desktop:terminal:create', (event, raw: unknown) => {
    const request = terminalCreateRequestSchema.parse(raw)
    const record = recordFor(event)
    const created = record.terminals.create({
      cwd: confineTerminalCwd(record.workspace.root, request.cwd),
      cols: request.cols,
      rows: request.rows,
      ...(request.agent !== undefined && { agent: request.agent }),
    })
    record.window.webContents.send('muse-desktop:terminal:opened', created)
    return created
  })
  ipcMain.on('muse-desktop:terminal:write', (event, raw: unknown) => {
    const frame = terminalWriteSchema.parse(raw)
    recordForIpc(event.sender.id)?.terminals.write(frame.id, frame.data)
  })
  ipcMain.on('muse-desktop:terminal:resize', (event, raw: unknown) => {
    const frame = terminalResizeSchema.parse(raw)
    recordForIpc(event.sender.id)?.terminals.resize(frame.id, frame.cols, frame.rows)
  })
  ipcMain.on('muse-desktop:terminal:close', (event, raw: unknown) => {
    const frame = terminalIdSchema.parse(raw)
    recordForIpc(event.sender.id)?.terminals.close(frame.id)
  })
  ipcMain.handle('muse-desktop:terminal:list', (event) => recordFor(event).terminals.list())
  ipcMain.handle('muse-desktop:terminal:children', (event, raw: unknown) => {
    const frame = terminalIdSchema.parse(raw)
    const record = recordFor(event)
    return { id: frame.id, hasChildren: record.terminals.hasChildren(frame.id) }
  })
  ipcMain.handle('muse-desktop:problems:get', (event) => recordFor(event).problems.snapshot())
  ipcMain.handle('muse-desktop:output:get', (event) => recordFor(event).output.snapshot())
  ipcMain.on('muse-desktop:output:clear', (event, raw: unknown) => {
    const frame = outputClearedSchema.parse(raw)
    recordForIpc(event.sender.id)?.output.clear(frame.channel)
  })
  ipcMain.handle('muse-desktop:window:open-workspace', (_event, raw: unknown) => {
    const request = openWorkspaceRequestSchema.parse(raw)
    openWorkspaceWindow(request.root, false)
  })
  ipcMain.handle('muse-desktop:external:open', async (_event, raw: unknown) => {
    const request = externalOpenRequestSchema.parse(raw)
    if (!isExternalUrlAllowed(request.url)) {
      throw new Error(`Refused: ${request.url} may not be opened externally`)
    }
    await shell.openExternal(request.url)
  })
  ipcMain.handle('muse-desktop:window:close', (event) => {
    recordFor(event).window.close()
  })
}

function recordForIpc(senderId: number): WindowRecord | undefined {
  for (const record of windows.values()) {
    if (record.window.webContents.id === senderId) return record
  }
  return undefined
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (hasSingleInstanceLock) {
  app.on('second-instance', (_event, argv) => {
    const fromArgs = workspaceFromArgs(argv)
    if (fromArgs !== null) {
      openWorkspaceWindow(fromArgs.root, fromArgs.setupMode)
      return
    }
    const first = windows.values().next().value
    if (first === undefined) {
      return
    }

    if (first.window.isMinimized()) first.window.restore()
    first.window.focus()
  })
  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
      const isGranted = isDesktopPermissionGranted(permission)
      if (!isGranted) {
        process.stderr.write(`muse-desktop: ${DESKTOP_LOG_TEXT.permissionDenied} (${permission})\n`)
      }
      callback(isGranted)
    })
    installIpc()
    await firstWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void firstWindow()
    })
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
} else {
  app.quit()
}
