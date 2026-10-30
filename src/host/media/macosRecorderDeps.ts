// M105 RLF-RECORDING: the macOS screen recorder's host deps. The signed
// helper app ships with the extension (one thin .app per Mac architecture,
// D209); this binds what the driver runs: the installed path walked by
// StrictModes, the app's own signature read into the requirement the driver
// verifies before each launch, a direct credential-free spawn, and M1's
// bounded sniffer for the finished file. Nothing here records on its own:
// `--probe` only reads authorization status and never asks for access.
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { MacosScreenRecordingDeps } from '../../core/media/record/macos'
import { noWorkspaceChildEnvironment } from '../../core/execGuard'
import { withoutCredentials } from '../../core/credentialEnvironment'
import { runProgram, type RunProgram } from '../processTree'
import { posixTrustedPathVerifier } from '../../runtime/trustedPath'
import {
  SCREEN_RECORDING_LINE_MAX_BYTES,
  darwinDictationHelperSegments,
} from '../../shared/constants'
import type { UiTable } from '../l10n'
import { inspectRecordingFile } from './recordingInspect'
import { recordingHelperChild, startRecordingHelper } from './recordingHelperProcess'

export interface MacosRecorderHost {
  /** The extension's folder: the signed helper app is read from under it. */
  readonly extensionPath: string
  /** The host's trusted temp root for the recording folders. */
  readonly tempRoot: string
  readonly arch: string
  /** The remote this window runs on (`vscode.env.remoteName`); undefined on the user's own machine. */
  readonly remoteName?: string | undefined
  readonly environment: NodeJS.ProcessEnv
  /** The caller's language, installed before the sniffer reads a refusal. */
  readonly l10n: UiTable
  /** The recording's byte bound, read at each start (the person's cap or the helper's own). */
  readonly maxBytes: () => number
  /** The editor's recovery action for a refused permission; nothing opens on its own. */
  readonly onPermissionDenied?: MacosScreenRecordingDeps['onPermissionDenied']
  readonly run?: RunProgram
}

/** `codesign -d -r-` prints the requirement the app's own signature designates. */
const DESIGNATED_REQUIREMENT = /^# designated => (.+)$/mu

/** The helper's path inside the app of this Mac architecture; a name no file holds for another. */
function helperPathFor(extensionPath: string, arch: string): string {
  return path.join(
    extensionPath,
    'native',
    ...(arch === 'arm64' || arch === 'x64'
      ? darwinDictationHelperSegments(arch)
      : ['darwin', `muse-dictate-screen-${arch}.app`, 'Contents', 'MacOS', 'muse-dictate']),
  )
}

export function createMacosRecorderDeps(host: MacosRecorderHost): MacosScreenRecordingDeps {
  const run = host.run ?? runProgram
  const trust = posixTrustedPathVerifier(host.extensionPath)
  const helperPath = helperPathFor(host.extensionPath, host.arch)
  // Fixed absolute commands only: absolute PATH entries, links followed.
  const readEnvironment = noWorkspaceChildEnvironment(
    process.platform,
    withoutCredentials(host.environment),
    realpathSync,
  )
  return {
    platform: process.platform,
    ...(host.remoteName !== undefined && { remoteName: host.remoteName }),
    helperPath,
    tempRoot: host.tempRoot,
    environment: host.environment,
    fileExists: existsSync,
    verifyTrustedHelper: async (file) => {
      const verdict = await trust.verify(file, { leafKind: 'file' })
      if (!('ok' in verdict)) return
      // <app>/Contents/MacOS/muse-dictate: the signature belongs to the app.
      const signaturePath = path.dirname(path.dirname(path.dirname(verdict.path)))
      const printed = await run('/usr/bin/codesign', ['-d', '-r-', signaturePath], readEnvironment)
      const designated = DESIGNATED_REQUIREMENT.exec(printed)?.[1]
      if (designated === undefined) return
      return { path: verdict.path, signaturePath, designatedRequirement: designated }
    },
    spawn: (command, args, env) => recordingHelperChild(startRecordingHelper(command, args, env)),
    inspect: (file) => inspectRecordingFile(file, host.l10n),
    // Read at each start: the person's cap can change between recordings.
    get maxBytes() {
      return host.maxBytes()
    },
    maxProtocolChars: SCREEN_RECORDING_LINE_MAX_BYTES,
    ...(host.onPermissionDenied !== undefined && { onPermissionDenied: host.onPermissionDenied }),
  }
}
