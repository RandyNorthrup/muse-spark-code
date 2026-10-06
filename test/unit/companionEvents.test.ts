import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionEvents } from '../../src/runtime/companion/events'

const streams: CompanionEvents[] = []
afterEach(() => {
  for (const stream of streams.splice(0)) stream.close()
})
function fixture() {
  const events = new CompanionEvents(100)
  streams.push(events)
  const response = new ServerResponse(new IncomingMessage(new Socket()))
  vi.spyOn(response, 'writeHead').mockReturnThis()
  const write = vi.spyOn(response, 'write').mockReturnValue(true)
  vi.spyOn(response, 'end').mockReturnThis()
  const stop = vi.fn()
  const activity = vi.fn()
  let emit: ((message: unknown) => void) | undefined
  const subscribe = (listener: (message: unknown) => void) => {
    emit = listener
    return stop
  }
  events.open(
    'synthetic-cookie',
    response,
    Date.now() + 1000,
    subscribe,
    (message) => JSON.stringify(message),
    activity,
  )
  return { events, response, write, stop, activity, emit: (message: unknown) => emit?.(message) }
}

describe('companion SSE bounds', () => {
  it('refuses a duplicate stream without replacing the original subscription', () => {
    const value = fixture()
    expect(() => {
      value.events.open(
        'synthetic-cookie',
        value.response,
        Date.now() + 1000,
        () => vi.fn(),
        (message) => JSON.stringify(message),
        vi.fn(),
      )
    }).toThrow('EPANEL_STREAM')
    expect(value.stop).not.toHaveBeenCalled()
    expect(value.write).toHaveBeenCalledTimes(1)
  })
  it('allows bounded backpressure, refuses excess queued bytes, and ignores late events', () => {
    const value = fixture()
    value.write.mockReturnValueOnce(false)
    value.emit({ text: 'safe' })
    expect(value.stop).not.toHaveBeenCalled()
    const queued = vi.spyOn(value.response, 'writableLength', 'get').mockReturnValue(90)
    value.emit({ text: 'next' })
    expect(value.stop).toHaveBeenCalledTimes(1)
    expect(value.events.has('synthetic-cookie')).toBe(false)
    const count = value.write.mock.calls.length
    queued.mockReturnValue(0)
    value.emit({ text: 'late' })
    value.response.emit('close')
    expect(value.write).toHaveBeenCalledTimes(count)
    expect(value.stop).toHaveBeenCalledTimes(1)
  })
  it('refuses additional bytes when the response buffer already exceeds its cap', () => {
    const value = fixture()
    vi.spyOn(value.response, 'writableLength', 'get').mockReturnValue(101)
    value.emit({ text: 'safe' })
    expect(value.stop).toHaveBeenCalledTimes(1)
    expect(value.write).toHaveBeenCalledTimes(1)
    expect(value.activity).not.toHaveBeenCalled()
  })
  it('releases a synchronous invalid initial emission once subscribe returns', () => {
    const events = new CompanionEvents(100)
    streams.push(events)
    const response = new ServerResponse(new IncomingMessage(new Socket()))
    vi.spyOn(response, 'write').mockReturnValue(true)
    vi.spyOn(response, 'end').mockReturnThis()
    const stop = vi.fn()
    events.open(
      'synthetic-cookie',
      response,
      Date.now() + 1000,
      (emit) => {
        emit('invalid')
        return stop
      },
      () => {
        throw new Error('private schema error')
      },
      vi.fn(),
    )
    expect(stop).toHaveBeenCalledTimes(1)
    expect(events.has('synthetic-cookie')).toBe(false)
  })
  it('still closes the response when the runtime unsubscribe fails', () => {
    const value = fixture()
    value.stop.mockImplementation(() => {
      throw new Error('private runtime error')
    })
    expect(() => {
      value.events.close()
    }).not.toThrow()
    expect(value.response.end).toHaveBeenCalledTimes(1)
    expect(value.response.destroyed).toBe(true)
    expect(value.events.has('synthetic-cookie')).toBe(false)
  })
})
