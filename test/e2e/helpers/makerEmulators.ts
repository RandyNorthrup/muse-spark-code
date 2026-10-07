import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { listSerialPorts } from '../../../src/core/maker/serial/listPorts'
import { serialAdapterCommand, serialSttyCommand } from '../../../src/core/maker/serial/adapters'
import { startSerialProcess } from '../../../src/core/maker/serial/process'
import type { SerialSessionDependencies } from '../../../src/core/maker/serial/session'
import { makerLeaseDeps, makerProcessDeps } from '../../unit/helpers/makerSerial'

const exec = promisify(execFile)
export const BOARDS = [
  {
    name: 'raspi3b',
    script: 'pi',
    vid: undefined,
    pid: undefined,
    family: undefined,
    text: 'MUSE_EMULATOR_READY',
  },
  {
    name: 'raspi4b',
    script: 'pi',
    vid: undefined,
    pid: undefined,
    family: undefined,
    text: 'MUSE_EMULATOR_READY',
  },
  {
    name: 'pi-virt',
    script: 'pi',
    vid: undefined,
    pid: undefined,
    family: undefined,
    text: 'MUSE_EMULATOR_READY',
  },
  { name: 'esp32', script: 'esp32', vid: '10c4', pid: 'ea60', family: undefined, text: '>>> ' },
  {
    name: 'esp32s3',
    script: 'esp32',
    vid: '303a',
    pid: '1001',
    family: 'esp32',
    text: 'MUSE_ESP32S3_READY',
  },
  { name: 'esp32c3', script: 'esp32', vid: '303a', pid: '1001', family: 'esp32', text: '>>> ' },
  { name: 'uno', script: 'avr', vid: '2341', pid: '0043', family: 'avr', text: 'MUSE_AVR_READY' },
  {
    name: 'mega',
    script: 'avr',
    vid: '2341',
    pid: '0042',
    family: undefined,
    text: 'MUSE_AVR_READY',
  },
  { name: 'pico', script: 'pico', vid: '2e8a', pid: '0005', family: 'rp2', text: '>>> ' },
  {
    name: 'stm32',
    script: 'renode',
    vid: '0483',
    pid: '3748',
    family: undefined,
    text: 'MUSE_STM32_READY',
  },
  { name: 'nrf52', script: 'renode', vid: '1366', pid: '0105', family: undefined, text: 'uart:~$' },
] as const
export type Board = (typeof BOARDS)[number]

const runSchema = z.object({
  pid: z.number().int().positive(),
  stamp: z.string(),
  port: z.string(),
  board: z.string(),
  children: z.array(z.number().int().positive()),
})
export async function rigCommand(
  board: Board,
  action: 'start' | 'stop' | 'status',
  state: string,
  mode = 'boot',
) {
  const { stdout } = await exec(
    '/bin/bash',
    [path.resolve(`scripts/emulators/${board.script}.sh`), action, board.name, state, mode],
    {
      env: { PATH: process.env['PATH'] },
      timeout: 20_000,
      maxBuffer: 4096,
    },
  )
  return stdout
}
export async function startRig(board: Board, state: string, mode = 'boot') {
  return runSchema.parse(JSON.parse(await rigCommand(board, 'start', state, mode)))
}

/** Synthetic OS metadata is attached to a REAL UART, not claimed USB hardware. */
export async function discover(board: Board, port: string) {
  const ports = await listSerialPorts({
    platform: 'linux',
    maxBytes: 4096,
    maxPorts: 2,
    maxAncestors: 2,
    tool: { kind: 'arduino-cli', executable: 'test-metadata-only' },
    run: () =>
      Promise.resolve(
        JSON.stringify({
          detected_ports: [
            {
              port: {
                address: port,
                protocol: 'serial',
                label: `emulated ${board.name}`,
                properties: {
                  vid: board.vid,
                  pid: board.pid,
                  serialNumber: `emulator-${board.name}`,
                },
              },
            },
          ],
        }),
      ),
  })
  const identity = ports[0]
  if (identity === undefined) throw new Error('emulator discovery empty')
  return identity
}

export async function sessionDependencies(
  board: Board,
  port: string,
  directory: string,
  signal: AbortSignal,
): Promise<SerialSessionDependencies> {
  const identity = await discover(board, port)
  return {
    platform: 'linux',
    holder: `emulator-${board.name}`,
    lease: await makerLeaseDeps(directory),
    limits: {
      maxBytes: 65_536,
      maxDurationMs: 90_000,
      approvalTtlMs: 10_000,
      maxIdentityChanges: 2,
    },
    canUseHardware: () => true,
    // P's injection seam only; G's classifier is absent on the lane P base.
    classify: (input) => Promise.resolve(input.operation === 'read' ? 'connect' : 'actuate'),
    confirm: (request, review) => {
      review({
        v: 1,
        type: 'makerPayloadReviewed',
        id: request.id,
        digest: request.digest,
        isComplete: true,
      })
      return Promise.resolve({
        id: request.id,
        digest: request.digest,
        target: request.target,
        decision: 'allow_once',
      })
    },
    identityNow: () => Promise.resolve(identity),
    isPortBusy: () => Promise.resolve(false),
    log: () => Promise.resolve(),
    signal,
    open: async (input, maxBytes, openSignal, start) => {
      const adapter = {
        kind: 'posix-raw',
        file: '/usr/bin/python3',
        script: path.resolve('native/posix/serial.py'),
      } as const
      const settings = { ...input, maxBytes, chunkBytes: 4096, pollMs: 10 }
      const stty = serialSttyCommand(adapter, 'linux', port, settings)
      if (stty !== undefined)
        await exec(stty.file, [...stty.args], { env: { PATH: process.env['PATH'] }, timeout: 2000 })
      return await startSerialProcess(
        serialAdapterCommand(adapter, port, settings),
        makerProcessDeps({ durationMs: input.durationMs, maxBytes }),
        openSignal,
        start,
      )
    },
  }
}

export async function until(isReady: () => Promise<boolean>, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!(await isReady())) {
    if (Date.now() >= deadline) throw new Error('emulator condition deadline')
    await delay(20)
  }
}
