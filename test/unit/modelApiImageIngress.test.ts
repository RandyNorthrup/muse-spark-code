import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest'
import { build } from 'esbuild'
import { mkdtemp, readFile } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import * as z from 'zod/mini'
import * as raster from '../../src/core/imageResize'
import { readImageInfo } from '../../src/core/imageDimensions'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { CONSERVATIVE_CAPABILITIES } from '../../src/core/providers/capabilities'
import { CODEC_IMAGE_WITHOUT_VISION } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeModelApi, fakeModelApiClient } from './helpers/fakeModelApi'
import { memoryToolIo } from './helpers/fakeToolIo'
import { fakeModelApiHostDeps } from './helpers/modelApiHostDeps'
import { startWatchedSession } from './helpers/sessionTurns'
import { removeFolder } from './helpers/temporaryFolders'

const fixture = { folder: '', bytes: Buffer.alloc(0) }
const actualResize = raster.resizeImage
beforeAll(async () => {
  fixture.folder = await mkdtemp(path.join(tmpdir(), 'm101-image-ingress-'))
  await build({
    entryPoints: ['src/core/imageResizeWorker.ts'],
    outfile: path.join(fixture.folder, 'worker.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
  })
  fixture.bytes = await readFile('test/fixtures/image-resize/landscape.png')
})
afterEach(() => vi.restoreAllMocks())
afterAll(() => removeFolder(fixture.folder))
const partsSchema = z.object({
  input: z.array(
    z.looseObject({
      type: z.string(),
      content: z.optional(
        z.array(
          z.object({
            type: z.string(),
            image_url: z.optional(z.string()),
            text: z.optional(z.string()),
          }),
        ),
      ),
    }),
  ),
})

it.each([true, false])(
  'applies the selected vision/limits once before attachment and read_file replay (%s)',
  async (vision) => {
    const resize = vi
      .spyOn(raster, 'resizeImage')
      .mockImplementation((input, limits, signal) =>
        actualResize(input, limits, signal, path.join(fixture.folder, 'worker.cjs')),
      )
    const api = fakeModelApi()
    const log = new FakeLogOutputChannel()
    const io = memoryToolIo({}, '/ws')
    io.binaries.set('/ws/image.png', fixture.bytes)
    const client = fakeModelApiClient(api, log)
    const host = new ModelApiHost({
      ...fakeModelApiHostDeps({ client, io, workspaceRoot: '/ws', log }),
      modelFacts: () => ({
        capabilities: {
          ...CONSERVATIVE_CAPABILITIES,
          vision,
          imageLimits: { maxWidth: 80, maxHeight: 60 },
        },
        quirks: { cachedUsageFields: [] },
      }),
    })
    const h = await startWatchedSession(host, '/ws', 'allowAll')
    try {
      api.script(
        { calls: [{ name: 'read_file', arguments: '{"path":"image.png"}', callId: 'image' }] },
        { text: 'done' },
      )
      await h.session.sendTurn([
        {
          type: 'image',
          base64Data: fixture.bytes.toString('base64'),
          mediaType: 'image/png',
          width: 320,
          height: 160,
        },
      ])
      await h.turnDone()
      api.script({ text: 'again' })
      await h.session.sendTurn([{ type: 'text', text: 'continue' }])
      await h.turnDone()
      expect(resize).toHaveBeenCalledTimes(vision ? 2 : 0)
      const content = partsSchema
        .parse(api.responseBodies()[2])
        .input.flatMap((item) => item.content ?? [])
      const images = content.filter((part) => part.type === 'input_image')
      expect(images).toHaveLength(vision ? 2 : 0)
      for (const image of images) {
        const data = image.image_url?.split(',', 2)[1]
        expect(data).toBeDefined()
        expect(readImageInfo(Buffer.from(data ?? '', 'base64'))).toMatchObject({
          width: 80,
          height: 40,
        })
      }
      if (!vision)
        expect(content.filter((part) => part.text === CODEC_IMAGE_WITHOUT_VISION)).toHaveLength(2)
    } finally {
      await host.close()
    }
  },
)
