// The browser check's own processes and folders (M81, PLAN.md D49), in the
// browser's bundle: the system Chrome or Edge started with nothing on its
// standard streams and the two extra pipes CDP runs over (file descriptors
// 3 and 4); its profile a fresh folder under the OS temporary folder,
// removed afterwards; and a kill that ends it with everything it started
// (processTree.ts: its process group on POSIX, taskkill and the orphan sweep
// on Windows). The browser also exits by itself when its pipe closes, so a
// window that dies leaves no browser behind (docs/certification/m81.md).

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Duplex } from 'node:stream'
import { environmentValue } from '../../core/backends/musecode/launch'
import { findBrowserExecutable } from '../../core/browser/browserLaunch'
import { findManagedProxyPolicy } from '../../core/browser/browserManagedPolicy'
import type { BrowserProcess, BrowserRunDeps } from '../../core/browser/browserRun'
import {
  BROWSER_PROFILE_PREFIX,
  BROWSER_PROFILE_REMOVE_RETRIES,
  BROWSER_PROFILE_REMOVE_RETRY_MS,
} from '../../shared/constants'
import { killTree, treeSpawnOptions } from '../processTree'
import { hostPolicyReaders } from './browserPolicyReaders'

export interface HostBrowserDeps {
  readonly platform: NodeJS.Platform
  readonly env: NodeJS.ProcessEnv
  /** A warning for the extension's log. */
  readonly warn: (message: string) => void
}

const PATH_VARIABLE = 'PATH'
const SYSTEM_ROOT_VARIABLE = 'SystemRoot'

function ignore(): void {
  // The pipe's loss is reported by its other end.
}

/** The browser over `--remote-debugging-pipe`: file descriptor 3 written, 4 read. */
function spawnBrowser(
  executable: string,
  args: readonly string[],
  deps: HostBrowserDeps,
): BrowserProcess {
  const startedAt = Date.now()
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the system Chrome or Edge by an absolute path from its well-known places or an absolute PATH entry (D24), with the fixed flags of browserLaunch.ts, the fresh profile and the plain hosts policy-checked into the bypass list; the model's URL goes over the pipe, never on the command line (M81, PLAN.md D49).
  const child = spawn(executable, [...args], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
    ...treeSpawnOptions(deps.platform),
  })
  // File descriptors 3 and 4: what Chrome reads, and what it writes.
  const writer = child.stdio[3]
  const reader = child.stdio[4]
  const exited = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    child.once('exit', () => {
      resolve()
    })
    // A file that cannot be started reports here; the pipe carries the reason.
    child.once('error', (error) => {
      if (reader instanceof Duplex) {
        reader.destroy(error)
      }
      resolve()
    })
  })
  if (!(writer instanceof Duplex) || !(reader instanceof Duplex)) {
    child.kill()
    throw new Error('the browser was started without its debugging pipes')
  }
  // Writing to a browser that has gone fails; its read end says so.
  writer.on('error', ignore)
  return {
    writer,
    reader,
    exited,
    kill: async () => {
      await killTree(
        child,
        {
          platform: deps.platform,
          systemRoot: environmentValue(deps.env, deps.platform, SYSTEM_ROOT_VARIABLE),
          log: deps.warn,
        },
        startedAt,
      )
    },
  }
}

/** The run's seams over the real browser, folders and environment. */
export function hostBrowserRunDeps(deps: HostBrowserDeps): BrowserRunDeps {
  return {
    findExecutable: () =>
      findBrowserExecutable({
        platform: deps.platform,
        pathVariable: environmentValue(deps.env, deps.platform, PATH_VARIABLE),
        variable: (name) => environmentValue(deps.env, deps.platform, name),
        fileExists: existsSync,
      }),
    findManagedPolicy: async () =>
      await findManagedProxyPolicy(
        hostPolicyReaders({
          platform: deps.platform,
          env: deps.env,
          systemRoot: environmentValue(deps.env, deps.platform, SYSTEM_ROOT_VARIABLE),
        }),
      ),
    createProfile: async () => await mkdtemp(path.join(tmpdir(), BROWSER_PROFILE_PREFIX)),
    removeProfile: async (directory) => {
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: BROWSER_PROFILE_REMOVE_RETRIES,
        retryDelay: BROWSER_PROFILE_REMOVE_RETRY_MS,
      })
    },
    spawn: (executable, args) => spawnBrowser(executable, args, deps),
    onProfileLeft: (directory, error) => {
      deps.warn(`The browser check's profile ${directory} could not be removed: ${String(error)}`)
    },
  }
}
