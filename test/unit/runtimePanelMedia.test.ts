// M105 delivery d: the native panel's `attachments/*` through its real code
// only: E3's adapter, the panel port and the real media bundle entry over
// real confinement and real temp files. The host's answers (the chooser,
// the contributor modal) are the editor services a suite registers, as
// the stdio suites register theirs; everything they gate is production.
// The wire itself is proven in runtimePanelConversation. Unknown, outside and
// unheard media refuse with the pipeline's own reasons; recording refuses
// with its wired words; a frame carrying bytes and an unparsed frame are
// refused, never attached or ignored.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { createMediaAttachments } from '../../src/host/media/mediaEntry'
import { confineWorkspacePath } from '../../src/core/workspacePath'
import {
  routeAttachmentMethod,
  selectAttachmentOwner,
  type AttachmentOwner,
  type PanelMediaHost,
} from '../../src/runtime/panel/panelMedia'
import { createPanelMedia } from '../../src/runtime/panelMediaEntry'
import { attachmentsResultSchema } from '../../src/shared/hostApi/attachments'
import { SETTING_DEFAULTS, UI_TEXT } from '../../src/shared/constants'
import { fill } from '../../src/shared/l10n/text'
import { videoFixture, wavFixture } from './helpers/media/fixtures'
import { collectingLogger } from './helpers/collectingLogger'

const CONTRIBUTOR = 'muse-spark-1.3-contributor'
const STANDARD = 'muse-spark-1.3'

const tempDirs: string[] = []
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

function recordingLog() {
  const lines: string[] = []
  return { ...collectingLogger(lines), lines }
}

async function setup(
  options: {
    readonly openFile?: string | null
    readonly confirm?: 'send' | 'useStandard' | 'remove'
    readonly backend?: 'museCode' | 'modelApi'
    readonly modelId?: string
    readonly isCurrent?: boolean
  } = {},
) {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), 'panel-media-ws-'))
  const dataRoot = await mkdtemp(path.join(tmpdir(), 'panel-media-data-'))
  tempDirs.push(workspaceRoot, dataRoot)
  const clip = path.join(workspaceRoot, 'clip.mp4')
  await writeFile(clip, videoFixture({ soundtrack: false }))
  const sounded = path.join(workspaceRoot, 'sounded.mp4')
  await writeFile(sounded, videoFixture({ soundtrack: true }))
  const note = path.join(workspaceRoot, 'note.wav')
  await writeFile(note, wavFixture())
  const text = path.join(workspaceRoot, 'note.txt')
  await writeFile(text, 'not media')
  const calls: { readonly method: string; readonly params: unknown }[] = []
  const host: PanelMediaHost = {
    request(method: 'ui/openFile' | 'ui/confirm', params: unknown): Promise<string | null> {
      calls.push({ method, params })
      if (method === 'ui/openFile')
        return Promise.resolve(
          options.openFile === undefined ? pathToFileURL(clip).href : options.openFile,
        )
      return Promise.resolve(options.confirm ?? 'send')
    },
  }
  const log = recordingLog()
  const media = createPanelMedia({
    dataRoot,
    workspaceRoot,
    settings: {
      current: () => ({
        mediaMaxUploadMiB: SETTING_DEFAULTS.mediaMaxUploadMiB,
        screenRecordingMaxSeconds: SETTING_DEFAULTS.screenRecordingMaxSeconds,
        mediaAudioAction: SETTING_DEFAULTS.mediaAudioAction,
      }),
    },
    files: {
      canonicalRelativePath: async (fsPath: string) => {
        const confined = await confineWorkspacePath(
          workspaceRoot,
          path.relative(workspaceRoot, fsPath),
          process.platform,
          { realPath: realpath },
        )
        return confined.ok
          ? { canonical: confined.canonical, checkedAbsolute: confined.checkedAbsolute }
          : undefined
      },
      toRelativePath: (uri: string) => {
        try {
          const relative = path.relative(workspaceRoot, fileURLToPath(uri))
          return relative.startsWith('..') || path.isAbsolute(relative)
            ? undefined
            : relative.replaceAll(path.sep, '/')
        } catch {
          return undefined
        }
      },
    },
    host,
    model: () => ({
      backend: options.backend ?? 'modelApi',
      modelId: options.modelId ?? CONTRIBUTOR,
    }),
    isCurrent: () => options.isCurrent ?? true,
    log,
    table: UI_TEXT,
    locale: 'en',
    distDir: 'test-dist',
    loadBundle: () => ({ createMediaAttachments }),
  })
  return { media, calls, log, workspaceRoot, dataRoot, clip, sounded, note, text }
}

function ownerOf(
  dispatch: AttachmentOwner['attachments'],
  sessionId = 'session-1',
): AttachmentOwner {
  return { sessionId, isReleased: false, attachments: dispatch }
}

describe('the panel attach flow', () => {
  it('attaches the chooser file as an upload row', async () => {
    const { media, calls } = await setup()
    try {
      const result = await media.dispatch({ method: 'attachments/pick', params: {} })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected an upload')
      expect(result.value.attachments).toHaveLength(1)
      const [upload] = result.value.attachments
      expect(upload?.name).toBe('clip.mp4')
      expect(upload?.info.kind).toBe('video')
      expect(upload?.uploadToken).not.toBe('')
      expect(upload?.requestId).not.toBe('')
      expect(upload?.uploadToken).not.toBe(upload?.requestId)
      expect(calls.filter((call) => call.method === 'ui/openFile')).toHaveLength(1)
    } finally {
      media.release()
    }
  })

  it('asks the contributor modal once per conversation', async () => {
    const { media, calls } = await setup()
    try {
      const first = await media.dispatch({ method: 'attachments/pick', params: {} })
      const second = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'clip.mp4' },
      })
      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      expect(calls.filter((call) => call.method === 'ui/confirm')).toHaveLength(1)
    } finally {
      media.release()
    }
  })

  it('attaches nothing when the chooser is dismissed', async () => {
    const { media } = await setup({ openFile: null })
    try {
      const result = await media.dispatch({ method: 'attachments/pick', params: {} })
      expect(result).toEqual({ ok: true, value: { attachments: [] } })
    } finally {
      media.release()
    }
  })

  it('attaches a workspace-relative token', async () => {
    const { media } = await setup()
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'clip.mp4' },
      })
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected an upload')
      expect(result.value.attachments[0]?.name).toBe('clip.mp4')
    } finally {
      media.release()
    }
  })

  it('refuses paths outside the workspace with the privacy reason', async () => {
    const { media } = await setup()
    try {
      for (const pathToken of ['../clip.mp4', '/etc/hostname']) {
        const result = await media.dispatch({ method: 'attachments/attach', params: { pathToken } })
        expect(result).toEqual({ ok: false, reason: UI_TEXT.textFilePrivate })
      }
    } finally {
      media.release()
    }
  })

  it('refuses media the sniffer does not know with its reason', async () => {
    const { media } = await setup()
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'note.txt' },
      })
      expect(result).toEqual({
        ok: false,
        reason: fill(UI_TEXT.media.attachmentUnknownType, { type: 'media' }),
      })
    } finally {
      media.release()
    }
  })

  it('refuses audio no voice transcribes with the gate reason', async () => {
    const { media } = await setup()
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'note.wav' },
      })
      expect(result).toEqual({
        ok: false,
        reason: fill(UI_TEXT.media.audioUnsupported, { model: CONTRIBUTOR }),
      })
    } finally {
      media.release()
    }
  })

  it('attaches a soundtrack video; the upload row carries no soundtrack warning', async () => {
    const { media } = await setup()
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'sounded.mp4' },
      })
      expect(result.ok).toBe(true)
    } finally {
      media.release()
    }
  })

  it('refuses on the Muse Code backend naming the Model API backend', async () => {
    const { media } = await setup({ backend: 'museCode' })
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'clip.mp4' },
      })
      expect(result).toEqual({ ok: false, reason: UI_TEXT.media.museCodeRefusal })
    } finally {
      media.release()
    }
  })

  it('honours a declined contributor answer with its reason', async () => {
    const { media } = await setup({ confirm: 'remove' })
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'clip.mp4' },
      })
      expect(result).toEqual({
        ok: false,
        reason: fill(UI_TEXT.media.contributorDeclined, { name: 'clip.mp4' }),
      })
    } finally {
      media.release()
    }
  })

  it('falls back to the standard gate when the user switches models', async () => {
    const { media } = await setup({ confirm: 'useStandard' })
    try {
      const result = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'clip.mp4' },
      })
      expect(result).toEqual({
        ok: false,
        reason: fill(UI_TEXT.media.videoUnknown, { model: STANDARD }),
      })
    } finally {
      media.release()
    }
  })

  it('releases a registration and ignores unknown ids', async () => {
    const { media } = await setup()
    try {
      const attached = await media.dispatch({ method: 'attachments/pick', params: {} })
      expect(attached.ok).toBe(true)
      if (!attached.ok) throw new Error('expected an upload')
      const token = attached.value.attachments[0]?.uploadToken ?? ''
      expect(await media.dispatch({ method: 'attachments/remove', params: { id: token } })).toEqual(
        {
          ok: true,
          value: { attachments: [] },
        },
      )
      expect(
        await media.dispatch({ method: 'attachments/remove', params: { id: 'never-issued' } }),
      ).toEqual({ ok: true, value: { attachments: [] } })
    } finally {
      media.release()
    }
  })

  it('refuses recording with the wired words', async () => {
    const { media } = await setup()
    try {
      const result = await media.dispatch({
        method: 'attachments/record',
        params: { maxSeconds: 10, microphone: false, systemAudio: false },
      })
      expect(result).toEqual({
        ok: false,
        reason: fill(UI_TEXT.media.recordingUnavailable, {
          reason: UI_TEXT.media.recorderUnavailable,
        }),
      })
    } finally {
      media.release()
    }
  })
})

describe('the dispatch guards', () => {
  it('refuses a frame carrying file bytes, and the queue survives it', async () => {
    const { media } = await setup()
    try {
      const refused = await media.dispatch({
        method: 'attachments/attach',
        params: { pathToken: 'clip.mp4', bytes: 'AAAABBBB' },
      })
      expect(refused).toEqual({ ok: false, reason: UI_TEXT.attachmentUnreadable })
      const next = await media.dispatch({ method: 'attachments/pick', params: {} })
      expect(next.ok).toBe(true)
    } finally {
      media.release()
    }
  })

  it.each([
    ['a bare string', 'attachments/pick'],
    ['an empty object', {}],
    ['a missing method', { params: {} }],
    ['a missing params', { method: 'attachments/pick' }],
    ['an unknown method', { method: 'attachments/invented', params: {} }],
    ['extra pick params', { method: 'attachments/pick', params: { pathToken: 'clip.mp4' } }],
    ['an empty token', { method: 'attachments/attach', params: { pathToken: '' } }],
  ])('refuses %s', async (_label, raw) => {
    const { media } = await setup()
    try {
      expect(await media.dispatch(raw)).toEqual({
        ok: false,
        reason: UI_TEXT.attachmentUnreadable,
      })
    } finally {
      media.release()
    }
  })

  it('refuses when the binding is no longer current', async () => {
    const { media, calls } = await setup({ isCurrent: false })
    try {
      expect(await media.dispatch({ method: 'attachments/pick', params: {} })).toEqual({
        ok: false,
        reason: UI_TEXT.attachmentUnreadable,
      })
      expect(calls).toEqual([])
    } finally {
      media.release()
    }
  })
})

describe('the owner rule', () => {
  it.each([
    ['none', [], undefined],
    ['one live owner', ['live'], 'live'],
    ['two live owners refuse', ['live', 'live'], undefined],
    ['a released owner is skipped', ['released', 'live'], 'live'],
    ['an unheld owner is skipped', ['unheld', 'live'], 'live'],
    ['an owner without a dispatch is skipped', ['nodispatch', 'live'], 'live'],
  ])('selects %s', (_label, kinds: string[], expected: string | undefined) => {
    const reply = attachmentsResultSchema.parse({ ok: true, value: { attachments: [] } })
    const dispatch: AttachmentOwner['attachments'] = () => Promise.resolve(reply)
    const controllers = kinds.map((kind, index) => ({
      sessionId: `session-${kind}-${String(index)}`,
      isReleased: kind === 'released',
      attachments: kind === 'nodispatch' ? undefined : dispatch,
    }))
    const owner = selectAttachmentOwner(
      controllers,
      (controller) => !controller.sessionId.includes('unheld'),
    )
    const wanted =
      expected === undefined
        ? undefined
        : controllers.find((controller) => controller.sessionId.includes(expected))?.sessionId
    expect(owner?.sessionId).toBe(wanted)
  })

  it('routes to the single live owner and refuses ambiguity', async () => {
    const { media } = await setup()
    try {
      const answered = await routeAttachmentMethod([ownerOf(media.dispatch)], () => true, {
        method: 'attachments/pick',
        params: {},
      })
      expect(answered.ok).toBe(true)
      await expect(
        routeAttachmentMethod(
          [ownerOf(media.dispatch, 'a'), ownerOf(media.dispatch, 'b')],
          () => true,
          {
            method: 'attachments/pick',
            params: {},
          },
        ),
      ).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
      await expect(
        routeAttachmentMethod([], () => true, { method: 'attachments/pick', params: {} }),
      ).rejects.toThrow('MHP_UNSUPPORTED_CAPABILITY')
    } finally {
      media.release()
    }
  })
})
