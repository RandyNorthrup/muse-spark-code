// D121: no failure latch of ours on the Windows job launcher — the backoff
// delay only paces retries, and every dispatch past it prepares fresh and
// tries again. Real containment code with a controllable clock here: three
// dispatches past the pacing delay prepare three times, while two back to
// back hold on one preparation.
import { describe, expect, it } from 'vitest'
import { PLUGIN_JOB_RETRY_BACKOFF_MS } from '../../src/shared/constants'
import { pluginContainment } from '../../src/host/backend/pluginContainment'

function noExecutable(): Promise<string | undefined> {
  return Promise.resolve(undefined)
}

function failingSource(now: () => number, calls: { count: number }, messages: string[]) {
  return pluginContainment({
    platform: 'win32',
    newJobExecutable: () => {
      calls.count += 1
      return noExecutable
    },
    now,
    log: (message: string) => {
      messages.push(message)
    },
  })
}

describe('plugin containment without a failure latch', () => {
  it('tries again on every dispatch past the pacing delay', async () => {
    let at = 0
    const calls = { count: 0 }
    const messages: string[] = []
    const source = failingSource(() => at, calls, messages)
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    // No latch: the third dispatch prepares fresh and tries again.
    expect(calls.count).toBe(3)
    expect(messages).toHaveLength(3)
    expect(messages[2]).toContain('tried again shortly')
  })

  it('holds a dispatch inside the pacing delay without preparing again', async () => {
    const at = 0
    const calls = { count: 0 }
    const messages: string[] = []
    const source = failingSource(() => at, calls, messages)
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    expect(calls.count).toBe(1)
    expect(messages).toHaveLength(1)
  })

  it('Retry clears the count: the next failure reads as the first again', async () => {
    let at = 0
    const calls = { count: 0 }
    const messages: string[] = []
    const source = failingSource(() => at, calls, messages)
    await source.containment()
    source.reset()
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    await source.containment()
    expect(messages[1]).toContain('once more shortly')
  })

  it('leaves process groups alone off Windows', async () => {
    const source = pluginContainment({
      platform: 'linux',
      newJobExecutable: () => undefined,
      now: () => 0,
      log: () => undefined,
    })
    expect(await source.containment()).toEqual({ kind: 'processGroup' })
  })
})
