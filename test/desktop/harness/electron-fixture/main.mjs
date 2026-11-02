// A disposable real Electron app (M111 lane QA): the smallest window the
// Playwright Electron driver can meaningfully drive. It models no product
// surface; lane WB's workbench is what the driver launches in real runs.

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow } from 'electron'

const here = path.dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const window = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'M111 QA Electron fixture',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.on('did-finish-load', () => {
    process.stdout.write('fixture-ready\n')
  })
  void window.loadFile(path.join(here, 'index.html'))
}

void app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
