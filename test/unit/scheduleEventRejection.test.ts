// D119 catch burn-down: only a malformed or misaddressed host delivery
// reads as a rejected event. The schemas fail for real below.
import { describe, expect, it } from 'vitest'
import type { ScheduleEvent, ScheduleSourceCapability } from '../../src/shared/scheduleEvents'
import { ScheduleFilesSource } from '../../src/core/schedules/events/files'
import { ScheduleSignalSource } from '../../src/core/schedules/events/signals'

interface Harness {
  readonly fire: (input: unknown) => void
  readonly rejected: readonly string[]
  readonly received: readonly ScheduleEvent[]
  readonly dispose: () => void
}

const testCapability = (): ScheduleSourceCapability => ({ available: true })

function harness(kind: 'files' | 'signal'): Harness {
  let listener: ((input: unknown) => void) | undefined
  const rejected: string[] = []
  const received: ScheduleEvent[] = []
  const capture = (onInput: (input: unknown) => void) => {
    listener = onInput
    return { dispose: () => undefined }
  }
  const notify = (id: string) => {
    rejected.push(id)
  }
  const capability = testCapability
  const subscribable =
    kind === 'files'
      ? new ScheduleFilesSource(
          ['*.txt'],
          { capability, watch: (_globs, onInput) => capture(onInput) },
          notify,
        )
      : new ScheduleSignalSource(
          'sig',
          ['manual'],
          'test-dependency',
          { capability, subscribe: capture },
          notify,
        )
  const subscription = subscribable.subscribe((event) => {
    received.push(event)
  })
  return {
    fire: (input) => {
      listener?.(input)
    },
    rejected,
    received,
    dispose: () => {
      subscription.dispose()
    },
  }
}

describe('schedule event rejection', () => {
  it('drops a malformed files notification and counts the rejection', () => {
    const run = harness('files')
    try {
      run.fire({ bogus: true })
      expect(run.rejected).toEqual(['files'])
      expect(run.received).toEqual([])
    } finally {
      run.dispose()
    }
  })

  it('delivers a matching files notification', () => {
    const run = harness('files')
    try {
      run.fire({ relativePath: 'a.txt', identity: '1', observedAt: 1 })
      expect(run.rejected).toEqual([])
      expect(run.received).toHaveLength(1)
      expect(run.received[0]).toMatchObject({ source: 'files', kind: 'filesChanged' })
    } finally {
      run.dispose()
    }
  })

  it('drops a malformed signal and one meant for another source', () => {
    const run = harness('signal')
    try {
      run.fire({ bogus: true })
      run.fire({ source: 'other', kind: 'manual', eventKey: 'k', observedAt: 1, fields: {} })
      expect(run.rejected).toEqual(['sig', 'sig'])
      expect(run.received).toEqual([])
    } finally {
      run.dispose()
    }
  })

  it('delivers a well-formed signal for its own source', () => {
    const run = harness('signal')
    try {
      run.fire({ source: 'sig', kind: 'manual', eventKey: 'k', observedAt: 1, fields: {} })
      expect(run.received).toHaveLength(1)
    } finally {
      run.dispose()
    }
  })
})
