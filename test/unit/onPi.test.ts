import { execFile } from 'node:child_process'
import type * as fsPromises from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectOnPi, type PiDetectIo } from '../../src/core/maker/detect/onPi'
import { nodeProjectDetectIo } from '../../src/core/maker/detect/projectIo'
import {
  MAKER_DETECT_MAX_BYTES,
  MAKER_PI_COMMAND_PATHS,
  MAKER_PI_COMMAND_TIMEOUT_MS,
} from '../../src/shared/constants'

vi.mock('node:child_process', () => ({
  execFile: vi.fn(
    (
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback: (error: null, output: string) => void,
    ) => {
      callback(null, 'unavailable')
    },
  ),
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof fsPromises>()),
  stat: () => Promise.resolve({ isFile: () => true }),
  access: () => Promise.resolve(),
}))
afterEach(() => {
  vi.restoreAllMocks()
})

function piIo(model = 'Raspberry Pi 5 Model B Rev 1.0\0'): PiDetectIo {
  return {
    readModel: vi.fn(() => Promise.resolve(Buffer.from(model))),
    isExecutable: vi.fn(() => Promise.resolve(true)),
    run: vi.fn((_file, argument) =>
      Promise.resolve(argument === 'get_throttled' ? 'throttled=0x50005\n' : "temp=43.2'C\n"),
    ),
  }
}

describe('optional bounded Pi facts', () => {
  it('runs the Node probe with no inherited environment, a time cap and an output cap', async () => {
    vi.spyOn(nodeProjectDetectIo, 'read').mockResolvedValue(Buffer.from('Raspberry Pi 5\0'))
    expect(await detectOnPi('linux')).toEqual({ model: 'Raspberry Pi 5' })
    expect(execFile).toHaveBeenCalledWith(
      MAKER_PI_COMMAND_PATHS[0],
      ['get_throttled'],
      {
        cwd: '/',
        env: {},
        encoding: 'utf8',
        timeout: MAKER_PI_COMMAND_TIMEOUT_MS,
        killSignal: 'SIGKILL',
        maxBuffer: MAKER_DETECT_MAX_BYTES,
      },
      expect.any(Function),
    )
  })
  it('does no probes on Windows or macOS', async () => {
    const io = piIo()
    expect(await detectOnPi('win32', io)).toBeUndefined()
    expect(await detectOnPi('darwin', io)).toBeUndefined()
    expect(io.readModel).not.toHaveBeenCalled()
    expect(io.isExecutable).not.toHaveBeenCalled()
    expect(io.run).not.toHaveBeenCalled()
  })

  it('does not run vcgencmd on another board or when the model file is absent', async () => {
    const io = piIo('Other Board\0')
    expect(await detectOnPi('linux', io)).toBeUndefined()
    expect(io.isExecutable).not.toHaveBeenCalled()
    expect(io.run).not.toHaveBeenCalled()
    expect(
      await detectOnPi('linux', { ...io, readModel: () => Promise.resolve(undefined) }),
    ).toBeUndefined()
  })

  it('uses fixed system paths and only the two observe arguments, keeping all throttle bits', async () => {
    const io = piIo()
    expect(await detectOnPi('linux', io)).toEqual({
      model: 'Raspberry Pi 5 Model B Rev 1.0',
      temperatureCelsius: 43.2,
      throttled: 0x5_00_05,
    })
    expect(io.readModel).toHaveBeenCalledWith(MAKER_DETECT_MAX_BYTES)
    expect(io.isExecutable).toHaveBeenCalledWith(MAKER_PI_COMMAND_PATHS[0])
    expect(io.run).toHaveBeenNthCalledWith(1, MAKER_PI_COMMAND_PATHS[0], 'get_throttled')
    expect(io.run).toHaveBeenNthCalledWith(2, MAKER_PI_COMMAND_PATHS[0], 'measure_temp')
  })

  it('returns the model alone when vcgencmd is missing, failed, malformed or oversized', async () => {
    const io = piIo()
    const model = { model: 'Raspberry Pi 5 Model B Rev 1.0' }
    expect(
      await detectOnPi('linux', { ...io, isExecutable: () => Promise.resolve(false) }),
    ).toEqual(model)
    expect(io.run).not.toHaveBeenCalled()
    expect(await detectOnPi('linux', { ...io, run: () => Promise.resolve(undefined) })).toEqual(
      model,
    )
    expect(
      await detectOnPi('linux', { ...io, run: () => Promise.resolve('untrusted command') }),
    ).toEqual(model)
    expect(
      await detectOnPi('linux', {
        ...io,
        run: () => Promise.resolve('x'.repeat(MAKER_DETECT_MAX_BYTES + 1)),
      }),
    ).toEqual(model)
  })

  it('rejects oversized, invalidly encoded and control-bearing model files', async () => {
    const io = piIo('Raspberry Pi\ncommand')
    expect(await detectOnPi('linux', io)).toBeUndefined()
    expect(
      await detectOnPi('linux', piIo(`Raspberry Pi ${'x'.repeat(MAKER_DETECT_MAX_BYTES)}`)),
    ).toBeUndefined()
    expect(
      await detectOnPi('linux', { ...io, readModel: () => Promise.resolve(Buffer.from([0xff])) }),
    ).toBeUndefined()
    expect(
      await detectOnPi('linux', {
        ...io,
        readModel: () =>
          Promise.resolve(Buffer.concat([Buffer.from('Raspberry Pi '), Buffer.from([0xff])])),
      }),
    ).toBeUndefined()
    expect(io.run).not.toHaveBeenCalled()
  })

  it('rejects overflowing numbers and oversized otherwise-valid diagnostics', async () => {
    const io = piIo()
    for (const output of [
      'throttled=0xffffffffffffffff',
      `temp=${'9'.repeat(400)}'C`,
      `throttled=0x1${' '.repeat(MAKER_DETECT_MAX_BYTES)}`,
      `temp=42.5'C${' '.repeat(MAKER_DETECT_MAX_BYTES)}`,
    ]) {
      expect(await detectOnPi('linux', { ...io, run: () => Promise.resolve(output) })).toEqual({
        model: 'Raspberry Pi 5 Model B Rev 1.0',
      })
    }
  })
})
