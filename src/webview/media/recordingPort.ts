// R3 owns MediaRecorder and getDisplayMedia. E3 owns the shared controls and
// preview. Required injection keeps missing capture support an explicit refusal.
export interface BrowserRecordingPreview {
  readonly blob: Blob
  readonly name: string
  readonly dispose: () => void
}

export interface BrowserRecordingRun {
  readonly stop: () => void
  readonly cancel: () => void
  readonly result: Promise<BrowserRecordingPreview>
}

export interface BrowserRecorderPort {
  readonly available: () => { readonly ok: true } | { readonly ok: false; readonly reason: string }
  readonly start: (
    options: {
      readonly maxSeconds: number
      readonly microphone: boolean
      readonly systemAudio: boolean
    },
    countdown: (remainingSeconds: number) => void,
  ) => Promise<BrowserRecordingRun>
}
