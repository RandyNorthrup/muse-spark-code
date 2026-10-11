import { describe, expect, it, vi } from 'vitest'
import {
  nativeAttachments,
  type NativeAttachmentPort,
} from '../../src/runtime/companion/nativeAttachments'
import { UI_TEXT } from '../../src/shared/constants'

const attachment = {
  requestId: 'request-1',
  uploadToken: 'opaque-token',
  name: 'clip.mp4',
  info: {
    kind: 'video',
    mediaType: 'video/mp4',
    sizeBytes: 1024,
    durationSeconds: 10,
    hasSoundtrack: false,
  },
}
const result = { attachments: [attachment] }

function setup() {
  const state = { isCurrent: true, isInteractiveUser: true }
  const port = {
    pick: vi.fn<NativeAttachmentPort['pick']>(() => Promise.resolve(result)),
    attach: vi.fn<NativeAttachmentPort['attach']>(() => Promise.resolve(result)),
    remove: vi.fn<NativeAttachmentPort['remove']>(() => Promise.resolve({ attachments: [] })),
    record: vi.fn<NativeAttachmentPort['record']>(() => Promise.resolve(result)),
  }
  const dispatch = nativeAttachments(port, {
    isCurrent: () => state.isCurrent,
    isInteractiveUser: () => state.isInteractiveUser,
  })
  return { state, port, dispatch }
}

async function holdPicker(rig: ReturnType<typeof setup>) {
  const pending = Promise.withResolvers<unknown>()
  rig.port.pick.mockReturnValueOnce(pending.promise)
  const first = rig.dispatch({ method: 'attachments/pick', params: {} })
  const second = rig.dispatch({
    method: 'attachments/attach',
    params: { pathToken: 'host-issued' },
  })
  await vi.waitFor(() => {
    expect(rig.port.pick).toHaveBeenCalledOnce()
  })
  return { pending, first, second }
}

// Each fake round-trips JSON like its native panel, never a disk path or bytes.
function fakeBridge(dispatch: ReturnType<typeof nativeAttachments>) {
  return async (frame: unknown) => {
    const encoded = JSON.stringify(frame)
    const raw: unknown = JSON.parse(encoded)
    const reply = await dispatch(raw)
    const encodedReply = JSON.stringify(reply)
    const transported: unknown = JSON.parse(encodedReply)
    return transported
  }
}

describe('native attachments through MHP projection', () => {
  it.each(['JCEF', 'WebView2', 'SWT'])(
    '%s fake bridge supports chooser, token drop, remove and user recording',
    async () => {
      const rig = setup()
      const bridge = fakeBridge(rig.dispatch)
      await expect(bridge({ method: 'attachments/pick', params: {} })).resolves.toEqual({
        ok: true,
        value: result,
      })
      await expect(
        bridge({ method: 'attachments/attach', params: { pathToken: 'host-issued-token' } }),
      ).resolves.toEqual({ ok: true, value: result })
      expect(rig.port.attach).toHaveBeenCalledWith('host-issued-token')
      await expect(
        bridge({ method: 'attachments/remove', params: { id: 'opaque-token' } }),
      ).resolves.toEqual({ ok: true, value: { attachments: [] } })
      await expect(
        bridge({
          method: 'attachments/record',
          params: { maxSeconds: 120, microphone: false, systemAudio: false },
        }),
      ).resolves.toEqual({ ok: true, value: result })
      expect(rig.port.record).toHaveBeenCalledWith({
        maxSeconds: 120,
        microphone: false,
        systemAudio: false,
      })
      expect(JSON.stringify(result)).not.toContain('base64')
    },
  )
  it.each([
    { method: 'attachments/attach', params: { path: '/private', bytes: 'canary' } },
    { method: 'attachments/attach', params: { pathToken: '', bytes: 'canary' } },
    { method: 'attachments/pick', params: { base64: 'canary' } },
    { method: 'attachments/remove', params: { id: '' } },
    {
      method: 'attachments/record',
      params: { maxSeconds: 601, microphone: false, systemAudio: false },
    },
    { method: 'attachments/record', params: { maxSeconds: 120 } },
    { method: 'unknown', params: {} },
    { method: 'attachments/pick', params: {}, bytes: 'canary' },
    {
      method: 'attachments/record',
      params: { maxSeconds: 9, microphone: false, systemAudio: false },
    },
    { method: 'attachments/attach', params: { pathToken: 'x'.repeat(4097) } },
    { method: 'attachments/remove', params: { id: 'x'.repeat(257) } },
  ])('refuses malformed or byte-bearing method $method', async (frame) => {
    const rig = setup()
    await expect(rig.dispatch(frame)).resolves.toMatchObject({ ok: false })
    expect(rig.port.attach).not.toHaveBeenCalled()
    expect(rig.port.record).not.toHaveBeenCalled()
  })
  it('a tool or headless caller cannot claim a user gesture in JSON', async () => {
    const rig = setup()
    rig.state.isInteractiveUser = false
    await expect(
      rig.dispatch({
        method: 'attachments/record',
        params: { maxSeconds: 120, microphone: false, systemAudio: false },
      }),
    ).resolves.toEqual({ ok: false, reason: UI_TEXT.media.recordingUserOnly })
    expect(rig.port.record).not.toHaveBeenCalled()
    await expect(
      rig.dispatch({
        method: 'attachments/record',
        userAction: true,
        params: { maxSeconds: 120, microphone: false, systemAudio: false },
      }),
    ).resolves.toMatchObject({ ok: false })
  })
  it.each([
    { attachments: [{ ...attachment, bytes: 'canary' }] },
    { attachments: [attachment], bytes: 'canary' },
    { attachments: [{ ...attachment, path: '/private' }] },
    { attachments: [{ ...attachment, uploadToken: '' }] },
    { attachments: Array.from({ length: 21 }, () => attachment) },
  ])('validates native results before returning them to the panel', async (value) => {
    const rig = setup()
    rig.port.pick.mockResolvedValue(value)
    await expect(rig.dispatch({ method: 'attachments/pick', params: {} })).resolves.toMatchObject({
      ok: false,
    })
  })
  it('serializes two picker/drop actions through one owner', async () => {
    const rig = setup()
    const { pending, first, second } = await holdPicker(rig)
    expect(rig.port.attach).not.toHaveBeenCalled()
    pending.resolve(result)
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(second).resolves.toMatchObject({ ok: true })
  })
  it('discards stale picker replies and refuses queued work after close', async () => {
    const rig = setup()
    const { pending, first, second } = await holdPicker(rig)
    rig.state.isCurrent = false
    pending.resolve(result)
    await expect(first).resolves.toMatchObject({ ok: false })
    await expect(second).resolves.toMatchObject({ ok: false })
    expect(rig.port.attach).not.toHaveBeenCalled()
  })
  it('does not strand the queue or echo sensitive native errors', async () => {
    const rig = setup()
    rig.port.pick.mockRejectedValueOnce(new Error('private-path/secret-canary'))
    const first = await rig.dispatch({ method: 'attachments/pick', params: {} })
    expect(first.ok).toBe(false)
    expect(JSON.stringify(first)).not.toContain('canary')
    await expect(rig.dispatch({ method: 'attachments/pick', params: {} })).resolves.toMatchObject({
      ok: true,
    })
  })
})
