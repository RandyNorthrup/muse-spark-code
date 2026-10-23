// M103 D: optional local facts. Never opens GPIO, serial or a credential store.
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import path from 'node:path'
import {
  MAKER_DETECT_MAX_BYTES,
  MAKER_PI_COMMAND_PATHS,
  MAKER_PI_COMMAND_TIMEOUT_MS,
  MAKER_PI_MODEL_PATH,
} from '../../../shared/constants'
import { nodeProjectDetectIo } from './projectIo'

export interface PiFacts {
  readonly model: string
  readonly temperatureCelsius?: number
  /** vcgencmd's full bitfield, including historical bits; no bits are dropped. */
  readonly throttled?: number
}

export interface PiDetectIo {
  readModel(maxBytes: number): Promise<Uint8Array | undefined>
  isExecutable(file: string): Promise<boolean>
  run(file: string, argument: 'measure_temp' | 'get_throttled'): Promise<string | undefined>
}

const nodePiIo: PiDetectIo = {
  async readModel(maxBytes) {
    // /proc/device-tree is an OS-owned link to sysfs on a Pi. The reader
    // resolves it, checks a regular file and bounds the bytes. Any failure
    // (absent, refused, oversized) simply means no model can be reported.
    const [model] = await Promise.allSettled([
      nodeProjectDetectIo.read(
        path.dirname(MAKER_PI_MODEL_PATH),
        path.basename(MAKER_PI_MODEL_PATH),
        maxBytes,
      ),
    ])
    return model.status === 'fulfilled' ? model.value : undefined
  },
  async isExecutable(file) {
    const [attempt] = await Promise.allSettled([
      (async () => {
        const info = await stat(file)
        if (!info.isFile()) return false
        await access(file, constants.X_OK)
        return true
      })(),
    ])
    return attempt.status === 'fulfilled' && attempt.value
  },
  run: (file, argument) =>
    new Promise((resolve) => {
      execFile(
        file,
        [argument],
        {
          cwd: '/',
          env: {},
          encoding: 'utf8',
          timeout: MAKER_PI_COMMAND_TIMEOUT_MS,
          killSignal: 'SIGKILL',
          maxBuffer: MAKER_DETECT_MAX_BYTES,
        },
        (error, stdout) => {
          resolve(error === null ? stdout : undefined)
        },
      )
    }),
}

/** No probes on another OS or a non-Pi; absent or failed optional tools leave explicit missing facts. */
export async function detectOnPi(
  platform: NodeJS.Platform,
  io: PiDetectIo = nodePiIo,
): Promise<PiFacts | undefined> {
  if (platform !== 'linux') return
  const bytes = await io.readModel(MAKER_DETECT_MAX_BYTES)
  if (bytes === undefined || bytes.length > MAKER_DETECT_MAX_BYTES) return
  let model: string
  try {
    model = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\0$/, '').trim()
  } catch (error) {
    if (!(error instanceof TypeError)) throw error
    return
  }
  if (!/^Raspberry Pi\b/.test(model) || /\p{Cc}/u.test(model)) return
  let executable: string | undefined
  for (const file of MAKER_PI_COMMAND_PATHS) {
    if (await io.isExecutable(file)) {
      executable = file
      break
    }
  }
  if (executable === undefined) return { model }
  const throttled = await io.run(executable, 'get_throttled')
  const temperature = await io.run(executable, 'measure_temp')
  const code =
    throttled === undefined || throttled.length > MAKER_DETECT_MAX_BYTES
      ? undefined
      : /^throttled=(0x[\da-f]+)\s*$/i.exec(throttled)?.[1]
  const degrees =
    temperature === undefined || temperature.length > MAKER_DETECT_MAX_BYTES
      ? undefined
      : /^temp=(\d+(?:\.\d+)?)'C\s*$/.exec(temperature)?.[1]
  const number = code === undefined ? undefined : Number(code)
  const celsius = degrees === undefined ? undefined : Number(degrees)
  return {
    model,
    ...(number !== undefined && Number.isSafeInteger(number) && { throttled: number }),
    ...(celsius !== undefined && Number.isFinite(celsius) && { temperatureCelsius: celsius }),
  }
}
