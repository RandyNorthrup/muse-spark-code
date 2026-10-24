// M125 lane H (D107 §8.1 step 3): the private Ollama runtime. One
// process per user on a free loopback port, the lock proving it; paths
// under the install root only, never machine-wide. Spawning needs the
// pinned binary, so its live proof waits for the archives (rule 9);
// ports, locks and paths prove here against real sockets, files and
// processes. The server starts and stops through the governed launch.
import { readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import * as os from 'node:os'
import path from 'node:path'
import { isErrno } from '../../fs/errno'
import { spawnResourceFile } from '../../resources/launcher'

export interface JudgeRuntimePaths {
  readonly root: string
  readonly bin: string
  readonly models: string
  readonly lock: string
  readonly record: string
}

/** The install layout: runtime/<version>/, models/, and the records. */
export function runtimePaths(storageRoot: string, version: string): JudgeRuntimePaths {
  const root = path.join(storageRoot, 'judge', 'runtime', version)
  return {
    root,
    bin: path.join(root, process.platform === 'win32' ? 'ollama.exe' : 'ollama'),
    models: path.join(storageRoot, 'judge', 'models'),
    lock: path.join(storageRoot, 'judge', 'runtime.lock'),
    record: path.join(storageRoot, 'judge', 'registration.json'),
  }
}

/** A free loopback port, by binding port 0 and letting go. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => {
        resolve(port)
      })
    })
  })
}

export interface RuntimeLock {
  /** Remove the lock; best effort, the holder is done either way. */
  readonly release: () => Promise<void>
}

function lockContent(): string {
  return JSON.stringify({ pid: process.pid, at: new Date().toISOString() })
}

function lockPid(content: string): number | undefined {
  let input: unknown
  try {
    input = JSON.parse(content)
  } catch (error: unknown) {
    if (!(error instanceof SyntaxError)) throw error
    return undefined
  }
  if (typeof input !== 'object' || input === null || !('pid' in input)) return undefined
  const pid: unknown = input.pid
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error: unknown) {
    if (!isErrno(error)) throw error
    return false
  }
}

/**
Hold the one-process lock, stealing it from a dead holder. A live
holder means another window owns the runtime: undefined, never a
second process.
*/
export async function acquireRuntimeLock(lockPath: string): Promise<RuntimeLock | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await writeFile(lockPath, lockContent(), { flag: 'wx' })
      return {
        release: async () => {
          try {
            await rm(lockPath)
          } catch (error: unknown) {
            if (!isErrno(error)) throw error
          }
        },
      }
    } catch (error: unknown) {
      if (!isErrno(error) || error.code !== 'EEXIST') throw error
    }
    let content: string
    try {
      content = await readFile(lockPath, 'utf8')
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      continue
    }
    const pid = lockPid(content)
    if (pid === undefined || isPidAlive(pid)) return undefined
    try {
      await rm(lockPath)
    } catch (error: unknown) {
      if (!isErrno(error)) throw error
      return undefined
    }
  }
  return undefined
}

export interface StartedRuntime {
  readonly pid: number
  readonly port: number
  readonly stop: () => Promise<void>
}

/**
Start the pinned server on its loopback port with its models directory,
through the governed launch like every process we start: admitted,
contained, the binary refused unless it exists outside the folder the
server runs in, the guarded child environment, and one stop for its whole
tree. The binary answers for itself: the caller waits on /api/version.
Live-proof deferred: needs the pinned archives.
*/
export async function startRuntime(
  binary: string,
  port: number,
  modelsDir: string,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<StartedRuntime> {
  const launched = await spawnResourceFile('contained', binary, ['serve'], {
    cwd: os.tmpdir(),
    env: {
      ...extraEnv,
      OLLAMA_HOST: `127.0.0.1:${String(port)}`,
      OLLAMA_MODELS: modelsDir,
    },
  })
  // Nothing reads the server's own log: its pipes drain, so a full pipe
  // never stalls it.
  launched.child.stdin.end()
  launched.child.stdout.resume()
  launched.child.stderr.resume()
  const pid = launched.child.pid
  if (pid === undefined) {
    await launched.stop()
    throw new Error('runtime spawn produced no pid')
  }
  let stopping: Promise<void> | undefined
  return {
    pid,
    port,
    stop: () => (stopping ??= launched.stop()),
  }
}
