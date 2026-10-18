import { describe, expect, it } from 'vitest'
import { PanelDelivery } from '../../src/runtime/panel/delivery'
import { MHP_PANEL } from '../../src/shared/constants'

describe('panel shared delivery budget', () => {
  it('refuses oversized serialized frames before acquiring budget', () => {
    const delivery = new PanelDelivery()
    expect(() => {
      delivery.post({ text: 'x'.repeat(MHP_PANEL.maximumEnvelopeBytes) })
    }).toThrow('MHP_PANEL_TOO_LARGE')
    expect(delivery.totals).toEqual({ messages: 0, bytes: 0 })
  })
  it('pauses after a false write, resumes on drain without resending, and counts unfinished writes', () => {
    const delivery = new PanelDelivery()
    const callbacks: (() => void)[] = []
    const lines: string[] = []
    const write = (line: string, complete: () => void) => {
      lines.push(line)
      callbacks.push(complete)
      return false
    }
    delivery.connect(write)
    delivery.post({ one: 1 }, 'a')
    delivery.post({ two: 2 }, 'b')
    expect(lines).toHaveLength(1)
    expect(delivery.totals.messages).toBe(2)
    callbacks[0]?.()
    expect(delivery.totals.messages).toBe(1)
    delivery.resume()
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('two')
    callbacks[1]?.()
    expect(delivery.totals).toEqual({ bytes: 0, messages: 0 })
  })
  it('caps combined input, output and service messages and bytes before enqueue', () => {
    const delivery = new PanelDelivery()
    const release = delivery.reserve(MHP_PANEL.maximumQueuedBytes)
    expect(() => {
      delivery.post({ service: true })
    }).toThrow('MHP_PANEL_BACKPRESSURE')
    expect(delivery.totals.messages).toBe(1)
    release()
    for (let i = 0; i < MHP_PANEL.maximumQueuedMessages; i += 1) delivery.post({ i })
    expect(() => delivery.reserve(1, 'a', 1)).toThrow('MHP_PANEL_BACKPRESSURE')
    delivery.close()
    expect(delivery.totals.messages).toBe(0)
    expect(() => {
      delivery.post(null)
    }).toThrow('MHP_PANEL_BACKPRESSURE')
  })
  it('drains available surfaces past an unready one and drops queued/buffered frames exactly once', () => {
    const delivery = new PanelDelivery()
    delivery.ready('a', false)
    delivery.post({ a: 1 }, 'a')
    delivery.post({ b: 1 }, 'b')
    const done: (() => void)[] = []
    const lines: string[] = []
    const write = (line: string, complete: () => void) => {
      lines.push(line)
      done.push(complete)
      return true
    }
    delivery.connect(write)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('b')
    expect(delivery.drop('b')).toBe(1)
    done[0]?.()
    expect(delivery.drop('b')).toBe(0)
    expect(delivery.drop('a')).toBe(1)
    expect(delivery.totals).toEqual({ messages: 0, bytes: 0 })
  })
})
