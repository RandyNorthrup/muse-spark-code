import { describe, expect, it } from 'vitest'
import { linuxDictationConfigHeader } from '../../scripts/lib/linuxDictationConfig.mjs'
import { LINUX_DICTATION } from '../../src/shared/linuxDictationConstants'

// CI's "compile native helpers (linux x64)" job failed on the first run of
// int/recovery because the build script still imported LINUX_DICTATION from
// constants.ts after it had moved. The header is the script's one step that
// needs no compiler or download, so it runs on every OS here.
describe('the Linux dictation helper header', () => {
  it('carries the tunables the extension reads, from the module that holds them', async () => {
    const header = await linuxDictationConfigHeader()
    const values = Object.fromEntries(
      header
        .matchAll(/^constexpr (?:unsigned|float) (\w+) = ([\d.]+)f?;$/gm)
        .map((match) => [match[1], Number(match[2])]),
    )
    expect(values).toEqual({
      RATE: LINUX_DICTATION.sampleRate,
      FRAMES_PER_SECOND: LINUX_DICTATION.framesPerSecond,
      PHRASE_SECONDS: LINUX_DICTATION.phraseSeconds,
      QUEUE_SECONDS: LINUX_DICTATION.queueSeconds,
      WAV_SECONDS: LINUX_DICTATION.wavSeconds,
      SILENCE: LINUX_DICTATION.silenceThreshold,
      THREADS: LINUX_DICTATION.recognizerThreads,
    })
  })
})
