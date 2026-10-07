import { createHash, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimHardwareLease,
  serialLeaseResource,
  didStopHardwareLease,
} from '../../src/core/maker/lease'
import {
  makerLeaseDeps,
  makerProcessDeps,
  makerNativeHelper,
  isTestProcessAlive,
} from './helpers/makerSerial'
import { startSerialProcess } from '../../src/core/maker/serial/process'
import {
  listenNativeOwnerPipe,
  withNativeLeaseMutex,
} from '../../src/core/maker/serial/nativeLease'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof FsPromises>()
  return { ...fs, rm: vi.fn(fs.rm), writeFile: vi.fn(fs.writeFile) }
})

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'm103-lease-'))
  directories.push(directory)
  return await makerLeaseDeps(directory)
}

async function recordFile(
  directory: string,
  resource: string,
  record?: { readonly id: string; readonly generation: string },
) {
  const folder = path.join(directory, `${createHash('sha256').update(resource).digest('hex')}.lock`)
  await mkdir(folder, { mode: 0o700, recursive: true })
  const identity = record ?? { id: randomUUID(), generation: randomUUID() }
  return path.join(folder, `${identity.id}.${identity.generation}.json`)
}

describe('hardware lease', () => {
  it('keeps a newer holder when a stale removal submitted before native lock loss finally runs', async () => {
    const native = await fixture()
    const deps = {
      ...native,
      platform: 'win32' as const,
      listenOwnerPipe: () => Promise.resolve(() => Promise.resolve()),
    }
    const resource = 'port:delayed-removal'
    const original = await claimHardwareLease(deps, resource, 'stale owner', () =>
      Promise.resolve(),
    )
    if (original.status !== 'acquired') throw new Error('test-claim')
    const base = path.join(
      deps.directory,
      `${createHash('sha256').update(resource).digest('hex')}.lock`,
    )
    // Locate via the public claim's output, including the reviewed layout for the red control.
    const sample = await lstat(base)
    const oldFile = sample.isFile()
      ? base
      : await recordFile(deps.directory, resource, original.record)
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const removed = Promise.withResolvers<undefined>()
    const drained = Promise.withResolvers<undefined>()
    let isHeld = false
    vi.mocked(rm).mockImplementation(async (file, options) => {
      if (file === oldFile && !isHeld) {
        isHeld = true
        entered.resolve(undefined)
        await resume.promise
        try {
          await actual.rm(file, options)
        } finally {
          removed.resolve(undefined)
        }
      } else await actual.rm(file, options)
    })
    const lose = path.join(deps.directory, 'lose-delayed-mutex')
    const helper = {
      file: process.execPath,
      prefix: [
        '-e',
        String.raw`
process.stderr.write('lease-ready\n'); process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
setInterval(() => { if (require('node:fs').existsSync(process.argv[1])) process.exit(0); }, 20);`,
        lose,
      ],
      process: makerProcessDeps(),
    }
    const absent = { isProcessAlive: () => false, isEndpointAlive: () => Promise.resolve(false) }
    const stale = claimHardwareLease(
      {
        ...deps,
        exclusive: (file, operation) =>
          withNativeLeaseMutex(helper, file, async (signal) => {
            try {
              return await operation(signal)
            } finally {
              drained.resolve(undefined)
            }
          }),
        ...absent,
      },
      resource,
      'failed stale claimant',
      () => Promise.resolve(),
    )
    const rejected = expect(stale).rejects.toThrow('lease-helper-unavailable')
    try {
      await entered.promise
      await writeFile(lose, '')
      await rejected
      const winner = await claimHardwareLease({ ...deps, ...absent }, resource, 'new holder', () =>
        Promise.resolve(),
      )
      if (winner.status !== 'acquired') throw new Error('test-claim')
      resume.resolve(undefined)
      await removed.promise
      await drained.promise
      const third = await claimHardwareLease(deps, resource, 'third claimant', () =>
        Promise.resolve(),
      )
      expect(third.status).toBe('busy')
      if (third.status === 'busy') expect(third.holder).toEqual(winner.record)
    } finally {
      resume.resolve(undefined)
      vi.mocked(rm).mockImplementation(actual.rm)
      await rejected
    }
  })

  it.each([
    {
      name: 'cleans a committed failed claim before rejecting even while its parent stays alive',
      failsClosing: false,
    },
    {
      name: 'removes a failed claim even when closing its owner endpoint fails',
      failsClosing: true,
    },
  ])('$name', async ({ failsClosing }) => {
    const native = await fixture()
    const closed = vi.fn(() => Promise.resolve())
    if (failsClosing) closed.mockRejectedValueOnce(new Error('test-close-failed'))
    const deps = {
      ...native,
      platform: 'win32' as const,
      listenOwnerPipe: () => Promise.resolve(closed),
    }
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const controller = new AbortController()
    let isFirstSection = true
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      await actual.writeFile(...args)
      controller.abort(new Error('lease-helper-unavailable'))
    })
    await expect(
      claimHardwareLease(
        {
          ...deps,
          exclusive: (file, operation) => {
            if (!isFirstSection) return deps.exclusive(file, operation)
            isFirstSection = false
            return operation(controller.signal)
          },
        },
        'port:failed-write',
        'failed claimant',
        () => Promise.resolve(),
      ),
    ).rejects.toThrow(failsClosing ? 'test-close-failed' : 'lease-helper-unavailable')
    expect(closed).toHaveBeenCalledTimes(1)
    const retry = await claimHardwareLease(deps, 'port:failed-write', 'retry', () =>
      Promise.resolve(),
    )
    expect(retry.status).toBe('acquired')
    if (retry.status === 'acquired') await retry.release()
  })

  it('drains a write already submitted when the native mutex rejects the claim', async () => {
    const native = await fixture()
    const closed = vi.fn(() => Promise.resolve())
    const deps = {
      ...native,
      platform: 'win32' as const,
      listenOwnerPipe: () => Promise.resolve(closed),
    }
    const actual = await vi.importActual<typeof FsPromises>('node:fs/promises')
    const entered = Promise.withResolvers<undefined>()
    const resume = Promise.withResolvers<undefined>()
    const lost = Promise.withResolvers<never>()
    const controller = new AbortController()
    let isFirstSection = true
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      entered.resolve(undefined)
      await resume.promise
      await actual.writeFile(...args)
    })
    let hasSettled = false
    const claim = (async () => {
      try {
        return await claimHardwareLease(
          {
            ...deps,
            exclusive: (file, operation) => {
              if (!isFirstSection) return deps.exclusive(file, operation)
              isFirstSection = false
              return Promise.race([operation(controller.signal), lost.promise])
            },
          },
          'port:pending-write',
          'pending claimant',
          () => Promise.resolve(),
        )
      } finally {
        hasSettled = true
      }
    })()
    const rejected = expect(claim).rejects.toThrow('lease-helper-unavailable')
    try {
      await entered.promise
      const error = new Error('lease-helper-unavailable')
      controller.abort(error)
      lost.reject(error)
      await delay(100)
      expect(closed).not.toHaveBeenCalled()
      expect(hasSettled).toBe(false)
    } finally {
      resume.resolve(undefined)
      await rejected
    }
    expect(closed).toHaveBeenCalledTimes(1)
    const retry = await claimHardwareLease(deps, 'port:pending-write', 'retry', () =>
      Promise.resolve(),
    )
    expect(retry.status).toBe('acquired')
    if (retry.status === 'acquired') await retry.release()
  })

  it('finishes an in-flight Stop acknowledgement before concurrent owner teardown', async () => {
    let deps = await fixture()
    if (process.platform === 'win32') {
      // Pause the real pipe writer so owner EOF deterministically races its flush.
      const helper = await makerNativeHelper(deps.directory, (source) =>
        source.replace(
          'using (var writer = new StreamWriter(pipe))',
          'Thread.Sleep(MutexPollMs); using (var writer = new StreamWriter(pipe))',
        ),
      )
      deps = {
        ...deps,
        exclusive: (file, operation) => withNativeLeaseMutex(helper, file, operation),
        listenOwnerPipe: (endpoint, id, stop) => listenNativeOwnerPipe(helper, endpoint, id, stop),
      }
    }
    const entered = new AbortController()
    const cleanup = Promise.withResolvers<undefined>()
    const claimed = await claimHardwareLease(deps, 'port:closing-stop', 'owner', () => {
      entered.abort()
      return cleanup.promise
    })
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    let releasing: Promise<void> | undefined
    const stopping = didStopHardwareLease(deps, 'port:closing-stop')
    try {
      await vi.waitFor(() => {
        expect(entered.signal.aborted).toBe(true)
      })
      let hasReleased = false
      releasing = (async () => {
        await claimed.release()
        hasReleased = true
      })()
      await delay(100)
      expect(hasReleased).toBe(false)
      cleanup.resolve(undefined)
      expect(await stopping).toBe(true)
      await releasing
    } finally {
      cleanup.resolve(undefined)
      await stopping
      await (releasing ?? claimed.release())
    }
  })

  it('invalidates a lost native mutex before a stale probe can erase a new holder', async () => {
    const deps = await fixture()
    const resource = 'port:lost-mutex'
    const id = randomUUID()
    const old = {
      version: 2,
      id,
      generation: randomUUID(),
      resource,
      holder: 'dead',
      pid: 999_999_999,
      endpoint:
        process.platform === 'win32'
          ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
          : path.join(deps.directory, `${id}.sock`),
    }
    const file = await recordFile(deps.directory, resource, old)
    await writeFile(file, JSON.stringify(old), { mode: 0o600 })
    const lose = path.join(deps.directory, 'lose-mutex')
    const entered = Promise.withResolvers<undefined>()
    const probe = Promise.withResolvers<boolean>()
    const helper = {
      file: process.execPath,
      prefix: [
        '-e',
        String.raw`
process.stderr.write('lease-ready\n');
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
setInterval(() => { if (require('node:fs').existsSync(process.argv[1])) process.exit(0); }, 20);`,
        lose,
      ],
      process: makerProcessDeps(),
    }
    const listen = vi.fn(deps.listenOwnerPipe)
    const stale = claimHardwareLease(
      {
        ...deps,
        exclusive: (file, operation) => withNativeLeaseMutex(helper, file, operation),
        listenOwnerPipe: listen,
        isProcessAlive: () => false,
        isEndpointAlive: () => {
          entered.resolve(undefined)
          return probe.promise
        },
      },
      resource,
      'stale claimant',
      () => Promise.resolve(),
    )
    const rejected = expect(stale).rejects.toThrow('lease-helper-unavailable')
    await entered.promise
    await writeFile(lose, '')
    await rejected
    const winner = await claimHardwareLease(
      { ...deps, isProcessAlive: () => false, isEndpointAlive: () => Promise.resolve(false) },
      resource,
      'new holder',
      () => Promise.resolve(),
    )
    if (winner.status !== 'acquired') throw new Error('test-claim')
    try {
      probe.resolve(false)
      await delay(100)
      expect(
        JSON.parse(
          await readFile(await recordFile(deps.directory, resource, winner.record), 'utf8'),
        ),
      ).toEqual(winner.record)
      expect(listen).not.toHaveBeenCalled()
    } finally {
      probe.resolve(false)
      await winner.release()
    }
  })

  it('accepts Stop from a separate process through the real native owner endpoint', async () => {
    const deps = await fixture()
    const stop = vi.fn(() => Promise.resolve())
    const claimed = await claimHardwareLease(deps, 'port:cross-process', 'owner', stop)
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    try {
      const client = await startSerialProcess(
        {
          file: process.execPath,
          args: [
            '-e',
            String.raw`
const socket = require('node:net').connect(process.argv[1]);
socket.setTimeout(2000, () => process.exit(1));
socket.on('error', () => process.exit(1));
socket.once('connect', () => socket.write(JSON.stringify({ command: 'stop', id: process.argv[2] }) + '\n'));
socket.on('data', bytes => process.stdout.write(bytes));
socket.once('end', () => process.exit(0));`,
            claimed.record.endpoint,
            claimed.record.id,
          ],
          writable: false,
        },
        makerProcessDeps({ durationMs: 5000 }),
      )
      const capture = await client.result
      expect(capture.reason).toBe('ended')
      expect(capture.bytes.toString('utf8').trim()).toBe('{"stopped":true}')
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      await claimed.release()
    }
  })

  it('reaches the active Stop endpoint while a failed generation is awaiting cleanup', async () => {
    const deps = await fixture()
    const resource = 'port:transient-records'
    const stop = vi.fn(() => Promise.resolve())
    const claimed = await claimHardwareLease(deps, resource, 'active owner', stop)
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    const id = randomUUID()
    const pending = {
      ...claimed.record,
      id,
      generation: randomUUID(),
      holder: 'failed pending claimant',
      endpoint:
        process.platform === 'win32'
          ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
          : path.join(deps.directory, `${id}.sock`),
    }
    const file = await recordFile(deps.directory, resource, pending)
    await writeFile(file, JSON.stringify(pending), { mode: 0o600 })
    try {
      expect(await didStopHardwareLease(deps, resource)).toBe(true)
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      await rm(file)
      await claimed.release()
    }
  })

  it('serializes competing claims, reports the holder and releases idempotently', async () => {
    const deps = await fixture()
    const stop = vi.fn().mockResolvedValue(undefined)
    const results = await Promise.all([
      claimHardwareLease(deps, 'port:test', 'conversation-one', stop),
      claimHardwareLease(deps, 'port:test', 'conversation-two', stop),
    ])
    expect(results.filter((result) => result.status === 'acquired')).toHaveLength(1)
    const acquired = results.find((result) => result.status === 'acquired')!
    const busy = results.find((result) => result.status === 'busy')!
    try {
      expect(busy.holder.id).toBe(acquired.record.id)
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      expect(stop).toHaveBeenCalledTimes(1)
    } finally {
      await acquired.release()
    }
    await acquired.release()
    expect(await didStopHardwareLease(deps, 'port:test')).toBe(false)
  })

  it('reclaims only after both process and socket are proven absent', async () => {
    const deps = await fixture()
    const resource = 'machine:printer'
    const id = randomUUID()
    const endpoint =
      process.platform === 'win32'
        ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
        : path.join(deps.directory, `${id}.sock`)
    const old = {
      version: 2,
      id,
      generation: randomUUID(),
      resource,
      holder: 'dead conversation',
      pid: 999_999_999,
      endpoint,
    }
    await writeFile(await recordFile(deps.directory, resource, old), JSON.stringify(old), {
      mode: 0o600,
    })
    expect(
      await claimHardwareLease(
        { ...deps, isProcessAlive: () => true, isEndpointAlive: () => Promise.resolve(false) },
        resource,
        'new',
        () => Promise.resolve(),
      ),
    ).toEqual({ status: 'busy', holder: old })
    expect(
      await claimHardwareLease(
        { ...deps, isProcessAlive: () => false, isEndpointAlive: () => Promise.resolve(true) },
        resource,
        'new',
        () => Promise.resolve(),
      ),
    ).toEqual({ status: 'busy', holder: old })
    const result = await claimHardwareLease(deps, resource, 'new', () => Promise.resolve())
    expect(result.status).toBe('acquired')
    if (result.status === 'acquired') await result.release()
  })

  it('does not redirect Stop or reclaim malformed records', async () => {
    const deps = await fixture()
    const resource = 'port:test'
    const file = await recordFile(deps.directory, resource)
    await writeFile(file, '{', { mode: 0o600 })
    await expect(
      claimHardwareLease(deps, resource, 'test', () => Promise.resolve()),
    ).rejects.toThrow()
    await writeFile(
      file,
      JSON.stringify({
        version: 2,
        id: randomUUID(),
        generation: randomUUID(),
        resource,
        holder: 'other',
        pid: 'invented',
        endpoint: 'invented',
      }),
    )
    await expect(
      claimHardwareLease(deps, resource, 'test', () => Promise.resolve()),
    ).rejects.toMatchObject({
      issues: [{ code: 'invalid_type', path: ['pid'], expected: 'number' }],
    })
    await rm(file)
    const foreign = {
      version: 2,
      id: randomUUID(),
      generation: randomUUID(),
      resource,
      holder: 'other',
      pid: process.pid,
      endpoint: path.join(deps.directory, 'foreign.sock'),
    }
    await writeFile(await recordFile(deps.directory, resource, foreign), JSON.stringify(foreign))
    await expect(didStopHardwareLease(deps, resource)).rejects.toThrow('lease-endpoint-invalid')
  })

  it('refuses a record stored under another holder generation', async () => {
    const deps = await fixture()
    const resource = 'port:wrong-generation'
    const id = randomUUID()
    const record = {
      version: 2,
      id,
      generation: randomUUID(),
      resource,
      holder: 'owner',
      pid: process.pid,
      endpoint:
        process.platform === 'win32'
          ? String.raw`\\.\pipe\MuseSparkSerial-${id}`
          : path.join(deps.directory, `${id}.sock`),
    }
    await writeFile(
      await recordFile(deps.directory, resource, { ...record, generation: randomUUID() }),
      JSON.stringify(record),
      { mode: 0o600 },
    )
    await expect(
      claimHardwareLease(deps, resource, 'claimant', () => Promise.resolve()),
    ).rejects.toThrow('lease-record-identity-invalid')
    await expect(didStopHardwareLease(deps, resource)).rejects.toThrow(
      'lease-record-identity-invalid',
    )
  })

  it('reports Stop failure and holds separate resources independently', async () => {
    const deps = await fixture()
    const first = await claimHardwareLease(deps, 'port:first', 'one', () =>
      Promise.reject(new Error('test-stop')),
    )
    const second = await claimHardwareLease(deps, 'machine:second', 'two', () => Promise.resolve())
    expect(first.status).toBe('acquired')
    expect(second.status).toBe('acquired')
    try {
      expect(await didStopHardwareLease(deps, 'port:first')).toBe(false)
    } finally {
      if (first.status === 'acquired') await first.release()
      if (second.status === 'acquired') await second.release()
    }
  })

  it('rejects a replayed Stop id and oversized input without invoking Stop', async () => {
    const deps = await fixture()
    const stop = vi.fn().mockResolvedValue(undefined)
    const claimed = await claimHardwareLease(deps, 'port:test', 'one', stop)
    if (claimed.status !== 'acquired') throw new Error('test-claim')
    try {
      const request = (text: string) =>
        new Promise<void>((resolve, reject) => {
          const socket = net.connect(claimed.record.endpoint)
          socket.resume()
          socket.on('error', () => socket.destroy())
          socket.once('close', () => {
            resolve()
          })
          socket.once('connect', () => socket.write(text))
          socket.setTimeout(3000, () => {
            socket.destroy()
            reject(new Error('test-stop-timeout'))
          })
        })
      await request(`${JSON.stringify({ command: 'stop', id: randomUUID() })}\n`)
      await request('x'.repeat(8192))
      expect(stop).not.toHaveBeenCalled()
    } finally {
      await claimed.release()
    }
  })

  it('canonicalizes aliases and Windows COM casing', async () => {
    const deps = await fixture()
    const target = path.join(deps.directory, 'tty')
    await writeFile(target, '')
    const alias = path.join(deps.directory, 'by-id')
    if (process.platform !== 'win32') {
      await symlink(target, alias)
      expect(await serialLeaseResource({ port: target }, process.platform)).toBe(
        await serialLeaseResource({ port: alias }, process.platform),
      )
    }
    for (const port of ['COM3', 'com3', String.raw`\\.\COM3`, String.raw`\\?\com3`])
      expect(await serialLeaseResource({ port }, 'win32')).toBe('port:COM3')
  })

  it('requires a private directory and refuses oversized records', async () => {
    const deps = await fixture()
    if (process.platform !== 'win32') {
      await chmod(deps.directory, 0o755)
      await expect(
        claimHardwareLease(deps, 'port:test', 'one', () => Promise.resolve()),
      ).rejects.toThrow('lease-directory-not-private')
      await chmod(deps.directory, 0o700)
    }
    const file = await recordFile(deps.directory, 'port:test')
    await writeFile(file, 'x'.repeat(8192))
    await expect(didStopHardwareLease(deps, 'port:test')).rejects.toThrow('lease-record-invalid')
    const text = await readFile(file)
    expect(text.length).toBe(8192)
  })

  it('rejects oversized native readiness before entering the critical section', async () => {
    const operation = vi.fn(() => Promise.resolve())
    const helper = {
      file: process.execPath,
      prefix: [
        '-e',
        String.raw`process.stderr.write('lease-ready\n'.repeat(1000)); setInterval(() => {}, 100);`,
      ],
      process: makerProcessDeps({ maxStatusBytes: 128 }),
    }
    await expect(withNativeLeaseMutex(helper, 'unused', operation)).rejects.toThrow(
      'lease-helper-status-oversize',
    )
    expect(operation).not.toHaveBeenCalled()
  })

  it('refuses a native pipe on the wrong platform or outside its private namespace', async () => {
    const helper = { file: '/must-not-run', prefix: [], process: makerProcessDeps() }
    const stop = vi.fn(() => Promise.resolve())
    await expect(
      listenNativeOwnerPipe(
        { ...helper, process: { ...helper.process, platform: 'linux' } },
        String.raw`\\.\pipe\MuseSparkSerial-test`,
        randomUUID(),
        stop,
      ),
    ).rejects.toThrow('lease-pipe-invalid')
    await expect(
      listenNativeOwnerPipe(
        { ...helper, process: { ...helper.process, platform: 'win32' } },
        '/foreign/pipe',
        randomUUID(),
        stop,
      ),
    ).rejects.toThrow('lease-pipe-invalid')
    expect(stop).not.toHaveBeenCalled()
  })

  it('ends a native mutex waiter when its parent dies, while the other holder stays alive', async () => {
    const deps = await fixture()
    const helper = await makerNativeHelper(deps.directory)
    const entered = new AbortController()
    const release = new AbortController()
    const waiting = new Promise<void>((resolve) => {
      entered.signal.addEventListener(
        'abort',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    const file = path.join(deps.directory, 'waiter.mutex')
    const holder = withNativeLeaseMutex(
      helper,
      file,
      () =>
        new Promise<void>((resolve) => {
          release.signal.addEventListener(
            'abort',
            () => {
              resolve()
            },
            { once: true },
          )
          entered.abort()
        }),
    )
    await waiting
    try {
      const script = `
const child = require('node:child_process').spawn(process.argv[1], JSON.parse(process.argv[2]), { detached: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
process.stdout.write(String(child.pid));
setTimeout(() => process.exit(0), 100);`
      const parent = await startSerialProcess(
        {
          file: process.execPath,
          args: ['-e', script, helper.file, JSON.stringify([...helper.prefix, 'mutex', file])],
          writable: false,
        },
        makerProcessDeps(),
      )
      const capture = await parent.result
      const pid = Number(capture.bytes.toString('utf8'))
      expect(pid).toBeGreaterThan(0)
      await vi.waitFor(
        async () => {
          expect(await isTestProcessAlive(pid)).toBe(false)
        },
        {
          timeout: 5000,
        },
      )
    } finally {
      release.abort()
      await holder
    }
  })

  it('echoes the native Stop call id so one reply cannot settle another', async () => {
    const script = String.raw`
const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'];
process.stderr.write('pipe-ready\n');
setTimeout(() => process.stdout.write('stop:' + ids[0] + '\r\n'), 20);
let count = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  if (line !== 'stopped:' + ids[count]) process.exit(1);
  count += 1;
  if (count < ids.length) process.stdout.write('stop:' + ids[count] + '\n');
});
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 100);`
    const stop = vi.fn(() => Promise.resolve())
    const close = await listenNativeOwnerPipe(
      {
        file: process.execPath,
        prefix: ['-e', script],
        process: { ...makerProcessDeps(), platform: 'win32' },
      },
      String.raw`\\.\pipe\MuseSparkSerial-test`,
      randomUUID(),
      stop,
    )
    try {
      await vi.waitFor(() => {
        expect(stop).toHaveBeenCalledTimes(2)
      })
    } finally {
      await close()
    }
  })
})
