// U18: the product converts to 16 kHz mono WAV before the batch send. Only
// the real-converter rendering is proven here, through the product's own
// discovery and conversion against the machine's ffmpeg; the batch send
// itself is unproven without a live key (docs/real-life/unproven.md).
import { describe, expect, it } from 'vitest'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { convertToWav16kMono, locateMediaConverter } from '../../src/core/media/convert'
import {
  MEDIA_CONVERTER_INSTALL_PATHS,
  MEDIA_CONVERTER_WINDOWS_INSTALLS,
} from '../../src/shared/constants'
import { readWavFormat } from '../../src/core/media/sniff/riff'

const MP3_FIXTURE = 'test/fixtures/voice/tone-2s.mp3'
const execFileAsync = promisify(execFile)

function documentedInstalls(): readonly string[] {
  switch (process.platform) {
    case 'darwin': {
      return MEDIA_CONVERTER_INSTALL_PATHS.darwin
    }
    case 'win32': {
      // Resolved from the environment, as the product resolves them.
      return MEDIA_CONVERTER_WINDOWS_INSTALLS.flatMap(({ variable, segments }) => {
        const root = Object.entries(process.env).find(([name]) => name.toUpperCase() === variable)
        return root?.[1] === undefined ? [] : [path.win32.join(root[1], ...segments)]
      })
    }
    default: {
      return MEDIA_CONVERTER_INSTALL_PATHS.linux
    }
  }
}

/** The product's own discovery rule: documented installs that are real files. */
async function verifyDocumentedInstall(
  file: string,
  _options: { readonly leafKind: 'file' },
): Promise<
  | { readonly ok: true; readonly path: string }
  | { readonly refused: true; readonly component: string; readonly reason: string }
> {
  if (!documentedInstalls().includes(file))
    return { refused: true, component: file, reason: 'not a documented converter install' }
  try {
    const entry = await stat(file)
    if (entry.isFile()) return { ok: true, path: file }
  } catch {
    // Missing below: documented but absent.
  }
  return { refused: true, component: file, reason: 'documented path is not a file' }
}

describe('U18 WAV conversion with the real converter', () => {
  it('renders 16 kHz mono WAV through the real ffmpeg', async () => {
    // The binary is found the way the product finds it: the documented
    // installs, a real file check, and a real version probe. When no
    // converter is on the machine the test skips with a printed reason.
    const located = await locateMediaConverter({ trustedPath: { verify: verifyDocumentedInstall } })
    if (!located.ok) {
      console.warn(`real-ffmpeg test skipped: ${located.reason}`)
      return
    }
    // The rig's sandbox denies file watches (EMFILE), which the default
    // supervisor treats as a kill signal, so this test supervises the real
    // encoder with a plain bounded spawn: the product's ffmpeg arguments and
    // output bytes are what it pins, not the watch boundary (M1's territory).
    const rendered = await convertToWav16kMono(path.resolve(MP3_FIXTURE), located.converter, {
      trustedPath: { verify: verifyDocumentedInstall },
      readRssBytes: () => Promise.resolve(0),
      run: async (command, args, runOptions): Promise<void> => {
        await execFileAsync(command, [...args], { cwd: runOptions.cwd })
      },
    })
    if (!rendered.ok) throw new Error(`conversion failed: ${rendered.reason}`)
    try {
      expect(rendered.info.mediaType).toBe('audio/wav')
      expect(rendered.info.durationSeconds).toBeCloseTo(2, 1)
      const bytes = await readFile(rendered.path)
      expect(bytes.subarray(0, 4).toString('latin1')).toBe('RIFF')
      expect(
        readWavFormat(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
      ).toMatchObject({ format: 1, channels: 1, sampleRate: 16_000, bitsPerSample: 16 })
    } finally {
      await rendered.dispose()
    }
  })
})
