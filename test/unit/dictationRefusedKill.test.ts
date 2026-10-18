import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it, vi } from 'vitest'
import { Dictation, type DictationStatus, type HelperChild } from '../../src/core/voice/dictation'
import type { CoreLogger } from '../../src/core/logging'
import { DICTATION_HELPER_COMMANDS } from '../../src/shared/constants'

const quiet = () => undefined
const log: CoreLogger = { trace: quiet, info: quiet, warn: quiet, error: quiet }

/**
 * The host side of the driver's spawn seam: a helper whose kill is
 * refused (it answers through `onStopFailed` and never exits on its own)
 * until the test observes its exit by hand. A real process cannot refuse
 * its own kill, so this path is only reachable through the seam the
 * driver was designed around.
 */
class ScriptChild implements HelperChild {
  private readonly data: ((chunk: Buffer | string) => void)[] = []
  private readonly exits: ((description: string) => void)[] = []
  private readonly refusals: ((description: string) => void)[] = []
  public readonly sent: string[] = []
  public kills = 0
  public readonly stdout = {
    on: (_event: 'data', listener: (chunk: Buffer | string) => void): unknown => {
      this.data.push(listener)
      return undefined
    },
  }
  public readonly stderr = {
    on: (_event: 'data', listener: (chunk: Buffer | string) => void): unknown => {
      this.data.push(listener)
      return undefined
    },
  }

  public send(line: string): void {
    this.sent.push(line)
  }

  public onExit(listener: (description: string) => void): void {
    this.exits.push(listener)
  }

  public onStopFailed(listener: (description: string) => void): void {
    this.refusals.push(listener)
  }

  public kill(): void {
    this.kills += 1
    for (const refusal of this.refusals) refusal('refused')
  }

  public feed(line: string): void {
    for (const listener of this.data) listener(`${line}\n`)
  }

  public exit(description: string): void {
    for (const listener of this.exits) listener(description)
    this.exits.length = 0
  }
}

function harness() {
  const spawned: ScriptChild[] = []
  const statuses: DictationStatus[] = []
  const errors: string[] = []
  let stopped = 0
  const driver = new Dictation({
    invocation: { command: 'helper', args: [] },
    spawn: () => {
      const child = new ScriptChild()
      spawned.push(child)
      return child
    },
    listener: {
      onStatus: (status) => {
        statuses.push(status)
      },
      onText: quiet,
      onError: (reason) => {
        errors.push(reason)
      },
      onStopped: () => {
        stopped += 1
      },
    },
    log,
  })
  return { spawned, statuses, errors, driver, stopped: () => stopped }
}

const ready = JSON.stringify({ type: 'ready', language: 'en' })

async function listening(h: ReturnType<typeof harness>): Promise<ScriptChild> {
  h.driver.start()
  expect(h.spawned).toHaveLength(1)
  const child = h.spawned[0]
  child.feed(ready)
  expect(child.sent).toEqual([DICTATION_HELPER_COMMANDS.start])
  child.feed(JSON.stringify({ type: 'listening' }))
  await delay(5)
  return child
}

// The failure settles only after two sequential quit-grace waits (2 s each).
const FAILURE_SETTLE_TIMEOUT_MS = 9000

/** Either the retained retry kill (fixed) or the idle report (broken). */
async function awaitFailureSettled(
  first: ScriptChild,
  statuses: readonly DictationStatus[],
): Promise<void> {
  await vi.waitFor(
    () => {
      expect(first.kills >= 2 || statuses.includes('idle')).toBe(true)
    },
    { timeout: FAILURE_SETTLE_TIMEOUT_MS, interval: 50 },
  )
}

describe('a twice-refused dictation kill', () => {
  it(
    'queues presses behind the observed exit instead of starting a second recorder',
    { timeout: FAILURE_SETTLE_TIMEOUT_MS + 1000 },
    async () => {
      const h = harness()
      const first = await listening(h)
      expect(h.statuses).toEqual(['starting', 'listening'])
      first.feed(JSON.stringify({ type: 'error', reason: 'boom' }))
      await awaitFailureSettled(first, h.statuses)
      // The failure kill and at least one retry were refused: the failure
      // is said, but no second recorder starts and idle is not reported.
      expect(first.kills).toBeGreaterThanOrEqual(2)
      expect(h.spawned).toHaveLength(1)
      expect(h.statuses).not.toContain('idle')
      expect(h.errors).toEqual(['boom'])
      // A press meanwhile queues behind the observed exit.
      h.driver.start()
      await delay(25)
      expect(h.spawned).toHaveLength(1)
      expect(h.statuses.at(-1)).toBe('starting')
      // The observed exit releases the reaping onto exactly one recorder.
      first.exit('gone')
      await vi.waitFor(
        () => {
          expect(h.spawned).toHaveLength(2)
        },
        { timeout: 1000, interval: 25 },
      )
      expect(h.statuses.at(-1)).toBe('starting')
      expect(h.errors).toEqual(['boom'])
      const second = h.spawned[1]
      second.feed(ready)
      expect(second.sent).toEqual([DICTATION_HELPER_COMMANDS.start])
    },
  )

  it(
    'reports idle with no new recorder when nothing queued behind the retained exit',
    { timeout: FAILURE_SETTLE_TIMEOUT_MS + 1000 },
    async () => {
      const h = harness()
      const first = await listening(h)
      first.feed(JSON.stringify({ type: 'error', reason: 'boom' }))
      await awaitFailureSettled(first, h.statuses)
      expect(h.spawned).toHaveLength(1)
      first.exit('gone')
      await vi.waitFor(
        () => {
          expect(h.statuses.at(-1)).toBe('idle')
        },
        { timeout: 1000, interval: 25 },
      )
      expect(h.spawned).toHaveLength(1)
      expect(h.errors).toEqual(['boom'])
    },
  )

  it('still ends a clean recording through quit and its observed exit', async () => {
    const h = harness()
    const first = await listening(h)
    h.driver.stop()
    expect(first.sent).toContain(DICTATION_HELPER_COMMANDS.stop)
    first.feed(JSON.stringify({ type: 'stopped' }))
    await delay(10)
    expect(first.sent).toContain(DICTATION_HELPER_COMMANDS.quit)
    first.exit('gone')
    await delay(10)
    expect(h.spawned).toHaveLength(1)
    expect(h.statuses.at(-1)).toBe('idle')
    expect(h.stopped()).toBe(1)
  })
})
