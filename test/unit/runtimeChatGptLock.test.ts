import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import path from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { withChatGptRefreshLock } from '../../src/runtime/chatGptRefreshLock'

const scratch = { folder: '' }
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

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('missing address')
  await new Promise<void>((resolve) =>
    server.close(() => {
      resolve()
    }),
  )
  return address.port
}

function worker(port: number): ChildProcess {
  return spawn(
    process.execPath,
    [
      path.resolve('test/hosts/runtime-chatgpt-lock-worker.mjs'),
      path.join(scratch.folder, 'lock.cjs'),
      String(port),
    ],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { SystemRoot: process.env['SystemRoot'], PATH: process.env['PATH'] },
    },
  )
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
    const port = await freePort()
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
      { port, timeoutMs: 2000 },
    )
    await held.promise
    const second = withChatGptRefreshLock(
      () => {
        order.push('second')
        return Promise.resolve('done')
      },
      { port, timeoutMs: 2000 },
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
    const port = await freePort()
    await expect(
      withChatGptRefreshLock(() => Promise.reject(new Error('synthetic-private-detail')), { port }),
    ).rejects.toThrow('chatgpt.request-failed')
    await expect(
      withChatGptRefreshLock(() => Promise.resolve('next'), { port, timeoutMs: 2000 }),
    ).resolves.toBe('next')
  })

  it('never steals a live process lock, and times out or cancels without running work', async () => {
    const port = await freePort()
    const child = worker(port)
    try {
      expect(await once(child, 'message')).toEqual(['held', undefined])
      let isEntered = false
      const work = () => {
        isEntered = true
        return Promise.resolve()
      }
      const bounded = Promise.race([
        withChatGptRefreshLock(work, { port, timeoutMs: 40 }),
        new Promise((_resolve, reject) => {
          setTimeout(() => {
            reject(new Error('lock deadline did not fire'))
          }, 500)
        }),
      ])
      await expect(bounded).rejects.toThrow('request-failed')
      const controller = new AbortController()
      const waiting = withChatGptRefreshLock(work, { port, signal: controller.signal })
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

  it('recovers automatically after the owner process crashes', async () => {
    const port = await freePort()
    const child = worker(port)
    try {
      const message = await once(child, 'message')
      expect(message[0]).toBe('held')
      const exit = exited(child)
      child.kill('SIGKILL')
      await exit
      await expect(
        withChatGptRefreshLock(() => Promise.resolve('recovered'), { port, timeoutMs: 2000 }),
      ).resolves.toBe('recovered')
    } finally {
      child.kill()
    }
  })

  it('refuses an already cancelled acquisition before running work', async () => {
    const controller = new AbortController()
    controller.abort()
    let isEntered = false
    await expect(
      withChatGptRefreshLock(
        () => {
          isEntered = true
          return Promise.resolve()
        },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('request-failed')
    expect(isEntered).toBe(false)
  })
})
