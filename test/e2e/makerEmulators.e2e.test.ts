import type { MakerStartGuard } from '../../src/core/maker/ports'
import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startSerialProcess } from '../../src/core/maker/serial/process'
import { identifyBoard } from '../../src/core/maker/serial/identity'
import { checkFlashIdentity } from '../../src/core/maker/flashIdentity'
import { didStopHardwareLease } from '../../src/core/maker/lease'
import { runSerialAction, type SerialActionInput } from '../../src/core/maker/serial/session'
import { makerLeaseDeps, makerProcessDeps, isTestProcessAlive } from '../unit/helpers/makerSerial'
import {
  BOARDS,
  discover,
  rigCommand,
  sessionDependencies,
  startRig,
  until,
} from './helpers/makerEmulators'
import { buildMakerLeaseWorker, readMakerLeaseFrame } from './helpers/makerEmulatorLease'

// Explicitly opt in to real local emulator processes; missing tools FAIL on opt-in.
describe.skipIf(process.env['MUSE_MAKER_EMULATORS'] !== '1')('maker emulator board matrix', () => {
  let directory: string
  let worker: string
  beforeAll(async () => {
    expect(process.platform).toBe('linux')
    directory = await mkdtemp(path.join(tmpdir(), 'mx-'))
    worker = path.join(directory, 'lease-worker.cjs')
    await buildMakerLeaseWorker(worker)
  })
  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it.each(BOARDS)(
    '$name: discovery, host approvals, UART traffic, Stop and competing processes',
    async (board) => {
      const state = path.join(directory, board.name)
      const leases = path.join(directory, `${board.name}-lease`)
      await mkdir(leases, { mode: 0o700 })
      const run = await startRig(board, state)
      const children: ChildProcessWithoutNullStreams[] = []
      const receipt = path.resolve(`temp/m103-x/receipts/${board.name}`)
      await mkdir(receipt, { recursive: true })
      try {
        expect(await startRig(board, state)).toEqual(run)
        const identity = await discover(board, run.port)
        expect(identity.port).toBe(run.port)
        expect(identifyBoard(identity).family).toBe(board.family)
        const control = new AbortController()
        const deps = await sessionDependencies(board, run.port, leases, control.signal)
        const confirmCalls: Parameters<typeof deps.confirm>[0][] = []
        const confirm: typeof deps.confirm = (request, review) => {
          confirmCalls.push(request)
          return deps.confirm(request, review)
        }
        let opens = 0
        const open: typeof deps.open = (...args) => {
          opens += 1
          return deps.open(...args)
        }
        const input: SerialActionInput = {
          operation: 'read',
          identity,
          baud: 115_200,
          // Cold OS/.NET startup precedes the first receipt on Pi and Renode.
          durationMs: board.script === 'pi' || board.script === 'renode' ? 30_000 : 15_000,
          dtr: false,
          rts: false,
          payloadHex: '',
        }
        const guarded = { ...deps, confirm, open }
        // Prove P propagates G's refusal; this is not a replacement classifier for G.
        expect(
          await runSerialAction(
            { ...input, operation: 'write', payloadHex: '00' },
            { ...guarded, classify: () => Promise.resolve('refused') },
          ),
        ).toEqual({ status: 'refused', reason: 'classification' })
        expect(opens).toBe(0)
        expect(confirmCalls).toEqual([])
        expect(
          await runSerialAction(input, {
            ...guarded,
            confirm: (request) =>
              Promise.resolve({ id: request.id, digest: request.digest, decision: 'reject_once' }),
          }),
        ).toEqual({ status: 'refused', reason: 'approval' })
        expect(opens).toBe(0)
        const observed = await runSerialAction(input, guarded)
        expect(observed.status).toBe('complete')
        if (observed.status !== 'complete') throw new Error('monitor refused')
        await writeFile(path.join(receipt, 'monitor.txt'), observed.capture.bytes)
        expect(observed.capture.bytes.toString('utf8')).toContain(board.text)
        if (board.script === 'pi')
          expect(observed.capture.bytes.toString('utf8')).toContain('root (automatic login)')
        expect(confirmCalls).toHaveLength(1)
        expect(confirmCalls[0]).toMatchObject({
          action: 'connect',
          warnsAboutReset: true,
          target: identity,
        })
        let flashStatus = 'unknown'
        if (board.family !== undefined)
          flashStatus = board.family === 'esp32' ? 'match' : 'mismatch'
        expect(checkFlashIdentity(identity, { idfTarget: 'esp32' }).status).toBe(flashStatus)
        let payload = 'MUSE_PING\n'
        if (board.script === 'pi') payload = 'cat /proc/device-tree/model; tty; echo MUSE_PING\n'
        else if (board.name === 'nrf52') payload = 'help\r\n'
        else if (board.script === 'esp32' || board.name === 'pico')
          payload = "print('MUSE_PING')\r\n"
        const written = await runSerialAction(
          {
            ...input,
            operation: 'write',
            durationMs: 1000,
            payloadHex: Buffer.from(payload).toString('hex'),
          },
          guarded,
        )
        expect(written.status).toBe('complete')
        if (written.status !== 'complete') throw new Error('write refused')
        await writeFile(path.join(receipt, 'write.txt'), written.capture.bytes)
        expect(written.capture.bytes.toString('utf8')).toContain(
          board.name === 'nrf52' ? 'Available commands' : 'MUSE_PING',
        )
        if (board.script === 'pi') {
          expect(written.capture.bytes.toString('utf8')).toContain('/dev/ttyAMA0')
          const models = {
            'pi-virt': 'Raspberry Pi (QEMU virt, generic arm64)',
            raspi3b: 'Raspberry Pi 3 Model B',
            raspi4b: 'Raspberry Pi 4 Model B',
          }
          expect(written.capture.bytes.toString('utf8')).toContain(models[board.name])
        }
        expect(confirmCalls).toHaveLength(2)
        expect(confirmCalls[0]?.id).not.toBe(confirmCalls[1]?.id)
        // Stop an actual active reader, independently of the normal turn queue.
        const opened = new AbortController()
        const active = runSerialAction(
          { ...input, durationMs: 30_000 },
          {
            ...guarded,
            open: async (request, maxBytes, openSignal, start) => {
              const serial = await deps.open(request, maxBytes, openSignal, start)
              opened.abort()
              return serial
            },
          },
        )
        await until(() => Promise.resolve(opened.signal.aborted))
        control.abort()
        const stopped = await active
        expect(stopped.status).toBe('complete')
        if (stopped.status !== 'complete') throw new Error('Stop refused')
        expect(stopped.capture.reason).toBe('stopped')
        // Two independent Node processes contend for the SAME real PTY alias.
        const launch = () => {
          const child = spawn(process.execPath, [worker, leases, run.port], {
            env: { PATH: process.env['PATH'] },
            stdio: 'pipe',
          })
          children.push(child)
          return child
        }
        const first = launch()
        const held = await readMakerLeaseFrame(first)
        expect(held.status).toBe('claimed')
        if (held.status !== 'claimed') throw new Error('initial lease busy')
        const second = launch()
        expect(await readMakerLeaseFrame(second)).toEqual({ status: 'busy', holderPid: first.pid })
        expect(await didStopHardwareLease(await makerLeaseDeps(leases), held.record.resource)).toBe(
          true,
        )
        await until(async () => first.pid !== undefined && !(await isTestProcessAlive(first.pid)))
      } finally {
        try {
          for (const child of children) child.stdin.end()
          for (const child of children) {
            if (child.pid !== undefined)
              await until(async () => !(await isTestProcessAlive(child.pid ?? -1)))
          }
        } finally {
          for (const child of children) child.kill('SIGTERM')
          await rigCommand(board, 'stop', state)
        }
        for (const pid of [run.pid, ...run.children])
          expect(await isTestProcessAlive(pid)).toBe(false)
        await expect(readFile(path.join(state, 'run.json'))).rejects.toThrow()
        await writeFile(
          path.join(receipt, 'emulator.log'),
          await readFile(path.join(state, 'emulator.log')),
        )
      }
      await delay(20)
    },
  )
  it.each(BOARDS.filter((board) => board.script === 'esp32' || board.script === 'avr'))(
    '$name: flashes exact approved bytes with the real tool and stops a live flash',
    async (board) => {
      const state = path.join(directory, `${board.name}-flash`)
      const leases = path.join(directory, `${board.name}-fl`)
      await mkdir(leases, { mode: 0o700 })
      let artifact = Buffer.from('M103 emulator flash receipt\n')
      if (board.script === 'avr')
        artifact = await readFile(path.resolve(`temp/m103-x/images/${board.name}.hex`))
      else if (board.name === 'esp32s3')
        artifact = await readFile(path.resolve('temp/m103-x/esp32s3-build/muse_emulator_uart.bin'))
      if (board.name === 'esp32s3') {
        await mkdir(state, { mode: 0o700 })
        const initial = await readFile(path.resolve('temp/m103-x/images/esp32s3-flash.bin'))
        initial.fill(0xff, 0x1_00_00, 0x1_00_00 + artifact.length)
        await writeFile(path.join(state, 'flash.bin'), initial)
      }
      let run = await startRig(board, state, 'download')
      const abort = new AbortController()
      const deps = await sessionDependencies(board, run.port, leases, abort.signal)
      let opens = 0
      const open = (
        input: SerialActionInput,
        maxBytes: number,
        openSignal: AbortSignal,
        start: MakerStartGuard,
      ) => {
        opens += 1
        return startSerialProcess(
          {
            file: '/usr/bin/python3',
            args: [
              '-I',
              path.resolve('test/fixtures/maker-emulators/flash.py'),
              board.name,
              state,
              String(Buffer.from(input.payloadHex, 'hex').length),
            ],
            readyWord: 'serial-ready',
            writable: true,
          },
          makerProcessDeps({ durationMs: input.durationMs, maxBytes }),
          openSignal,
          start,
        )
      }
      const confirmCalls: Parameters<typeof deps.confirm>[0][] = []
      const confirm: typeof deps.confirm = (request, review) => {
        confirmCalls.push(request)
        return deps.confirm(request, review)
      }
      const input: SerialActionInput = {
        operation: 'write',
        identity: await discover(board, run.port),
        baud: 115_200,
        durationMs: 60_000,
        dtr: false,
        rts: false,
        payloadHex: artifact.toString('hex'),
      }
      const flashDeps = {
        ...deps,
        limits: { ...deps.limits, maxBytes: board.name === 'esp32s3' ? 262_144 : 65_536 },
        open,
        confirm,
        classify: () => Promise.resolve('program' as const),
        flashTarget:
          board.script === 'avr'
            ? { fqbn: `arduino:avr:${board.name}` }
            : { idfTarget: board.name },
      }
      try {
        expect(await runSerialAction(input, { ...flashDeps, canUseHardware: () => false })).toEqual(
          { status: 'refused', reason: 'context' },
        )
        expect(opens).toBe(0)
        if (board.family !== undefined) {
          expect(
            await runSerialAction(input, { ...flashDeps, flashTarget: { family: 'rp2350' } }),
          ).toEqual({ status: 'refused', reason: 'mismatch' })
          expect(opens).toBe(0)
          expect(confirmCalls).toEqual([])
        }
        const result = await runSerialAction(input, flashDeps)
        expect(result.status).toBe('complete')
        if (result.status !== 'complete') throw new Error('flash refused')
        const receipt = path.resolve(`temp/m103-x/receipts/${board.name}`)
        await mkdir(receipt, { recursive: true })
        await writeFile(path.join(receipt, 'flash.txt'), result.capture.bytes)
        expect(result.capture.reason).toBe('ended')
        expect(result.capture.bytes.toString('utf8')).toContain(
          board.script === 'avr' ? 'bytes of flash verified' : 'Hash of data verified',
        )
        expect(confirmCalls).toHaveLength(1)
        expect(confirmCalls[0]).toMatchObject({
          action: 'program',
          target: input.identity,
        })
        expect(await readFile(path.join(state, 'approved-image'))).toEqual(artifact)
        if (board.script === 'esp32') {
          const flash = await readFile(path.join(state, 'flash.bin'))
          const address = board.name === 'esp32s3' ? 0x1_00_00 : 0x3f_00_00
          expect(flash.subarray(address, address + artifact.length)).toEqual(artifact)
          if (board.name === 'esp32s3') {
            expect(await readFile(path.join(state, 'uart-efuse.bin'))).toEqual(
              await readFile(path.resolve('temp/m103-x/images/esp32s3-uart-efuse.bin')),
            )
            await rigCommand(board, 'stop', state)
            run = await startRig(board, state)
            const booted = await runSerialAction(
              { ...input, operation: 'read', payloadHex: '', durationMs: 15_000 },
              { ...deps, confirm },
            )
            expect(booted.status).toBe('complete')
            if (booted.status !== 'complete') throw new Error('reboot monitor refused')
            await writeFile(path.join(receipt, 'flashed-app.txt'), booted.capture.bytes)
            expect(booted.capture.bytes.toString('utf8')).toContain(board.text)
            expect(confirmCalls).toHaveLength(2)
            expect(confirmCalls[1]?.action).toBe('connect')
            await rigCommand(board, 'stop', state)
            run = await startRig(board, state, 'download')
          }
        } else {
          // The bootloader leaves programming mode after a verified upload.
          await rigCommand(board, 'stop', state)
          run = await startRig(board, state, 'download')
        }
        await rm(path.join(state, 'flash-writing'), { force: true })
        let longArtifact: Buffer = Buffer.alloc(32_768, 65)
        if (board.script === 'avr') {
          const binary = path.join(state, 'long.bin')
          const hex = path.join(state, 'long.hex')
          await writeFile(binary, Buffer.alloc(16_384, 65))
          await promisify(execFile)('avr-objcopy', ['-I', 'binary', '-O', 'ihex', binary, hex], {
            env: { PATH: process.env['PATH'] },
            timeout: 5000,
          })
          longArtifact = await readFile(hex)
        }
        const active = runSerialAction(
          { ...input, payloadHex: longArtifact.toString('hex') },
          flashDeps,
        )
        await until(async () => {
          try {
            await readFile(path.join(state, 'flash-writing'))
            return true
          } catch {
            return false
          }
        }, 20_000)
        abort.abort()
        const stopped = await active
        expect(stopped.status).toBe('complete')
        if (stopped.status !== 'complete') throw new Error('flash Stop refused')
        expect(stopped.capture.reason).toBe('stopped')
        expect(confirmCalls).toHaveLength(board.name === 'esp32s3' ? 3 : 2)
        await writeFile(path.join(receipt, 'flash-stop.txt'), stopped.capture.bytes)
        const pid = Number(await readFile(path.join(state, 'flash-tool-pid'), 'utf8'))
        await until(async () => !(await isTestProcessAlive(pid)))
      } finally {
        abort.abort()
        await rigCommand(board, 'stop', state)
        for (const pid of [run.pid, ...run.children])
          expect(await isTestProcessAlive(pid)).toBe(false)
      }
    },
  )
  it('Pico refuses malformed and out-of-range UF2 before opening any UART', async () => {
    const good = await readFile(path.resolve('temp/m103-x/images/pico.uf2'))
    const invalid = path.join(directory, 'invalid.uf2')
    const badMagic = Buffer.from(good)
    badMagic.writeUInt32LE(0, 0)
    const badAddress = Buffer.from(good)
    badAddress.writeUInt32LE(0, 12)
    for (const bytes of [Buffer.alloc(1), badMagic, badAddress]) {
      await writeFile(invalid, bytes)
      await expect(
        promisify(execFile)(
          process.execPath,
          [
            path.resolve('scripts/emulators/pico.mjs'),
            path.resolve('temp/m103-x/rp2040'),
            invalid,
            path.join(directory, 'must-not-open'),
          ],
          { env: { PATH: process.env['PATH'] }, timeout: 5000 },
        ),
      ).rejects.toThrow('invalid UF2')
    }
  })
})
