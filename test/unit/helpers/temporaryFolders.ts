// Removing a test's temporary folder. On Windows a scanner or an indexer
// can hold a file there for a moment after the test is done with it, so
// Node retries the removal. A folder still held after the retries fails the
// suite: that is how a process a test leaves behind shows (the tree kill's
// orphans, PLAN.md M27, sat in `toolIo.test.ts`'s folder this way).

import { readdirSync, realpathSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { noWorkspaceChildEnvironment, windowsPowerShell } from '../../../src/core/execGuard'
import { runProgram } from '../../../src/host/processTree'

const REMOVE_RETRIES = 5
const REMOVE_RETRY_DELAY_MS = 200

export function removeFolder(folder: string): Promise<void> {
  return rm(folder, {
    recursive: true,
    force: true,
    maxRetries: REMOVE_RETRIES,
    retryDelay: REMOVE_RETRY_DELAY_MS,
  })
}

/**
The temporary folders one suite makes, all removed afterwards. Suites
share it instead of repeating the tracker, so the duplication gate stays
silent and every folder still cleans up the same way.
*/
export function temporaryTracker() {
  const folders: string[] = []
  return {
    cleanup: async (): Promise<void> => {
      await Promise.all(folders.splice(0).map((folder) => removeFolder(folder)))
    },
    make: async (prefix: string): Promise<string> => {
      const folder = await mkdtemp(path.join(tmpdir(), prefix))
      folders.push(folder)
      return folder
    },
  }
}

/** A test's temporary folder for one body: created, handed over, removed. */
export async function usingTempDir<T>(
  prefix: string,
  work: (folder: string) => T | Promise<T>,
): Promise<T> {
  // Resolved, like temporaryDir: a symlinked ancestor (macOS's /var) would
  // otherwise hand a path the symlink-guarded stores must refuse.
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
  try {
    return await work(folder)
  } finally {
    await removeFolder(folder)
  }
}

/**
A fresh directory under the process temporary folder (resolved, so
macOS's `/var` symlink never leaks into hashed paths).
*/
export async function temporaryDir(prefix: string): Promise<string> {
  return await realpath(await mkdtemp(path.join(tmpdir(), prefix)))
}

/**
A fresh lock directory for the named lock, relative to the working
folder: a Unix socket path must fit sockaddr_un (103 bytes on macOS),
and neither the checkout's absolute path nor a lane-private TMPDIR can
promise that. Workers inherit the working folder, so they meet here.
*/
export async function lockDirectory(prefix: string): Promise<string> {
  const temp = path.resolve('temp')
  await mkdir(temp, { recursive: true })
  return path.relative(process.cwd(), await mkdtemp(path.join(temp, prefix)))
}

/**
A Windows storage folder the trusted-path check accepts: inheritance cut,
then full control to this user, SYSTEM and Administrators only. A
temporary folder may inherit other accounts' write access (it does on some
rigs), and the trust check rightly refuses a helper built there. Suites
share it instead of repeating the lockdown, so the duplication gate stays
silent and every storage dir still locks down the same way.
*/
export async function lockWindowsStorageDir(storageDir: string, systemRoot: string): Promise<void> {
  const powershell = windowsPowerShell(systemRoot)
  const user = await runProgram(
    powershell.file,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '[Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    ],
    powershell.env,
  )
  await runProgram(
    path.win32.join(systemRoot, 'System32', 'icacls.exe'),
    [
      storageDir,
      '/inheritance:r',
      '/grant:r',
      ...[user.trim(), 'S-1-5-18', 'S-1-5-32-544'].map((sid) => `*${sid}:(OI)(CI)F`),
    ],
    noWorkspaceChildEnvironment('win32', { SystemRoot: systemRoot }, realpathSync),
  )
}

/** Every file under a folder, as absolute paths: what a key scan reads. */
export function filesUnder(folder: string): readonly string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}
