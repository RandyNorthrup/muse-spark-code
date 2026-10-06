// M105 R1: portable macOS driver. The caller owns the interactive entry point,
// preview and upload; M1 supplies inspect and the editor/runtime supplies spawn.
import { Buffer } from 'node:buffer'
import { chmod, lstat, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import * as z from 'zod/mini'
import {
  DICTATION_QUIT_GRACE_MS,
  BYTES_PER_MIB,
  HOOK_FORBIDDEN_ENV_NAMES,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import { fill } from '../../../shared/l10n/text'
import {
  mediaInfoSchema,
  screenRecordingOptionsSchema,
  type MediaInfo,
} from '../../../shared/media'
import type { HelperChild } from '../../voice/dictation'
import type { ScreenRecordingDriver, ScreenRecordingResult } from './driver'

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const SCREEN_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
const MICROPHONE_SETTINGS =
  'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'

type Permission = 'screen' | 'microphone'

function permissionForCode(code: string): Permission | undefined {
  if (code === 'screenPermissionDenied') return 'screen'
  return code === 'microphonePermissionDenied' ? 'microphone' : undefined
}

export interface MacosScreenRecordingDeps {
  readonly platform: NodeJS.Platform
  readonly remoteName?: string
  /** Absolute installed native/darwin/muse-dictate path, never a workspace command. */
  readonly helperPath: string
  readonly tempRoot: string
  readonly environment: NodeJS.ProcessEnv
  readonly fileExists: (file: string) => boolean
  /** Spawn directly with this exact argument array and environment; no shell. */
  readonly spawn: (command: string, args: readonly string[], env: NodeJS.ProcessEnv) => HelperChild
  /** M1's bounded sniffer, injected until its lane is integrated. */
  readonly inspect: (file: string) => Promise<MediaInfo>
  /** Lane W binds these to SCREEN_RECORDING_* tunables in shared/constants. */
  readonly startupTimeoutMs: number
  readonly finishTimeoutMs: number
  readonly maxProtocolChars: number
  /** The editor offers its recovery action; no settings are opened automatically. */
  readonly onPermissionDenied?: (permission: Permission) => void
}

const lineSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('recording') }),
  z.strictObject({ type: z.literal('finished') }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum([
      'screenPermissionDenied',
      'microphonePermissionDenied',
      'unavailable',
      'unsupportedAudio',
      'failed',
      'tooLarge',
      'cancelled',
      'invalidOptions',
    ]),
  }),
])

/** Called only from the recovery action the user chose. */
export async function openMacosRecordingPermissions(
  permission: Permission,
  openExternal: (uri: string) => Promise<void>,
): Promise<void> {
  await openExternal(permission === 'screen' ? SCREEN_SETTINGS : MICROPHONE_SETTINGS)
}

function unavailable(reason: string): ScreenRecordingResult & { readonly ok: false } {
  return { ok: false, reason: fill(UI_TEXT.media.recordingUnavailable, { reason }) }
}

/** No model credential or inherited disclaim marker reaches the helper/converters. */
function childEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(base).filter(([name]) => {
      const upper = name.toUpperCase()
      return (
        !upper.endsWith('_API_KEY') &&
        !HOOK_FORBIDDEN_ENV_NAMES.has(upper) &&
        upper !== 'MUSE_DICTATE_DISCLAIMED'
      )
    }),
  )
}

export function macosScreenRecordingDriver(deps: MacosScreenRecordingDeps): ScreenRecordingDriver {
  const available: ScreenRecordingDriver['available'] = () => {
    if (deps.remoteName !== undefined)
      return Promise.resolve({ ok: false, reason: UI_TEXT.media.recordingRemote })
    return Promise.resolve(
      deps.platform === 'darwin' &&
        path.isAbsolute(deps.helperPath) &&
        deps.fileExists(deps.helperPath)
        ? { ok: true }
        : unavailable('native/darwin/muse-dictate'),
    )
  }
  return {
    available,
    async start(input, onCountdown) {
      const options = screenRecordingOptionsSchema.safeParse(input)
      const ready = await available()
      if (!ready.ok || !options.success) {
        return {
          stop: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          result: Promise.resolve(ready.ok ? unavailable('invalidOptions') : ready),
        }
      }
      const folder = await mkdtemp(path.join(deps.tempRoot, 'muse-screen-'))
      const output = path.join(folder, 'recording.mp4')
      const maxBytes = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
      const dispose = async () => {
        await rm(folder, { recursive: true, force: true })
      }
      let child: HelperChild
      try {
        await chmod(folder, PRIVATE_DIRECTORY_MODE)
        child = deps.spawn(
          deps.helperPath,
          [
            '--record-screen',
            '--output',
            output,
            '--max-seconds',
            String(options.data.maxSeconds),
            '--max-bytes',
            String(maxBytes),
            '--microphone',
            String(options.data.microphone),
            '--system-audio',
            String(options.data.systemAudio),
          ],
          childEnvironment(deps.environment),
        )
      } catch {
        await dispose()
        return {
          stop: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          result: Promise.resolve(unavailable('muse-dictate')),
        }
      }
      let stopRun: () => Promise<void>
      let cancelRun: () => Promise<void>
      // The executor installs the listeners directly; Node 20 has no withResolvers.
      const result = new Promise<ScreenRecordingResult>((settle) => {
        let isDone = false
        let isSettling = false
        let isCancelled = false
        let isRecording = false
        let hasFinished = false
        let isStopping = false
        let failure: string | undefined
        const shouldDiscard = () => isCancelled || failure !== undefined
        let remaining = options.data.maxSeconds
        let tick: ReturnType<typeof setInterval> | undefined
        let killTimer: ReturnType<typeof setTimeout> | undefined
        let watchdog: ReturnType<typeof setTimeout>
        const send = (command: string) => {
          try {
            child.send(command)
          } catch {
            child.kill()
          }
        }
        const terminate = (reason: string) => {
          if (isDone || failure !== undefined) return
          failure = reason
          // The process adapter owes onExit. Bound it even if a broken adapter never calls back.
          killTimer = setTimeout(() => {
            void complete(false)
          }, DICTATION_QUIT_GRACE_MS)
          child.kill()
        }
        const complete = async (hasCleanExit: boolean) => {
          if (isDone || isSettling) return
          isSettling = true
          clearTimeout(watchdog)
          clearTimeout(killTimer)
          clearInterval(tick)
          try {
            if (!hasFinished || !hasCleanExit || shouldDiscard()) {
              await dispose()
              settle(unavailable(failure ?? (isCancelled ? 'cancelled' : 'muse-dictate')))
              return
            }
            const stat = await lstat(output)
            if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) {
              throw new Error('invalid recording file')
            }
            await chmod(output, PRIVATE_FILE_MODE)
            const info = mediaInfoSchema.parse(await deps.inspect(output))
            if (
              shouldDiscard() ||
              info.kind !== 'video' ||
              info.mediaType !== 'video/mp4' ||
              info.sizeBytes !== stat.size ||
              info.durationSeconds === null ||
              info.durationSeconds > options.data.maxSeconds + 2 ||
              info.hasSoundtrack !== (options.data.microphone || options.data.systemAudio)
            ) {
              throw new Error('invalid recording metadata')
            }
            settle({ ok: true, preview: { path: output, info, dispose } })
          } catch {
            try {
              await dispose()
            } finally {
              settle(unavailable('mp4'))
            }
          } finally {
            isDone = true
          }
        }
        const stop = () => {
          if (isDone || isStopping) return Promise.resolve()
          isStopping = true
          clearInterval(tick)
          clearTimeout(watchdog)
          watchdog = setTimeout(() => {
            terminate('muse-dictate')
          }, deps.finishTimeoutMs)
          send('stop')
          return Promise.resolve()
        }
        watchdog = setTimeout(() => {
          terminate('muse-dictate')
        }, deps.startupTimeoutMs)
        let pending = ''
        const decoder = new StringDecoder('utf8')
        child.stdout.on('data', (chunk) => {
          if (isDone || failure !== undefined) return
          pending += typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk))
          if (pending.length > deps.maxProtocolChars) {
            terminate('protocol')
            return
          }
          let newline = pending.indexOf('\n')
          while (newline !== -1) {
            const line = pending.slice(0, newline)
            pending = pending.slice(newline + 1)
            try {
              const frame = lineSchema.parse(JSON.parse(line))
              if (frame.type === 'error') {
                const permission = permissionForCode(frame.code)
                if (permission === undefined) {
                  terminate(frame.code)
                } else {
                  deps.onPermissionDenied?.(permission)
                  terminate(UI_TEXT.media.recordingPermissionDenied)
                }
              } else if (frame.type === 'finished') {
                if (!isRecording || hasFinished) throw new Error('out of order')
                hasFinished = true
                clearInterval(tick)
                clearTimeout(watchdog)
                watchdog = setTimeout(() => {
                  terminate('muse-dictate')
                }, deps.finishTimeoutMs)
              } else {
                if (isRecording || hasFinished) throw new Error('out of order')
                isRecording = true
                if (!isStopping) {
                  clearTimeout(watchdog)
                  onCountdown(remaining)
                  tick = setInterval(() => {
                    remaining -= 1
                    onCountdown(remaining)
                    if (remaining === 0) void stop()
                  }, MILLISECONDS_PER_SECOND)
                  watchdog = setTimeout(() => {
                    remaining = 0
                    onCountdown(remaining)
                    void stop()
                  }, remaining * MILLISECONDS_PER_SECOND)
                }
              }
            } catch {
              terminate('protocol')
            }
            newline = pending.indexOf('\n')
          }
        })
        // Native error codes are fixed; stderr may contain paths/accounts and is never retained.
        child.stderr.on('data', () => {
          /* Deliberately discard private native diagnostics. */
        })
        child.onExit((description) => {
          void complete(description === 'exit code 0' && pending === '' && decoder.end() === '')
        })
        stopRun = stop
        cancelRun = async () => {
          if (isDone) return
          isCancelled = true
          send('cancel')
          terminate('cancelled')
          await result
        }
      })
      return { result, stop: () => stopRun(), cancel: () => cancelRun() }
    },
  }
}
