// The ACP agent's child-work admission (M116, PLAN.md D219): `/agents
// continue|retry` through the `SubagentAdmission` port. The M107
// governor's latest reading pauses the resume only at its paused level,
// where the governor itself pauses new work; unknown — no reading, or a
// failed refresh — never pauses work (owner rule). The round covers the
// control call; the wait honors `isOver` for callers that hold it open.
import { describe, expect, it } from 'vitest'
import { createReadingHolder } from '../../src/core/orchestration/playbook/readingHolder'
import {
  createSubagentAdmission,
  SUBAGENT_PAUSED_REASON,
} from '../../src/runtime/playbook/admission'
import { UI_TEXT } from '../../src/shared/constants'
import type { ResourceLevel, ResourceStatus } from '../../src/shared/resources'
import { resourceStatus as status } from './helpers/playbook/resourceStatus'

function refusedValue(reason: string, shown: string): string {
  return `${reason} / ${shown}`
}

/** The port may answer undefined; this admission never does, and the tests prove it. */
function answered(call: Promise<string> | undefined): Promise<string> {
  if (call === undefined) throw new Error('the admission must answer')
  return call
}

describe('the ACP child-work admission', () => {
  it('refuses the resume at the paused level, and the effect never runs', async () => {
    const admission = createSubagentAdmission({
      holder: createReadingHolder<ResourceStatus>(),
      readResourceStatus: () => Promise.resolve(status('pause')),
    })
    let effects = 0
    const outcome = await admission(
      'delegate',
      'session-1',
      'subagent-1',
      () => {
        effects += 1
        return Promise.resolve('ran')
      },
      () => true,
      refusedValue,
    )
    expect(effects).toBe(0)
    expect(outcome).toBe(`${SUBAGENT_PAUSED_REASON} / ${UI_TEXT.agentResumePaused}`)
  })

  it('admits when the reading is unknown', async () => {
    const holder = createReadingHolder<ResourceStatus>()
    const admission = createSubagentAdmission({
      holder,
      readResourceStatus: () => Promise.resolve(undefined),
    })
    const outcome = await admission(
      'delegate',
      'session-1',
      'subagent-1',
      () => Promise.resolve('ran'),
      () => true,
      () => {
        throw new Error('unknown must not refuse')
      },
    )
    expect(outcome).toBe('ran')
    expect(holder.get()).toBeUndefined()
  })

  it.each(['normal', 'throttle'] as const)('admits below the paused level (%s)', async (level) => {
    const admission = createSubagentAdmission({
      holder: createReadingHolder<ResourceStatus>(),
      readResourceStatus: () => Promise.resolve(status(level)),
    })
    const outcome = await admission(
      'delegate',
      'session-1',
      'subagent-1',
      () => Promise.resolve('ran'),
      () => true,
      () => {
        throw new Error(`${level} must not refuse`)
      },
    )
    expect(outcome).toBe('ran')
  })

  it('admits when the refresh fails, clearing to unknown', async () => {
    const holder = createReadingHolder<ResourceStatus>()
    holder.set(status('pause'))
    const admission = createSubagentAdmission({
      holder,
      readResourceStatus: () => Promise.reject(new Error('governor unreachable')),
    })
    const outcome = await admission(
      'delegate',
      'session-1',
      'subagent-1',
      () => Promise.resolve('ran'),
      () => true,
      () => {
        throw new Error('a failed refresh must not refuse')
      },
    )
    expect(outcome).toBe('ran')
    expect(holder.get()).toBeUndefined()
  })

  it('refreshes on every call, never deciding on a stale reading', async () => {
    let level: ResourceLevel = 'pause'
    const admission = createSubagentAdmission({
      holder: createReadingHolder<ResourceStatus>(),
      readResourceStatus: () => Promise.resolve(status(level)),
    })
    const run = (): Promise<string> =>
      answered(
        admission(
          'delegate',
          'session-1',
          'subagent-1',
          () => Promise.resolve('ran'),
          () => true,
          (_reason, shown) => shown,
        ),
      )
    expect(await run()).toBe(UI_TEXT.agentResumePaused)
    level = 'normal'
    expect(await run()).toBe('ran')
  })

  it('waits for the round to end before resolving', async () => {
    const admission = createSubagentAdmission({
      holder: createReadingHolder<ResourceStatus>(),
      readResourceStatus: () => Promise.resolve(status('normal')),
    })
    let wakes = 0
    let captured: (() => void) | undefined
    let isSettled = false
    const outcome = answered(
      admission(
        'delegate',
        'session-1',
        'subagent-1',
        () => Promise.resolve('done'),
        (wake) => {
          wakes += 1
          captured = wake
          return wakes > 1
        },
        () => {
          throw new Error('normal must not refuse')
        },
      ),
    )
    void (async () => {
      try {
        await outcome
      } finally {
        isSettled = true
      }
    })()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(wakes).toBe(1)
    expect(isSettled).toBe(false)
    captured?.()
    await expect(outcome).resolves.toBe('done')
    expect(wakes).toBe(2)
  })

  it('gates every child-work kind alike: capacity is machine-global', async () => {
    const admission = createSubagentAdmission({
      holder: createReadingHolder<ResourceStatus>(),
      readResourceStatus: () => Promise.resolve(status('pause')),
    })
    for (const kind of ['subagent', 'delegate'] as const) {
      const outcome = await admission(
        kind,
        'session-1',
        'subagent-1',
        () => Promise.resolve('ran'),
        () => true,
        (_reason, shown) => shown,
      )
      expect(outcome, kind).toBe(UI_TEXT.agentResumePaused)
    }
  })
})
