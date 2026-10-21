// Schedule paid consent until M115 Lane U wires it (MSM58M69, PLAN.md
// D204). Only the production refusal a person can reach today is tested:
// `ScheduleSurface` refuses a paid V2 create/update unless the trusted
// caller carries `scheduledPrompts` and a budget at least the draft's cap
// (the panel's caller carries neither, `src/runtime/schedules/runtime.ts`).
// The unwired helpers (`askSchedulePaidConsent`, `createSchedulePaidScope`,
// `paidAccountQuestion`) have no production caller yet, so no test feeds
// them invented fixtures: invented model, account, price and scripted
// popup answers prove nothing about a firing run (REL237FIX).
//
// Real modules throughout; a dependency that must never be reached throws
// instead of standing in for the ledger or the popup.
import { describe, expect, it } from 'vitest'
import { ScheduleBackgroundCoordinator } from '../../src/runtime/schedules/background'
import { ScheduleSurface } from '../../src/runtime/schedules/surface'
import type { ScheduleCallerContext } from '../../src/runtime/schedules/args'
import { UI_TEXT } from '../../src/shared/constants'
import { scheduleDraftSchema, type ScheduleDraft } from '../../src/shared/scheduleV2'
import { canonicalUsd } from '../../src/shared/usdSchema'
import { onceScheduleRouting } from './helpers/scheduleRouting'

const NOW = 1_790_000_000_000
const AT = 1_800_000_000_000

/** A port that must never be reached: throws instead of standing in. */
function neverReached(name: string): () => never {
  return () => {
    throw new Error(`must not reach ${name}`)
  }
}

function draftWith(paidCapUsd: string): ScheduleDraft {
  return scheduleDraftSchema.parse({
    name: 'Test schedule',
    action: { kind: 'prompt', prompt: 'Summarize the inbox' },
    ...onceScheduleRouting(AT, canonicalUsd('1')),
    paidCapUsd: canonicalUsd(paidCapUsd),
    parallel: false,
    zone: 'America/Los_Angeles',
    pinned: false,
  })
}

// The real surface over a real background coordinator; every port past
// the paid gate must stay unreached on a refusal, so it throws.
function surface(): ScheduleSurface {
  return new ScheduleSurface({
    request: neverReached('forward'),
    background: new ScheduleBackgroundCoordinator({
      entry: {
        status: neverReached('background status'),
        register: neverReached('background register'),
        remove: neverReached('background remove'),
      },
      consent: { exclusive: neverReached('background consent') },
      now: () => NOW,
      nextWakeAtMs: neverReached('next wake'),
    }),
    askBackground: neverReached('askBackground'),
    notice: neverReached('notice'),
  })
}

async function createOnSurface(
  draft: ScheduleDraft,
  caller: ScheduleCallerContext,
  forward: () => Promise<unknown> = neverReached('forward'),
) {
  return await surface().request(
    { method: 'schedules/create', workspaceKey: 'test-workspace', draft },
    'test-workspace',
    forward,
    caller,
  )
}

describe('the production surface refuses a paid V2 draft without caller budget (M58/D204)', () => {
  // The panel's caller, word for word (`ScheduleRuntime.message`).
  const panelCaller: ScheduleCallerContext = {
    source: 'interactive',
    isInteractive: true,
    scheduledPrompts: false,
  }

  it('a paid draft from the panel is refused before anything is forwarded', async () => {
    const result = await createOnSurface(draftWith('1'), panelCaller)
    expect(result).toEqual({
      kind: 'refused',
      reason: UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired,
    })
  })

  it('a cap carried only by the grant is refused the same way', async () => {
    const result = await createOnSurface(draftWith('0'), panelCaller)
    expect(result).toEqual({
      kind: 'refused',
      reason: UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired,
    })
  })

  it('a caller budget below the cap is refused', async () => {
    const result = await createOnSurface(draftWith('1'), {
      source: 'cli',
      isInteractive: false,
      scheduledPrompts: true,
      maxBudgetUsd: canonicalUsd('0.5'),
    })
    expect(result).toEqual({
      kind: 'refused',
      reason: UI_TEXT.scheduleV2.runtime.paidAuthorizationRequired,
    })
  })

  it('a caller with the flag and enough budget passes the surface gate', async () => {
    let wasReached = false
    const result = await createOnSurface(
      draftWith('1'),
      {
        source: 'cli',
        isInteractive: false,
        scheduledPrompts: true,
        maxBudgetUsd: canonicalUsd('2'),
      },
      () => {
        wasReached = true
        throw new Error('forward reached')
      },
    )
    // The surface turns the forward's failure into its unavailable refusal;
    // what matters is that the paid gate let the request through to it.
    expect(wasReached).toBe(true)
    expect(result).toEqual({
      kind: 'refused',
      reason: UI_TEXT.scheduleV2.runtime.unavailable,
    })
  })
})
