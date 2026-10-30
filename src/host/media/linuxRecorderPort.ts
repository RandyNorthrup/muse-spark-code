// M105 RLF-RECORDING: the Linux screen recorder's host port. The desktop's
// ScreenCast portal is the only screen source, and its descriptor reaches
// GStreamer through the shipped native helper (muse-portal-record, libc
// only): it speaks the session bus, shows the portal's picker, runs the
// bound gst-launch-1.0 with the descriptor inherited, and supervises it.
// This binds what the driver runs: the helper's trusted path, the fixed
// absolute GStreamer tools probed for the elements the pipeline names, the
// helper's JSON-line protocol, an owner-only recording folder, and M1's
// bounded sniffer. Nothing here records on its own: `--probe` only asks the
// bus whether the portal carries ScreenCast.
import { realpathSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import type { LinuxRecordingPort } from '../../core/media/record/linux'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { posixTrustedPathVerifier } from '../../runtime/trustedPath'
import { runProgram, type RunProgram } from '../processTree'
import type { UiTable } from '../l10n'
import { inspectRecordingFile } from './recordingInspect'
import {
  isRunFailure,
  recordingLineProcess,
  startRecordingHelper,
  type RecordingLineProcess,
} from './recordingHelperProcess'

export interface LinuxRecorderHost {
  /** The extension's folder: the shipped helper is read from under it. */
  readonly extensionPath: string
  /** The host's trusted temp root for the recording folders. */
  readonly tempRoot: string
  readonly arch: string
  readonly environment: NodeJS.ProcessEnv
  /** The remote this window runs on (`vscode.env.remoteName`); undefined on the user's own machine. */
  readonly remoteName: string | undefined
  /** Aborted when the window closes: ends the picker and any run. */
  readonly signal: AbortSignal
  /** The caller's language, installed before the sniffer reads a refusal. */
  readonly l10n: UiTable
  /** The recording's byte bound, read at each start (the person's cap or the helper's own). */
  readonly maxBytes: () => number
  readonly run?: RunProgram
}

/**
GStreamer's fixed homes for the two tools. Never a PATH lookup: the tools
run with the person's session, so only a root-owned (or the person's own)
tree that no one else can write to is trusted.
*/
const GSTREAMER_DIRECTORIES = ['/usr/bin', '/usr/local/bin', '/bin'] as const
const GST_LAUNCH = 'gst-launch-1.0'
const GST_INSPECT = 'gst-inspect-1.0'
const PORTAL_HELPER = 'muse-portal-record'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

/** What the pipeline names: the video chain, and the sound chain only when sound is chosen. */
const VIDEO_ELEMENTS = [
  'pipewiresrc',
  'videoconvert',
  'x264enc',
  'h264parse',
  'queue',
  'mp4mux',
  'filesink',
] as const
const AUDIO_ELEMENTS = ['audiomixer', 'audioconvert', 'audioresample', 'avenc_aac', 'aacparse']

/**
The session the helper and the encoder need, nothing else: the bus, the
runtime directory holding the PipeWire socket, the display, and the
language. No credential, and no GStreamer plugin-path override.
*/
const HELPER_ENVIRONMENT_NAMES = [
  'DBUS_SESSION_BUS_ADDRESS',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'XDG_CURRENT_DESKTOP',
  'WAYLAND_DISPLAY',
  'DISPLAY',
  'PIPEWIRE_RUNTIME_DIR',
  'PIPEWIRE_REMOTE',
  'HOME',
  'LANG',
  'LC_ALL',
] as const

const helperLineSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('sources'),
    fd: z.int().check(z.gte(0)),
    nodeId: z.int().check(z.gt(0)),
  }),
  z.strictObject({ type: z.literal('complete') }),
  z.strictObject({ type: z.literal('closed') }),
  z.strictObject({
    type: z.literal('error'),
    code: z.enum(['permission', 'unavailable', 'failed', 'cancelled', 'revoked']),
  }),
])

/** One protocol line; undefined for anything that is not the helper's protocol. */
function parseHelperLine(line: string): z.infer<typeof helperLineSchema> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error: unknown) {
    // Only malformed text reads absent: anything else is raised, never silence.
    if (error instanceof SyntaxError) return undefined
    throw error
  }
  const result = helperLineSchema.safeParse(parsed)
  return result.success ? result.data : undefined
}

/** The portal's refusal as the error the driver reads, named as DOMException names the same causes. */
const PORTAL_FAILURE_NAMES: Readonly<Record<string, string>> = {
  permission: 'NotAllowedError',
  unavailable: 'NotFoundError',
  cancelled: 'AbortError',
}

function portalFailure(code: string): Error {
  const message = `the screen-cast portal answered ${code}`
  const name = PORTAL_FAILURE_NAMES[code]
  return name === undefined ? new Error(message) : new DOMException(message, name)
}

interface ActiveRun {
  readonly helper: RecordingLineProcess
  readonly encoder: string
  readonly exited: Promise<number | null>
  /** The helper reported the encoder's clean end. */
  hasCompleted: boolean
  /** The portal reported the session closed. */
  hasClosed: boolean
  /** The launch line went out: the run's own result answers for the helper from here. */
  isLaunched: boolean
}

export function createLinuxRecorderPort(host: LinuxRecorderHost): LinuxRecordingPort {
  const run = host.run ?? runProgram
  const trust = posixTrustedPathVerifier(host.extensionPath)
  const helperPath = path.join(host.extensionPath, 'native', 'linux', host.arch, PORTAL_HELPER)
  const environment = noWorkspaceChildEnvironment(
    'linux',
    Object.fromEntries(
      HELPER_ENVIRONMENT_NAMES.flatMap((name) => {
        const value = host.environment[name]
        return value === undefined ? [] : [[name, value]]
      }),
    ),
    realpathSync,
  )
  /** The bound encoder and the helper holding the portal session; one run at a time. */
  let boundEncoder: string | undefined
  let active: ActiveRun | undefined

  const trustedHelper = async (): Promise<string | undefined> => {
    const verdict = await trust.verify(helperPath, { leafKind: 'file' })
    return 'ok' in verdict ? verdict.path : undefined
  }

  return {
    userInitiated: () => true,
    localScreen: () =>
      host.remoteName === undefined &&
      (host.environment['WAYLAND_DISPLAY'] !== undefined ||
        host.environment['DISPLAY'] !== undefined),
    signal: host.signal,
    findEncoder: async (audio) => {
      for (const directory of GSTREAMER_DIRECTORIES) {
        const launch = await trust.verify(path.posix.join(directory, GST_LAUNCH), {
          leafKind: 'file',
        })
        const inspect = await trust.verify(path.posix.join(directory, GST_INSPECT), {
          leafKind: 'file',
        })
        if (!('ok' in launch) || !('ok' in inspect)) continue
        const elements = [
          ...VIDEO_ELEMENTS,
          ...(audio.microphone || audio.systemAudio ? AUDIO_ELEMENTS : []),
        ]
        for (const element of elements) {
          try {
            await run(inspect.path, ['--exists', element], environment)
          } catch (error: unknown) {
            // The tool answered no for this element: this install cannot
            // run the pipeline. Anything else is a bug in the probe.
            if (error instanceof Error && isRunFailure(error.cause)) return
            throw error
          }
        }
        boundEncoder = launch.path
        return launch.path
      }
      return
    },
    hasPortal: async () => {
      const helper = await trustedHelper()
      if (helper === undefined) return false
      try {
        await run(helper, ['--probe'], environment)
        return true
      } catch (error: unknown) {
        // The helper answered no (a failure exit) or could not start: the
        // portal is not there to use. Anything else is a bug in the probe.
        if (error instanceof Error && isRunFailure(error.cause)) return false
        throw error
      }
    },
    openPortal: async (options, signal) => {
      active = undefined
      const encoder = boundEncoder
      const helperFile = await trustedHelper()
      if (encoder === undefined || helperFile === undefined) throw portalFailure('unavailable')
      const helper = recordingLineProcess(
        startRecordingHelper(
          helperFile,
          [
            '--portal',
            '--encoder',
            encoder,
            '--max-bytes',
            String(host.maxBytes()),
            '--max-seconds',
            String(options.maxSeconds),
          ],
          environment,
        ),
      )
      const exited = new Promise<number | null>((resolve) => {
        helper.onExit(resolve)
      })
      const run: ActiveRun = {
        helper,
        encoder,
        exited,
        hasCompleted: false,
        hasClosed: false,
        isLaunched: false,
      }
      // The helper's lines, in order, until the sources arrive or it ends.
      const sources = await new Promise<{ readonly fd: number; readonly nodeId: number }>(
        (resolve, reject) => {
          const cancelPicker = (): void => {
            // The person's cancel reaches the helper, which ends its wait.
            helper.trySend('{"cancel":true}')
          }
          if (signal.aborted) cancelPicker()
          else signal.addEventListener('abort', cancelPicker, { once: true })
          helper.onLine((line) => {
            const frame = parseHelperLine(line)
            switch (frame?.type) {
              case undefined: {
                reject(portalFailure('failed'))
                break
              }
              case 'sources': {
                resolve({ fd: frame.fd, nodeId: frame.nodeId })
                break
              }
              case 'error': {
                reject(portalFailure(frame.code))
                break
              }
              case 'closed': {
                run.hasClosed = true
                break
              }
              case 'complete': {
                run.hasCompleted = true
                break
              }
            }
          })
          void exited.then(() => {
            reject(portalFailure('failed'))
          })
        },
      )
      active = run
      return {
        video: sources,
        // The portal's revocation, or the helper ending before the launch.
        // Once launched, the run's own result answers for the helper's end,
        // and a finished recording never reads as a closed session.
        closed: new Promise<void>((resolve) => {
          void exited.then(() => {
            if (run.hasClosed || !run.isLaunched) resolve()
          })
        }),
        // The helper dies at once; the encoder dies with it (parent-death
        // signal) and the portal closes the session when the bus drops.
        close: async () => {
          await helper.kill()
        },
      }
    },
    createPrivateRecording: async () => {
      await mkdir(host.tempRoot, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
      const directory = await mkdtemp(path.join(host.tempRoot, 'muse-screen-'))
      await chmod(directory, PRIVATE_DIRECTORY_MODE)
      const file = path.join(directory, 'recording.mp4')
      // Owner-only from the first byte: the encoder writes into this file.
      await writeFile(file, '', { flag: 'wx', mode: PRIVATE_FILE_MODE })
      return {
        path: file,
        remove: async () => {
          await rm(directory, { recursive: true, force: true })
        },
      }
    },
    launchVerified: async (request) => {
      const current = active
      const verdict = await trust.verify(request.command, { leafKind: 'file' })
      if (
        current === undefined ||
        !('ok' in verdict) ||
        verdict.path !== current.encoder ||
        request.command !== current.encoder
      )
        throw portalFailure('failed')
      current.helper.send(
        JSON.stringify({
          launch: { command: request.command, args: request.args, output: request.output },
        }),
      )
      current.isLaunched = true
      const cancel = async (): Promise<void> => {
        current.helper.trySend('{"cancel":true}')
        await current.exited
      }
      request.signal.addEventListener(
        'abort',
        () => {
          void cancel()
        },
        { once: true },
      )
      if (request.signal.aborted) void cancel()
      return {
        stop: () => {
          current.helper.trySend('{"stop":true}')
          return Promise.resolve()
        },
        cancel,
        result: (async () => (await current.exited) === 0 && current.hasCompleted)(),
      }
    },
    sniff: (file) => inspectRecordingFile(file, host.l10n),
    // Read at each start: the person's cap can change between recordings.
    get maxBytes() {
      return host.maxBytes()
    },
  }
}
