import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { open, access, mkdtemp, readFile, writeFile, rm, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  serialAdapterCommand,
  serialSttyCommand,
  selectSerialAdapter,
  type SerialAdapter,
} from '../../src/core/maker/serial/adapters'
import { SerialLineFramer, serialPayload } from '../../src/core/maker/serial/framing'
import { startSerialProcess, type SerialCommand } from '../../src/core/maker/serial/process'
import { killTree } from '../../src/host/processTree'
import { fakeSerialScript, makerProcessDeps, isTestProcessAlive } from './helpers/makerSerial'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

function fake(mode = 'echo', isWritable = true): SerialCommand {
  return {
    file: process.execPath,
    args: ['-e', fakeSerialScript, mode],
    readyWord: 'serial-ready',
    writable: isWritable,
  }
}

function isProcessGone(pid: number | undefined) {
  if (pid === undefined) return true
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

async function readPty(peer: FileHandle, length: number): Promise<Buffer> {
  const bytes = Buffer.alloc(length)
  let offset = 0
  await vi.waitFor(
    async () => {
      try {
        const read = await peer.read(bytes, offset, length - offset)
        offset += read.bytesRead
      } catch (error: unknown) {
        if (!(error instanceof Error && 'code' in error && error.code === 'EAGAIN')) throw error
      }
      expect(offset).toBe(length)
    },
    { timeout: 2000 },
  )
  return bytes
}

describe('bounded serial helper', () => {
  it('runs the final approval guard after preparation and refuses before spawning any child', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm103-start-binding-'))
    directories.push(directory)
    const marker = path.join(directory, 'child-started')
    const command: SerialCommand = {
      file: process.execPath,
      args: ['-e', 'require("node:fs").writeFileSync(process.argv[1], "started")', marker],
      writable: false,
    }
    let didPrepare = false
    let guardCalls = 0
    const guard = () => {
      guardCalls += 1
      throw new Error('test-approval-refused')
    }
    await expect(
      startSerialProcess(command, makerProcessDeps(), undefined, async () => {
        await delay(1)
        didPrepare = true
        return guard
      }),
    ).rejects.toThrow('test-approval-refused')
    expect(didPrepare).toBe(true)
    expect(guardCalls).toBe(1)
    await expect(access(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('waits for opener closure even when forced termination fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm103-kill-failure-'))
    directories.push(directory)
    const marker = path.join(directory, 'pid')
    const exitMarker = path.join(directory, 'may-exit')
    const abort = new AbortController()
    let killCalls = 0
    const kill: ReturnType<typeof makerProcessDeps>['kill'] = () => {
      killCalls += 1
      return Promise.reject(new Error('test-termination-failed'))
    }
    const opening = startSerialProcess(
      {
        file: process.execPath,
        args: [
          '-e',
          `
require('node:fs').writeFileSync(process.argv[1], String(process.pid));
process.stdin.resume();
process.stdin.on('end', () => setInterval(() => {
  if (require('node:fs').existsSync(process.argv[2])) process.exit(0);
}, 20));
setInterval(() => {}, 100);`,
          marker,
          exitMarker,
        ],
        readyWord: 'serial-ready',
        writable: true,
      },
      makerProcessDeps({ durationMs: 30_000, kill }),
      abort.signal,
    )
    let settledCalls = 0
    const observed = (async () => {
      try {
        await opening
      } finally {
        settledCalls += 1
      }
    })()
    const stopped = expect(observed).rejects.toThrow('test-termination-failed')
    let pid = 0
    try {
      await vi.waitFor(async () => {
        pid = Number(await readFile(marker, 'utf8'))
        expect(pid).toBeGreaterThan(0)
      })
      abort.abort()
      await vi.waitFor(() => {
        expect(killCalls).toBe(1)
      })
      expect(settledCalls).toBe(0)
      expect(await isTestProcessAlive(pid)).toBe(true)
    } finally {
      abort.abort()
      await writeFile(exitMarker, '')
      await stopped
      await vi.waitFor(async () => {
        expect(await isTestProcessAlive(pid)).toBe(false)
      })
    }
  })

  it('cancels a real helper before readiness and waits until its process closes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'm103-opening-'))
    directories.push(directory)
    const marker = path.join(directory, 'pid')
    const abort = new AbortController()
    const command = {
      file: process.execPath,
      args: [
        '-e',
        `
require('node:fs').writeFileSync(process.argv[1], String(process.pid));
process.stdin.resume();
process.stdin.on('end', () => setTimeout(() => process.exit(0), 100));
setInterval(() => {}, 100);`,
        marker,
      ],
      readyWord: 'serial-ready',
      writable: true,
    } as const
    const opening = startSerialProcess(
      command,
      makerProcessDeps({ durationMs: 30_000 }),
      abort.signal,
    )
    const stopped = expect(opening).rejects.toThrow('serial-open-stopped')
    let pid = 0
    try {
      await vi.waitFor(async () => {
        pid = Number(await readFile(marker, 'utf8'))
        expect(pid).toBeGreaterThan(0)
      })
    } finally {
      abort.abort()
      await stopped
    }
    expect(await isTestProcessAlive(pid)).toBe(false)
    await expect(startSerialProcess(command, makerProcessDeps(), abort.signal)).rejects.toThrow(
      'serial-open-stopped',
    )
    expect(await readFile(marker, 'utf8')).toBe(String(pid))
  })

  it('preserves binary bytes and kills the child at the read deadline', async () => {
    const session = await startSerialProcess(fake(), makerProcessDeps({ durationMs: 300 }))
    const bytes = Buffer.from([0, 10, 255, 128, 27, 65])
    await session.write(bytes)
    const capture = await session.result
    expect(capture.bytes).toEqual(bytes)
    expect(capture.reason).toBe('duration')
    expect(isProcessGone(session.pid)).toBe(true)
    await session.close()
  })

  it('bounds output and cumulative writes and rejects monitor writes', async () => {
    const full = await startSerialProcess(fake('overflow'), makerProcessDeps({ maxBytes: 128 }))
    const capture = await full.result
    expect(capture.bytes.length).toBe(128)
    expect(capture.reason).toBe('limit')
    expect(isProcessGone(full.pid)).toBe(true)
    const writes = await startSerialProcess(
      fake(),
      makerProcessDeps({ maxBytes: 2, durationMs: 5000 }),
    )
    try {
      await writes.write(Buffer.from([1]))
      await expect(writes.write(Buffer.from([2, 3]))).rejects.toThrow('serial-write-oversize')
    } finally {
      await writes.close()
    }
    const monitor = await startSerialProcess(fake('echo', false), makerProcessDeps())
    try {
      await expect(monitor.write(Buffer.from([1]))).rejects.toThrow('serial-monitor-read-only')
    } finally {
      await monitor.close()
    }
  })

  it('rejects missing, invalid and oversized ready frames and failed spawns', async () => {
    for (const [mode, error] of [
      ['stall', 'serial-helper-ready-timeout'],
      ['unknown', 'serial-helper-unavailable'],
      ['unavailable', 'serial-helper-unavailable'],
      ['stderr-overflow', 'serial-helper-status-oversize'],
    ]) {
      await expect(
        startSerialProcess(
          fake(mode),
          makerProcessDeps({ readyTimeoutMs: 200, durationMs: 1000, maxStatusBytes: 128 }),
        ),
      ).rejects.toThrow(error)
    }
    await expect(
      startSerialProcess(
        { ...fake(), file: path.join(tmpdir(), 'muse-serial-not-installed') },
        makerProcessDeps(),
      ),
    ).rejects.toThrow('serial-helper-start-failed')
    await expect(startSerialProcess(fake(), makerProcessDeps({ maxBytes: 0 }))).rejects.toThrow(
      'serial-process-limits-invalid',
    )
  })

  it('Stop is immediate and idempotent, with no approval dependency', async () => {
    const session = await startSerialProcess(fake(), makerProcessDeps({ durationMs: 30_000 }))
    const before = Date.now()
    await session.close()
    expect(Date.now() - before).toBeLessThan(2000)
    const capture = await session.result
    expect(capture.reason).toBe('stopped')
    expect(isProcessGone(session.pid)).toBe(true)
    await session.close()
    await expect(session.write(Buffer.from([1]))).rejects.toThrow('serial-process-closed')
  })

  it('sweeps a monitor child that inherits pipes after the parent exits', async () => {
    const before = Date.now()
    const monitor = await startSerialProcess(fake('orphan'), makerProcessDeps({ durationMs: 5000 }))
    const capture = await monitor.result
    expect(Date.now() - before).toBeLessThan(process.platform === 'win32' ? 10_000 : 2000)
    const orphan = Number(capture.bytes.toString('utf8').trim())
    expect(orphan).toBeGreaterThan(0)
    expect(capture.reason).toBe('ended')
    expect(await isTestProcessAlive(orphan)).toBe(false)
    expect(isProcessGone(monitor.pid)).toBe(true)
  })

  it('keeps stdin open for a platform monitor and ends a monitor that exits normally', async () => {
    const command = {
      file: process.execPath,
      args: ['-e', fakeSerialScript, 'echo'],
      writable: false,
    }
    const monitor = await startSerialProcess(command, makerProcessDeps({ durationMs: 200 }))
    const capture = await monitor.result
    expect(capture.reason).toBe('duration')
    const ended = await startSerialProcess(
      { ...command, args: ['-e', 'process.exit(0)'] },
      makerProcessDeps(),
    )
    const completed = await ended.result
    expect(completed.reason).toBe('ended')
  })
})

describe('serial framing and adapters', () => {
  it('shows exact binary hex and preserves split UTF-8 and CRLF frames', () => {
    expect(serialPayload(Buffer.from([0, 255, 65]))).toEqual({ encoding: 'hex', value: '00ff41' })
    expect(serialPayload(Buffer.from('hello\r\n'))).toEqual({
      encoding: 'text',
      value: 'hello\r\n',
    })
    const framing = new SerialLineFramer(20)
    const bytes = Buffer.from('café\r\nlast')
    expect(framing.push(bytes.subarray(0, 4))).toEqual([])
    expect(framing.push(bytes.subarray(4))).toEqual([Buffer.from('café\r\n')])
    expect(framing.finish()).toEqual(Buffer.from('last'))
    expect(framing.finish()).toEqual(Buffer.alloc(0))
    expect(() => new SerialLineFramer(0)).toThrow('serial-frame-limit-invalid')
    expect(() => new SerialLineFramer(2).push(Buffer.from('abc\n'))).toThrow(
      'serial-frame-oversize',
    )
    expect(() => new SerialLineFramer(2).push(Buffer.from('abc'))).toThrow('serial-frame-oversize')
  })

  it('selects user monitors first for reads and transparent helpers for writes', () => {
    const choices: SerialAdapter[] = [
      { kind: 'pio', file: '/user/pio' },
      { kind: 'arduino-cli', file: '/user/arduino-cli' },
      { kind: 'pyserial', file: '/user/python', script: '/shipped/serial.py' },
    ]
    expect(selectSerialAdapter(choices, false).kind).toBe('pio')
    expect(selectSerialAdapter(choices, true).kind).toBe('pyserial')
    expect(() => selectSerialAdapter(choices.slice(0, 2), true)).toThrow(
      'serial-adapter-unavailable',
    )
    const settings = {
      baud: 115_200,
      durationMs: 1000,
      maxBytes: 4096,
      chunkBytes: 256,
      pollMs: 50,
      dtr: false,
      rts: false,
    }
    for (const adapter of choices) {
      if (adapter.kind === 'arduino-cli') continue
      const command = serialAdapterCommand(adapter, '/dev/ttyACM0', settings)
      expect(command.args).toContain('/dev/ttyACM0')
      expect(command.writable).toBe(adapter.kind === 'pyserial')
    }
    const raw: SerialAdapter = {
      kind: 'posix-raw',
      file: '/usr/bin/python3',
      script: '/shipped/serial.py',
    }
    for (const platform of ['linux', 'darwin'] as const)
      expect(() => serialSttyCommand(raw, platform, '/dev/ttyACM0', settings)).toThrow(
        'serial-line-settings-unsupported',
      )
    expect(() => serialSttyCommand(raw, 'win32', 'COM1', settings)).toThrow(
      'serial-stty-platform-invalid',
    )
    expect(serialSttyCommand(choices[0]!, 'linux', 'port', settings)).toBeUndefined()
    const shell: SerialAdapter = { kind: 'stty', file: '/bin/stty', shell: '/bin/sh' }
    expect(() => serialAdapterCommand(shell, '/dev/tty-test; touch /tmp/no', settings)).toThrow(
      'serial-line-settings-unsupported',
    )
    expect(
      serialAdapterCommand({ kind: 'windows', file: 'helper.exe' }, 'COM1', settings).args[0],
    ).toBe('serial')
  })

  it('honours both approved line states or refuses an incapable adapter before opening', () => {
    const capable: SerialAdapter[] = [
      { kind: 'pio', file: '/pio' },
      { kind: 'windows', file: '/helper' },
      { kind: 'pyserial', file: '/python', script: '/serial.py' },
    ]
    const incapable: SerialAdapter[] = [
      { kind: 'arduino-cli', file: '/arduino-cli' },
      { kind: 'posix-raw', file: '/python', script: '/serial.py' },
      { kind: 'stty', file: '/stty', shell: '/sh' },
    ]
    for (const isDtrEnabled of [false, true])
      for (const isRtsEnabled of [false, true]) {
        const settings = {
          baud: 115_200,
          durationMs: 1000,
          maxBytes: 128,
          chunkBytes: 32,
          pollMs: 20,
          dtr: isDtrEnabled,
          rts: isRtsEnabled,
        }
        for (const adapter of capable) {
          const command = serialAdapterCommand(adapter, 'COM3', settings)
          if (adapter.kind === 'pio') {
            expect(command.args.slice(-4)).toEqual([
              '--dtr',
              isDtrEnabled ? '1' : '0',
              '--rts',
              isRtsEnabled ? '1' : '0',
            ])
          } else
            expect(command.args.slice(-2)).toEqual([
              isDtrEnabled ? '1' : '0',
              isRtsEnabled ? '1' : '0',
            ])
        }
        for (const adapter of incapable)
          expect(() => serialAdapterCommand(adapter, 'COM3', settings)).toThrow(
            'serial-line-settings-unsupported',
          )
      }
    expect(selectSerialAdapter([incapable[0]!, capable[1]!], false)).toBe(capable[1])
    expect(() => selectSerialAdapter(incapable, false)).toThrow('serial-adapter-unavailable')
  })
})

if (process.platform !== 'win32') {
  describe('socat data path on the rig', () => {
    it.each(['posix-raw', 'stty'] as const)(
      'refuses approved line settings on %s and independently verifies its low-level binary IO',
      async (kind) => {
        const directory = await mkdtemp(path.join(tmpdir(), 'm103-pty-'))
        directories.push(directory)
        const left = path.join(directory, 'left')
        const right = path.join(directory, 'right')
        const relay = spawn(
          process.platform === 'darwin' ? '/opt/homebrew/bin/socat' : '/usr/bin/socat',
          [`PTY,link=${left},raw,echo=0`, `PTY,link=${right},raw,echo=0`],
          { detached: true, stdio: 'ignore', env: makerProcessDeps().env },
        )
        const relayEnded = new Promise<void>((resolve) =>
          relay.once('close', () => {
            resolve()
          }),
        )
        const tree = { platform: process.platform, systemRoot: undefined, log: () => undefined }
        try {
          for (let count = 0; count < 100; count += 1) {
            try {
              await access(left)
              await access(right)
              break
            } catch {
              await delay(20)
            }
          }
          const peer = await open(right, constants.O_RDWR | constants.O_NONBLOCK)
          try {
            const settings = {
              baud: 115_200,
              durationMs: 1000,
              maxBytes: 128,
              chunkBytes: 32,
              pollMs: 20,
              dtr: false,
              rts: false,
            }
            const adapter: SerialAdapter =
              kind === 'stty'
                ? { kind: 'stty', file: '/bin/stty', shell: '/bin/sh' }
                : {
                    kind: 'posix-raw',
                    file: '/usr/bin/python3',
                    script: path.resolve('native/posix/serial.py'),
                  }
            expect(() => serialAdapterCommand(adapter, left, settings)).toThrow(
              'serial-line-settings-unsupported',
            )
            // PTYs do not implement DTR/RTS. These test-only commands exercise
            // low-level IO/cleanup; they cannot be selected for an approved action.
            const setup = {
              file: '/bin/stty',
              args: [
                process.platform === 'darwin' ? '-f' : '-F',
                left,
                String(settings.baud),
                'raw',
                '-echo',
                '-hupcl',
                'cs8',
                '-parenb',
                '-cstopb',
              ],
              writable: false,
            }
            const stty = await startSerialProcess(setup, makerProcessDeps())
            const setupResult = await stty.result
            expect(setupResult.reason).toBe('ended')
            const session = await startSerialProcess(
              {
                file: kind === 'stty' ? '/bin/sh' : '/usr/bin/python3',
                args:
                  kind === 'stty'
                    ? [
                        '-c',
                        String.raw`exec 3<> "$1" || exit 1; printf "serial-ready\n" >&2; cat <&3 & serial_reader=$!; cat >&3; kill "$serial_reader"; wait "$serial_reader" 2>/dev/null`,
                        'muse-serial',
                        left,
                      ]
                    : [
                        '-I',
                        path.resolve('native/posix/serial.py'),
                        'raw',
                        left,
                        String(settings.baud),
                        String(settings.durationMs),
                        String(settings.maxBytes),
                        String(settings.chunkBytes),
                        String(settings.pollMs),
                        '0',
                        '0',
                      ],
                readyWord: 'serial-ready',
                writable: true,
              },
              makerProcessDeps(),
            )
            const inbound = Buffer.from([0, 255, 10, 128, 65])
            const outbound = Buffer.from([27, 0, 255, 66])
            await peer.write(inbound)
            await session.write(outbound)
            expect(await readPty(peer, outbound.length)).toEqual(outbound)
            const capture = await session.result
            expect(capture.bytes).toEqual(inbound)
            expect(isProcessGone(session.pid)).toBe(true)
          } finally {
            await peer.close()
          }
        } finally {
          await killTree(relay, tree, Date.now())
          await relayEnded
        }
      },
    )
  })
}
