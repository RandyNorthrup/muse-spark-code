// Optional machine-local conversion. No installation, shell, credentials,
// provider calls or user content in diagnostics. Callers own confinement/consent.
import { spawn, type ChildProcess } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { watch, type FSWatcher } from 'node:fs'
import fs, { chmod, lstat, mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  HOOK_FORBIDDEN_ENV_NAMES,
  BYTES_PER_MIB,
  MEDIA_AVCONVERT_VERSION_PATTERN,
  MEDIA_CONVERTER_INSTALL_PATHS,
  MEDIA_CONVERTER_SHIM_PATTERNS,
  MEDIA_CONVERTER_WINDOWS_INSTALLS,
  MEDIA_CONVERTER_PROBE_MAX_BYTES,
  MEDIA_CONVERTER_PROBE_TIMEOUT_MS,
  MEDIA_FFMPEG_VERSION_PATTERN,
  MEDIA_CONVERSION_DEFAULT_OUTPUT_BYTES,
  MEDIA_CONVERSION_MAX_RSS_BYTES,
  MEDIA_CONVERSION_MEMORY_CAP_CODE,
  MEDIA_CONVERSION_WATCHDOG_INTERVAL_MS,
  MEDIA_CONVERSION_SAMPLE_TIMEOUT_MS,
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_PROC_RSS_PATTERN,
  MEDIA_PROC_EXITED_PATTERN,
  MEDIA_PROC_RSS_UNIT_BYTES,
  MUSE_VOICE_SAMPLE_RATE,
  SHELL_MAX_TIMEOUT_MS,
  UI_TEXT,
} from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type { TrustedPathVerifier } from '../../runtime/trustedPathPort'
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

interface VersionProbeOptions {
  readonly timeoutMs: number
  readonly env: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
}

export interface ConverterVerification {
  /** The shared StrictModes/safe_path port (REDM104L3's `runtime/trustedPath.ts`
   * on POSIX, `runtime/windowsTrustedPath.ts` on Windows). Absent refuses. */
  readonly trustedPath?: TrustedPathVerifier
  /** Raw bounded version stdout; an unrecognised banner is refused. */
  readonly probeVersion?: (
    command: string,
    args: readonly string[],
    options: VersionProbeOptions,
  ) => Promise<string>
}

interface ConverterDiscoveryOptions extends ConverterVerification {
  readonly platform?: NodeJS.Platform
  /** Machine configuration (`museSpark.mediaConverterPath`, the runtime's
   * `--media-converter`), never workspace PATH lookup. When given, it is the
   * only candidate: a failure refuses with its reason, never falling back. */
  readonly configuredConverters?: readonly MediaConverter[]
  /** Where Windows install locations resolve from; never a drive literal. */
  readonly env?: NodeJS.ProcessEnv
}

/** Documented install locations: POSIX paths, Windows ones from the environment. */
function documentedConverters(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): readonly MediaConverter[] {
  if (platform === 'win32')
    return MEDIA_CONVERTER_WINDOWS_INSTALLS.flatMap(({ variable, segments }) => {
      const root = Object.entries(env).find(([name]) => name.toUpperCase() === variable)?.[1]
      return root === undefined || !path.win32.isAbsolute(root) || /\p{Cc}/u.test(root)
        ? []
        : [{ kind: 'ffmpeg' as const, command: path.win32.join(root, ...segments) }]
    })
  const installations: Partial<Record<NodeJS.Platform, readonly string[]>> =
    MEDIA_CONVERTER_INSTALL_PATHS
  return [
    ...(platform === 'darwin' ? [{ kind: 'avconvert' as const, command: AVCONVERT }] : []),
    ...(installations[platform] ?? []).map((command) => ({ kind: 'ffmpeg' as const, command })),
  ]
}

/** REDM104L3's refusal for a group/other-writable ancestor. */
const SHARED_ANCESTOR = 'group/other writable ancestor'

type TrustedCommand =
  { readonly ok: true; readonly path: string } | { readonly ok: false; readonly reason: string }

/** The verified canonical executable to launch, or why not. A launcher shim
 * (Chocolatey, Scoop, snap) runs a second, unverified binary, so it refuses. */
async function trustedCommand(
  converter: MediaConverter,
  options: ConverterVerification,
): Promise<TrustedCommand> {
  if (options.trustedPath === undefined) return { ok: false, reason: 'no trusted-path verifier' }
  const verdict = await options.trustedPath.verify(converter.command, { leafKind: 'file' })
  if ('refused' in verdict) return { ok: false, reason: `${verdict.component}: ${verdict.reason}` }
  return MEDIA_CONVERTER_SHIM_PATTERNS.some((pattern) => pattern.test(verdict.path))
    ? { ok: false, reason: `${verdict.path}: launcher shim` }
    : { ok: true, path: verdict.path }
}

function converterEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) =>
        !name.toUpperCase().endsWith('_API_KEY') &&
        !HOOK_FORBIDDEN_ENV_NAMES.has(name.toUpperCase()),
    ),
  )
}

function observeConverter(
  child: ChildProcess,
  options: Pick<VersionProbeOptions, 'timeoutMs' | 'signal'>,
  stop: () => void,
): () => void {
  const timer = setTimeout(stop, options.timeoutMs)
  options.signal?.addEventListener('abort', stop, { once: true })
  child.once('error', stop)
  if (isAborted(options.signal)) stop()
  return () => {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', stop)
  }
}

function probeVersion(
  command: string,
  args: readonly string[],
  options: VersionProbeOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (isAborted(options.signal)) {
      reject(new Error('Stopped'))
      return
    }
    const child = spawn(command, args, {
      env: options.env,
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    })
    let output = ''
    let bytes = 0
    let hasFailed = false
    const stop = () => {
      hasFailed = true
      child.kill('SIGKILL')
    }
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MEDIA_CONVERTER_PROBE_MAX_BYTES) stop()
      else output += chunk.toString('utf8')
    })
    const release = observeConverter(child, options, stop)
    child.once('close', (code) => {
      release()
      if (hasFailed || code !== 0) reject(new Error('Version probe failed'))
      else resolve(output)
    })
  })
}

/** The verified canonical command with a strictly parsed release banner, or
 * why not. The probe itself launches the verified canonical path. */
async function knownVersionCommand(
  converter: MediaConverter,
  options: ConverterVerification,
  signal?: AbortSignal,
): Promise<TrustedCommand> {
  const trusted = await trustedCommand(converter, options)
  if (!trusted.ok || isAborted(signal))
    return trusted.ok ? { ok: false, reason: 'stopped' } : trusted
  const output = await (options.probeVersion ?? probeVersion)(
    trusted.path,
    [converter.kind === 'ffmpeg' ? '-version' : '--version'],
    {
      timeoutMs: MEDIA_CONVERTER_PROBE_TIMEOUT_MS,
      env: converterEnvironment(),
      ...(signal !== undefined && { signal }),
    },
  )
  const banner = output.split('\n', 1)[0]?.replace(/\r$/u, '') ?? ''
  return Buffer.byteLength(output) <= MEDIA_CONVERTER_PROBE_MAX_BYTES &&
    (converter.kind === 'ffmpeg'
      ? MEDIA_FFMPEG_VERSION_PATTERN
      : MEDIA_AVCONVERT_VERSION_PATTERN
    ).test(banner)
    ? trusted
    : { ok: false, reason: `${trusted.path}: no release version` }
}

/** Immediately before encoding: the same canonical path verifies again. */
async function recheckedCommand(
  converter: MediaConverter,
  probed: string,
  options: ConverterVerification,
): Promise<string | undefined> {
  const trusted = await trustedCommand(converter, options)
  return trusted.ok && trusted.path === probed ? trusted.path : undefined
}

/** Explicit configuration first and alone, else documented installs; never
 * PATH. No verifier means no offer. Every version probe is a verified launch,
 * and the converter returned names the verified canonical executable. */
export async function locateMediaConverter(
  options: ConverterDiscoveryOptions = {},
): Promise<
  | { readonly ok: true; readonly converter: MediaConverter }
  | { readonly ok: false; readonly reason: string }
> {
  const platform = options.platform ?? process.platform
  const configured = options.configuredConverters ?? []
  const candidates =
    configured.length > 0 ? configured : documentedConverters(platform, options.env ?? process.env)
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const reasons: string[] = []
  for (const converter of candidates) {
    if (!pathApi.isAbsolute(converter.command)) {
      reasons.push(`${converter.command}: absolute path required`)
      continue
    }
    try {
      const known = await knownVersionCommand(converter, options)
      if (known.ok) return { ok: true, converter: { kind: converter.kind, command: known.path } }
      reasons.push(known.reason)
    } catch {
      // A missing candidate or a failed probe names only its path.
      reasons.push(`${converter.command}: unavailable`)
    }
  }
  // A configured path that fails says why; it never falls back to discovery.
  if (configured.length > 0)
    return {
      ok: false,
      reason: fill(UI_TEXT.media.converterConfiguredRefused, { reason: reasons.join('; ') }),
    }
  // A found converter under a shared-writable folder (Intel Homebrew's
  // admin-group /usr/local/bin until M104's signed private-group lookup)
  // names the fix rather than the generic absence.
  const shared = reasons.find((reason) => reason.includes(SHARED_ANCESTOR))
  return {
    ok: false,
    reason:
      shared === undefined
        ? UI_TEXT.media.converterUnavailable
        : fill(UI_TEXT.media.converterSharedFolder, { reason: shared }),
  }
}

/** What every encoder launch must enforce, whatever watches its memory. */
export interface LimitedRunOptions {
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  readonly outputPath: string
  readonly maxOutputBytes: number
  readonly maxRssBytes: number
}

interface ConversionRunOptions extends LimitedRunOptions {
  readonly readRssBytes: (pid: number) => Promise<number>
}

export interface MediaConversionOptions extends ConverterVerification {
  readonly limits?: MediaLimits
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
  /** Native/kernel sampler for the encoder PID. Off Linux, encoding requires
   * either this bounded sampler or `memoryLimitedRun`; neither refuses. */
  readonly readRssBytes?: (pid: number) => Promise<number>
  /**
   * A process boundary whose memory cap the kernel enforces (the Windows job's
   * JOB_OBJECT_LIMIT_JOB_MEMORY), used when no sampler is bound. It applies
   * `maxRssBytes` as that cap, enforces the output and deadline limits itself,
   * awaits the child's close, and rejects with an error whose `code` is
   * `MEDIA_CONVERSION_MEMORY_CAP_CODE` when the cap stopped the encoder.
   */
  readonly memoryLimitedRun?: (
    command: string,
    args: readonly string[],
    options: LimitedRunOptions,
  ) => Promise<void>
  /** Fresh owner-only directory. Required on Windows: chmod cannot set its ACL.
   * The host/native runtime creates the directory; conversion owns its cleanup. */
  readonly createPrivateDirectory?: () => Promise<string>
  /** Injected process boundary for other hosts and fake-only tests. It must
   * enforce the supplied output/RSS/deadline limits and await child close. */
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

/** `convertToWav16kMono` returns audio, never video: a separate result keeps
 * the video-only `MediaConversionResult` honest. */
export type WavConversionResult =
  | {
      readonly ok: true
      readonly path: string
      readonly info: Extract<MediaFileInfo, { kind: 'audio' }>
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
    let hasClosed = false
    // Node reaps the child before 'exit': from then on its PID is no
    // reading. RSS is bounded by the samples taken while it ran; after
    // close only the output decides (MEDIAVB finding on RVM105M12's rule).
    let hasExited = false
    child.once('exit', () => {
      hasExited = true
    })
    let resourceCheck: Promise<void> | undefined
    const stop = () => {
      hasFailed = true
      if (!hasClosed) child.kill('SIGKILL')
    }
    /** The output's type and size cap: while the child runs and once after close. */
    const isOutputWithinCap = async (): Promise<boolean> => {
      const output = await lstat(options.outputPath)
      return output.isFile() && output.size <= options.maxOutputBytes
    }
    const sampleResources = async () => {
      try {
        if (!(await isOutputWithinCap()) || child.pid === undefined) {
          stop()
          return
        }
        const rss = await options.readRssBytes(child.pid)
        if (!Number.isSafeInteger(rss) || rss < 0 || rss > options.maxRssBytes) stop()
      } catch {
        // A live child's unavailable sample refuses. A sample that lost the
        // race with the exit read a reaped PID, which proves nothing.
        if (!hasExited) stop()
      }
    }
    const checkResources = async () => {
      let sampleDeadline: ReturnType<typeof setTimeout> | undefined
      const expired = new Promise<void>((settle) => {
        sampleDeadline = setTimeout(() => {
          if (!hasExited) stop()
          settle()
        }, MEDIA_CONVERSION_SAMPLE_TIMEOUT_MS)
      })
      try {
        await Promise.race([sampleResources(), expired])
      } finally {
        clearTimeout(sampleDeadline)
        resourceCheck = undefined
      }
    }
    const requestCheck = () => {
      if (resourceCheck !== undefined || hasClosed || hasFailed) return
      resourceCheck = checkResources()
    }
    let watcher: FSWatcher | undefined
    try {
      watcher = watch(options.cwd, requestCheck)
      watcher.on('error', stop)
    } catch {
      stop()
    }
    const watchdog = setInterval(requestCheck, MEDIA_CONVERSION_WATCHDOG_INTERVAL_MS)
    requestCheck()
    const release = observeConverter(child, options, stop)
    child.once('close', (code) => {
      hasClosed = true
      watcher?.close()
      clearInterval(watchdog)
      const finish = async () => {
        // A successful exit cannot outrun its outstanding sample, and its
        // final output must still be a file within the cap. No RSS is read
        // from the reaped PID.
        await resourceCheck
        if (!hasFailed && code === 0) {
          try {
            if (!(await isOutputWithinCap())) hasFailed = true
          } catch {
            hasFailed = true
          }
        }
        release()
        if (hasFailed || code !== 0) reject(new Error('Converter failed'))
        else resolve()
      }
      void finish()
    })
  })
}

async function readLinuxRssBytes(pid: number): Promise<number> {
  // A reaped PID is an unavailable reading, not evidence of zero RSS.
  const status = await fs.readFile(`/proc/${String(pid)}/status`, 'utf8')
  const value = MEDIA_PROC_RSS_PATTERN.exec(status)?.[1]
  if (value === undefined && pid !== process.pid && MEDIA_PROC_EXITED_PATTERN.test(status)) return 0
  if (value === undefined) throw new Error('RSS unavailable')
  return Number(value) * MEDIA_PROC_RSS_UNIT_BYTES
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}

type MemoryWatch =
  | { readonly kind: 'sampler'; readonly readRssBytes: (pid: number) => Promise<number> }
  | {
      readonly kind: 'kernel'
      readonly run: NonNullable<MediaConversionOptions['memoryLimitedRun']>
    }

/** A bounded RSS sampler, else a kernel-enforced cap, else (off Linux) none. */
async function memoryWatch(options: MediaConversionOptions): Promise<MemoryWatch | undefined> {
  if (options.readRssBytes !== undefined)
    return { kind: 'sampler', readRssBytes: options.readRssBytes }
  if (options.memoryLimitedRun !== undefined)
    return { kind: 'kernel', run: options.memoryLimitedRun }
  if (process.platform !== 'linux') return undefined
  await readLinuxRssBytes(process.pid)
  return { kind: 'sampler', readRssBytes: readLinuxRssBytes }
}

function encode(
  command: string,
  args: readonly string[],
  limits: LimitedRunOptions,
  watch: MemoryWatch,
  run: MediaConversionOptions['run'],
): Promise<void> {
  return watch.kind === 'kernel'
    ? watch.run(command, args, limits)
    : (run ?? runConverter)(command, args, { ...limits, readRssBytes: watch.readRssBytes })
}

/** The kernel's memory cap stopped the encoder: said as such, never guessed. */
function isMemoryCap(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === MEDIA_CONVERSION_MEMORY_CAP_CODE
  )
}

function memoryCapFailed() {
  return {
    ok: false,
    reason: fill(UI_TEXT.media.conversionFailed, { reason: 'memory cap' }),
  } as const
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
  const maxOutputBytes = options.limits?.maxUploadBytes ?? MEDIA_CONVERSION_DEFAULT_OUTPUT_BYTES
  const failed = () =>
    ({
      ok: false,
      reason: fill(UI_TEXT.media.conversionFailed, { reason: converter.kind }),
    }) as const
  if (
    !path.isAbsolute(inputPath) ||
    !path.isAbsolute(converter.command) ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0 ||
    maxOutputBytes > MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB ||
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
    const known = await knownVersionCommand(converter, options, options.signal)
    if (!source.ok || !known.ok) return failed()
    const watch = await memoryWatch(options)
    if (watch === undefined) return failed()
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
            '-max_alloc',
            String(MEDIA_CONVERSION_MAX_RSS_BYTES),
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
    // Recheck immediately before encoding: discovery/probing does not grant trust.
    const command = await recheckedCommand(converter, known.path, options)
    if (command === undefined || isAborted(options.signal)) return failed()
    const env = converterEnvironment()
    await encode(
      command,
      args,
      {
        cwd: directory,
        env,
        timeoutMs,
        outputPath: output,
        maxOutputBytes,
        maxRssBytes: MEDIA_CONVERSION_MAX_RSS_BYTES,
        ...(options.signal !== undefined && { signal: options.signal }),
      },
      watch,
      options.run,
    )
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
  } catch (error: unknown) {
    return isMemoryCap(error) ? memoryCapFailed() : failed()
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
}

/**
 * Sound extraction for batch transcription (U18, D85.5): the batch endpoint
 * refuses mp4, mov and mp3 sent as they are, and accepts 16 kHz mono WAV
 * (`MUSE_VOICE_AUDIO_ENCODING`), so the product converts before it sends.
 * ffmpeg renders exactly that (`-vn -ac 1 -ar 16000 -c:a pcm_s16le`, the
 * lead's round-3 command); avconvert cannot express it through its preset
 * interface, so only ffmpeg converts here. Owner-only output, verified by
 * bytes before returning; dispose after upload/discard.
 */
export async function convertToWav16kMono(
  inputPath: string,
  converter: MediaConverter,
  options: MediaConversionOptions = {},
): Promise<WavConversionResult> {
  const timeoutMs = options.timeoutMs ?? SHELL_MAX_TIMEOUT_MS
  const maxOutputBytes = options.limits?.maxUploadBytes ?? MEDIA_CONVERSION_DEFAULT_OUTPUT_BYTES
  const failed = () =>
    ({
      ok: false,
      reason: fill(UI_TEXT.media.conversionFailed, { reason: converter.kind }),
    }) as const
  if (
    !path.isAbsolute(inputPath) ||
    !path.isAbsolute(converter.command) ||
    converter.kind !== 'ffmpeg' ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes <= 0 ||
    maxOutputBytes > MEDIA_MAX_UPLOAD_MIB * BYTES_PER_MIB ||
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
    const known = await knownVersionCommand(converter, options, options.signal)
    if (!source.ok || !known.ok) return failed()
    const watch = await memoryWatch(options)
    if (watch === undefined) return failed()
    const privateDirectory =
      options.createPrivateDirectory === undefined
        ? await mkdtemp(path.join(tmpdir(), 'muse-media-'))
        : await options.createPrivateDirectory()
    if (!path.isAbsolute(privateDirectory)) throw new Error('Invalid private directory')
    directory = privateDirectory
    await chmod(directory, OWNER_DIRECTORY_MODE)
    const output = path.join(directory, 'extracted.wav')
    const reserved = await open(output, 'wx', OWNER_FILE_MODE)
    await reserved.close()
    // Recheck immediately before encoding: discovery/probing does not grant trust.
    const command = await recheckedCommand(converter, known.path, options)
    if (command === undefined || isAborted(options.signal)) return failed()
    const env = converterEnvironment()
    await encode(
      command,
      [
        '-nostdin',
        '-max_alloc',
        String(MEDIA_CONVERSION_MAX_RSS_BYTES),
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-protocol_whitelist',
        'file',
        '-i',
        inputPath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(MUSE_VOICE_SAMPLE_RATE),
        '-c:a',
        'pcm_s16le',
        '-f',
        'wav',
        output,
      ],
      {
        cwd: directory,
        env,
        timeoutMs,
        outputPath: output,
        maxOutputBytes,
        maxRssBytes: MEDIA_CONVERSION_MAX_RSS_BYTES,
        ...(options.signal !== undefined && { signal: options.signal }),
      },
      watch,
      options.run,
    )
    if (isAborted(options.signal)) return failed()
    const stat = await lstat(output)
    if (!stat.isFile()) return failed()
    await chmod(output, OWNER_FILE_MODE)
    const result = await sniffFile(output, stat.size)
    if (!result.ok || result.info.kind !== 'audio' || result.info.mediaType !== 'audio/wav')
      return failed()
    const admitted = checkMediaLimits(result.info, options.limits)
    if (!admitted.ok) return { ok: false, reason: admitted.reason }
    if (isAborted(options.signal)) return failed()
    const ownedDirectory = directory
    const dispose = () => rm(ownedDirectory, { recursive: true, force: true })
    directory = undefined
    return { ok: true, path: output, info: result.info, dispose }
  } catch (error: unknown) {
    return isMemoryCap(error) ? memoryCapFailed() : failed()
  } finally {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  }
}
