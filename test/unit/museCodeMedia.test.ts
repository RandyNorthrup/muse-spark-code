import { describe, expect, it } from 'vitest'
import { MuseCodeHost } from '../../src/core/backends/musecode/MuseCodeHost'
import { UI_TEXT } from '../../src/shared/constants'
import { FakeLogOutputChannel } from './helpers/fakes'
import { fakeInitializeResult, fakeMspHost } from './helpers/fakeMsp'
import { describeTool } from '../../src/webview/toolPresentation'

async function setup() {
  const handle = fakeMspHost(fakeInitializeResult)
  handle.server.handle('session/start', () => ({
    session: { sessionId: 'session-1', modelId: 'muse-spark-1.3', status: 'idle' },
    viewCursor: '',
  }))
  const host = new MuseCodeHost(handle.host, new FakeLogOutputChannel())
  const session = await host.startSession({
    workspaceRoot: '/ws',
    modelId: 'muse-spark-1.3',
    approvalMode: 'denyUnmatched',
  })
  return { handle, host, session }
}

describe('Muse Code media refusal pending U16', () => {
  it.each(['video/mp4', 'video/quicktime', 'audio/wav', 'audio/mpeg'])(
    'refuses %s disguised as an MSP image before start or steer',
    async (mediaType) => {
      const rig = await setup()
      try {
        const part = {
          type: 'image',
          mediaType,
          base64Data: 'media-canary',
          width: 1,
          height: 1,
        } satisfies Parameters<typeof rig.session.sendTurn>[0][number]
        await expect(rig.session.sendTurn([part])).rejects.toThrow(UI_TEXT.media.museCodeRefusal)
        await expect(rig.session.steer('turn-1', [part])).rejects.toThrow(
          UI_TEXT.media.museCodeRefusal,
        )
        expect(
          rig.handle.server.requests.filter((frame) => frame.method?.startsWith('turn/')),
        ).toEqual([])
      } finally {
        await rig.host.close()
      }
    },
  )
  it('video disguised as a file gets the media refusal; an ordinary PDF keeps its old refusal', async () => {
    const rig = await setup()
    try {
      const part = {
        type: 'file',
        mediaType: 'video/mp4',
        base64Data: 'media-canary',
        sizeBytes: 1,
        name: 'clip.mp4',
        pageCount: undefined,
      } satisfies Parameters<typeof rig.session.sendTurn>[0][number]
      await expect(rig.session.sendTurn([part])).rejects.toThrow(UI_TEXT.media.museCodeRefusal)
      await expect(
        rig.session.sendTurn([{ ...part, mediaType: 'application/pdf' }]),
      ).rejects.toThrow(UI_TEXT.pdfNeedsModelApi)
    } finally {
      await rig.host.close()
    }
  })
  it.each(['clip.mp4', 'clip.mov', String.raw`C:\media\CLIP.MP4`])(
    'marks captured read_file path %s for an approved lazy video preview',
    (videoPath) => {
      expect(describeTool('read_file', JSON.stringify({ path: videoPath }))).toMatchObject({
        body: 'read',
        videoPath,
      })
    },
  )
  it('does not mark non-video or unrelated tool paths as videos', () => {
    expect(describeTool('read_file', '{"path":"clip.mp4.txt"}').videoPath).toBeUndefined()
    expect(describeTool('read_file', '{"path":"clip.webm"}').videoPath).toBeUndefined()
    expect(describeTool('write_file', '{"path":"clip.mp4"}').videoPath).toBeUndefined()
  })
})
