// M105 R2. No editor or model dependency: native/ACP hosts supply the trusted
// helper and lifecycle ports; only an interactive entry point may call these.
import path from 'node:path'
import * as z from 'zod/mini'
import {
  MEDIA_MAX_UPLOAD_MIB,
  MEDIA_FILE_ID_MIN_BYTES,
  MILLISECONDS_PER_SECOND,
  PROCESS_TABLE_TIMEOUT_MS,
  SCREEN_RECORDING_RECENT_MAX_AGE_MS,
  SCREEN_RECORDING_REMOVE_ATTEMPTS,
  SCREEN_RECORDING_REMOVE_RETRY_MS,
} from '../../../shared/constants'
import { UI_TEXT, fill } from '../../../shared/l10n/text'
import { mediaInfoSchema, screenRecordingOptionsSchema } from '../../../shared/media'
import type { MediaInfo } from '../../../shared/media'
import type {
  ScreenRecordingDriver,
  ScreenRecordingOptions,
  ScreenRecordingResult,
  ScreenRecordingRun,
} from './driver'

const helperFrame = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('recording') }),
  z.strictObject({ type: z.literal('complete') }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['permission', 'accessDenied', 'unavailable', 'cancelled', 'noRecent', 'limit']),
  }),
])

/** The port must buffer lines/exit until listeners attach, and bound each line. */
export interface WindowsRecorderProcess {
  readonly onLine: (listener: (line: string) => void) => void
  /** Fires after stdout is drained and the helper's file handles are closed. */
  readonly onExit: (listener: (code: number | null) => void) => void
  readonly send: (command: 'stop' | 'cancel') => void
  /** Ends the helper and resolves only after its file handles close. */
  readonly kill: () => Promise<void>
}

export interface WindowsRecorderDeps {
  readonly isLocal: boolean
  /** The host asserts a current user gesture; tools/headless never grant it. */
  readonly isInteractiveUserAction: () => boolean
  readonly prepareHelper: () => Promise<string | undefined>
  /** --probe checks WGC/encoder availability without recording or asking access. */
  readonly probeRecording: (executable: string) => Promise<boolean>
  /** Revalidates the absolute installed helper path immediately before launch. */
  readonly verifyHelper: (executable: string) => Promise<boolean>
  /** Direct spawn, argument array, credential-free environment, no shell. */
  readonly launch: (executable: string, args: readonly string[]) => WindowsRecorderProcess
  /** Reserves a unique, absent absolute path under the host's trusted temp root.
   * The helper atomically creates it with an owner-only Windows DACL. */
  readonly reserveDirectory: () => Promise<string>
  /** Confines deletion to this reserved path; removes only our private copy. */
  readonly removeDirectory: (directory: string) => Promise<void>
  /** M1's bounded byte sniffer, never inferred from the filename/helper output. */
  readonly inspect: (file: string) => Promise<MediaInfo>
  /** Close, dispose or host sleep: unregister returned subscription after exit. */
  readonly onShutdown: (cancel: () => void) => () => void
  readonly maxBytes: number
}

export interface WindowsScreenRecorder extends ScreenRecordingDriver {
  /** Copies the newest recent Snipping Tool mp4 into a private preview.
   * Its original is never deleted, modified, or uploaded by this driver. */
  readonly attachLatest: () => Promise<ScreenRecordingResult>
}

function refused(reason: string): ScreenRecordingRun {
  return {
    result: Promise.resolve({ ok: false, reason }),
    stop: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
  }
}

function unavailable(): string {
  return fill(UI_TEXT.media.recordingUnavailable, { reason: 'Windows.Graphics.Capture' })
}

export function windowsScreenRecorder(deps: WindowsRecorderDeps): WindowsScreenRecorder {
  let active: ScreenRecordingRun | undefined
  const remove = async (directory: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        await deps.removeDirectory(directory)
        return
      } catch (error) {
        if (attempt >= SCREEN_RECORDING_REMOVE_ATTEMPTS) throw error
        await new Promise<void>((resolve) => setTimeout(resolve, SCREEN_RECORDING_REMOVE_RETRY_MS))
      }
    }
  }
  const available: ScreenRecordingDriver['available'] = async () => {
    if (!deps.isLocal) return { ok: false, reason: UI_TEXT.media.recordingRemote }
    try {
      const helper = await deps.prepareHelper()
      return helper !== undefined &&
        path.win32.isAbsolute(helper) &&
        (await deps.verifyHelper(helper)) &&
        (await deps.probeRecording(helper))
        ? { ok: true }
        : { ok: false, reason: unavailable() }
    } catch {
      return { ok: false, reason: unavailable() }
    }
  }

  const begin = async (
    options: ScreenRecordingOptions | undefined,
    onCountdown: (remaining: number) => void,
  ): Promise<ScreenRecordingRun> => {
    if (!deps.isInteractiveUserAction()) return refused(UI_TEXT.media.recordingUserOnly)
    if (!deps.isLocal) return refused(UI_TEXT.media.recordingRemote)
    if (active !== undefined) return refused(unavailable())
    if (
      !Number.isSafeInteger(deps.maxBytes) ||
      deps.maxBytes <= 0 ||
      deps.maxBytes > MEDIA_MAX_UPLOAD_MIB * MEDIA_FILE_ID_MIN_BYTES ||
      (options !== undefined && !screenRecordingOptionsSchema.safeParse(options).success)
    )
      return refused(unavailable())

    // Hold admission across asynchronous preparation: two simultaneous gestures
    // cannot both allocate a helper. This is an explicit refusal, not a fake run.
    const admission = refused(unavailable())
    active = admission
    let directory: string | undefined
    let unsubscribe: (() => void) | undefined
    let cancelChild: (() => void) | undefined
    const state = {
      isCancelled: false,
      isComplete: false,
      hasExited: false,
      hasRequestedStop: false,
    }
    // Cancellation changes in a callback while preparation or inspection waits.
    const isCancelled = () => state.isCancelled
    try {
      unsubscribe = deps.onShutdown(() => {
        state.isCancelled = true
        cancelChild?.()
      })
      if (isCancelled()) throw new Error('shutdown')
      const helper = await deps.prepareHelper()
      if (isCancelled()) throw new Error('shutdown')
      if (helper === undefined || !path.win32.isAbsolute(helper)) throw new Error('helper')
      directory = await deps.reserveDirectory()
      if (isCancelled()) throw new Error('shutdown')
      if (!path.win32.isAbsolute(directory)) throw new Error('directory')
      if (!(await deps.verifyHelper(helper))) throw new Error('trust')
      if (isCancelled()) throw new Error('shutdown')
      if (!deps.isInteractiveUserAction()) throw new Error('interaction expired')
      const unsubscribeShutdown = unsubscribe
      const outputDirectory = directory
      const output = path.win32.join(outputDirectory, 'recording.mp4')
      const args = [
        options === undefined ? '--latest' : '--record',
        outputDirectory,
        String(deps.maxBytes),
        String(process.pid),
        ...(options === undefined
          ? [String(SCREEN_RECORDING_RECENT_MAX_AGE_MS)]
          : [
              String(options.maxSeconds),
              String(options.microphone),
              String(options.systemAudio),
              UI_TEXT.media.recordingStart,
              UI_TEXT.media.recordingStop,
            ]),
      ]
      const child = deps.launch(helper, args)
      let reason = unavailable()
      let countdown: ReturnType<typeof setInterval> | undefined
      let deadline: ReturnType<typeof setTimeout> | undefined
      let remaining = options?.maxSeconds ?? 0
      const exited = new Promise<number | null>((resolve) => {
        child.onExit((code) => {
          state.hasExited = true
          clearInterval(countdown)
          clearTimeout(deadline)
          resolve(code)
        })
      })
      const end = (shouldCancel: boolean) => {
        state.isCancelled ||= shouldCancel
        if (state.hasRequestedStop || state.hasExited) return
        state.hasRequestedStop = true
        deadline = setTimeout(() => {
          state.isCancelled = true
          void child.kill().catch(() => {
            /* The exit port still settles the run. */
          })
        }, PROCESS_TABLE_TIMEOUT_MS)
        try {
          child.send(shouldCancel ? 'cancel' : 'stop')
        } catch {
          state.isCancelled = true
        }
      }
      child.onLine((line) => {
        let value: unknown
        try {
          value = JSON.parse(line)
        } catch {
          end(true)
          return
        }
        const parsed = helperFrame.safeParse(value)
        if (!parsed.success) {
          end(true)
          return
        }
        const frame = parsed.data
        if (frame.type === 'complete') {
          state.isComplete = true
          return
        }
        if (frame.type === 'error') {
          switch (frame.code) {
            case 'accessDenied': {
              reason = UI_TEXT.media.recordingAccessDenied
              break
            }
            case 'permission': {
              reason = UI_TEXT.media.recordingPermissionDenied
              break
            }
            case 'noRecent': {
              reason = UI_TEXT.media.recordingNoRecent
              break
            }
            default: {
              reason = unavailable()
            }
          }
          end(true)
          return
        }
        if (options === undefined || countdown !== undefined) {
          end(true)
          return
        }
        try {
          onCountdown(remaining)
        } catch {
          end(true)
          return
        }
        countdown = setInterval(() => {
          remaining = Math.max(0, remaining - 1)
          try {
            onCountdown(remaining)
          } catch {
            end(true)
          }
          if (remaining === 0) end(false)
        }, MILLISECONDS_PER_SECOND)
      })
      cancelChild = () => {
        end(true)
      }
      if (isCancelled()) end(true)
      let cleanup: Promise<void> | undefined
      // Share in-flight/successful cleanup, but let a later discard retry a
      // failure after a scanner's lock has outlasted the bounded attempts.
      const removePreview = async () => {
        try {
          await remove(outputDirectory)
        } catch (error) {
          cleanup = undefined
          throw error
        }
      }
      const dispose = () => (cleanup ??= removePreview())
      const observe = async (): Promise<ScreenRecordingResult> => {
        try {
          const code = await exited
          if (code !== 0 || isCancelled() || !state.isComplete) return { ok: false, reason }
          const info = mediaInfoSchema.parse(await deps.inspect(output))
          return isCancelled() ||
            info.kind !== 'video' ||
            info.mediaType !== 'video/mp4' ||
            info.sizeBytes <= 0 ||
            info.sizeBytes > deps.maxBytes ||
            info.durationSeconds === null ||
            (options !== undefined &&
              (info.durationSeconds > options.maxSeconds ||
                info.hasSoundtrack !== (options.microphone || options.systemAudio)))
            ? { ok: false, reason: unavailable() }
            : { ok: true, preview: { path: output, info, dispose } }
        } catch {
          return { ok: false, reason: unavailable() }
        }
      }
      const result = (async () => {
        try {
          const outcome = await observe()
          if (!outcome.ok) await dispose()
          return outcome
        } finally {
          clearInterval(countdown)
          clearTimeout(deadline)
          unsubscribeShutdown()
          active = undefined
        }
      })()
      const run: ScreenRecordingRun = {
        result,
        stop: async () => {
          end(false)
          await result
        },
        cancel: async () => {
          end(true)
          const outcome = await result
          if (outcome.ok) await outcome.preview.dispose()
        },
      }
      active = run
      return run
    } catch {
      unsubscribe?.()
      active = undefined
      if (directory !== undefined) await remove(directory)
      return refused(unavailable())
    }
  }
  return {
    available,
    start: begin,
    attachLatest: async () => {
      const run = await begin(undefined, () => {
        throw new Error('latest import cannot record')
      })
      return await run.result
    },
  }
}
