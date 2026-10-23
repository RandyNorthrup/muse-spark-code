// M96d Traffic suggestions: each bottleneck rule fires with its
// reason, thresholds stay the person's own, and a dismissal holds.
import { describe, expect, it } from 'vitest'
import type { TeamIntensityLevel } from '../../src/shared/constants'
import {
  buildTrafficSuggestions,
  dismissTrafficSuggestion,
  type TrafficDismissalStore,
  type TrafficSuggestionContext,
} from '../../src/core/team/trafficSuggestions'

function store(): TrafficDismissalStore {
  const dismissed = new Set<string>()
  return {
    isDismissed: (key) => dismissed.has(key),
    dismiss: (key) => {
      dismissed.add(key)
    },
  }
}

function context(overrides: Partial<TrafficSuggestionContext> = {}): TrafficSuggestionContext {
  return {
    reviewWaiters: 0,
    reviewerHeadroom: 0,
    reviewRole: 'code-review',
    reviewerCandidates: [],
    runningWaiters: 0,
    level: 'balanced',
    throttledEntries: [],
    conflictsByPath: new Map(),
    loadGuardTrips: 0,
    runners: 1,
    canAddRunner: true,
    userWaiters: 0,
    thresholds: {},
    dismissals: store(),
    ...overrides,
  }
}

describe('M96d Traffic suggestions', () => {
  it('adds a reviewer when review is the bottleneck', () => {
    const full = context({
      reviewWaiters: 3,
      reviewerCandidates: [{ modelRef: 'muse-spark-1.3' }],
      thresholds: { reviewWaiters: 2 },
    })
    expect(buildTrafficSuggestions(full)).toEqual([
      {
        kind: 'trafficBottleneck',
        action: { action: 'addReviewer', role: 'code-review', modelRef: 'muse-spark-1.3' },
        reason:
          '3 changes wait for review with no free reviewer lane; adding muse-spark-1.3 to code-review unblocks them',
      },
    ])
    const one = context({
      reviewWaiters: 1,
      reviewerCandidates: [{ modelRef: 'muse-spark-1.3' }],
      thresholds: { reviewWaiters: 1 },
    })
    expect(buildTrafficSuggestions(one)[0]?.reason).toBe(
      '1 change waits for review with no free reviewer lane; adding muse-spark-1.3 to code-review unblocks it',
    )
    // Free headroom drains the queue: no bottleneck, no suggestion.
    expect(buildTrafficSuggestions(context({ ...full, reviewerHeadroom: 2 }))).toEqual([])
    // Below the person's threshold, or none set, or nobody capable.
    expect(buildTrafficSuggestions(context({ ...full, reviewWaiters: 1 }))).toEqual([])
    expect(buildTrafficSuggestions(context({ ...full, thresholds: {} }))).toEqual([])
    expect(buildTrafficSuggestions(context({ ...full, reviewerCandidates: [] }))).toEqual([])
  })

  it('raises the intensity when tasks wait on the running caps', () => {
    const full = context({ runningWaiters: 4, thresholds: { runningWaiters: 2 } })
    expect(buildTrafficSuggestions(full)).toEqual([
      {
        kind: 'trafficBottleneck',
        action: { action: 'raiseIntensity', from: 'balanced', to: 'heavy' },
        reason:
          '4 tasks are ready but the running caps are full; raising intensity from Balanced to Heavy starts more',
      },
    ])
    // At Max there is nowhere to raise to.
    expect(buildTrafficSuggestions(context({ ...full, level: 'max' }))).toEqual([])
    expect(buildTrafficSuggestions(context({ ...full, thresholds: {} }))).toEqual([])
    expect(buildTrafficSuggestions(context({ ...full, runningWaiters: 1 }))).toEqual([])
  })

  it('adds an entry on another provider when an agent is throttled often', () => {
    const full = context({
      throttledEntries: [
        {
          entryId: 'eng-main',
          role: 'engineering',
          provider: 'meta',
          throttles: 5,
          candidates: [
            { modelRef: 'codex-cli', provider: 'openai' },
            { modelRef: 'other-meta', provider: 'meta' },
          ],
        },
      ],
      thresholds: { throttles: 3 },
    })
    expect(buildTrafficSuggestions(full)).toEqual([
      {
        kind: 'trafficBottleneck',
        action: {
          action: 'addProviderEntry',
          entryId: 'eng-main',
          role: 'engineering',
          modelRef: 'codex-cli',
          provider: 'openai',
        },
        reason: 'eng-main was throttled 5 times; adding codex-cli on openai spreads the load',
      },
    ])
    // Same-provider candidates do not spread the load.
    const sameOnly = context({
      throttledEntries: [
        {
          entryId: 'eng-main',
          role: 'engineering',
          provider: 'meta',
          throttles: 5,
          candidates: [{ modelRef: 'other-meta', provider: 'meta' }],
        },
      ],
      thresholds: { throttles: 3 },
    })
    expect(buildTrafficSuggestions(sameOnly)).toEqual([])
    expect(buildTrafficSuggestions(context({ ...full, thresholds: {} }))).toEqual([])
  })

  it('declares a shared file when one file causes most conflicts', () => {
    const full = context({
      conflictsByPath: new Map([
        ['src/shared/constants.ts', 3],
        ['notes.txt', 1],
      ]),
    })
    expect(buildTrafficSuggestions(full)).toEqual([
      {
        kind: 'trafficBottleneck',
        action: { action: 'declareSharedFile', path: 'src/shared/constants.ts' },
        reason:
          'src/shared/constants.ts caused 3 conflicts out of 4; declaring it a shared file with regions lets the next changes land cleanly',
      },
    ])
    // A tie is not "most"; an empty period has no top file.
    const tied = context({
      conflictsByPath: new Map([
        ['a.ts', 2],
        ['b.ts', 2],
      ]),
    })
    expect(buildTrafficSuggestions(tied)).toEqual([])
    expect(buildTrafficSuggestions(context())).toEqual([])
  })

  it('adds a runner, or lowers the intensity, when the load guard trips often', () => {
    const full = context({ loadGuardTrips: 4, runners: 2, thresholds: { loadGuardTrips: 3 } })
    expect(buildTrafficSuggestions(full)).toEqual([
      {
        kind: 'trafficBottleneck',
        action: { action: 'addRunner', runners: 3 },
        reason: 'The load guard tripped 4 times; adding a runner (now 3) absorbs the load',
      },
      {
        kind: 'trafficBottleneck',
        action: { action: 'lowerIntensity', from: 'balanced', to: 'light' },
        reason:
          'The load guard tripped 4 times; lowering intensity from Balanced to Light eases the machine',
      },
    ])
    // Minimal cannot go lower; a capped host cannot add a runner.
    const minimal = context({
      loadGuardTrips: 4,
      level: 'minimal',
      runners: 2,
      thresholds: { loadGuardTrips: 3 },
    })
    expect(buildTrafficSuggestions(minimal).map((suggestion) => suggestion.action.action)).toEqual([
      'addRunner',
    ])
    const capped = context({ ...full, canAddRunner: false })
    expect(buildTrafficSuggestions(capped).map((suggestion) => suggestion.action.action)).toEqual([
      'lowerIntensity',
    ])
    // Nothing applicable, nothing suggested.
    const stuck = context({ ...capped, level: 'minimal' })
    expect(buildTrafficSuggestions(stuck)).toEqual([])
    expect(buildTrafficSuggestions(context({ ...full, thresholds: {} }))).toEqual([])
  })

  it('counts the tasks waiting for the user', () => {
    expect(buildTrafficSuggestions(context({ userWaiters: 2 }))).toEqual([
      {
        kind: 'trafficBottleneck',
        action: { action: 'userWaiters', count: 2 },
        reason: '2 tasks wait for you; answering unblocks them',
      },
    ])
    expect(buildTrafficSuggestions(context({ userWaiters: 1 }))[0]?.reason).toBe(
      '1 task waits for you; answering unblocks it',
    )
    expect(buildTrafficSuggestions(context())).toEqual([])
  })

  it('keeps rule order stable and honours dismissals', () => {
    const dismissals = store()
    const full = context({
      reviewWaiters: 3,
      reviewerCandidates: [{ modelRef: 'muse-spark-1.3' }],
      runningWaiters: 4,
      throttledEntries: [
        {
          entryId: 'eng-main',
          role: 'engineering',
          provider: 'meta',
          throttles: 5,
          candidates: [{ modelRef: 'codex-cli', provider: 'openai' }],
        },
      ],
      conflictsByPath: new Map([['src/shared/constants.ts', 3]]),
      loadGuardTrips: 4,
      runners: 1,
      userWaiters: 2,
      thresholds: { reviewWaiters: 1, runningWaiters: 1, throttles: 1, loadGuardTrips: 1 },
      dismissals,
    })
    const actions = (built: ReturnType<typeof buildTrafficSuggestions>): readonly string[] =>
      built.map((suggestion) => suggestion.action.action)
    expect(actions(buildTrafficSuggestions(full))).toEqual([
      'addReviewer',
      'raiseIntensity',
      'addProviderEntry',
      'declareSharedFile',
      'addRunner',
      'lowerIntensity',
      'userWaiters',
    ])
    for (const suggestion of buildTrafficSuggestions(full))
      dismissTrafficSuggestion(dismissals, suggestion)
    expect(buildTrafficSuggestions(full)).toEqual([])
  })

  it('dismisses shared files per file and entries per entry', () => {
    const dismissals = store()
    const files = context({
      conflictsByPath: new Map([
        ['src/shared/constants.ts', 3],
        ['src/shared/l10n/en.ts', 1],
      ]),
      dismissals,
    })
    const [first] = buildTrafficSuggestions(files)
    expect(first?.action).toEqual({
      action: 'declareSharedFile',
      path: 'src/shared/constants.ts',
    })
    if (first !== undefined) dismissTrafficSuggestion(dismissals, first)
    expect(buildTrafficSuggestions(files)).toEqual([])
    // Another file taking the lead still advises: only its own key holds.
    const moved = context({
      conflictsByPath: new Map([
        ['src/shared/constants.ts', 1],
        ['src/shared/l10n/en.ts', 3],
      ]),
      dismissals,
    })
    expect(buildTrafficSuggestions(moved)[0]?.action).toEqual({
      action: 'declareSharedFile',
      path: 'src/shared/l10n/en.ts',
    })
  })

  it('steps intensity along the level order', () => {
    const levels: readonly TeamIntensityLevel[] = ['minimal', 'light', 'balanced', 'heavy', 'max']
    for (const [index, level] of levels.entries()) {
      const raise = buildTrafficSuggestions(
        context({ runningWaiters: 2, level, thresholds: { runningWaiters: 1 } }),
      )
      const higher = levels[index + 1]
      expect(raise[0]?.action).toEqual(
        higher === undefined ? undefined : { action: 'raiseIntensity', from: level, to: higher },
      )
      const lower = buildTrafficSuggestions(
        context({ loadGuardTrips: 2, level, thresholds: { loadGuardTrips: 1 } }),
      ).find((suggestion) => suggestion.action.action === 'lowerIntensity')
      const down = levels[index - 1]
      expect(lower?.action).toEqual(
        down === undefined ? undefined : { action: 'lowerIntensity', from: level, to: down },
      )
    }
  })
})
