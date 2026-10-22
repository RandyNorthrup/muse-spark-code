// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MakerApproval } from '../../src/core/maker/ports'
import { createUiStore, listenToHost } from '../../src/webview/state/store'
import { initialUiState } from '../../src/webview/state/uiState'
import { createMakerStore } from '../../src/webview/maker/store'
import { uiApproval, uiBridge, MAKER_UI_STATE, MAKER_UI_ID } from './helpers/makerUi'

afterEach(() => {
  vi.useRealTimers()
})

describe('maker UI echoes through the single host authority', () => {
  it('routes maker traffic outside chat validation while retaining chat boundary errors', () => {
    const report = vi.fn()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const dispose = listenToHost(createUiStore(initialUiState), window, Date.now, report)
    window.dispatchEvent(new MessageEvent('message', { data: MAKER_UI_STATE }))
    expect(report).not.toHaveBeenCalled()
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: 'sessionInfo', modelId: 100 } }),
    )
    expect(report).toHaveBeenCalledOnce()
    dispose()
    warn.mockRestore()
  })
  it('echoes exact target/id/digest once and the engine consumes only its local binding', () => {
    const { store, post } = uiBridge()
    store.receive(MAKER_UI_STATE)
    const request = uiApproval()
    const engine = new MakerApproval(request, () => true)
    store.receive({ v: 1, type: 'makerApproval', request })
    store.previewRendered(request.id, request.digest)
    store.reviewCompleted(request.id, request.digest)
    engine.review({
      v: 1,
      type: 'makerPayloadReviewed',
      id: request.id,
      digest: request.digest,
      isComplete: true,
    })
    post.mockClear()
    expect(store.answer(request.id, 'allow_once')).toBe(true)
    const raw = post.mock.calls[0]?.[0]
    expect(raw).toEqual({
      v: 1,
      type: 'makerAnswer',
      answer: {
        id: request.id,
        digest: request.digest,
        target: request.target,
        decision: 'allow_once',
      },
    })
    const binding = engine.answer(raw?.type === 'makerAnswer' ? raw.answer : undefined)
    expect(binding).toBeDefined()
    if (binding !== undefined) {
      expect(engine.consume(binding, request.target)).toBe(true)
      expect(engine.consume(binding, request.target)).toBe(false)
    }
    expect(store.answer(request.id, 'allow_once')).toBe(false)
    store.receive({ v: 1, type: 'makerApproval', request })
    expect(store.getState().approvals).toEqual([])
    expect(post).toHaveBeenCalledTimes(1)
    store.dispose()
  })

  it.each(['id', 'digest', 'target', 'expiry'])(
    'the engine refuses a surface answer with changed %s',
    (field) => {
      const { store, post } = uiBridge()
      store.receive(MAKER_UI_STATE)
      const request = uiApproval()
      let now = Date.now()
      const engine = new MakerApproval(
        request,
        () => true,
        () => now,
      )
      engine.review({
        v: 1,
        type: 'makerPayloadReviewed',
        id: request.id,
        digest: request.digest,
        isComplete: true,
      })
      store.receive({ v: 1, type: 'makerApproval', request })
      store.previewRendered(request.id, request.digest)
      store.reviewCompleted(request.id, request.digest)
      post.mockClear()
      store.answer(request.id, 'allow_once')
      const raw = post.mock.calls[0]?.[0]
      if (raw?.type !== 'makerAnswer') throw new Error('missing answer')
      const answer = { ...raw.answer }
      if (field === 'id') answer.id = '954e0cdb-0f0a-4be0-80f2-fd0e47a93d61'
      else if (field === 'digest') answer.digest = 'b'.repeat(64)
      else if (field === 'target' && answer.target.kind === 'machine')
        answer.target = { ...answer.target, registrationId: '954e0cdb-0f0a-4be0-80f2-fd0e47a93d61' }
      else if (field === 'expiry') now = request.expiresAt
      expect(engine.answer(answer)).toBeUndefined()
      expect(engine.hasStarted).toBe(false)
      store.dispose()
    },
  )

  it('rejects expiry even while the dialog chunk has not loaded', () => {
    vi.useFakeTimers()
    const { store, post } = uiBridge()
    store.receive(MAKER_UI_STATE)
    store.receive({ v: 1, type: 'makerApproval', request: uiApproval() })
    vi.advanceTimersByTime(1000)
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'makerAnswer',
        answer: expect.objectContaining({ decision: 'reject_once' }),
      }),
    )
    expect(store.getState().approvals).toEqual([])
    expect(store.answer(MAKER_UI_ID, 'allow_once')).toBe(false)
    store.dispose()
  })

  it('a late click rejects even before the timer callback can run', () => {
    const { host, post } = uiBridge()
    let now = Date.now()
    const store = createMakerStore(host, () => now)
    const request = uiApproval(now)
    store.receive(MAKER_UI_STATE)
    store.receive({ v: 1, type: 'makerApproval', request })
    now = request.expiresAt
    expect(store.answer(request.id, 'allow_once')).toBe(false)
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ answer: expect.objectContaining({ decision: 'reject_once' }) }),
    )
    store.dispose()
  })

  it.each(['isTrusted', 'hardwareEnabled', 'isInteractive'])(
    'denies actions when host %s is false; Stop remains independent',
    (flag) => {
      const { store, post } = uiBridge()
      store.receive({ ...MAKER_UI_STATE, [flag]: false })
      store.receive({ v: 1, type: 'makerApproval', request: uiApproval() })
      expect(store.getState().approvals).toEqual([])
      expect(
        store.send({
          v: 1,
          type: 'makerSend',
          id: MAKER_UI_ID,
          machineId: 'printer',
          payload: 'M104 S190',
        }),
      ).toBe(false)
      expect(
        store.send({
          v: 1,
          type: 'makerSerial',
          id: MAKER_UI_ID,
          operation: 'read',
          target: MAKER_UI_STATE.ports[0] ?? { kind: 'serial', port: 'COM7' },
          baud: 100,
          durationMs: 100,
          dtr: false,
          rts: false,
          payloadHex: '',
        }),
      ).toBe(false)
      expect(store.send({ v: 1, type: 'makerStop', machineId: 'printer' })).toBe(true)
      expect(post).toHaveBeenLastCalledWith({ v: 1, type: 'makerStop', machineId: 'printer' })
      store.dispose()
    },
  )

  it('revocation rejects a pending approval and disposal rejects queued requests', () => {
    const { store, post } = uiBridge()
    store.receive(MAKER_UI_STATE)
    store.receive({ v: 1, type: 'makerApproval', request: uiApproval() })
    store.receive({ ...MAKER_UI_STATE, hardwareEnabled: false })
    expect(post).toHaveBeenCalledTimes(1)
    store.receive(MAKER_UI_STATE)
    store.receive({
      v: 1,
      type: 'makerApproval',
      request: { ...uiApproval(), id: '954e0cdb-0f0a-4be0-80f2-fd0e47a93d61' },
    })
    store.dispose()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ answer: expect.objectContaining({ decision: 'reject_once' }) }),
    )
  })

  it('refuses malformed/versioned/secret-bearing boundary data and answer bypass', () => {
    const { store, post } = uiBridge()
    store.receive({ ...MAKER_UI_STATE, v: 2 })
    store.receive({ ...MAKER_UI_STATE, apiKey: 'unacceptable-field' })
    store.receive({
      v: 1,
      type: 'makerApproval',
      request: { ...uiApproval(), target: { kind: 'machine' } },
    })
    expect(store.getState().admission).toBeUndefined()
    const request = uiApproval()
    expect(
      store.send({
        v: 1,
        type: 'makerAnswer',
        answer: {
          id: request.id,
          digest: request.digest,
          target: request.target,
          decision: 'allow_once',
        },
      }),
    ).toBe(false)
    expect(post).not.toHaveBeenCalled()
    store.dispose()
  })

  it('host close burns the display slot, including an out-of-order close', () => {
    const { store, post } = uiBridge()
    store.receive(MAKER_UI_STATE)
    store.receive({ v: 1, type: 'makerApprovalClosed', id: MAKER_UI_ID })
    store.receive({ v: 1, type: 'makerApproval', request: uiApproval() })
    expect(store.getState().approvals).toEqual([])
    expect(store.answer(MAKER_UI_ID, 'allow_once')).toBe(false)
    expect(post).not.toHaveBeenCalled()
    store.dispose()
  })
})
