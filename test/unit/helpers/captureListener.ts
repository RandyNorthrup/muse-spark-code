// A dictation listener that records what a capture helper hands it (M35):
// statuses, errors, audio and stops. Shared by the driver's and the Linux
// recorder's tests.

import type { CoreLogger } from '../../../src/core/logging'
import type { DictationListener, DictationStatus } from '../../../src/core/voice/dictation'

export const SILENT_LOG: CoreLogger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

export function captureListener() {
  const statuses: DictationStatus[] = []
  const errors: string[] = []
  const audio: number[][] = []
  let stopped = 0
  const listener: DictationListener = {
    onStatus: (status) => {
      statuses.push(status)
    },
    onText: () => undefined,
    onError: (reason) => {
      errors.push(reason)
    },
    onAudio: (pcm) => {
      audio.push([...pcm])
    },
    onStopped: () => {
      stopped += 1
    },
  }
  return { listener, statuses, errors, audio, stopped: () => stopped }
}
