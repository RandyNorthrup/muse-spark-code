// Muse Desktop (M111, D91.12) lane WB: the preload. This is the whole of
// the renderer's reach: a frozen, schema-checking bridge on
// `window.museDesktop`. No Electron or Node object crosses it.

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_BRIDGE_NAME } from '../../src/shared/constants'
import {
  desktopWorkspaceSchema,
  fileEntrySchema,
  fileReadResultSchema,
  outputAppendedSchema,
  outputClearedSchema,
  outputSnapshotSchema,
  problemsChangedSchema,
  terminalChildrenSchema,
  terminalCreatedSchema,
  terminalDataSchema,
  terminalExitSchema,
  terminalSessionSchema,
  workbenchLayoutV2Schema,
  type DesktopChannel,
  type MuseDesktopBridge,
} from '../../src/shared/desktop/bridge'
import { z } from 'zod'

function invoke(channel: DesktopChannel, ...args: unknown[]): Promise<unknown> {
  const result: Promise<unknown> = ipcRenderer.invoke(channel, ...args)
  return result
}
function send(channel: DesktopChannel, frame: unknown): void {
  ipcRenderer.send(channel, frame)
}

const bridge: MuseDesktopBridge = {
  async workspace() {
    return desktopWorkspaceSchema.parse(await invoke('muse-desktop:workspace'))
  },
  async getLayout(key) {
    const raw: unknown = await invoke('muse-desktop:layout:get', key)
    return raw === null ? null : workbenchLayoutV2Schema.parse(raw)
  },
  async setLayout(request) {
    await invoke('muse-desktop:layout:set', request)
  },
  async listFiles() {
    const raw: unknown = await invoke('muse-desktop:files:list')
    return z.array(fileEntrySchema).parse(raw)
  },
  async readFile(filePath) {
    return fileReadResultSchema.parse(await invoke('muse-desktop:files:read', { path: filePath }))
  },
  async writeFile(filePath, text) {
    await invoke('muse-desktop:files:write', { path: filePath, text })
  },
  async publishStatus(request) {
    await invoke('muse-desktop:status:publish', request)
  },
  async createTerminal(request) {
    return terminalCreatedSchema.parse(await invoke('muse-desktop:terminal:create', request))
  },
  writeTerminal(id, data) {
    send('muse-desktop:terminal:write', { id, data })
  },
  resizeTerminal(id, cols, rows) {
    send('muse-desktop:terminal:resize', { id, cols, rows })
  },
  closeTerminal(id) {
    send('muse-desktop:terminal:close', { id })
  },
  onTerminalData(listener) {
    const handler = (_event: unknown, raw: unknown): void => {
      listener(terminalDataSchema.parse(raw))
    }
    ipcRenderer.on('muse-desktop:terminal:data', handler)
    return () => {
      ipcRenderer.removeListener('muse-desktop:terminal:data', handler)
    }
  },
  onTerminalExit(listener) {
    const handler = (_event: unknown, raw: unknown): void => {
      listener(terminalExitSchema.parse(raw))
    }
    ipcRenderer.on('muse-desktop:terminal:exit', handler)
    return () => {
      ipcRenderer.removeListener('muse-desktop:terminal:exit', handler)
    }
  },
  async listTerminals() {
    const raw: unknown = await invoke('muse-desktop:terminal:list')
    return z.array(terminalSessionSchema).parse(raw)
  },
  async hasTerminalChildren(id) {
    return terminalChildrenSchema.parse(await invoke('muse-desktop:terminal:children', { id }))
  },
  onTerminalOpened(listener) {
    const handler = (_event: unknown, raw: unknown): void => {
      listener(terminalSessionSchema.parse(raw))
    }
    ipcRenderer.on('muse-desktop:terminal:opened', handler)
    return () => {
      ipcRenderer.removeListener('muse-desktop:terminal:opened', handler)
    }
  },
  async getProblems() {
    return problemsChangedSchema.parse(await invoke('muse-desktop:problems:get'))
  },
  onProblemsChanged(listener) {
    const handler = (_event: unknown, raw: unknown): void => {
      listener(problemsChangedSchema.parse(raw))
    }
    ipcRenderer.on('muse-desktop:problems:changed', handler)
    return () => {
      ipcRenderer.removeListener('muse-desktop:problems:changed', handler)
    }
  },
  async getOutput() {
    return outputSnapshotSchema.parse(await invoke('muse-desktop:output:get'))
  },
  clearOutput(channel) {
    send('muse-desktop:output:clear', channel === undefined ? {} : { channel })
  },
  onOutputAppended(listener) {
    const handler = (_event: unknown, raw: unknown): void => {
      listener(outputAppendedSchema.parse(raw))
    }
    ipcRenderer.on('muse-desktop:output:appended', handler)
    return () => {
      ipcRenderer.removeListener('muse-desktop:output:appended', handler)
    }
  },
  onOutputCleared(listener) {
    const handler = (_event: unknown, raw: unknown): void => {
      listener(outputClearedSchema.parse(raw))
    }
    ipcRenderer.on('muse-desktop:output:cleared', handler)
    return () => {
      ipcRenderer.removeListener('muse-desktop:output:cleared', handler)
    }
  },
  async openWorkspace(root) {
    await invoke('muse-desktop:window:open-workspace', { root })
  },
  async openExternal(url) {
    await invoke('muse-desktop:external:open', { url })
  },
  async closeWindow() {
    await invoke('muse-desktop:window:close')
  },
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_NAME, Object.freeze(bridge))
