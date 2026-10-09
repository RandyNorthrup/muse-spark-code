// M105 lane V, seam 5: the runtime's ACP and exec media port. `/attach` and
// `exec --attach` reach AcpMedia's confinement and the captured record's
// gate; what it admits binds to the runtime's attached-media registry
// (video and audio) or the established inline parts (images, PDFs).
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { runtimeMediaPort, type RuntimeMediaPortDeps } from '../../src/acp/mediaPort'
import type { AcpMediaContext } from '../../src/acp/media'
import { AttachedMedia } from '../../src/core/media/attachedMedia'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { videoFixture, wavFixture } from './helpers/media/fixtures'

const signal = new AbortController().signal
const CONTRIBUTOR = 'muse-spark-1.3-contributor'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg==',
  'base64',
)

/** A confined workspace of one file, read as the runtime's tool IO reads it. */
function port(
  bytes: Uint8Array,
  options: { readonly modelId?: string; readonly transcribes?: boolean } = {},
) {
  const attached = new AttachedMedia()
  const info = sniffMediaBytes(bytes)
  const chunk = Promise.resolve(bytes)
  const readMedia = vi.fn((_absolute: string) =>
    Promise.resolve(
      info === undefined
        ? { kind: 'other' as const, reason: 'not media', isPdf: false }
        : {
            info,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            source: {
              name: 'file',
              mime: info.mediaType,
              bytes: bytes.length,
              open: async function* () {
                yield await chunk
              },
            },
          },
    ),
  )
  const deps: RuntimeMediaPortDeps = {
    platform: 'linux',
    io: {
      realPath: (given) => Promise.resolve(given),
      readMedia,
      readBytes: () => Promise.resolve(bytes),
    },
    attached,
    newToken: () => 'token-1',
    transcribesSound: () => options.transcribes === true,
  }
  const context: AcpMediaContext = {
    cwd: '/ws',
    sessionId: 'session',
    backend: 'modelApi',
    modelId: () => options.modelId ?? CONTRIBUTOR,
    interactive: true,
  }
  return { media: runtimeMediaPort(context, deps), attached }
}

describe('the runtime media port (M105 lane V seam 5)', () => {
  it('registers an attached video with the runtime registry, path kept for the converter', async () => {
    const bytes = videoFixture({ soundtrack: false })
    const p = port(bytes)
    const attachment = await p.media.attach('clip.mp4', signal)
    expect(attachment.part).toMatchObject({ type: 'media', token: 'token-1', name: 'clip.mp4' })
    const record = p.attached.resolve(attachment.part)
    expect(record).toMatchObject({ name: 'clip.mp4', info: { kind: 'video' } })
    expect(await p.attached.path('token-1')).toBe('/ws/clip.mp4')
    if (record === undefined) throw new Error('expected a record')
    const stream = p.attached.source(record)?.open(signal) ?? []
    const read = await Array.fromAsync(stream)
    expect(Buffer.concat(read).equals(Buffer.from(bytes))).toBe(true)
  })

  it('refuses video on a model with no captured record, with the gate reason', async () => {
    const p = port(videoFixture({ soundtrack: false }), { modelId: 'muse-spark-1.3' })
    await expect(p.media.attach('clip.mp4', signal)).rejects.toThrow(
      fill(UI_TEXT.media.videoUnknown, { model: 'muse-spark-1.3' }),
    )
  })

  it('admits audio only where the agent transcribes it', async () => {
    await expect(port(wavFixture()).media.attach('note.wav', signal)).rejects.toThrow(
      fill(UI_TEXT.media.audioUnsupported, { model: CONTRIBUTOR }),
    )
    const p = port(wavFixture(), { transcribes: true })
    const attachment = await p.media.attach('note.wav', signal)
    expect(attachment.part).toMatchObject({ type: 'media', info: { kind: 'audio' } })
    expect(p.attached.audio(attachment.part)).toMatchObject({ name: 'note.wav' })
  })

  it('keeps an attached image as its established inline part', async () => {
    const p = port(new Uint8Array(PNG))
    const attachment = await p.media.attach('tile.png', signal)
    expect(attachment.part).toEqual({
      type: 'image',
      base64Data: PNG.toString('base64'),
      mediaType: 'image/png',
      width: 1,
      height: 1,
    })
  })
})
