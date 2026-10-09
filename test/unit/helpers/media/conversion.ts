// Test-only conversion options for the transcription adapters: a verifier
// that admits the given path as canonical, a zero RSS reading, a release
// banner, and on Windows the owner-only directory the host would create
// (chmod cannot). No real converter binary is ever touched.
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { MediaConversionOptions } from '../../../../src/core/media/convert'

export function fakeConversionOptions(run?: MediaConversionOptions['run']): MediaConversionOptions {
  return {
    trustedPath: { verify: (file: string) => Promise.resolve({ ok: true as const, path: file }) },
    readRssBytes: () => Promise.resolve(0),
    ...(process.platform === 'win32' && {
      createPrivateDirectory: () => mkdtemp(path.join(tmpdir(), 'm105-private-fake-')),
    }),
    probeVersion: () =>
      Promise.resolve('ffmpeg version 7.0-test Copyright (c) 2025 the FFmpeg developers'),
    ...(run !== undefined && { run }),
  }
}
