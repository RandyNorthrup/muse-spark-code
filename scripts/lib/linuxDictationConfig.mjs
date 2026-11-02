// CI/developer build only: the C++ header that gives the Linux dictation
// helper (native/dictation-linux) the same tunables the TypeScript side reads.
// The pins come from src/shared/linuxDictationConstants.ts, the one module
// that holds them, bundled by esbuild because the script runs as plain Node.
import { build as compile } from 'esbuild'
import { Buffer } from 'node:buffer'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '../..')

export async function linuxDictationConfigHeader() {
  const compiled = await compile({
    stdin: {
      contents: "export { LINUX_DICTATION } from './src/shared/linuxDictationConstants.ts'",
      resolveDir: ROOT,
    },
    bundle: true,
    platform: 'node',
    format: 'esm',
    write: false,
  })
  const { LINUX_DICTATION: pin } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`
  )
  return `#pragma once
namespace muse_config {
constexpr unsigned RATE = ${pin.sampleRate};
constexpr unsigned FRAMES_PER_SECOND = ${pin.framesPerSecond};
constexpr unsigned PHRASE_SECONDS = ${pin.phraseSeconds};
constexpr unsigned QUEUE_SECONDS = ${pin.queueSeconds};
constexpr unsigned WAV_SECONDS = ${pin.wavSeconds};
constexpr float SILENCE = ${pin.silenceThreshold}f;
constexpr unsigned THREADS = ${pin.recognizerThreads};
}
`
}
