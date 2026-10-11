import { describe, expect, it, vi } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { notify } from '../../src/core/events/notify'
import { FakeLogOutputChannel } from './helpers/fakes'

describe('notify', () => {
  it('delivers the value to each observer in order without reporting success as failure', () => {
    const seen: string[] = []
    const log = new FakeLogOutputChannel()
    const report = vi.fn()
    notify(
      new Set([
        (value: string) => {
          seen.push(`first ${value}`)
        },
        (value) => {
          seen.push(`next ${value}`)
        },
      ]),
      'event',
      log,
      'museCode.event',
      report,
    )
    expect(seen).toEqual(['first event', 'next event'])
    expect(log.error).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
  })

  it('isolates an observer failure, logs fixed words and reports a safe diagnostic once', () => {
    const error = new Error('private /Users/test/account@example.test')
    const first = vi.fn(() => {
      throw error
    })
    const next = vi.fn()
    const log = new FakeLogOutputChannel()
    const report = vi.fn()
    notify([first, next], 'event', log, 'museCode.event', report)
    expect(first).toHaveBeenCalledExactlyOnceWith('event')
    expect(next).toHaveBeenCalledExactlyOnceWith('event')
    expect(report).toHaveBeenCalledExactlyOnceWith({
      type: 'backendNotice',
      level: 'error',
      text: UI_TEXT.backendListenerFailed,
    })
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'Backend notification listener failed: museCode.event',
    )
  })

  it('keeps delivering when the optional failure reporter throws', () => {
    const first = vi.fn(() => {
      throw new Error('private observer error')
    })
    const next = vi.fn()
    const report = vi.fn(() => {
      throw new Error('private reporter error')
    })
    const log = new FakeLogOutputChannel()
    notify([first, next], undefined, log, 'museCode.event', report)
    expect(next).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(report).toHaveBeenCalledOnce()
    expect(log.error.mock.calls).toEqual([
      ['Backend notification listener failed: museCode.event'],
      ['Backend notification listener failed: backend.diagnostic'],
    ])
  })

  it('keeps delivering when no failure reporter is installed', () => {
    const next = vi.fn()
    const log = new FakeLogOutputChannel()
    notify(
      [
        () => {
          throw new Error('private observer error')
        },
        next,
      ],
      'event',
      log,
      'museCode.event',
    )
    expect(next).toHaveBeenCalledExactlyOnceWith('event')
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'Backend notification listener failed: museCode.event',
    )
  })
})

it('delivers later observers and the safe diagnostic even if logging throws', () => {
  const log = new FakeLogOutputChannel()
  log.error.mockImplementation(() => {
    throw new Error('private logger detail')
  })
  const next = vi.fn()
  const report = vi.fn()
  expect(() => {
    notify(
      [
        () => {
          throw new Error('private observer detail')
        },
        next,
      ],
      'event',
      log,
      'museCode.event',
      report,
    )
  }).not.toThrow()
  expect(next).toHaveBeenCalledExactlyOnceWith('event')
  expect(report).toHaveBeenCalledExactlyOnceWith({
    type: 'backendNotice',
    level: 'error',
    text: UI_TEXT.backendListenerFailed,
  })
})
