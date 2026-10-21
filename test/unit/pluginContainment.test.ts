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

/** A launcher preparation that finds its executable only while `shouldSucceed` says so. */
function togglingExecutable(shouldSucceed: () => boolean): () => Promise<string | undefined> {
  return () => Promise.resolve(shouldSucceed() ? String.raw`C:\job.exe` : undefined)
}

function failingSource(
  now: () => number,
  calls: { count: number },
  messages: string[],
  maxFailures?: () => number,
) {
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
    ...(maxFailures !== undefined && { maxFailures }),
  })
}

/** A failing source on a controllable clock: `advance` moves past the pacing delay. */
function clockedSource() {
  let at = 0
  const calls = { count: 0 }
  const messages: string[] = []
  const source = failingSource(() => at, calls, messages)
  return {
    calls,
    messages,
    source,
    advance: () => {
      at += PLUGIN_JOB_RETRY_BACKOFF_MS
    },
  }
}

describe('plugin containment without a failure latch', () => {
  it('tries again on every dispatch past the pacing delay', async () => {
    const { calls, messages, source, advance } = clockedSource()
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    advance()
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    advance()
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    // No latch: the third dispatch prepares fresh and tries again.
    expect(calls.count).toBe(3)
    expect(messages).toHaveLength(3)
    expect(messages[2]).toContain('tried again shortly')
  })

  it('holds a dispatch inside the pacing delay without preparing again', async () => {
    const { calls, messages, source } = clockedSource()
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

describe('person-set plugin failure latch (D121)', () => {
  it('sets plugin hooks aside at the set count until Retry', async () => {
    let at = 0
    const calls = { count: 0 }
    const messages: string[] = []
    const source = failingSource(
      () => at,
      calls,
      messages,
      () => 2,
    )
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    expect(messages[1]).toContain('stay off until Retry Plugin Hooks')
    // Latched: the third dispatch past the pacing delay prepares nothing new.
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    expect(calls.count).toBe(2)
    expect(messages).toHaveLength(2)
    // Retry clears even a latched count: the next failure reads as the first again.
    source.reset()
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    expect(await source.containment()).toMatchObject({ kind: 'unavailable' })
    expect(calls.count).toBe(3)
    expect(messages[2]).toContain('once more shortly')
  })

  it('Retry clears the count before the latch engages', async () => {
    let at = 0
    const calls = { count: 0 }
    const messages: string[] = []
    const source = failingSource(
      () => at,
      calls,
      messages,
      () => 2,
    )
    await source.containment()
    expect(messages[0]).toContain('once more shortly')
    source.reset()
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    await source.containment()
    // Without the reset this second failure would latch the hooks aside.
    expect(messages[1]).toContain('once more shortly')
    expect(calls.count).toBe(2)
  })

  it('a success clears the count before the latch engages', async () => {
    let at = 0
    const calls = { count: 0 }
    const messages: string[] = []
    let shouldSucceed = false
    const source = pluginContainment({
      platform: 'win32',
      newJobExecutable: () => {
        calls.count += 1
        return togglingExecutable(() => shouldSucceed)
      },
      now: () => at,
      log: (message: string) => {
        messages.push(message)
      },
      maxFailures: () => 2,
    })
    await source.containment()
    shouldSucceed = true
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    const ready = await source.containment()
    expect(ready).toMatchObject({ kind: 'job' })
    shouldSucceed = false
    at += PLUGIN_JOB_RETRY_BACKOFF_MS
    await source.containment()
    // The earlier failure was cleared by the success: this reads as the first again.
    expect(messages.at(-1)).toContain('once more shortly')
  })
})
