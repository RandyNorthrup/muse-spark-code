import type { MuseVoiceDeps } from '../../core/voice/museVoice'
// The host side of voice dictation (M9): finds the helper for this platform,
// at activation, so the microphone says at once whether it can record. One
// setup per window; each conversation creates its own driver from it on
// first use. Muse Voice (M35) adds its capture helper, the Linux recorders
// and the WebSocket to Meta. The drivers themselves, with the processes and
// the socket, are dist/voice.js (PLAN.md D6), loaded on the first recording;
// Linux's offline driver and its helper/model acquisition are
// dist/voiceLinux.js, loaded on the first Linux recording.

import { existsSync } from 'node:fs'
import path from 'node:path'
import { env, ExtensionKind, extensions, workspace, window, type Disposable } from 'vscode'
import type { CoreLogger } from '../../core/logging'
import { unlessAborted } from '../../core/timeouts'
import type { DictationSetup } from '../../core/voice/dictation'
import {
  type CaptureProbe,
  type HelperProbe,
  locateCaptureHelper,
  locateDictationHelper,
} from '../../core/voice/helperLocation'
import {
  EXTENSION_QUALIFIED_ID,
  LINUX_DICTATION,
  SETTINGS_SECTION,
  SETTING_DEFAULTS,
  UI_TEXT,
} from '../../shared/constants'
import { fill, formatBytes, uiLocale } from '../../shared/l10n/text'
import { deferredDriver, type VoiceBundle, type VoiceLinuxBundle } from './voiceBundle'

/**
 * The remote this extension host runs on, or undefined on the user's own
 * machine. `env.remoteName` alone is not enough: it is also set in the local
 * extension host of a remote window ("defined in all extension hosts (local
 * and remote) in case a remote extension host exists", vscode.d.ts), where
 * a user's `remote.extensionKind` override could run this extension; the
 * extension's kind says which side it is on.
 */
function remoteHostName(): string | undefined {
  const kind = extensions.getExtension(EXTENSION_QUALIFIED_ID)?.extensionKind
  return kind === ExtensionKind.UI ? undefined : env.remoteName
}

export function createDictationSetup(
  probe: Omit<HelperProbe, 'fileExists' | 'programFiles' | 'remoteName' | 'appName'>,
  log: CoreLogger,
  voice: () => VoiceBundle,
  voiceLinux: () => VoiceLinuxBundle,
  linux?: { readonly storageRoot: string; readonly register: (disposable: Disposable) => void },
): DictationSetup {
  const directory =
    linux === undefined ? undefined : path.join(linux.storageRoot, LINUX_DICTATION.directory)
  const isEnabled = (): boolean =>
    workspace
      .getConfiguration(SETTINGS_SECTION)
      .get<unknown>(LINUX_DICTATION.setting, SETTING_DEFAULTS.linuxDictationModel) === true
  if (directory !== undefined && linux !== undefined && probe.platform === 'linux') {
    const remove = async (): Promise<void> => {
      try {
        await voiceLinux().removeLinuxDictationModel(directory)
      } catch (error: unknown) {
        log.warn('Linux dictation model removal failed')
        // The reason is technical (permissions, a live download lock), so it
        // stays spliced onto the translated sentence (RVCM9LNX P3).
        const reason = error instanceof Error && error.message !== '' ? error.message : 'unknown'
        await window.showErrorMessage(`${UI_TEXT.linuxDictationRemoveFailed}: ${reason}`)
      }
    }
    if (!isEnabled() && existsSync(directory)) void remove()
    linux.register(
      workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration(`${SETTINGS_SECTION}.${LINUX_DICTATION.setting}`) &&
          !isEnabled()
        )
          void remove()
      }),
    )
  }
  if (directory !== undefined && probe.platform === 'linux' && !isEnabled()) {
    // 'Removed' only when nothing is left to remove; otherwise removal was
    // just launched above and its outcome is still unknown (RVCM9LNX P3).
    return {
      isAvailable: false,
      reason: existsSync(directory)
        ? UI_TEXT.linuxDictationRemovalPending
        : UI_TEXT.linuxDictationRemoved,
    }
  }
  const location = locateDictationHelper({
    ...probe,
    arch: process.arch,
    linuxModelPath:
      directory === undefined ? undefined : path.join(directory, LINUX_DICTATION.modelFile),
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: remoteHostName(),
    appName: env.appName,
  })
  if (!location.isAvailable) {
    log.info(`Voice dictation unavailable: ${location.reason}`)
    return location
  }
  return {
    isAvailable: true,
    create: (listener) =>
      deferredDriver(listener, () =>
        directory !== undefined && probe.platform === 'linux'
          ? voiceLinux().createLinuxDictation(
              {
                invocation: location.invocation,
                listener,
                log,
                isEnabled,
                model: {
                  directory,
                  fetch,
                  consent: async (signal) => await canDownloadLinuxModel(directory, signal),
                },
                helper: {
                  directory,
                  fetch,
                  consent: async (signal) => await canDownloadLinuxModel(directory, signal),
                  arch: process.arch,
                },
              },
              UI_TEXT,
              uiLocale(),
            )
          : voice().createDictation(location.invocation, listener, log, UI_TEXT, uiLocale()),
      ),
  }
}

export interface MuseVoiceSetupDeps {
  /** The Model API key, read per recording. */
  readonly apiKey: () => Promise<string | undefined>
  /** Counts reported whole seconds, or local seconds without a final. */
  readonly onSeconds: (seconds: number) => void
  readonly reserveDaily: MuseVoiceDeps['reserveDaily']
  readonly log: CoreLogger
  /** dist/voice.js, required on the first recording. */
  readonly voice: () => VoiceBundle
}

/**
 * Muse Voice (M35, PLAN.md D30): the paid engine's recorder for this
 * platform and the stream to Meta, or why it cannot run here. Whether it is
 * the microphone's engine (the setting, the accepted price, the Model API
 * backend) is the caller's to decide.
 */
export function createMuseVoiceSetup(
  probe: Omit<
    CaptureProbe,
    'fileExists' | 'programFiles' | 'remoteName' | 'appName' | 'pathVariable'
  >,
  deps: MuseVoiceSetupDeps,
): DictationSetup {
  if (typeof globalThis.WebSocket !== 'function') {
    return { isAvailable: false, reason: UI_TEXT.museVoiceNoWebSocket }
  }
  const location = locateCaptureHelper({
    ...probe,
    fileExists: existsSync,
    programFiles: process.env['ProgramFiles'],
    remoteName: remoteHostName(),
    appName: env.appName,
    pathVariable: process.env['PATH'],
  })
  if (!location.isAvailable) {
    deps.log.info(`Muse Voice unavailable: ${location.reason}`)
    return location
  }
  const { voice, ...driverDeps } = deps
  return {
    isAvailable: true,
    create: (listener) =>
      deferredDriver(listener, () =>
        voice().createMuseVoice(
          { ...driverDeps, capture: location },
          listener,
          UI_TEXT,
          uiLocale(),
        ),
      ),
  }
}

async function canDownloadLinuxModel(directory: string, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return false
  const download = { title: UI_TEXT.browserRuntimeDownload }
  const decline = { title: UI_TEXT.browserRuntimeNotNow, isCloseAffordance: true }
  // One card for both downloads (PLAN.md D140): the helper's size is the
  // measured first-download approximation; the pins enforce exact sizes.
  const asked = window.showInformationMessage(
    fill(UI_TEXT.linuxDictationDownloadTitle, {
      helperSize: `~${formatBytes(LINUX_DICTATION.helperDownloadBytes)}`,
      size: formatBytes(LINUX_DICTATION.bytes),
    }),
    { modal: true, detail: fill(UI_TEXT.linuxDictationDownloadDetail, { location: directory }) },
    download,
    decline,
  )
  return (await unlessAborted(Promise.resolve(asked), signal)) === download && !signal.aborted
}
