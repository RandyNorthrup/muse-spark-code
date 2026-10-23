import { describe, expect, it } from 'vitest'
import { PanelUiRequests } from '../../src/runtime/panel/uiRequests'
import { PanelDelivery } from '../../src/runtime/panel/delivery'
import { MHP_PANEL } from '../../src/shared/constants'

function rig() {
  const owner = new PanelUiRequests()
  const frames: unknown[] = []
  const disconnect = owner.connect((frame, complete) => {
    frames.push(frame)
    complete?.()
  })
  return { owner, frames, disconnect }
}

describe('window-owned fallback UI correlation', () => {
  it('shares the panel admission budget across the separate UI transport', async () => {
    const budget = new PanelDelivery()
    const release = budget.reserve(MHP_PANEL.maximumQueuedBytes)
    const owner = new PanelUiRequests(budget)
    owner.connect((_frame, complete) => {
      complete?.()
    })
    await expect(owner.request('ui/input', { title: 'Input', prompt: 'Value' })).rejects.toThrow(
      'BACKPRESSURE',
    )
    release()
    owner.close()
    expect(budget.totals).toEqual({ bytes: 0, messages: 0 })
  })
  it('preserves an exact id and validates the result for its method', async () => {
    const { owner, frames } = rig()
    const answer = owner.request('ui/input', { title: 'Input', prompt: 'Value' })
    expect(frames[0]).toMatchObject({ id: 'ui-1', method: 'ui/input' })
    owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: 'text' })
    expect(() => {
      owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: 'twice' })
    }).toThrow('UNCORRELATED')
    expect(await answer).toBe('text')
    expect(owner.delivery.totals).toEqual({ bytes: 0, messages: 0 })
    owner.close()
  })
  it('rejects a malformed result and a result from a different window', async () => {
    const first = rig()
    const second = rig()
    const answer = first.owner.request('ui/input', { title: 'Input', prompt: 'Value' })
    const failure = expect(answer).rejects.toThrow()
    expect(() => {
      second.owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: 'text' })
    }).toThrow('UNCORRELATED')
    expect(() => {
      first.owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: 1 })
    }).toThrow('INVALID_RESULT')
    await failure
    first.owner.close()
    second.owner.close()
  })
  it('cancels the exact prompt, validates its late result and refuses a replay', async () => {
    const { owner, frames } = rig()
    const cancel = new AbortController()
    const answer = owner.request('ui/input', { title: 'Input', prompt: 'Value' }, cancel.signal)
    const failure = expect(answer).rejects.toThrow('CANCELLED')
    cancel.abort()
    await failure
    expect(frames[1]).toEqual({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 'ui-1' } })
    expect(() => {
      owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: 1 })
    }).toThrow()
    owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: null })
    expect(() => {
      owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: null })
    }).toThrow('UNCORRELATED')
    expect(owner.delivery.totals).toEqual({ bytes: 0, messages: 0 })
    owner.close()
  })
  it('disconnect rejects pending work and reconnect cannot replay a queued prompt', async () => {
    const { owner, disconnect } = rig()
    const answer = owner.request('ui/input', { title: 'Input', prompt: 'Value' })
    const failure = expect(answer).rejects.toThrow('DISCONNECTED')
    disconnect()
    await failure
    const frames: unknown[] = []
    owner.connect((frame, complete) => {
      frames.push(frame)
      complete?.()
    })
    expect(frames).toEqual([])
    expect(() => {
      owner.receive({ jsonrpc: '2.0', id: 'ui-1', result: 'late' })
    }).toThrow('UNCORRELATED')
    owner.close()
  })
  it('refuses invalid parameters, an aborted request and overlapping streams', async () => {
    const { owner, frames } = rig()
    expect(() => owner.connect(() => undefined)).toThrow('ALREADY_CONNECTED')
    await expect(
      owner.request('ui/progress', { id: 1, title: 'Work', done: false, fraction: 2 }),
    ).rejects.toThrow()
    const signal = new AbortController()
    signal.abort()
    await expect(
      owner.request('ui/input', { title: 'Input', prompt: 'Value' }, signal.signal),
    ).rejects.toThrow()
    expect(frames).toEqual([])
    owner.close()
  })
  it('closes a window before cancelled correlations can exceed the admission bound', async () => {
    const { owner } = rig()
    for (let index = 0; index <= MHP_PANEL.maximumQueuedMessages; index++) {
      const signal = new AbortController()
      const answer = owner.request('ui/input', { title: 'Input', prompt: 'Value' }, signal.signal)
      const failure = expect(answer).rejects.toThrow('CANCELLED')
      signal.abort()
      await failure
    }
    expect(owner.isConnected).toBe(false)
    expect(owner.delivery.totals).toEqual({ bytes: 0, messages: 0 })
    await expect(owner.request('ui/input', { title: 'Input', prompt: 'Value' })).rejects.toThrow(
      'DISCONNECTED',
    )
  })
})
