import { describe, expect, it, vi } from 'vitest'
import {
  executeTool,
  toolDefinitions,
  type ReadMediaFile,
  type ToolContext,
} from '../../src/core/backends/modelapi/tools'
import { UI_TEXT } from '../../src/shared/constants'
import { memoryToolIo } from './helpers/fakeToolIo'
import { sniffMediaBytes } from '../../src/core/media/limits'
import { videoFixture, mp3Fixture, wavFixture } from './helpers/media/fixtures'

function harness(bytes = videoFixture()) {
  const info = sniffMediaBytes(bytes)
  if (info === undefined) throw new Error('bad fixture')
  const chunk = Promise.resolve(bytes)
  const file: ReadMediaFile = {
    info,
    sha256: 'a'.repeat(64),
    source: {
      name: 'clip.mp4',
      mime: info.mediaType,
      bytes: bytes.length,
      open: async function* () {
        yield await chunk
      },
    },
  }
  const io = memoryToolIo({}, '/ws')
  const readMedia = vi.fn(() => Promise.resolve(file))
  const prepare = vi.fn(() =>
    Promise.resolve({
      fileId: 'file-test',
      provider: 'meta',
      expiresAt: 2_000_000_000,
      sha256: file.sha256,
      bytes: bytes.length,
      name: 'clip.mp4',
      mime: info.mediaType,
    }),
  )
  const ctx: ToolContext = {
    workspaceRoot: '/ws',
    platform: 'linux',
    io: { ...io, readMedia },
    media: { prepare },
    seen: new Map(),
  }
  return {
    ctx,
    readMedia,
    prepare,
    file,
    run: (given = 'clip.mp4') => executeTool('read_file', JSON.stringify({ path: given }), ctx),
  }
}

describe('media read_file', () => {
  it('never registers a screen-recording tool', () => {
    expect(
      toolDefinitions('linux')
        .map((tool) => tool.name)
        .filter((name) => /record/iu.test(name)),
    ).toEqual([])
  })
  it('returns file-id and media metadata without bytes for mp4, mp3 and wav', async () => {
    for (const [name, bytes] of [
      ['clip.mp4', videoFixture()],
      ['voice.mp3', mp3Fixture()],
      ['voice.wav', wavFixture()],
    ] as const) {
      const h = harness(bytes)
      const outcome = await h.run(name)
      expect(outcome.failureReason).toBeUndefined()
      expect(outcome.mediaFile).toMatchObject({
        info: { mediaType: h.file.info.mediaType },
        file: { fileId: 'file-test' },
      })
      expect(h.readMedia).toHaveBeenCalledWith(
        `/ws/${name}`,
        expect.any(Number),
        `/ws/${name}`,
        undefined,
      )
      expect(JSON.stringify(outcome)).not.toContain(Buffer.from(bytes).toString('base64'))
      expect(outcome.touched).toMatchObject({ complete: true, names: [name, name] })
    }
  })

  it('refuses missing bindings, policy-denied paths and escapes before upload', async () => {
    const h = harness()
    const { media: _media, ...withoutMedia } = h.ctx
    const missing = await executeTool('read_file', '{"path":"clip.mp4"}', withoutMedia)
    expect(missing.failureReason).toBe(UI_TEXT.media.uploadStorageUnknown)
    const denied = await executeTool('read_file', '{"path":"clip.mp4"}', {
      ...h.ctx,
      files: { denyGlobs: [], extraRoots: [], isDenyAll: true, isDenied: () => true },
    })
    expect(denied.failureReason).toBeDefined()
    const escaped = await h.run('../clip.mp4')
    expect(escaped.failureReason).toBeDefined()
    expect(h.readMedia).not.toHaveBeenCalled()
    expect(h.prepare).not.toHaveBeenCalled()
  })

  it('enforces selected-model/budget refusals and verifies returned upload metadata', async () => {
    const h = harness()
    h.prepare
      .mockRejectedValueOnce(new Error('unknown modality'))
      .mockRejectedValueOnce(new Error('media budget reached'))
    const unknown = await h.run()
    expect(unknown.failureReason).toBe('unknown modality')
    const overBudget = await h.run()
    expect(overBudget.failureReason).toBe('media budget reached')
    const uploaded = await h.prepare()
    h.prepare.mockResolvedValueOnce({ ...uploaded, sha256: 'b'.repeat(64) })
    const mismatch = await h.run()
    expect(mismatch.failureReason).toContain('changed since upload')
  })

  it('keeps cancellation on the host stop path', async () => {
    const h = harness()
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeTool('read_file', '{"path":"clip.mp4"}', { ...h.ctx, signal: controller.signal }),
    ).rejects.toThrow()
    expect(h.prepare).not.toHaveBeenCalled()
  })
})
