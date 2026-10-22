import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  claimHardwareLease as claimLease,
  serialLeaseResource,
  didStopHardwareLease,
  stopAllHardwareLeases,
  stopHardwareLease,
  type HardwareLeaseRecord,
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
const releases: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.allSettled(releases.splice(0).map((release) => release()))
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

async function claimHardwareLease(...args: Parameters<typeof claimLease>) {
  const result = await claimLease(...args)
  if (result.status === 'acquired') releases.push(result.release)
  return result
}

async function fixture() {
  const directory = await mkdtemp(
    path.join(process.platform === 'darwin' ? '/private/tmp' : tmpdir(), 'm103-lease-'),
  )
  directories.push(directory)
  return await makerLeaseDeps(directory)
}

function generationFile(directory: string, record: HardwareLeaseRecord) {
  return path.join(
    directory,
    `claim-v1.${createHash('sha256').update(record.resource).digest('hex')}.${record.id}.${record.generation}.json`,
  )
}

async function claim(
  deps: Awaited<ReturnType<typeof fixture>>,
  resource = 'port:test',
  stop = () => Promise.resolve(),
) {
  const result = await claimHardwareLease(deps, resource, 'owner', stop)
  if (result.status !== 'acquired') throw new Error('test-claim')
  return result
}

describe('hardware lease', () => {
  it('handles concurrent stale cleaners and repeated release without reusing a claim slot', async () => {
    const deps = await fixture()
    const previous = await claim(deps)
    const staleDeps = { ...deps, processStartTime: () => Promise.resolve('different-start') }
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        claimHardwareLease(staleDeps, 'port:test', 'cleaner', () => Promise.resolve()),
      ),
    )
    const winners = results.filter((result) => result.status === 'acquired')
    expect(winners).toHaveLength(1)
    await previous.release()
    await previous.release()
    await Promise.all(winners.map((winner) => winner.release()))
    const retry = await claim(deps)
    const entries = await readdir(deps.directory)
    const slots = entries.filter((name) => name.endsWith('.claim'))
    expect(slots).toHaveLength(3)
    await retry.release()
  })

  it('distinguishes PID reuse and holds a lease when its start identity cannot be queried', async () => {
    const deps = await fixture()
    const previous = await claim(deps)
    const replacement = await claim({
      ...deps,
      processStartTime: () => Promise.resolve('replacement'),
    })
    await previous.release()
    let queries = 0
    const unknown = {
      ...deps,
      processStartTime: () => {
        queries += 1
        return queries === 1
          ? Promise.resolve('replacement')
          : Promise.reject(new Error('test-query-denied'))
      },
    }
    try {
      expect(
        await claimHardwareLease(unknown, 'port:test', 'third', () => Promise.resolve()),
      ).toEqual({ status: 'busy', holder: replacement.record })
    } finally {
      await replacement.release()
    }
  })

  it('treats corrupt claim records as held by unknown and still stops the active session', async () => {
    const deps = await fixture()
    let stops = 0
    const stop = () => {
      stops += 1
      return Promise.resolve()
    }
    const active = await claimHardwareLease(deps, 'port:test', 'active', stop)
    if (active.status !== 'acquired') throw new Error('test-claim')
    const slot = path.join(
      deps.directory,
      `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.head.claim`,
    )
    const bytes = await readFile(slot)
    try {
      await writeFile(slot, '{')
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        { status: 'busy' },
      )
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      expect(stops).toBe(1)
    } finally {
      await writeFile(slot, bytes)
      await active.release()
    }
  })

  it('refuses release of another generation and accepts an already removed record', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const file = generationFile(deps.directory, active.record)
    await writeFile(file, JSON.stringify({ ...active.record, generation: randomUUID() }))
    await expect(active.release()).rejects.toThrow('lease-holder-changed')
    await unlink(file)
    await active.release()
    await active.release()
  })

  it('holds an unknown generation mismatch without treating its missing marker as release', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const file = generationFile(deps.directory, active.record)
    const saved = await readFile(file)
    try {
      await writeFile(file, JSON.stringify({ ...active.record, generation: randomUUID() }))
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        {
          status: 'busy',
        },
      )
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
    } finally {
      await writeFile(file, saved)
      await active.release()
    }
  })

  it('holds an unknown retirement receipt instead of skipping its active holder', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const receipt = generationFile(deps.directory, active.record).replace(
      'claim-v1.',
      'retired-v1.',
    )
    await writeFile(receipt, JSON.stringify({ ...active.record, id: randomUUID() }))
    try {
      expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual(
        {
          status: 'busy',
        },
      )
      await expect(active.release()).rejects.toThrow('lease-retirement-changed')
      await expect(lstat(generationFile(deps.directory, active.record))).rejects.toHaveProperty(
        'code',
        'ENOENT',
      )
      await expect(
        lstat(generationFile(deps.directory, active.record).replace('claim-v1.', 'stop-v1.')),
      ).rejects.toHaveProperty('code', 'ENOENT')
    } finally {
      await unlink(receipt)
      await active.release()
    }
  })

  it('never follows malformed, oversized, foreign or generation-mismatched Stop index entries', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    const folder = deps.directory
    const prefix = `stop-v1.${createHash('sha256').update('port:test').digest('hex')}.`
    await writeFile(
      path.join(folder, `${prefix}foreign.json`),
      JSON.stringify({ ...active.record, endpoint: 'foreign' }),
    )
    await writeFile(path.join(folder, `${prefix}mismatched.json`), JSON.stringify(active.record))
    try {
      // Copies of the owner Stop reached are not other owners.
      expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      // FIXM103W11: an unreadable entry may be an owner Stop cannot reach, so Stop is unconfirmed.
      await writeFile(path.join(folder, `${prefix}corrupt.json`), '{')
      await writeFile(path.join(folder, `${prefix}large.json`), 'x'.repeat(8192))
      const unreadable = {
        party: 'unknown',
        status: 'failed',
        reason: 'lease-stop-unrecognized',
        record: null,
      }
      expect(await stopHardwareLease(deps, 'port:test')).toEqual({
        stopped: false,
        sessions: [
          { record: active.record, party: 'holder', status: 'stopped' },
          unreadable,
          unreadable,
        ],
      })
      await expect(stopAllHardwareLeases(deps)).rejects.toThrow('lease-stop-failed')
    } finally {
      await active.release()
    }
  })

  it('RVM103W5 P1 an unreadable Stop index entry alone leaves stop-all unconfirmed', async () => {
    const deps = await fixture()
    const key = createHash('sha256').update('port:unreadable').digest('hex')
    // No other record names this resource, so only the entry itself can report it.
    await writeFile(path.join(deps.directory, `stop-v1.${key}.corrupt.json`), '{')
    await expect(stopAllHardwareLeases(deps)).rejects.toThrow('lease-stop-failed')
  })

  it.each(['live', 'unknown'])(
    'RVM103W6 P1: still contacts recognised owners alongside a renamed %s owner',
    async (identity) => {
      const deps = await fixture()
      let missedStops = 0
      let reachedStops = 0
      const missed = () => {
        missedStops += 1
        return Promise.resolve()
      }
      const reached = () => {
        reachedStops += 1
        return Promise.resolve()
      }
      const active = await claimHardwareLease(deps, 'port:actual', 'owner', missed)
      if (active.status !== 'acquired') throw new Error('test-claim')
      await claimHardwareLease(deps, 'port:recognised', 'other owner', reached)
      await rename(
        generationFile(deps.directory, active.record).replace('claim-v1.', 'stop-v1.'),
        generationFile(deps.directory, { ...active.record, resource: 'port:other' }).replace(
          'claim-v1.',
          'stop-v1.',
        ),
      )
      const scan =
        identity === 'unknown'
          ? {
              ...deps,
              processStartTime: () => Promise.reject(new Error('test-identity-unavailable')),
            }
          : deps
      await expect(stopAllHardwareLeases(scan)).rejects.toThrow('lease-stop-failed')
      expect(missedStops).toBe(0)
      expect(reachedStops).toBe(1)
    },
  )

  it.each(['duplicate', 'gone'])(
    'RVM103W6 P1: a renamed %s index does not raise a false Stop alarm',
    async (kind) => {
      const deps = await fixture()
      let stops = 0
      const stop = () => {
        stops += 1
        return Promise.resolve()
      }
      const active = await claim(deps, 'port:actual', stop)
      const file = generationFile(deps.directory, active.record).replace('claim-v1.', 'stop-v1.')
      const renamed = generationFile(deps.directory, {
        ...active.record,
        resource: 'port:other',
      }).replace('claim-v1.', 'stop-v1.')
      if (kind === 'duplicate') await link(file, renamed)
      else await rename(file, renamed)
      const scan =
        kind === 'gone' ? { ...deps, processStartTime: () => Promise.resolve(undefined) } : deps
      await expect(stopAllHardwareLeases(scan)).resolves.toBeUndefined()
      expect(stops).toBe(kind === 'duplicate' ? 1 : 0)
      expect(await readFile(renamed, 'utf8')).toBe(JSON.stringify(active.record))
    },
  )

  it('refuses unsafe directory ownership, modes and symlink ancestors', async () => {
    const deps = await fixture()
    await expect(
      claim({ ...deps, platform: 'win32', isOwnerDirectory: () => Promise.resolve(false) }),
    ).rejects.toThrow('lease-directory-not-private')
    const { isOwnerDirectory: _ownerDirectory, ...withoutOwnerCheck } = deps
    await expect(claim({ ...withoutOwnerCheck, platform: 'win32' })).rejects.toThrow(
      'lease-directory-not-private',
    )
    const target = path.join(deps.directory, 'target')
    const alias = path.join(deps.directory, 'alias')
    await mkdir(target)
    await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(claim({ ...deps, directory: path.join(alias, 'leases') })).rejects.toThrow(
      'lease-directory-invalid',
    )
    await expect(lstat(path.join(target, 'leases'))).rejects.toMatchObject({ code: 'ENOENT' })
    if (process.platform === 'win32') {
      return
    }

    await chmod(deps.directory, 0o755)
    await expect(claim(deps)).rejects.toThrow('lease-directory-not-private')
    await chmod(deps.directory, 0o700)
  })

  it.each(['corrupt', 'oversized', 'foreign-resource', 'foreign-endpoint', 'symlink'])(
    'holds an unknown %s claim without gating Stop',
    async (kind) => {
      const deps = await fixture()
      const active = await claim(deps)
      const slot = path.join(
        deps.directory,
        `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.head.claim`,
      )
      const saved = await readFile(slot)
      const moved = `${slot}.moved`
      switch (kind) {
        case 'corrupt': {
          await writeFile(slot, '{')
          break
        }
        case 'oversized': {
          await writeFile(
            slot,
            JSON.stringify({ ...active.record, padding: 'x'.repeat(deps.maxRecordBytes + 1) }),
          )
          break
        }
        case 'foreign-resource': {
          const foreign = await claim(deps, 'port:foreign')
          await writeFile(slot, JSON.stringify(foreign.record))
          break
        }
        case 'foreign-endpoint': {
          await writeFile(slot, JSON.stringify({ ...active.record, endpoint: 'foreign' }))
          break
        }
        case 'symlink': {
          await rename(slot, moved)
          await symlink(moved, slot, 'file')
          break
        }
      }
      try {
        expect(
          await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve()),
        ).toEqual({ status: 'busy' })
        expect(await didStopHardwareLease(deps, 'port:test')).toBe(true)
      } finally {
        if (kind === 'symlink') {
          await unlink(slot)
          await rename(moved, slot)
        } else await writeFile(slot, saved)
        await active.release()
      }
    },
  )

  it('Stop reports no session for an absent lease folder without creating it', async () => {
    const deps = await fixture()
    const missing = { ...deps, directory: path.join(deps.directory, 'maker', 'leases') }
    const preparedFiles = await readdir(deps.directory)
    await expect(stopAllHardwareLeases(missing)).resolves.toBeUndefined()
    expect(await stopHardwareLease(missing, 'port:test')).toEqual({ stopped: false, sessions: [] })
    expect(await readdir(deps.directory)).toEqual(preparedFiles)
  })
  it('refuses oversized preparation and a missing holder identity before starting an endpoint', async () => {
    const deps = await fixture()
    let listens = 0
    const listen: typeof deps.listenOwnerPipe = (...args) => {
      listens += 1
      return deps.listenOwnerPipe(...args)
    }
    await expect(claim({ ...deps, maxRecordBytes: 1, listenOwnerPipe: listen })).rejects.toThrow(
      'lease-record-oversize',
    )
    await expect(
      claim({
        ...deps,
        processStartTime: () => Promise.resolve(undefined),
        listenOwnerPipe: listen,
      }),
    ).rejects.toThrow('lease-holder-identity-unavailable')
    expect(listens).toBe(0)
  })

  it('holds an unknown process-start query and rejects claim-chain cycles', async () => {
    const deps = await fixture()
    const active = await claim(deps)
    let queries = 0
    const unknown = {
      ...deps,
      processStartTime: () => {
        queries += 1
        return Promise.resolve(queries === 1 ? active.record.startedAt : '')
      },
    }
    expect(
      await claimHardwareLease(unknown, 'port:test', 'third', () => Promise.resolve()),
    ).toEqual({ status: 'busy', holder: active.record })
    await active.release()
    const prefix = `claim-v1.${createHash('sha256').update('port:test').digest('hex')}.`
    await link(
      path.join(deps.directory, `${prefix}head.claim`),
      path.join(deps.directory, `${prefix}${active.record.generation}.claim`),
    )
    expect(await claimHardwareLease(deps, 'port:test', 'third', () => Promise.resolve())).toEqual({
      status: 'busy',
    })
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

  it('accepts Stop from a separate process through the real native owner endpoint', async () => {
    const deps = await fixture()
    let stops = 0
    const stop = () => {
      stops += 1
      return Promise.resolve()
    }
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
      expect(stops).toBe(1)
    } finally {
      await claimed.release()
    }
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
      expect(await stopHardwareLease(deps, 'port:first')).toMatchObject({
        stopped: false,
        sessions: [{ party: 'holder', status: 'failed', reason: 'lease-stop-failed' }],
      })
    } finally {
      if (first.status === 'acquired') await first.release()
      if (second.status === 'acquired') await second.release()
    }
  })

  it('rejects a replayed Stop id and oversized input without invoking Stop', async () => {
    const deps = await fixture()
    let stops = 0
    const stop = () => {
      stops += 1
      return Promise.resolve()
    }
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
      expect(stops).toBe(0)
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

  it('rejects oversized native readiness before entering the critical section', async () => {
    let operations = 0
    const operation = () => {
      operations += 1
      return Promise.resolve()
    }
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
    expect(operations).toBe(0)
  })

  it('refuses a native pipe on the wrong platform or outside its private namespace', async () => {
    const helper = { file: '/must-not-run', prefix: [], process: makerProcessDeps() }
    let stops = 0
    const stop = () => {
      stops += 1
      return Promise.resolve()
    }
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
    expect(stops).toBe(0)
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
    let stops = 0
    const stop = () => {
      stops += 1
      return Promise.resolve()
    }
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
        expect(stops).toBe(2)
      })
    } finally {
      await close()
    }
  })
})

// Start identity on every platform: makerLeaseIdentity.test.ts (FIXM103W10).
describe('hardware lease stop-all', () => {
  it('stops nothing and throws nothing over an empty lease directory', async () => {
    const deps = await fixture()
    await expect(stopAllHardwareLeases(deps)).resolves.toBeUndefined()
  })
})
