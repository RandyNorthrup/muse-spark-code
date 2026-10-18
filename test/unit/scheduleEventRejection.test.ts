// D119 catch burn-down: only a malformed or misaddressed host delivery
// reads as a rejected event. The schemas fail for real below.
import { describe, expect, it } from 'vitest'
import type { ScheduleEvent } from '../../src/shared/scheduleEvents'
import { ScheduleFilesSource } from '../../src/core/schedules/events/files'
import { ScheduleSignalSource } from '../../src/core/schedules/events/signals'

describe('schedule event rejection', () => {
  it('drops a malformed files notification and counts the rejection', () => {
    let listener: ((input: unknown) => void) | undefined
    const rejected: string[] = []
    const received: ScheduleEvent[] = []
    const source = new ScheduleFilesSource(
      ['*.txt'],
      {
        capability: () => ({ available: true }),
        watch: (_globs, onInput) => {
          listener = onInput
          return { dispose: () => undefined }
        },
      },
      (id) => {
        rejected.push(id)
      },
    )
    const subscription = source.subscribe((event) => {
      received.push(event)
    })
    try {
      listener?.({ bogus: true })
      expect(rejected).toEqual(['files'])
      expect(received).toEqual([])
    } finally {
      subscription.dispose()
    }
  })

  it('delivers a matching files notification', () => {
    let listener: ((input: unknown) => void) | undefined
    const rejected: string[] = []
    const received: ScheduleEvent[] = []
    const source = new ScheduleFilesSource(
      ['*.txt'],
      {
        capability: () => ({ available: true }),
        watch: (_globs, onInput) => {
          listener = onInput
          return { dispose: () => undefined }
        },
      },
      (id) => {
        rejected.push(id)
      },
    )
    const subscription = source.subscribe((event) => {
      received.push(event)
    })
    try {
      listener?.({ relativePath: 'a.txt', identity: '1', observedAt: 1 })
      expect(rejected).toEqual([])
      expect(received).toHaveLength(1)
      expect(received[0]).toMatchObject({ source: 'files', kind: 'filesChanged' })
    } finally {
      subscription.dispose()
    }
  })

  it('drops a malformed signal and one meant for another source', () => {
    let listener: ((input: unknown) => void) | undefined
    const rejected: string[] = []
    const received: ScheduleEvent[] = []
    const source = new ScheduleSignalSource(
      'sig',
      ['manual'],
      'test-dependency',
      {
        capability: () => ({ available: true }),
        subscribe: (onInput) => {
          listener = onInput
          return { dispose: () => undefined }
        },
      },
      (id) => {
        rejected.push(id)
      },
    )
    const subscription = source.subscribe((event) => {
      received.push(event)
    })
    try {
      listener?.({ bogus: true })
      listener?.({ source: 'other', kind: 'manual', eventKey: 'k', observedAt: 1, fields: {} })
      expect(rejected).toEqual(['sig', 'sig'])
      expect(received).toEqual([])
    } finally {
      subscription.dispose()
    }
  })

  it('delivers a well-formed signal for its own source', () => {
    let listener: ((input: unknown) => void) | undefined
    const received: ScheduleEvent[] = []
    const source = new ScheduleSignalSource(
      'sig',
      ['manual'],
      'test-dependency',
      {
        capability: () => ({ available: true }),
        subscribe: (onInput) => {
          listener = onInput
          return { dispose: () => undefined }
        },
      },
      () => undefined,
    )
    const subscription = source.subscribe((event) => {
      received.push(event)
    })
    try {
      listener?.({ source: 'sig', kind: 'manual', eventKey: 'k', observedAt: 1, fields: {} })
      expect(received).toHaveLength(1)
    } finally {
      subscription.dispose()
    }
  })
})
