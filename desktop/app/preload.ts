// Muse Desktop (M111, D91.12) lane WB: the preload. This is the whole of
// the renderer's reach: a frozen, schema-checking bridge on
// `window.museDesktop`. No Electron or Node object crosses it.

import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_BRIDGE_NAME } from '../../src/shared/constants'
import {
  desktopWorkspaceSchema,
  fileEntrySchema,
  fileReadResultSchema,
  terminalCreatedSchema,
  terminalDataSchema,
  terminalExitSchema,
  workbenchLayoutSchema,
  type MuseDesktopBridge,
} from '../../src/shared/desktop/bridge'
import { z } from 'zod'

const bridge: MuseDesktopBridge = {
  async workspace() {
    return desktopWorkspaceSchema.parse(await ipcRenderer.invoke('muse-desktop:workspace'))
  },
  async getLayout(key) {
    const raw: unknown = await ipcRenderer.invoke('muse-desktop:layout:get', key)
    return raw === null ? null : workbenchLayoutSchema.parse(raw)
  },
  async setLayout(request) {
    await ipcRenderer.invoke('muse-desktop:layout:set', request)
  },
  async listFiles() {
    const raw: unknown = await ipcRenderer.invoke('muse-desktop:files:list')
    return z.array(fileEntrySchema).parse(raw)
  },
  async readFile(filePath) {
    return fileReadResultSchema.parse(
      await ipcRenderer.invoke('muse-desktop:files:read', { path: filePath }),
    )
  },
  async writeFile(filePath, text) {
    await ipcRenderer.invoke('muse-desktop:files:write', { path: filePath, text })
  },
  async publishStatus(request) {
    await ipcRenderer.invoke('muse-desktop:status:publish', request)
  },
  async createTerminal(request) {
    return terminalCreatedSchema.parse(
      await ipcRenderer.invoke('muse-desktop:terminal:create', request),
    )
  },
  writeTerminal(id, data) {
    ipcRenderer.send('muse-desktop:terminal:write', { id, data })
  },
  resizeTerminal(id, cols, rows) {
    ipcRenderer.send('muse-desktop:terminal:resize', { id, cols, rows })
  },
  closeTerminal(id) {
    ipcRenderer.send('muse-desktop:terminal:close', { id })
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
  async openWorkspace(root) {
    await ipcRenderer.invoke('muse-desktop:window:open-workspace', { root })
  },
  async openExternal(url) {
    await ipcRenderer.invoke('muse-desktop:external:open', { url })
  },
  async closeWindow() {
    await ipcRenderer.invoke('muse-desktop:window:close')
  },
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_NAME, Object.freeze(bridge))
