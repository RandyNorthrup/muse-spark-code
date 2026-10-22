// Edge 4: a forecast computed under a replaced credential is withdrawn,
// never delivered, displayed or spun up under the new generation. The run
// is the real estimator over a real plan snapshot and the real fleet
// binding; only the credential generation moves, through the reader.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPlanSnapshot } from '../../src/core/estimator/planSnapshot'
import { fleetIoFromSources } from '../../src/host/estimator/fleetBinding'
import { estimatorSourcePorts } from '../../src/host/estimator/localFleet'
import { createEstimatorRun } from '../../src/host/estimator/estimatorEntry'
import { parseEstimateGoal } from '../../src/shared/estimate'
import { amount } from './helpers/estimatorKindScheduleFixtures'
import { EN } from '../../src/shared/l10n/en'
import { BASE_LOCALE, UI_TEXT, setUiText } from '../../src/shared/l10n/text'
import { conversationPanel, modelApiRig } from './helpers/conversationPanel'
import type { HostToWebviewMessage } from '../../src/shared/protocol'

const AS_OF = '2026-10-06T12:00:00.000Z'
const NOW = Date.parse(AS_OF)
// The plan behind the held forecast: real plan text, never invented lanes.
const PLAN = `## 6. Milestones

### M117 — Capacity work (2026-10-06)

**Status 2026-10-06: building.**

- **Goal.** Ship capacity.
- **Depends on.** Nothing new.
- **Gates.** The full gate.

| Lane | Items | Files it owns | Starts | Hours |
| ---- | ----- | ------------- | ------ | ----- |
| 0 | all | \`src/a.ts\` | First | 8 |
`

beforeEach(() => {
  setUiText(EN, BASE_LOCALE)
})

afterEach(() => {
  setUiText(EN, BASE_LOCALE)
})

function warningTexts(posted: readonly HostToWebviewMessage[]): string[] {
  const texts: string[] = []
  for (const message of posted) {
    if (message.type === 'notice' && message.level === 'warning') texts.push(message.text)
  }
  return texts
}

describe('estimate withdrawal on credential change', () => {
  it('withdraws an in-flight forecast computed under the replaced credential', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-estimate-withdraw-'))
    try {
      // A known percent window with a future reset admits the lane, so the
      // run delivers a section unless the generation moves first.
      const goal = parseEstimateGoal('M117')
      if (goal === undefined) throw new Error('unparseable goal: M117')
      const snapshot = buildPlanSnapshot(PLAN, goal, AS_OF, { branches: [] })
      for (const row of snapshot.lanes) row.lane.resources.accountPercentPerHour = amount(60)
      const run = createEstimatorRun(
        estimatorSourcePorts(
          () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
          () => Promise.resolve(snapshot),
          fleetIoFromSources({
            settings: () => undefined,
            activeAccount: () => ({
              kind: 'limits',
              generation: '1',
              providerId: 'meta',
              accountId: 'work',
              label: 'Work',
              snapshot: {
                planWindows: {
                  weekly: { usedPercent: 90, resetAt: '2026-10-06T13:00:00.000Z' },
                },
              },
              nowMs: NOW,
            }),
            ci: () => [],
          }),
        ),
        EN,
        BASE_LOCALE,
      )
      let generation = '1'
      const rig = modelApiRig(directory)
      const panel = conversationPanel({
        rig,
        directory,
        estimator: run,
        estimatorGeneration: () => generation,
      })
      const pending = panel.controller.handle({
        type: 'estimateRun',
        requestId: 'old',
        request: { goal, asOf: AS_OF, fleet: 'current', optimize: 'cost' },
      })
      // The run is never aborted and the provider never switches: only the
      // credential generation moves while the estimate is in flight.
      generation = '2'
      await pending
      expect(panel.posted.filter((message) => message.type === 'estimatorSection')).toHaveLength(0)
      expect(panel.posted.filter((message) => message.type === 'estimatorFailure')).toContainEqual({
        type: 'estimatorFailure',
        requestId: 'old',
        diagnostic: { estimateDiagnostic: 'estimate-credential-changed' },
      })
      expect(warningTexts(panel.posted)).toContain(UI_TEXT.estimateCredentialChanged)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('refuses to spin up a held forecast after a credential change', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'muse-estimate-withdraw-spin-'))
    try {
      const goal = parseEstimateGoal('M117')
      if (goal === undefined) throw new Error('unparseable goal: M117')
      const snapshot = buildPlanSnapshot(PLAN, goal, AS_OF, { branches: [] })
      for (const row of snapshot.lanes) row.lane.resources.accountPercentPerHour = amount(60)
      const run = createEstimatorRun(
        estimatorSourcePorts(
          () => ({ enabled: false, networkAllowed: false, maxAgeMs: 0, catalogUrls: [] }),
          () => Promise.resolve(snapshot),
          fleetIoFromSources({
            settings: () => undefined,
            activeAccount: () => ({
              kind: 'limits',
              generation: '1',
              providerId: 'meta',
              accountId: 'work',
              label: 'Work',
              snapshot: {
                planWindows: {
                  weekly: { usedPercent: 90, resetAt: '2026-10-06T13:00:00.000Z' },
                },
              },
              nowMs: NOW,
            }),
            ci: () => [],
          }),
        ),
        EN,
        BASE_LOCALE,
      )
      let generation = '1'
      const rig = modelApiRig(directory)
      const panel = conversationPanel({
        rig,
        directory,
        estimator: run,
        estimatorGeneration: () => generation,
      })
      await panel.controller.handle({
        type: 'estimateRun',
        requestId: 'first',
        request: { goal, asOf: AS_OF, fleet: 'current', optimize: 'cost' },
      })
      expect(panel.posted.filter((message) => message.type === 'estimatorSection')).toHaveLength(1)
      generation = '2'
      await panel.controller.handle({
        type: 'estimateSpinUp',
        requestId: 'start',
        setup: 'current',
      })
      expect(panel.posted.filter((message) => message.type === 'estimatorStarted')).toHaveLength(0)
      expect(panel.posted.filter((message) => message.type === 'estimatorFailure')).toContainEqual({
        type: 'estimatorFailure',
        requestId: 'start',
        diagnostic: { estimateDiagnostic: 'estimate-credential-changed' },
      })
      expect(warningTexts(panel.posted)).toContain(UI_TEXT.estimateCredentialChanged)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
