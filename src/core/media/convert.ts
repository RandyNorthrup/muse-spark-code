// Optional machine-local conversion. No installation, shell, credentials,
// provider calls or user content in diagnostics. Callers own confinement/consent.
import { spawn } from 'node:child_process'
import { constants, accessSync, statSync } from 'node:fs'
import { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { HOOK_FORBIDDEN_ENV_NAMES, SHELL_MAX_TIMEOUT_MS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { resolveExecutable, type ExecutableProbe } from '../executables'
import {
  checkMediaLimits,
  sniffMedia,
  type MediaFileInfo,
  type MediaLimits,
  type SniffMediaResult,
} from './limits'

export interface MediaConverter {
  readonly kind: 'ffmpeg' | 'avconvert'
  readonly command: string
}

const OWNER_DIRECTORY_MODE = 0o700
const OWNER_FILE_MODE = 0o600
const AVCONVERT = '/usr/bin/avconvert'
const INPUT_FORMATS: Readonly<Record<MediaFileInfo['mediaType'], string>> = {
  'video/mp4': 'mov',
  'video/quicktime': 'mov',
  'video/webm': 'matroska',
  'video/x-matroska': 'matroska',
  'audio/mp4': 'mov',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK)
    return statSync(file).isFile()
  } catch {
    return false
  }
}

/** Absolute PATH entries only; avconvert is macOS's own system executable. */
export function locateMediaConverter(
  givenProbe?: ExecutableProbe,
):
  | { readonly ok: true; readonly converter: MediaConverter }
  | { readonly ok: false; readonly reason: string } {
  const probe = givenProbe ?? {
    platform: process.platform,
    pathVariable: process.env['PATH'],
    fileExists: isExecutable,
  }
  if (probe.platform === 'darwin' && probe.fileExists(AVCONVERT))
    return { ok: true, converter: { kind: 'avconvert', command: AVCONVERT } }
  const command = resolveExecutable('ffmpeg', probe)
  return command === undefined
    ? { ok: false, reason: UI_TEXT.media.converterUnavailable }
    : { ok: true, converter: { kind: 'ffmpeg', command } }
}

interface ConversionRunOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

export interface MediaConversionOptions {
  readonly limits?: MediaLimits
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /** Fresh owner-only directory. Required on Windows: chmod cannot set its ACL.
   * The host/native runtime creates the directory; conversion owns its cleanup. */
  readonly createPrivateDirectory?: () => Promise<string>
  /** Injected process boundary for other hosts and fake-only tests. */
  readonly run?: (
    command: string,
    args: readonly string[],
    options: ConversionRunOptions,
  ) => Promise<void>
}

export type MediaConversionResult =
  | {
      readonly ok: true
      readonly path: string
      readonly info: Extract<MediaFileInfo, { kind: 'video' }>
      readonly dispose: () => Promise<void>
    }
  | { readonly ok: false; readonly reason: string }

function runConverter(
  command: string,
  args: readonly string[],
  options: ConversionRunOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted === true) {
      reject(new Error('Stopped'))
      return
    }
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'ignore',
      windowsHide: true,
    })
    let hasFailed = false
    const stop = () => {
      hasFailed = true
      child.kill('SIGKILL')
    }
    const timer = setTimeout(stop, options.timeoutMs)
    options.signal?.addEventListener('abort', stop, { once: true })
    if (isAborted(options.signal)) stop()
    child.once('error', () => {
      hasFailed = true
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', stop)
      if (hasFailed || code !== 0) reject(new Error('Converter failed'))
      else resolve()
    })
  })
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

async function sniffFile(filePath: string, sizeBytes: number): Promise<SniffMediaResult> {
  const handle = await open(filePath, 'r')
  try {
    return await sniffMedia({
      sizeBytes,
      read: async (offset, length) => {
        const buffer = new Uint8Array(length)
        const read = await handle.read(buffer, 0, length, offset)
        return buffer.subarray(0, read.bytesRead)
      },
    })
  } finally {
    await handle.close()
  }
}

/** Owner-only output, verified by bytes before returning; dispose after upload/discard. */
export async function convertToMp4(
  inputPath: string,
  converter: MediaConverter,
  options: MediaConversionOptions = {},
): Promise<MediaConversionResult> {
  const timeoutMs = options.timeoutMs ?? SHELL_MAX_TIMEOUT_MS
  const failed = () =>
    ({
      ok: false,
      reason: fill(UI_TEXT.media.conversionFailed, { reason: converter.kind }),
    }) as const
  if (
    !path.isAbsolute(inputPath) ||
    !path.isAbsolute(converter.command) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > SHELL_MAX_TIMEOUT_MS ||
    options.signal?.aborted === true
  )
    return failed()
  if (process.platform === 'win32' && options.createPrivateDirectory === undefined)
    return { ok: false, reason: fill(UI_TEXT.media.conversionFailed, { reason: 'permissions' }) }
  let directory: string | undefined
  try {
    const input = await lstat(inputPath)
    if (!input.isFile()) return failed()
    const source = await sniffFile(inputPath, input.size)
    if (!source.ok) return failed()
    const privateDirectory =
      options.createPrivateDirectory === undefined
        ? await mkdtemp(path.join(tmpdir(), 'muse-media-'))
        : await options.createPrivateDirectory()
    if (!path.isAbsolute(privateDirectory)) throw new Error('Invalid private directory')
    directory = privateDirectory
    await chmod(directory, OWNER_DIRECTORY_MODE)
    const output = path.join(directory, 'converted.mp4')
    const reserved = await open(output, 'wx', OWNER_FILE_MODE)
    await reserved.close()
    const args =
      converter.kind === 'ffmpeg'
        ? [
            '-nostdin',
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-protocol_whitelist',
            'file',
            '-f',
            INPUT_FORMATS[source.info.mediaType],
            ...(INPUT_FORMATS[source.info.mediaType] === 'mov'
              ? ['-enable_drefs', '0', '-use_absolute_path', '0']
              : []),
            '-i',
            inputPath,
            '-map',
            '0:v:0?',
            '-map',
            '0:a:0?',
            '-c:v',
            'libx264',
            '-c:a',
            'aac',
            '-movflags',
            '+faststart',
            '-f',
            'mp4',
            output,
          ]
        : [
            '--source',
            inputPath,
            '--preset',
            'PresetHighestQuality',
            '--output',
            output,
            '--replace',
          ]
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([name]) =>
          !name.toUpperCase().endsWith('_API_KEY') &&
          !HOOK_FORBIDDEN_ENV_NAMES.has(name.toUpperCase()),
      ),
    )
    await (options.run ?? runConverter)(converter.command, args, {
      cwd: directory,
      env,
      timeoutMs,
      ...(options.signal !== undefined && { signal: options.signal }),
    })
    if (isAborted(options.signal)) return failed()
    const stat = await lstat(output)
    if (!stat.isFile()) return failed()
    await chmod(output, OWNER_FILE_MODE)
    const result = await sniffFile(output, stat.size)
    if (!result.ok || result.info.kind !== 'video' || result.info.mediaType !== 'video/mp4')
      return failed()
    const admitted = checkMediaLimits(result.info, options.limits)
    if (!admitted.ok) return { ok: false, reason: admitted.reason }
    if (isAborted(options.signal)) return failed()
    const ownedDirectory = directory
    const dispose = () => rm(ownedDirectory, { recursive: true, force: true })
    directory = undefined
    return { ok: true, path: output, info: result.info, dispose }
  } catch {
    return failed()
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
}
