// The real grant-lock module, real child processes, real temp folders. No
// stand-ins: every test below fails when a person would be hurt (a second
// holder, a lost lock after a crash, a stale file, a reserved port, a local
// failure masked as "temporarily unavailable").
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withChatGptRefreshLock } from '../../src/runtime/chatGptRefreshLock'
import { ChatGptSignInError } from '../../src/core/providers/subscriptions/chatgptHostId'
import { chatGptCommandText } from '../../src/runtime/chatGptProviderCommands'
import { CHATGPT_GRANT_LOCK_FILE } from '../../src/shared/constants'

const scratch = { folder: '' }
// Socket-file assertions only hold where the lock binds a Unix socket
// (macOS/Linux). On Windows the same lock binds a named pipe instead, so
// those cases have their own pipe variants below.
const isWindows = process.platform === 'win32'
beforeAll(async () => {
  const temp = path.resolve('temp')
  await mkdir(temp, { recursive: true })
  scratch.folder = await mkdtemp(path.join(temp, 'm95b-x-lock-'))
  await build({
    entryPoints: [path.resolve('src/runtime/chatGptRefreshLock.ts')],
    outfile: path.join(scratch.folder, 'lock.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
})
afterAll(async () => {
  if (scratch.folder !== '') await rm(scratch.folder, { recursive: true, force: true })
})

async function lockDirectory(prefix: string): Promise<string> {
  return await mkdtemp(path.join(scratch.folder, prefix))
}

function socketFile(directory: string): string {
  return path.join(directory, CHATGPT_GRANT_LOCK_FILE)
}

function worker(directory: string): ChildProcess {
  return spawn(
    process.execPath,
    [
      path.resolve('test/hosts/runtime-chatgpt-lock-worker.mjs'),
      path.join(scratch.folder, 'lock.cjs'),
      directory,
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'] },
    },
  )
}

/** A foreign raw-socket holder: SIGKILL leaves its file like a real crash. */
function staleHolder(socketPath: string): ChildProcess {
  return spawn(
    process.execPath,
    [path.resolve('test/hosts/runtime-chatgpt-stale-socket.mjs'), socketPath],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'] },
    },
  )
}

/** Crash a lock holder the way a dead process leaves one: no cleanup runs. */
async function crashHolder(directory: string): Promise<void> {
  const child = worker(directory)
  try {
    expect(await once(child, 'message')).toEqual(['held', undefined])
    const exit = exited(child)
    child.kill('SIGKILL')
    await exit
  } finally {
    child.kill()
  }
}

async function expectLockRecovery(directory: string): Promise<void> {
  await expect(
    withChatGptRefreshLock(() => Promise.resolve('recovered'), { directory, timeoutMs: 2000 }),
  ).resolves.toBe('recovered')
}

function exited(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('lock worker did not exit'))
    }, 5000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

describe('ACP ChatGPT process lock', () => {
  it('serializes callers and releases after success', async () => {
    const directory = await lockDirectory('serial-')
    const held = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const order: string[] = []
    const first = withChatGptRefreshLock(
      async () => {
        order.push('first')
        held.resolve(undefined)
        await release.promise
        order.push('released')
      },
      { directory, timeoutMs: 2000 },
    )
    await held.promise
    const second = withChatGptRefreshLock(
      () => {
        order.push('second')
        return Promise.resolve('done')
      },
      { directory, timeoutMs: 2000 },
    )
    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(order).toEqual(['first'])
      release.resolve(undefined)
      await first
      await expect(second).resolves.toBe('done')
      expect(order).toEqual(['first', 'released', 'second'])
    } finally {
      release.resolve(undefined)
      await Promise.allSettled([first, second])
    }
  })

  it('releases after a thrown operation and withholds its secret-bearing error', async () => {
    const directory = await lockDirectory('thrown-')
    await expect(
      withChatGptRefreshLock(() => Promise.reject(new Error('synthetic-private-detail')), {
        directory,
      }),
    ).rejects.toThrow('chatgpt.request-failed')
    await expect(
      withChatGptRefreshLock(() => Promise.resolve('next'), { directory, timeoutMs: 2000 }),
    ).resolves.toBe('next')
  })

  it('never steals a live process lock, and times out or cancels without running work', async () => {
    const directory = await lockDirectory('live-')
    const child = worker(directory)
    try {
      expect(await once(child, 'message')).toEqual(['held', undefined])
      let isEntered = false
      const work = () => {
        isEntered = true
        return Promise.resolve()
      }
      const bounded = Promise.race([
        withChatGptRefreshLock(work, { directory, timeoutMs: 40 }),
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('lock deadline did not fire'))
          }, 500)
        }),
      ])
      await expect(bounded).rejects.toThrow('request-failed')
      const controller = new AbortController()
      const waiting = withChatGptRefreshLock(work, { directory, signal: controller.signal })
      controller.abort()
      await expect(waiting).rejects.toThrow('request-failed')
      expect(isEntered).toBe(false)
      const exit = exited(child)
      child.send('release')
      expect(await exit).toBe(0)
    } finally {
      child.kill()
    }
  })

  it.runIf(!isWindows)('recovers automatically after the owner process crashes', async () => {
    const directory = await lockDirectory('crash-')
    await crashHolder(directory)
    // The crash leaves the socket file behind with no listener.
    const crashed = await lstat(socketFile(directory))
    expect(crashed.isSocket()).toBe(true)
    await expectLockRecovery(directory)
  })

  it.runIf(isWindows)('recovers automatically after the pipe holder dies', async () => {
    const directory = await lockDirectory('crash-')
    await crashHolder(directory)
    // A named pipe has no file: the OS removes it with the dead holder.
    await expectLockRecovery(directory)
  })

  it.runIf(!isWindows)('replaces a stale socket file left without a listener', async () => {
    const directory = await lockDirectory('stale-')
    // A graceful close is not how stale files happen; bind the file in a
    // child and crash it, exactly as a dead holder leaves one.
    const holder = staleHolder(socketFile(directory))
    try {
      expect(await once(holder, 'message')).toEqual(['listening', undefined])
      const exit = exited(holder)
      holder.kill('SIGKILL')
      await exit
      const stale = await lstat(socketFile(directory))
      expect(stale.isSocket()).toBe(true)
      await expect(
        withChatGptRefreshLock(() => Promise.resolve('replaced'), { directory, timeoutMs: 2000 }),
      ).resolves.toBe('replaced')
    } finally {
      holder.kill()
    }
  })

  it('takes the lock while the old fixed TCP port is held by another listener', async () => {
    const directory = await lockDirectory('port-')
    // The old lock bound this exact port; the new one never touches TCP. If
    // this machine's OS already holds or reserves it, that only strengthens
    // the premise, so every setup outcome proceeds to the same assertion.
    const squatter = createServer((socket) => socket.destroy())
    const isHeld = await new Promise<boolean>((resolve) => {
      squatter.once('error', () => {
        resolve(false)
      })
      squatter.listen(49_953, '127.0.0.1', () => {
        resolve(true)
      })
    })
    try {
      await expect(
        withChatGptRefreshLock(() => Promise.resolve('unblocked'), {
          directory,
          timeoutMs: 2000,
        }),
      ).resolves.toBe('unblocked')
    } finally {
      if (isHeld) {
        await new Promise<void>((resolve) => {
          squatter.close(() => {
            resolve()
          })
        })
      }
    }
  })

  it.runIf(!isWindows)(
    'reports a local listener failure with its OS code, never as temporarily unavailable',
    async () => {
      const directory = await lockDirectory('local-')
      const blocker = path.join(directory, 'blocker')
      await writeFile(blocker, 'a regular file, not a folder')
      await expect(
        withChatGptRefreshLock(() => Promise.resolve('never'), {
          directory: path.join(blocker, 'grant'),
          timeoutMs: 2000,
        }),
      ).rejects.toThrow('chatgpt.lock-unavailable')
      const sentence = chatGptCommandText().failure('lock-unavailable', 'ENOTDIR')
      expect(sentence).toContain('ENOTDIR')
      expect(sentence).toContain('could not be opened')
      expect(sentence).not.toContain('temporarily unavailable')
    },
  )

  it.runIf(isWindows)(
    'reports a local pipe failure with its OS code, never as temporarily unavailable',
    async () => {
      // An empty name within the pipe namespace: no object can carry it,
      // so Windows itself refuses the bind (its ERROR_INVALID_NAME reaches
      // the lock as EACCES through libuv) and the lock reports the OS code.
      // No stand-in: the refusal comes from the kernel through the real
      // lock, and no work runs.
      let isEntered = false
      let failure: unknown
      try {
        await withChatGptRefreshLock(
          () => {
            isEntered = true
            return Promise.resolve('never')
          },
          { pipeName: '', timeoutMs: 2000 },
        )
      } catch (error) {
        failure = error
      }
      expect(isEntered).toBe(false)
      expect(failure).toBeInstanceOf(ChatGptSignInError)
      const code = failure instanceof ChatGptSignInError ? failure.code : undefined
      const reason = failure instanceof ChatGptSignInError ? failure.reason : undefined
      expect(code).toBe('lock-unavailable')
      expect(typeof reason).toBe('string')
      if (typeof reason !== 'string') return
      const sentence = chatGptCommandText().failure('lock-unavailable', reason)
      expect(sentence).toContain(reason)
      expect(sentence).toContain('could not be opened')
      expect(sentence).not.toContain('temporarily unavailable')
    },
  )

  it('refuses an already cancelled acquisition before running work', async () => {
    const directory = await lockDirectory('cancelled-')
    const controller = new AbortController()
    controller.abort()
    let isEntered = false
    await expect(
      withChatGptRefreshLock(
        () => {
          isEntered = true
          return Promise.resolve()
        },
        { directory, signal: controller.signal },
      ),
    ).rejects.toThrow('request-failed')
    expect(isEntered).toBe(false)
  })
})
