import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

function recordFile(directory: string, resource: string) {
  return path.join(directory, `${createHash('sha256').update(resource).digest('hex')}.lock`)
}

describe('hardware lease', () => {
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
    expect(busy.holder.id).toBe(acquired.record.id)
    expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
    expect(stop).toHaveBeenCalledTimes(1)
    await acquired.release()
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
      version: 1,
      id,
      resource,
      holder: 'dead conversation',
      pid: 999_999_999,
      endpoint,
    }
    await writeFile(recordFile(deps.directory, resource), JSON.stringify(old), { mode: 0o600 })
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
    const file = recordFile(deps.directory, resource)
    await writeFile(file, '{', { mode: 0o600 })
    await expect(
      claimHardwareLease(deps, resource, 'test', () => Promise.resolve()),
    ).rejects.toThrow()
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        id: randomUUID(),
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
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        id: randomUUID(),
        resource,
        holder: 'other',
        pid: process.pid,
        endpoint: path.join(deps.directory, 'foreign.sock'),
      }),
    )
    await expect(didStopHardwareLease(deps, resource)).rejects.toThrow('lease-endpoint-invalid')
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
    expect(await serialLeaseResource({ port: 'com7' }, 'win32')).toBe('port:COM7')
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
    await writeFile(recordFile(deps.directory, 'port:test'), 'x'.repeat(8192))
    await expect(didStopHardwareLease(deps, 'port:test')).rejects.toThrow('lease-record-invalid')
    const text = await readFile(recordFile(deps.directory, 'port:test'))
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
setTimeout(() => process.stdout.write('stop:' + ids[0] + '\n'), 20);
let count = 0;
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  if (line !== 'stopped:' + ids[count]) process.exit(1);
  count += 1;
  if (count < ids.length) process.stdout.write('stop:' + ids[count] + '\n');
});
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
