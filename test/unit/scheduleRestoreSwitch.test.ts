import { afterEach, expect, it } from 'vitest'
import { COMMAND_REFERENCE, featureCatalog } from '../../src/shared/featureCatalog'
import {
  SCHEDULE_EDITOR_DELIVERY_CERTIFICATION,
  OPTIONAL_RUNTIME_AVAILABILITY,
  UI_TEXT,
} from '../../src/shared/constants'
import { compactReference } from '../../src/shared/cliCommands'
import { formatAcpUsage } from '../../src/runtime/cliOptions'

afterEach(() =>
  Object.defineProperty(SCHEDULE_EDITOR_DELIVERY_CERTIFICATION, 'isReady', { value: false }),
)
it.each([false, true])(
  'one certification switch controls runtime, command and help publication: %s',
  (isReady) => {
    Object.defineProperty(SCHEDULE_EDITOR_DELIVERY_CERTIFICATION, 'isReady', { value: isReady })
    expect(OPTIONAL_RUNTIME_AVAILABILITY.schedules).toBe(isReady)
    for (const command of ['schedulePrompt', 'showSchedules', 'showScheduleTimeline'] as const)
      expect(COMMAND_REFERENCE[command].canRun).toBe(isReady)
    const details = featureCatalog().flatMap((feature) => feature.details)
    expect(details).toContainEqual({
      ui: isReady ? 'referenceSchedulesCertified' : 'referenceSchedules',
    })
    expect(details).toContainEqual({
      ui: isReady ? 'referenceRuntimeSchedulesCertified' : 'referenceRuntimeSchedules',
    })
    expect(details).toContainEqual({
      ui: isReady ? 'referenceSchedulePaidConsentCertified' : 'referenceSchedulePaidConsent',
    })
    expect(formatAcpUsage(UI_TEXT, 'muse-spark-code-acp').includes('--scheduled-prompts')).toBe(
      isReady,
    )
    expect(compactReference([]).includes('Commands: schedule')).toBe(false)
    const commands = compactReference([])
      .split('\n')
      .find((line) => line.startsWith(UI_TEXT.referenceCommands))
    expect(commands?.includes(', schedule,')).toBe(isReady)
  },
)
