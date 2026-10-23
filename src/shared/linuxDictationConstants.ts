// Linux's offline dictation tunables (M9, PLAN.md D140). This module imports
// nothing: the dictation bundle (dist/dictation.js) and Linux's driver
// bundle (dist/voiceLinux.js) read it directly, without the rest of
// constants.ts, so activation does not carry it (the lane-K budget test),
// and every other module reads it from here too.
//
// Only Linux uses this offline English engine; model bytes stay out of
// packages.
export const LINUX_DICTATION = {
  directory: 'dictation-linux',
  modelFile: 'ggml-tiny.en.bin',
  partialFile: 'ggml-tiny.en.partial',
  lockDirectory: '.download-lock',
  bytes: 77_704_715,
  sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/c521a4b02f422512d734391fdf08bb08c0862f68/ggml-tiny.en.bin',
  timeoutMs: 900_000,
  redirectLimit: 5,
  statusOk: 200,
  statusPartial: 206,
  redirects: [301, 302, 303, 307, 308],
  directoryMode: 0o700,
  fileMode: 0o600,
  helperMode: 0o700,
  setting: 'linuxDictationModel',
  helperBinary: 'muse-dictate',
  // Approximate first-download bytes shown on the consent card (measured
  // five-file x64 inventory, 2026-10-10; arm64 is similar). The pins
  // enforce the exact per-file sizes at download; this is display only.
  // The CPU backend variants are not in this number yet: re-measure it
  // from the staged release helpers before publishing (PLAN.md D140).
  helperDownloadBytes: 7_623_768,
  sampleRate: 16_000,
  framesPerSecond: 5,
  phraseSeconds: 10,
  queueSeconds: 30,
  wavSeconds: 60,
  silenceThreshold: 0.004,
  recognizerThreads: 3,
  stopGraceMs: 30_000,
  libraries: ['libwhisper.so.1', 'libggml.so', 'libggml-base.so'],
  baseline: { x64: 'libggml-cpu-x64.so', arm64: 'libggml-cpu-armv8.0_1.so' },
  environment: { LD_PRELOAD: '', LD_LIBRARY_PATH: '', LD_AUDIT: '', GGML_BACKEND_PATH: '' },
  // Audio-server selectors the Linux helper must never inherit (RVCM9LNX
  // P2): a network choice here would move capture to TCP. The launcher
  // deletes them; the helper refuses a non-local server itself.
  audioServerVariables: [
    'PULSE_SERVER',
    'PULSE_SINK',
    'PULSE_SOURCE',
    'PIPEWIRE_REMOTE',
    'PIPEWIRE_CORE',
  ],
} as const
