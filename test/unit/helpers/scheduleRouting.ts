import type { UsdAmount } from '../../../src/shared/usdSchema'

/** The once-into-a-conversation routing block every test schedule carries. */
export function onceScheduleRouting(atMs: number, grantCapUsd: UsdAmount) {
  return {
    trigger: { kind: 'once', atMs },
    target: { kind: 'conversation', sessionId: 'test-session', backend: 'modelApi' },
    delivery: 'whenIdle',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: { rules: [], destinationIds: [], paidCapUsd: grantCapUsd },
  }
}
