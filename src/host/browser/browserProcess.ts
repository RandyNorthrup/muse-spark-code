// The browser check's own processes, folders and sockets (M81 A1, PLAN.md
// D49), in the check's bundle: the verified headless shell started with
// nothing on its standard streams, the two extra pipes CDP runs over (file
// descriptors 3 and 4) and the projected environment; each check's folder
// under the extension's storage (`bc/<id>/`: the profile, its temporary
// folder, its home), created private and removed afterwards; the proxy and
// the probe fixture; and a kill that ends the browser with everything it
// started: its own process group on POSIX, `taskkill /T /F` on Windows,
// where Chrome's helpers also end with the browser's own job objects (the
// rigs show none left, docs/certification/m81.md). The browser also exits by
// itself when its pipe closes, so a window that dies leaves no browser
// behind. A folder a dead window left is swept by a later check once its
// owner is known to be gone.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import type { BrowserProcess, BrowserRunDeps, CheckFolder } from '../../core/browser/browserRun'
import { startProbeFixture } from '../../core/browser/canaries'
import { startCheckProxy } from '../../core/browser/checkProxy'
import {
  BROWSER_CHECK_DIR,
  BROWSER_CHECK_ID_BYTES,
  BROWSER_CHECK_OWNER_FILE,
  BROWSER_CHECK_SWEEP_MAX,
  BROWSER_PROFILE_REMOVE_RETRIES,
  BROWSER_PROFILE_REMOVE_RETRY_MS,
  BROWSER_PROFILE_SUBDIRS,
  WINDOWS_TASKKILL_RELATIVE_PATH,
} from '../../shared/browserCheckConstants'

export interface HostBrowserDeps {
  readonly platform: NodeJS.Platform
  readonly env: Readonly<Record<string, string | undefined>>
  /** A fixed fact for the extension's log. */
  readonly warn: (fact: string) => void
}

const PRIVATE_DIR_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const SYSTEM_ROOT = 'systemroot'

function ignore(): void {
  // The pipe's loss is reported by its other end.
}

/** A spawn `error`'s own code, when it has one. */
function spawnCodeOf(error: unknown): string | undefined {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : undefined
}

/** Ends the browser and everything it started, at once. */
async function killBrowser(child: ChildProcess, deps: HostBrowserDeps): Promise<void> {
  const { pid } = child
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  if (deps.platform !== 'win32') {
    try {
      // The browser leads its own process group (spawned detached).
      process.kill(-pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  const systemRoot = systemRootOf(deps)
  if (systemRoot === undefined) {
    child.kill()
    return
  }
  await new Promise<void>((resolve) => {
    // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- Windows' own taskkill by its absolute path under SystemRoot, with the browser's own process id: the tree kill of the check's browser (M81 A1, PLAN.md §8).
    execFile(
      path.win32.join(systemRoot, WINDOWS_TASKKILL_RELATIVE_PATH),
      ['/PID', String(pid), '/T', '/F'],
      { windowsHide: true },
      (error) => {
        if (error !== null && child.exitCode === null) {
          deps.warn("Browser check: the browser's process tree needed a forced end")
          child.kill()
        }
        resolve()
      },
    )
  })
}

/** The browser over `--remote-debugging-pipe`: file descriptor 3 written, 4 read. */
function spawnBrowser(
  executable: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  deps: HostBrowserDeps,
): BrowserProcess {
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the pinned headless shell at the absolute path the runtime bundle verified against browserRuntime.json in the extension's own storage (never PATH, a system browser or a workspace file), with the fixed flags of BROWSER_LAUNCH_FLAGS, the check's own proxy endpoint and profile, and a projected environment; the model's URL goes over the pipe, never on the command line (M81 A1, PLAN.md D49).
  const child = spawn(executable, [...args], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    env: { ...env },
    windowsHide: true,
    // Its own process group on POSIX, so the kill ends everything it started.
    detached: deps.platform !== 'win32',
  })
  // File descriptors 3 and 4: what Chrome reads, and what it writes.
  const writer = child.stdio[3]
  const reader = child.stdio[4]
  // The spawn's own error code, once known: the OS reports a refused
  // executable (EACCES/EPERM from application control, permissions or
  // signing) asynchronously on `error` rather than throwing, so its code is
  // kept for the run's own mapping; `undefined` once the browser started.
  const spawnError = new Promise<string | undefined>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(undefined)
      return
    }
    child.once('spawn', () => {
      resolve(undefined)
    })
    child.once('error', (error: unknown) => {
      resolve(spawnCodeOf(error))
    })
    child.once('exit', () => {
      resolve(undefined)
    })
  })
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => {
      resolve()
    })
    // A file that cannot be started reports here; the pipe carries the end.
    child.once('error', () => {
      if (reader instanceof Duplex) {
        reader.destroy(new Error('the browser could not be started'))
      }
      resolve()
    })
  })
  if (!(writer instanceof Duplex) || !(reader instanceof Duplex)) {
    child.kill()
    throw new Error('no debugging pipes')
  }
  // Writing to a browser that has gone fails; its read end says so.
  writer.on('error', ignore)
  return {
    writer,
    reader,
    exited,
    spawnError,
    kill: async () => {
      await killBrowser(child, deps)
    },
  }
}

/** Windows' own folder, by its variable's name in any case. */
function systemRootOf(deps: HostBrowserDeps): string | undefined {
  if (deps.platform !== 'win32') {
    return undefined
  }
  const key = Object.keys(deps.env).find((name) => name.toLowerCase() === SYSTEM_ROOT)
  return key === undefined ? undefined : deps.env[key]
}

/** Whether a process id still runs; unknown counts as running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ESRCH'
    )
  }
}

/** Folders earlier checks left whose owner process is gone, a bounded few at a time. */
async function sweepLeftovers(parent: string): Promise<void> {
  let names: readonly string[]
  try {
    names = await readdir(parent)
  } catch {
    return
  }
  for (const name of names.slice(0, BROWSER_CHECK_SWEEP_MAX)) {
    const root = path.join(parent, name)
    let owner: number
    try {
      owner = Number(await readFile(path.join(root, BROWSER_CHECK_OWNER_FILE), 'utf8'))
    } catch {
      continue
    }
    // Unknown ownership is kept; a live owner may be another window's check.
    if (Number.isSafeInteger(owner) && owner > 0 && owner !== process.pid && !isRunning(owner)) {
      try {
        await rm(root, { recursive: true, force: true })
      } catch {
        // Still there: a later sweep tries again.
      }
    }
  }
}

async function createFolder(storageDir: string): Promise<CheckFolder> {
  const parent = path.join(storageDir, BROWSER_CHECK_DIR)
  await mkdir(parent, { recursive: true, mode: PRIVATE_DIR_MODE })
  await sweepLeftovers(parent)
  const root = path.join(parent, randomBytes(BROWSER_CHECK_ID_BYTES).toString('hex'))
  // Not recursive: an existing folder is never reused.
  await mkdir(root, { mode: PRIVATE_DIR_MODE })
  await writeFile(path.join(root, BROWSER_CHECK_OWNER_FILE), String(process.pid), {
    mode: PRIVATE_FILE_MODE,
    flag: 'wx',
  })
  const folder: CheckFolder = {
    root,
    profile: path.join(root, BROWSER_PROFILE_SUBDIRS.profile),
    temp: path.join(root, BROWSER_PROFILE_SUBDIRS.temp),
    home: path.join(root, BROWSER_PROFILE_SUBDIRS.home),
  }
  for (const directory of [folder.profile, folder.temp, folder.home]) {
    await mkdir(directory, { mode: PRIVATE_DIR_MODE })
  }
  return folder
}

/** This machine's own non-loopback IPv4 address: what C6 and C7 test against. */
function ownAddress(): string | undefined {
  return Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
}

/** The run's seams over the real browser, folders, sockets and environment. */
export function hostBrowserRunDeps(deps: HostBrowserDeps): BrowserRunDeps {
  return {
    platform: deps.platform,
    env: deps.env,
    createFolder,
    removeFolder: async (folder) => {
      try {
        await rm(folder.root, {
          recursive: true,
          force: true,
          maxRetries: BROWSER_PROFILE_REMOVE_RETRIES,
          retryDelay: BROWSER_PROFILE_REMOVE_RETRY_MS,
        })
      } catch {
        deps.warn("Browser check: a check's folder could not be removed; a later check sweeps it")
      }
    },
    statExecutable: async (executable) => {
      try {
        const info = await stat(executable)
        return { bytes: info.size, mtimeMs: info.mtimeMs }
      } catch {
        return
      }
    },
    startProxy: async (scope) => await startCheckProxy(scope),
    startFixture: async () => await startProbeFixture(deps.platform, ownAddress),
    spawn: (executable, args, env) => spawnBrowser(executable, args, env, deps),
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  }
}
