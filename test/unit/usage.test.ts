import { afterEach, describe, expect, it } from 'vitest'
import { EN } from '../../src/shared/l10n/en'
import { setUiText } from '../../src/shared/l10n/text'
import {
  barValue,
  formatDuration,
  formatWindowLength,
  planLabel,
  subscriptionUsageSchema,
  usageReadResultSchema,
} from '../../src/shared/usage'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = 1_800_000_000_000

describe('subscription usage schemas', () => {
  it('reads the SDK shape and tolerates an empty usage/read result', () => {
    const usage = {
      observedAtMs: NOW,
      tier: 'muse-pro',
      window: { usedPercent: 42, resetsAtMs: NOW + HOUR, windowDurationMins: 300 },
      weekly: { usedPercent: 120, resetsAtMs: NOW + 3 * DAY },
    }
    expect(subscriptionUsageSchema.parse(usage)).toEqual(usage)
    expect(usageReadResultSchema.parse({})).toEqual({ usage: undefined })
    expect(usageReadResultSchema.parse({ usage }).usage).toEqual(usage)
    expect(subscriptionUsageSchema.safeParse({ tier: 'x' }).success).toBe(false)
  })
})

describe('barValue', () => {
  it('clamps the provider percent to the bar without touching the label', () => {
    expect(barValue(42)).toBe(42)
    expect(barValue(130)).toBe(100)
    expect(barValue(-3)).toBe(0)
  })
})

describe('formatDuration', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('rounds up to whole minutes and drops zero parts', () => {
    expect(formatDuration(NOW + 2 * HOUR + 5 * MINUTE, NOW)).toBe('2h 5m')
    expect(formatDuration(NOW + 2 * HOUR, NOW)).toBe('2h')
    expect(formatDuration(NOW + 3 * DAY + 4 * HOUR, NOW)).toBe('3d 4h')
    expect(formatDuration(NOW + 3 * DAY, NOW)).toBe('3d')
    expect(formatDuration(NOW + 30_000, NOW)).toBe('1m')
    expect(formatDuration(NOW + 90 * MINUTE + 1, NOW)).toBe('1h 31m')
  })

  it('says now once the moment has passed', () => {
    expect(formatDuration(NOW, NOW)).toBe('now')
    expect(formatDuration(NOW - HOUR, NOW)).toBe('now')
  })

  it('uses the display language’s units and its word for now (M40)', () => {
    setUiText({ ...EN, durationNow: 'jetzt' }, 'de')
    expect(formatDuration(NOW + 30_000, NOW)).toBe('1 Min.')
    expect(formatDuration(NOW + 2 * HOUR + 5 * MINUTE, NOW)).toBe('2h 5 Min.')
    expect(formatDuration(NOW, NOW)).toBe('jetzt')
  })
})

describe('planLabel', () => {
  it('shows a named tier verbatim and hides an opaque numeric id behind a generic label', () => {
    expect(planLabel('muse-pro')).toBe('muse-pro')
    expect(planLabel('27681393394859588')).toBe('Muse Code subscription')
    expect(planLabel('')).toBe('Muse Code subscription')
  })
})

describe('formatWindowLength', () => {
  afterEach(() => {
    setUiText(EN, 'en')
  })

  it('names whole hours and falls back to minutes', () => {
    expect(formatWindowLength(300)).toBe('5-hour window')
    expect(formatWindowLength(60)).toBe('1-hour window')
    expect(formatWindowLength(90)).toBe('90-minute window')
  })

  it('picks the form the display language uses for the count (M40)', () => {
    setUiText(
      {
        ...EN,
        usageWindowHours: {
          one: '{count}-Stunden-Fenster (eins)',
          other: '{count}-Stunden-Fenster',
        },
      },
      'de',
    )
    expect(formatWindowLength(60)).toBe('1-Stunden-Fenster (eins)')
    expect(formatWindowLength(300)).toBe('5-Stunden-Fenster')
  })
})
