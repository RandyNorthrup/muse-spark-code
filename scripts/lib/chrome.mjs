// Where headless Chrome lives on this machine, for the scripts that render
// the webview (harness screenshots) and the Marketplace icon. CHROME_PATH
// wins; otherwise the platform's usual install folders, then PATH.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const CHROME_CANDIDATES = {
  win32: [
    path.join(
      process.env.ProgramFiles ?? String.raw`C:\Program Files`,
      'Google/Chrome/Application/chrome.exe',
    ),
    path.join(
      process.env['ProgramFiles(x86)'] ?? String.raw`C:\Program Files (x86)`,
      'Google/Chrome/Application/chrome.exe',
    ),
    path.join(process.env.LOCALAPPDATA ?? '', 'Google/Chrome/Application/chrome.exe'),
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'],
}

/** The Chrome executable to run, or undefined when none is known. */
export function findChrome() {
  if (process.env.CHROME_PATH !== undefined) {
    return process.env.CHROME_PATH
  }
  const candidates = CHROME_CANDIDATES[process.platform] ?? []
  // Bare names are resolved through PATH by execFile; absolute ones must exist.
  return candidates.find((candidate) => !path.isAbsolute(candidate) || existsSync(candidate))
}
