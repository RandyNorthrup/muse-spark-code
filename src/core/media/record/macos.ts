// M105 R1: portable macOS driver. The caller owns the interactive entry point,
// preview and upload; M1 supplies inspect and the editor/runtime supplies spawn.
import path from 'node:path'
import * as z from 'zod/mini'
import { isCredentialVariable } from '../../../shared/credentialEnvironment'
import {
  BYTES_PER_MIB,
  MEDIA_MAX_UPLOAD_DEFAULT_MIB,
  MILLISECONDS_PER_SECOND,
  UI_TEXT,
} from '../../../shared/constants'
import {
  mediaInfoSchema,
  screenRecordingOptionsSchema,
  type MediaInfo,
} from '../../../shared/media'
import type { HelperChild } from '../../voice/dictation'
import type { ScreenRecordingDriver, ScreenRecordingResult } from './driver'
import type { MacosRecordingPermission } from './macosPermissions'
import { type GuardedChildEnv } from '../../executables'
import { noWorkspaceChildEnvironment } from '../../execGuard'
import { Buffer } from 'node:buffer'
import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import { fill } from '../../../shared/l10n/text'
import { realpathSync } from 'node:fs'

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
/** The native helper's own output bound (`maximumBytes` in ScreenRecord.swift). */
export const MACOS_RECORDING_HELPER_MAX_BYTES = MEDIA_MAX_UPLOAD_DEFAULT_MIB * BYTES_PER_MIB
function permissionForCode(code: string): MacosRecordingPermission | undefined {
  if (code === 'screenPermissionDenied') return 'screen'
  return code === 'microphonePermissionDenied' ? 'microphone' : undefined
}

export interface MacosScreenRecordingDeps {
  readonly platform: NodeJS.Platform
  readonly remoteName?: string
  /** Installed screen .app executable, never a workspace command. */
  readonly helperPath: string
  readonly tempRoot: string
  readonly environment: NodeJS.ProcessEnv
  readonly fileExists: (file: string) => boolean
  /** REDM104L3's installed-root/link verifier, bound at integration. Absence refuses.
  The requirement comes from trusted release metadata: expected Team ID and
  designated requirement, or the exact ad-hoc CDHash; never workspace settings.
  */
  readonly verifyTrustedHelper?: (file: string) => Promise<
    | {
        readonly path: string
        readonly signaturePath: string
        readonly designatedRequirement: string
      }
    | undefined
  >
  /**
  Host power-suspend subscription. Unsubscribe when the run settles. Absent
  where the host has no suspend signal (VS Code exposes none): the native
  helper still stops on sleep itself, and the run starts without it.
  */
  readonly onSuspend?: (listener: () => void) => () => void
  /**
  Spawn directly with this exact argument array and environment; no shell.
  The driver hands it only the guarded recorder environment below, so a
  raw environment does not type-check here.
  */
  readonly spawn: (command: string, args: readonly string[], env: GuardedChildEnv) => HelperChild
  /** M1's bounded sniffer, injected until its lane is integrated. */
  readonly inspect: (file: string) => Promise<MediaInfo>
  /**
  The recording file's byte bound: the person's upload cap when set, else
  the helper's own bound. Refused unless a whole number from 1 to the
  helper's bound; D121 keeps no other bound of ours, so a run whose helper
  stops answering waits until the person stops it.
  */
  readonly maxBytes: number
  /** The helper protocol's per-read bound (bytes, never a person's value). */
  readonly maxProtocolChars: number
  /** The editor offers its recovery action; no settings are opened automatically. */
  readonly onPermissionDenied?: (permission: MacosRecordingPermission) => void
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

// Native --probe capture: see the R1 correction receipt; no permission request.
const probeSchema = z.strictObject({
  type: z.literal('available'),
  responsibility: z.enum(['parent', 'helper']),
  screen: z.enum(['authorized', 'notAuthorized']),
  microphone: z.enum(['authorized', 'denied', 'restricted', 'notDetermined']),
  display: z.enum(['available', 'unavailable']),
  encoder: z.enum(['available', 'unavailable']),
})

function unavailable(reason: string): ScreenRecordingResult & { readonly ok: false } {
  return { ok: false, reason: fill(UI_TEXT.media.recordingUnavailable, { reason }) }
}

/**
No credential of any shape, or inherited disclaim marker, reaches the
helper/converters — and the recorder helpers run fixed absolute commands
with the host working directory, never a workspace: absolute PATH entries
only, links followed.
*/
function childEnvironment(base: NodeJS.ProcessEnv): GuardedChildEnv {
  const filtered = Object.fromEntries(
    Object.entries(base).filter(
      ([name]) => !isCredentialVariable(name) && name.toUpperCase() !== 'MUSE_DICTATE_DISCLAIMED',
    ),
  )
  return noWorkspaceChildEnvironment(process.platform, filtered, realpathSync)
}

export function macosScreenRecordingDriver(deps: MacosScreenRecordingDeps): ScreenRecordingDriver {
  // Used for both fixed codesign and the read-only native probe. The read
  // is bounded in bytes, never in time (D121: no timeout of ours); discard
  // diagnostics and refuse malformed/truncated output.
  const readCheck = (command: string, args: readonly string[]): Promise<string | undefined> =>
    new Promise((resolve) => {
      let child: HelperChild
      try {
        child = deps.spawn(command, args, childEnvironment(deps.environment))
      } catch {
        resolve(undefined)
        return
      }
      let isDone = false
      let output = ''
      const decoder = new StringDecoder('utf8')
      const finish = (value: string | undefined) => {
        if (isDone) return
        isDone = true
        resolve(value)
      }
      child.stdout.on('data', (chunk) => {
        if (isDone) return
        output += typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk))
        if (output.length <= deps.maxProtocolChars) return
        finish(undefined)
        child.kill()
      })
      child.stderr.on('data', () => {
        /* Discard signature/native diagnostics. */
      })
      child.onExit((description) => {
        finish(description === 'exit code 0' && decoder.end() === '' ? output : undefined)
      })
    })
  const verifiedPath = async (): Promise<string | undefined> => {
    if (!deps.verifyTrustedHelper) return undefined
    try {
      const verified = await deps.verifyTrustedHelper(deps.helperPath)
      if (
        !verified ||
        !path.isAbsolute(verified.path) ||
        !path.isAbsolute(verified.signaturePath) ||
        path.extname(verified.signaturePath) !== '.app' ||
        verified.path.replaceAll('\\', '/') !==
          path
            .join(verified.signaturePath, 'Contents', 'MacOS', 'muse-dictate')
            .replaceAll('\\', '/') ||
        !verified.designatedRequirement.trim()
      )
        return undefined
      const signature = await readCheck('/usr/bin/codesign', [
        '--verify',
        '--strict',
        '-R',
        `=${verified.designatedRequirement}`,
        verified.signaturePath,
      ])
      return signature === undefined ? undefined : verified.path
    } catch {
      return undefined
    }
  }
  /**
  The public probe never prompts, and permission is the helper's to ask for
  at Start (screen first, then the selected microphone), so a Mac that has
  not been asked yet can still start. Only what no prompt can change
  refuses early: the display, the encoder, and a microphone the system's
  policy restricts.
  */
  const availability = async (
    isMicrophoneSelected: boolean,
  ): ReturnType<ScreenRecordingDriver['available']> => {
    if (deps.remoteName !== undefined) return { ok: false, reason: UI_TEXT.media.recordingRemote }
    if (
      deps.platform !== 'darwin' ||
      !path.isAbsolute(deps.helperPath) ||
      !deps.fileExists(deps.helperPath)
    )
      // Names the architecture's own signed .app the package ships: the
      // last .app on the path, since an ancestor folder can end in .app too
      // (a sandboxed temp root, an installed host).
      return unavailable(
        `native/darwin/${deps.helperPath.split(/[\\/]/u).findLast((part) => part.endsWith('.app')) ?? path.basename(deps.helperPath)}`,
      )
    const helper = await verifiedPath()
    if (!helper) return unavailable('helperIntegrity')
    const output = await readCheck(helper, ['--record-screen', '--probe'])
    try {
      const probe = probeSchema.parse(JSON.parse(output ?? ''))
      if (isMicrophoneSelected && probe.microphone === 'restricted')
        return unavailable(UI_TEXT.media.recordingMicrophonePermissionRestricted)
      if (probe.display !== 'available' || probe.encoder !== 'available')
        return unavailable(probe.display === 'available' ? 'encoder' : 'display')
      return { ok: true }
    } catch {
      return unavailable('probe')
    }
  }
  const available: ScreenRecordingDriver['available'] = () => availability(false)
  return {
    available,
    async start(input, onCountdown) {
      const options = screenRecordingOptionsSchema.safeParse(input)
      if (
        !options.success ||
        !Number.isSafeInteger(deps.maxBytes) ||
        deps.maxBytes <= 0 ||
        deps.maxBytes > MACOS_RECORDING_HELPER_MAX_BYTES
      ) {
        return {
          stop: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          result: Promise.resolve(unavailable('invalidOptions')),
        }
      }
      const ready = await availability(options.data.microphone)
      if (!ready.ok) {
        return {
          stop: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          result: Promise.resolve(ready),
        }
      }
      // Reverify immediately before recording: availability's probe is a separate launch.
      const helperPath = await verifiedPath()
      if (!helperPath) {
        return {
          stop: () => Promise.resolve(),
          cancel: () => Promise.resolve(),
          result: Promise.resolve(unavailable('helperIntegrity')),
        }
      }
      const subscribeSuspend = deps.onSuspend
      const maxBytes = deps.maxBytes
      await mkdir(deps.tempRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      const folder = await mkdtemp(path.join(deps.tempRoot, 'muse-screen-'))
      const output = path.join(folder, 'recording.mp4')
      const dispose = async () => {
        await rm(folder, { recursive: true, force: true })
      }
      let child: HelperChild
      try {
        await chmod(folder, PRIVATE_DIRECTORY_MODE)
        child = deps.spawn(
          helperPath,
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
        let hasExited = false
        let isStopping = false
        let failure: string | undefined
        const shouldDiscard = () => isCancelled || failure !== undefined
        let remaining = options.data.maxSeconds
        let tick: ReturnType<typeof setInterval> | undefined
        const endHelper = () => {
          try {
            child.kill()
          } catch {
            // Already exited: nothing to end.
          }
        }
        const send = (command: string) => {
          try {
            child.send(command)
          } catch {
            // The command channel is dead: ending the helper still delivers
            // onExit, which settles the run.
            endHelper()
          }
        }
        // A failed run asks the helper to cancel and waits for its exit,
        // which settles the run. D121: no watchdog of ours stops the work;
        // only the person's cancel ends a helper that never answers.
        const fail = (reason: string) => {
          if (isDone || failure !== undefined) return
          failure = reason
          send('cancel')
        }
        const complete = async (hasCleanExit: boolean) => {
          if (isDone || isSettling) return
          isSettling = true
          clearInterval(tick)
          unsubscribeSuspend()
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
              (options.data.maxSeconds > 0 && info.durationSeconds > options.data.maxSeconds + 2) ||
              info.hasSoundtrack !== (options.data.microphone || options.data.systemAudio)
            ) {
              throw new Error('invalid recording metadata')
            }
            settle({ ok: true, preview: { path: output, info, dispose } })
          } catch {
            // An unverifiable recording delivers nothing: dispose and settle
            // the mp4 refusal together, however disposal ends.
            try {
              await dispose()
            } finally {
              settle(unavailable('mp4'))
            }
          } finally {
            isDone = true
          }
        }
        // Asks the helper once, then waits for its own exit: finishing a
        // recording takes as long as it takes (D121, no deadline).
        const stop = () => {
          if (isDone || isStopping) return Promise.resolve()
          isStopping = true
          clearInterval(tick)
          send('stop')
          return Promise.resolve()
        }
        const unsubscribeSuspend =
          subscribeSuspend === undefined
            ? () => {
                // No host suspend signal: nothing subscribed.
              }
            : subscribeSuspend(() => void stop())
        let pending = ''
        const decoder = new StringDecoder('utf8')
        child.stdout.on('data', (chunk) => {
          if (isDone || failure !== undefined) return
          pending += typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk))
          if (pending.length > deps.maxProtocolChars) {
            fail('protocol')
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
                  fail(frame.code)
                } else {
                  deps.onPermissionDenied?.(permission)
                  fail(
                    permission === 'screen'
                      ? UI_TEXT.media.recordingScreenPermissionRequired
                      : UI_TEXT.media.recordingMicrophonePermissionDenied,
                  )
                }
              } else if (frame.type === 'finished') {
                if (!isRecording || hasFinished) throw new Error('out of order')
                hasFinished = true
                clearInterval(tick)
              } else {
                if (isRecording || hasFinished) throw new Error('out of order')
                isRecording = true
                if (!isStopping) {
                  // D121: maxSeconds 0 records until stopped — the tick then
                  // reports seconds recorded and nothing ends the run
                  // automatically; any other length is the person's own.
                  const isUncapped = options.data.maxSeconds === 0
                  let elapsed = options.data.maxSeconds - remaining
                  onCountdown(isUncapped ? elapsed : remaining)
                  tick = setInterval(() => {
                    if (isUncapped) {
                      elapsed += 1
                      onCountdown(elapsed)
                      return
                    }
                    remaining -= 1
                    onCountdown(remaining)
                    if (remaining === 0) void stop()
                  }, MILLISECONDS_PER_SECOND)
                }
              }
            } catch {
              // A malformed frame fails the run; the helper's exit settles it.
              fail('protocol')
            }
            newline = pending.indexOf('\n')
          }
        })
        // Native error codes are fixed; stderr may contain paths/accounts and is never retained.
        child.stderr.on('data', () => {
          /* Deliberately discard private native diagnostics. */
        })
        child.onExit((description) => {
          hasExited = true
          void complete(description === 'exit code 0' && pending === '' && decoder.end() === '')
        })
        stopRun = stop
        cancelRun = async () => {
          if (isDone) return
          isCancelled = true
          // The person's cancel: a helper already asked to stop that is
          // still running is ended at once; otherwise it is asked to
          // cancel and its exit settles the run.
          if (isStopping && !hasExited) endHelper()
          else send('cancel')
          await result
        }
      })
      return { result, stop: () => stopRun(), cancel: () => cancelRun() }
    },
  }
}
