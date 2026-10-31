import { describe, expect, it } from 'vitest'
import { detectOnPi, type PiDetectIo } from '../../src/core/maker/detect/onPi'
import { MAKER_DETECT_MAX_BYTES, MAKER_PI_COMMAND_PATHS } from '../../src/shared/constants'

function piIo(model = 'Raspberry Pi 5 Model B Rev 1.0\0') {
  const calls = {
    readModel: [] as number[],
    isExecutable: [] as string[],
    run: [] as string[][],
  }
  const io: PiDetectIo = {
    readModel: (maxBytes) => {
      calls.readModel.push(maxBytes)
      return Promise.resolve(Buffer.from(model))
    },
    isExecutable: (file) => {
      calls.isExecutable.push(file)
      return Promise.resolve(true)
    },
    run: (file, argument) => {
      calls.run.push([file, argument])
      return Promise.resolve(argument === 'get_throttled' ? 'throttled=0x50005\n' : "temp=43.2'C\n")
    },
  }
  return { io, calls }
}

describe('optional bounded Pi facts', () => {
  it('does no probes on Windows or macOS', async () => {
    const { io, calls } = piIo()
    expect(await detectOnPi('win32', io)).toBeUndefined()
    expect(await detectOnPi('darwin', io)).toBeUndefined()
    expect(calls.readModel).toEqual([])
    expect(calls.isExecutable).toEqual([])
    expect(calls.run).toEqual([])
  })

  it('does not run vcgencmd on another board or when the model file is absent', async () => {
    const { io, calls } = piIo('Other Board\0')
    expect(await detectOnPi('linux', io)).toBeUndefined()
    expect(calls.isExecutable).toEqual([])
    expect(calls.run).toEqual([])
    expect(
      await detectOnPi('linux', { ...io, readModel: () => Promise.resolve(undefined) }),
    ).toBeUndefined()
  })

  it('uses fixed system paths and only the two observe arguments, keeping all throttle bits', async () => {
    const { io, calls } = piIo()
    expect(await detectOnPi('linux', io)).toEqual({
      model: 'Raspberry Pi 5 Model B Rev 1.0',
      temperatureCelsius: 43.2,
      throttled: 0x5_00_05,
    })
    expect(calls.readModel).toEqual([MAKER_DETECT_MAX_BYTES])
    expect(calls.isExecutable).toEqual([MAKER_PI_COMMAND_PATHS[0]])
    expect(calls.run).toEqual([
      [MAKER_PI_COMMAND_PATHS[0], 'get_throttled'],
      [MAKER_PI_COMMAND_PATHS[0], 'measure_temp'],
    ])
  })

  it('returns the model alone when vcgencmd is missing, failed, malformed or oversized', async () => {
    const { io, calls } = piIo()
    const model = { model: 'Raspberry Pi 5 Model B Rev 1.0' }
    expect(
      await detectOnPi('linux', { ...io, isExecutable: () => Promise.resolve(false) }),
    ).toEqual(model)
    expect(calls.run).toEqual([])
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
    const { io, calls } = piIo('Raspberry Pi\ncommand')
    expect(await detectOnPi('linux', io)).toBeUndefined()
    expect(
      await detectOnPi('linux', piIo(`Raspberry Pi ${'x'.repeat(MAKER_DETECT_MAX_BYTES)}`).io),
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
    expect(calls.run).toEqual([])
  })

  it('rejects overflowing numbers and oversized otherwise-valid diagnostics', async () => {
    const { io } = piIo()
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
