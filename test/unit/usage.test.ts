import { describe, expect, it } from 'vitest'
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
  it('rounds up to whole minutes and drops zero parts', () => {
    expect(formatDuration(NOW + 2 * HOUR + 5 * MINUTE, NOW)).toBe('2 h 5 min')
    expect(formatDuration(NOW + 2 * HOUR, NOW)).toBe('2 h')
    expect(formatDuration(NOW + 3 * DAY + 4 * HOUR, NOW)).toBe('3 d 4 h')
    expect(formatDuration(NOW + 3 * DAY, NOW)).toBe('3 d')
    expect(formatDuration(NOW + 30_000, NOW)).toBe('1 min')
    expect(formatDuration(NOW + 90 * MINUTE + 1, NOW)).toBe('1 h 31 min')
  })

  it('says now once the moment has passed', () => {
    expect(formatDuration(NOW, NOW)).toBe('now')
    expect(formatDuration(NOW - HOUR, NOW)).toBe('now')
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
  it('names whole hours and falls back to minutes', () => {
    expect(formatWindowLength(300)).toBe('5-hour window')
    expect(formatWindowLength(60)).toBe('1-hour window')
    expect(formatWindowLength(90)).toBe('90-minute window')
  })
})
