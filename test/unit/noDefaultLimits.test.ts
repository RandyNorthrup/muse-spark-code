import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
import { readPlan } from '../../src/core/reporting/plan/reader'
import { runtimeReportsPlanMaxBytes } from '../../src/runtime/runtimeReportsPlan'
import type { Logger } from '../../src/host/logger'
import { readSettings, type SettingsSource } from '../../src/host/settings'
import {
  QUESTION_DEFER_DEFAULT_SECONDS,
  SECONDS_PER_DAY,
  SETTING_DEFAULTS,
  stopContinuationLimitFor,
  subagentConcurrencyFor,
} from '../../src/shared/constants'
import { questionDeferSeconds } from '../../src/shared/questionDeadline'
import { subagentSpawnDescription } from '../../src/core/backends/modelapi/subagentTools'
import {
  boundToolResultText,
  limitsForByteGuard,
  validateToolResultCap,
} from '../../src/core/backends/modelapi/toolResultBound'
import { webSearchMaxCallsFor } from '../../src/shared/constants'
import { uploadExpirySeconds } from '../../src/core/backends/modelapi/files'
import { readUsageHistorySettings } from '../../src/runtime/usage/usageSettingsFile'
import { usageLocalDay } from '../../src/core/usage/aggregate'
import { UsageJournalStore } from '../../src/core/usage/journalStore'
import { createUsageRecord, type UsageRecordContext } from '../../src/core/usage/journalRecord'
import { NodeUsageFs } from '../../src/runtime/usage/nodeUsageFs'
import { resourceSettingsSchema } from '../../src/shared/resources'
import { checkMediaLimits } from '../../src/core/media/limits'
import { mediaLimitsFromSettings } from '../../src/host/media/mediaProviders'
import { screenRecordingOptionsSchema } from '../../src/shared/media'
import { pluginCallBounds } from '../../src/core/backends/modelapi/pluginHost'
import { fileRoots } from './helpers/tempDirs'

const properties = manifest.contributes.configuration.properties as Record<
  string,
  { default: unknown }
>

function manifestDefault(key: string): unknown {
  const entry = properties[key]
  if (entry === undefined) throw new Error(`missing manifest setting ${key}`)
  return entry.default
}

function settingSource(values: Record<string, unknown>): SettingsSource {
  return {
    get: (key: string) => values[key],
  }
}

function silentLog(warnings: string[]): Logger {
  return {
    trace: () => undefined,
    info: () => undefined,
    warn: (message: string) => {
      warnings.push(message)
    },
    error: () => undefined,
  }
}

function recordAt(at: number): unknown {
  const context: UsageRecordContext = {
    id: `call-${String(at)}`,
    at,
    startedAt: at - 1000,
    client: 'Zed',
    backend: 'modelApi',
    provider: 'custom',
    model: 'test-model',
    kind: 'turn',
    outcome: 'completed',
  }
  return createUsageRecord(undefined, context)
}

// NOLIMITSALL (PLAN.md D121): every limit setting defaults to no limit; the
// person sets their own. 0 is none, as `hooksMaxRunningCommands = 0` and
// `modelApiSessionBudgetUsd = 0` already do.
describe('no default limits: questions deferral', () => {
  it('defaults to never deferring until the person sets a delay', () => {
    expect(QUESTION_DEFER_DEFAULT_SECONDS).toBe(0)
    expect(manifestDefault('museSpark.questions.deferAfterSeconds')).toBe(0)
  })

  it('waits indefinitely with nothing set and uses a person-set delay as set', () => {
    expect(questionDeferSeconds()).toBe(0)
    expect(questionDeferSeconds(0)).toBe(0)
    expect(questionDeferSeconds(1)).toBe(1)
    expect(questionDeferSeconds(5)).toBe(5)
    expect(questionDeferSeconds(60)).toBe(60)
    expect(questionDeferSeconds(3601)).toBe(3601)
    expect(questionDeferSeconds(100_000)).toBe(100_000)
  })

  it('refuses what is not a count instead of replacing it', () => {
    expect(questionDeferSeconds(NaN)).toBeUndefined()
    expect(questionDeferSeconds(-5)).toBeUndefined()
    expect(questionDeferSeconds(1.5)).toBeUndefined()
    expect(questionDeferSeconds(Infinity)).toBeUndefined()
  })
})

describe('no default limits: hook continuations and subagent concurrency', () => {
  it('defaults to no limit of our own', () => {
    expect(SETTING_DEFAULTS.hooksMaxStopContinuations).toBe(0)
    expect(SETTING_DEFAULTS.subagentMaxConcurrent).toBe(0)
    expect(manifestDefault('museSpark.hooksMaxStopContinuations')).toBe(0)
    expect(manifestDefault('museSpark.subagentMaxConcurrent')).toBe(0)
  })

  it('runs Stop hooks and subagents without a count of ours with nothing set', () => {
    expect(stopContinuationLimitFor(0)).toBe(Infinity)
    expect(subagentConcurrencyFor(0)).toBe(Infinity)
    expect(subagentSpawnDescription(0)).not.toContain('Up to')
  })

  it('still applies a person-set value within the old range', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ hooksMaxStopContinuations: 3, subagentMaxConcurrent: 3 }),
      silentLog(warnings),
    )
    expect(read.hooksMaxStopContinuations).toBe(3)
    expect(read.subagentMaxConcurrent).toBe(3)
    expect(warnings).toHaveLength(0)
    expect(stopContinuationLimitFor(3)).toBe(3)
    expect(subagentConcurrencyFor(3)).toBe(3)
    expect(subagentSpawnDescription(3)).toContain('Up to 3 work at once')
  })

  // NOLIMITSSET (PLAN.md D121): the 8/64 ceilings were ours, never a
  // provider's — a set count past them governs as set.
  it('honours a person-set value past the removed ceiling', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ hooksMaxStopContinuations: 12, subagentMaxConcurrent: 100 }),
      silentLog(warnings),
    )
    expect(read.hooksMaxStopContinuations).toBe(12)
    expect(read.subagentMaxConcurrent).toBe(100)
    expect(warnings).toHaveLength(0)
    expect(stopContinuationLimitFor(12)).toBe(12)
    expect(subagentConcurrencyFor(100)).toBe(100)
    expect(subagentSpawnDescription(100)).toContain('Up to 100 work at once')
  })

  it('still refuses what is not a count instead of clamping it', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ hooksMaxStopContinuations: -1, subagentMaxConcurrent: 1.5 }),
      silentLog(warnings),
    )
    expect(read.hooksMaxStopContinuations).toBe(0)
    expect(read.subagentMaxConcurrent).toBe(0)
    expect(warnings).toHaveLength(2)
  })

  // A bound of ours on these settings cannot return: the manifest states no
  // ceiling of ours, only the quantity's own floor.
  it('declares no ceiling of ours in the manifest', () => {
    expect(properties['museSpark.hooksMaxStopContinuations']).not.toHaveProperty('maximum')
    expect(properties['museSpark.subagentMaxConcurrent']).not.toHaveProperty('maximum')
  })
})

describe('no default limits: plugin waits, memory, answers and failure latch', () => {
  it('defaults to no bound of our own', () => {
    expect(SETTING_DEFAULTS.pluginHookTimeoutSeconds).toBe(0)
    expect(SETTING_DEFAULTS.pluginChildMaxMemoryMiB).toBe(0)
    expect(SETTING_DEFAULTS.pluginAnswerMaxBytes).toBe(0)
    expect(SETTING_DEFAULTS.pluginMaxFailures).toBe(0)
    expect(manifestDefault('museSpark.pluginHookTimeoutSeconds')).toBe(0)
    expect(manifestDefault('museSpark.pluginChildMaxMemoryMiB')).toBe(0)
    expect(manifestDefault('museSpark.pluginAnswerMaxBytes')).toBe(0)
    expect(manifestDefault('museSpark.pluginMaxFailures')).toBe(0)
  })

  it('reads nothing set as no bound, and a person-set value as their bound', () => {
    const warnings: string[] = []
    const read = readSettings(settingSource({}), silentLog(warnings))
    expect(read.pluginHookTimeoutSeconds).toBe(0)
    expect(read.pluginChildMaxMemoryMiB).toBe(0)
    expect(read.pluginAnswerMaxBytes).toBe(0)
    expect(read.pluginMaxFailures).toBe(0)
    expect(
      pluginCallBounds({
        timeoutSeconds: read.pluginHookTimeoutSeconds,
        maxMemoryMiB: read.pluginChildMaxMemoryMiB,
        maxAnswerBytes: read.pluginAnswerMaxBytes,
      }),
    ).toEqual({ timeoutMs: undefined, maxMemoryBytes: undefined, maxAnswerBytes: undefined })
    const set = readSettings(
      settingSource({
        pluginHookTimeoutSeconds: 30,
        pluginChildMaxMemoryMiB: 512,
        pluginAnswerMaxBytes: 64 * 1024,
        pluginMaxFailures: 2,
      }),
      silentLog(warnings),
    )
    expect(set.pluginHookTimeoutSeconds).toBe(30)
    expect(set.pluginChildMaxMemoryMiB).toBe(512)
    expect(set.pluginAnswerMaxBytes).toBe(64 * 1024)
    expect(set.pluginMaxFailures).toBe(2)
    expect(
      pluginCallBounds({
        timeoutSeconds: set.pluginHookTimeoutSeconds,
        maxMemoryMiB: set.pluginChildMaxMemoryMiB,
        maxAnswerBytes: set.pluginAnswerMaxBytes,
      }),
    ).toEqual({
      timeoutMs: 30_000,
      maxMemoryBytes: 512 * 1024 * 1024,
      maxAnswerBytes: 64 * 1024,
    })
    expect(warnings).toHaveLength(0)
  })
})

describe('no default limits: tool-output byte guard', () => {
  const hundredKilobyte = `${'ok line\n'.repeat(12_000)}tail\n`

  it('defaults to no byte guard of our own', () => {
    expect(SETTING_DEFAULTS.modelApiMaxToolOutputBytes).toBe(0)
    expect(manifestDefault('museSpark.modelApiMaxToolOutputBytes')).toBe(0)
  })

  it('passes a result through whole with nothing set', () => {
    const validated = validateToolResultCap(0, undefined)
    expect(validated).toEqual({ bytes: Infinity })
    const limits = 'bytes' in validated ? limitsForByteGuard(validated.bytes, undefined) : undefined
    expect(limits).toBeDefined()
    expect(boundToolResultText(hundredKilobyte, limits!).cut).toBeUndefined()
    expect(boundToolResultText(hundredKilobyte, limits!).text).toBe(hundredKilobyte)
  })

  it('still applies a person-set guard', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ modelApiMaxToolOutputBytes: 64_000 }),
      silentLog(warnings),
    )
    expect(read.modelApiMaxToolOutputBytes).toBe(64_000)
    expect(warnings).toHaveLength(0)
    const validated = validateToolResultCap(64_000, undefined)
    expect(validated).toEqual({ bytes: 64_000 })
    const limits = 'bytes' in validated ? limitsForByteGuard(validated.bytes, undefined) : undefined
    expect(boundToolResultText(hundredKilobyte, limits!).cut).toBeDefined()
  })
})

describe('no default limits: hosted searches per response', () => {
  it('defaults to no search bound of our own', () => {
    expect(SETTING_DEFAULTS.webSearchMaxPerRequest).toBe(0)
    expect(manifestDefault('museSpark.webSearchMaxPerRequest')).toBe(0)
  })

  it('sends no max of ours with nothing set', () => {
    const warnings: string[] = []
    expect(
      readSettings(settingSource({ webSearchMaxPerRequest: 0 }), silentLog(warnings))
        .webSearchMaxPerRequest,
    ).toBe(0)
    expect(warnings).toHaveLength(0)
    expect(webSearchMaxCallsFor(0)).toBeUndefined()
  })

  it('still applies a person-set bound within the old range', () => {
    const warnings: string[] = []
    expect(
      readSettings(settingSource({ webSearchMaxPerRequest: 5 }), silentLog(warnings))
        .webSearchMaxPerRequest,
    ).toBe(5)
    expect(warnings).toHaveLength(0)
    expect(webSearchMaxCallsFor(5)).toBe(5)
  })

  // NOLIMITSSET (PLAN.md D121): no capability record carries a per-request
  // search maximum, so the 20 was ours — a set value past it sends as set.
  it('sends a person-set value past the removed 20 as set', () => {
    const warnings: string[] = []
    expect(
      readSettings(settingSource({ webSearchMaxPerRequest: 21 }), silentLog(warnings))
        .webSearchMaxPerRequest,
    ).toBe(21)
    expect(warnings).toHaveLength(0)
    expect(webSearchMaxCallsFor(21)).toBe(21)
    expect(webSearchMaxCallsFor(1000)).toBe(1000)
  })

  it('still refuses what is not a count instead of clamping it', () => {
    const warnings: string[] = []
    expect(
      readSettings(settingSource({ webSearchMaxPerRequest: -1 }), silentLog(warnings))
        .webSearchMaxPerRequest,
    ).toBe(0)
    expect(warnings).toHaveLength(1)
    expect(webSearchMaxCallsFor(-1)).toBeUndefined()
    expect(webSearchMaxCallsFor(1.5)).toBeUndefined()
  })

  it('declares no ceiling of ours in the manifest', () => {
    expect(properties['museSpark.webSearchMaxPerRequest']).not.toHaveProperty('maximum')
  })
})

describe('no default limits: media upload and screen recording', () => {
  const bigVideo = {
    kind: 'video',
    mediaType: 'video/mp4',
    sizeBytes: 500 * 1024 * 1024,
    durationSeconds: 1000,
    hasSoundtrack: false,
  } as const

  it('defaults to no media cap of our own', () => {
    expect(SETTING_DEFAULTS.mediaMaxUploadMiB).toBe(0)
    expect(SETTING_DEFAULTS.screenRecordingMaxSeconds).toBe(0)
    expect(manifestDefault('museSpark.mediaMaxUploadMiB')).toBe(0)
    expect(manifestDefault('museSpark.screenRecordingMaxSeconds')).toBe(0)
  })

  it('admits any size and length with nothing set', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ mediaMaxUploadMiB: 0, screenRecordingMaxSeconds: 0 }),
      silentLog(warnings),
    )
    expect(read.mediaMaxUploadMiB).toBe(0)
    expect(read.screenRecordingMaxSeconds).toBe(0)
    expect(warnings).toHaveLength(0)
    expect(
      mediaLimitsFromSettings({
        mediaMaxUploadMiB: 0,
        screenRecordingMaxSeconds: 0,
        mediaAudioAction: 'transcribe',
      }),
    ).toEqual({})
    expect(checkMediaLimits(bigVideo, {})).toEqual({ ok: true })
    expect(
      screenRecordingOptionsSchema.parse({ maxSeconds: 0, microphone: false, systemAudio: false }),
    ).toEqual({ maxSeconds: 0, microphone: false, systemAudio: false })
  })

  it('still applies a person-set size and length', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ mediaMaxUploadMiB: 200, screenRecordingMaxSeconds: 120 }),
      silentLog(warnings),
    )
    expect(read.mediaMaxUploadMiB).toBe(200)
    expect(read.screenRecordingMaxSeconds).toBe(120)
    expect(warnings).toHaveLength(0)
    expect(
      mediaLimitsFromSettings({
        mediaMaxUploadMiB: 200,
        screenRecordingMaxSeconds: 120,
        mediaAudioAction: 'transcribe',
      }),
    ).toEqual({ maxUploadBytes: 200 * 1024 * 1024, maxDurationSeconds: 120 })
    expect(
      checkMediaLimits(bigVideo, { maxUploadBytes: 200 * 1024 * 1024, maxDurationSeconds: 120 }),
    ).toEqual({ ok: false, reason: expect.any(String) })
  })

  // D121: no floor and no ceiling of ours on the person's recording length.
  // The setting reads it as set and the recorder options carry it unchanged.
  it.each([5, 3600])('takes a set recording length of %i seconds as set', (seconds) => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ screenRecordingMaxSeconds: seconds }),
      silentLog(warnings),
    )
    expect(read.screenRecordingMaxSeconds).toBe(seconds)
    expect(warnings).toHaveLength(0)
    expect(
      screenRecordingOptionsSchema.parse({
        maxSeconds: read.screenRecordingMaxSeconds,
        microphone: false,
        systemAudio: false,
      }),
    ).toEqual({ maxSeconds: seconds, microphone: false, systemAudio: false })
    expect(
      mediaLimitsFromSettings({
        mediaMaxUploadMiB: 0,
        screenRecordingMaxSeconds: read.screenRecordingMaxSeconds,
        mediaAudioAction: 'transcribe',
      }),
    ).toEqual({ maxDurationSeconds: seconds })
  })
})

describe('no default limits: report plan bytes', () => {
  it('defaults to no plan bound of our own', () => {
    expect(SETTING_DEFAULTS['reports.planMaxBytes']).toBe(0)
    expect(manifestDefault('museSpark.reports.planMaxBytes')).toBe(0)
  })

  it('reads the whole plan with nothing set and refuses past a person-set bound', () => {
    const warnings: string[] = []
    const read = readSettings(settingSource({}), silentLog(warnings))
    expect(read['reports.planMaxBytes']).toBe(0)
    const big = `## 6. Milestones\n### M12 — Big\n**Status 2026-10-05: planned.**\n${'x'.repeat(1024)}\n`
    expect(readPlan(big, {}, read['reports.planMaxBytes']).facts.drift).toEqual([])
    const set = readSettings(settingSource({ 'reports.planMaxBytes': 64 }), silentLog(warnings))
    expect(set['reports.planMaxBytes']).toBe(64)
    expect(warnings).toHaveLength(0)
    expect(readPlan(big, {}, set['reports.planMaxBytes']).facts.drift).toEqual([
      { code: 'input-size', line: 1, detail: 'maxUtf8Bytes=64' },
    ])
  })

  it('reads the runtime bound from the agent settings file, none when absent', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'nolimits-plan-'))
    try {
      expect(runtimeReportsPlanMaxBytes(folder)).toBe(0)
      await writeFile(path.join(folder, 'settings.json'), '{"reportsPlanMaxBytes":4096}', 'utf8')
      expect(runtimeReportsPlanMaxBytes(folder)).toBe(4096)
      await writeFile(path.join(folder, 'settings.json'), '{"paidDailyBudgetUsd":5}', 'utf8')
      expect(runtimeReportsPlanMaxBytes(folder)).toBe(0)
      await writeFile(path.join(folder, 'settings.json'), '{broken', 'utf8')
      expect(runtimeReportsPlanMaxBytes(folder)).toBe(0)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('lets a failure that is not a missing or malformed file throw past the reader', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'nolimits-plan-'))
    try {
      expect(() => runtimeReportsPlanMaxBytes(folder + path.sep + 'bad\0name')).toThrow()
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })
})

// NOLIMITSSET (PLAN.md D121): the 30/40/98/0.5/64/2 floors and ceilings were
// ours — a percentage's own 0–100 and a GiB floor's own zero are the quantity
// itself. A set value past an old bound reaches the governor's settings as set.
describe('no default limits: resource thresholds', () => {
  it('governs a person-set value past the removed bounds as set', () => {
    const parsed = resourceSettingsSchema.parse({
      cpuMaxPercent: 20,
      memoryMaxPercent: 20,
      memoryMinFreeGiB: 128,
      diskMinFreeGiB: 128,
    })
    expect(parsed.cpuMaxPercent).toBe(20)
    expect(parsed.memoryMaxPercent).toBe(20)
    expect(parsed.memoryMinFreeGiB).toBe(128)
    expect(parsed.diskMinFreeGiB).toBe(128)
  })

  it('still refuses what the quantity itself cannot be', () => {
    for (const value of [-1, 101]) {
      expect(resourceSettingsSchema.safeParse({ cpuMaxPercent: value }).success).toBe(false)
      expect(resourceSettingsSchema.safeParse({ memoryMaxPercent: value }).success).toBe(false)
    }
    expect(resourceSettingsSchema.safeParse({ memoryMinFreeGiB: -1 }).success).toBe(false)
    expect(resourceSettingsSchema.safeParse({ diskMinFreeGiB: -1 }).success).toBe(false)
  })

  it('declares no bound of ours in the manifest', () => {
    expect(properties['museSpark.resourceCpuMaxPercent']).not.toHaveProperty('minimum')
    expect(properties['museSpark.resourceCpuMaxPercent']).not.toHaveProperty('maximum')
    expect(properties['museSpark.resourceMemoryMaxPercent']).not.toHaveProperty('minimum')
    expect(properties['museSpark.resourceMemoryMaxPercent']).not.toHaveProperty('maximum')
    expect(properties['museSpark.resourceMemoryMinFreeGiB']).not.toHaveProperty('minimum')
    expect(properties['museSpark.resourceMemoryMinFreeGiB']).not.toHaveProperty('maximum')
    expect(properties['museSpark.resourceDiskMinFreeGiB']).not.toHaveProperty('minimum')
    expect(properties['museSpark.resourceDiskMinFreeGiB']).not.toHaveProperty('maximum')
  })
})

// NOLIMITSSET (PLAN.md D121): the 500-rule ceiling was ours. The governing
// behaviour (a 1000-rule list read whole) is proven in
// test/unit/commandRules.test.ts; here the manifest proves the ceiling
// cannot return.
describe('no default limits: command rules', () => {
  it('declares no ceiling of ours in the manifest', () => {
    expect(properties['museSpark.modelApiCommandRules']).not.toHaveProperty('maxItems')
  })
})

// NOLIMITSSET (PLAN.md D121): the 32-host ceiling was ours — every host the
// person names is kept.
describe('no default limits: browser check extra hosts', () => {
  it('keeps a person-set list past the removed 32 whole', () => {
    const warnings: string[] = []
    const hosts = Array.from({ length: 40 }, (_entry, index) => `host${String(index)}.example.com`)
    const read = readSettings(settingSource({ browserCheckExtraHosts: hosts }), silentLog(warnings))
    expect(read.browserCheckExtraHosts).toEqual(hosts)
    expect(warnings).toHaveLength(0)
  })

  it('declares no ceiling of ours in the manifest', () => {
    expect(properties['museSpark.browserCheckExtraHosts']).not.toHaveProperty('maxItems')
  })
})

// NOLIMITSSET (PLAN.md D121): no capability record carries an upload-expiry
// range, so the 1–30 days were ours — a set number of days converts as set.
describe('no default limits: media upload expiry', () => {
  it('converts a person-set value past the removed 30 as set', () => {
    const warnings: string[] = []
    const read = readSettings(settingSource({ mediaUploadExpiryDays: 60 }), silentLog(warnings))
    expect(read.mediaUploadExpiryDays).toBe(60)
    expect(warnings).toHaveLength(0)
    expect(uploadExpirySeconds(60)).toBe(60 * SECONDS_PER_DAY)
    expect(uploadExpirySeconds(1)).toBe(1 * SECONDS_PER_DAY)
  })

  it('still refuses what is not a whole day instead of clamping it', () => {
    const warnings: string[] = []
    const read = readSettings(settingSource({ mediaUploadExpiryDays: 0 }), silentLog(warnings))
    expect(read.mediaUploadExpiryDays).toBe(7)
    expect(warnings).toHaveLength(1)
  })

  // The manifest keeps only the quantity's own floor (whole days from 1);
  // the 30-day ceiling of ours is gone.
  it('declares no ceiling of ours in the manifest', () => {
    expect(properties['museSpark.mediaUploadExpiryDays']).toHaveProperty('minimum', 1)
    expect(properties['museSpark.mediaUploadExpiryDays']).not.toHaveProperty('maximum')
  })
})

// NOLIMITSSET (PLAN.md D121): the 365-day default with its 30–1825 range was
// a retention limit of ours as a default. With nothing set history is kept
// until the person sets a number of days or clears it; a set number of days
// (any whole number of at least 1) trims as set.
describe('no default limits: usage history days', () => {
  const { fresh: freshRoot } = fileRoots()

  it('defaults to keeping history, with no day count of ours', () => {
    expect(SETTING_DEFAULTS.usageHistoryDays).toBeNull()
    expect(manifestDefault('museSpark.usageHistoryDays')).toBeNull()
    const warnings: string[] = []
    expect(readSettings(settingSource({}), silentLog(warnings)).usageHistoryDays).toBeNull()
    expect(warnings).toHaveLength(0)
  })

  it('uses a set number of days as set, past the old default and maximum', () => {
    const warnings: string[] = []
    expect(
      readSettings(settingSource({ usageHistoryDays: 10 }), silentLog(warnings)).usageHistoryDays,
    ).toBe(10)
    expect(
      readSettings(settingSource({ usageHistoryDays: 400 }), silentLog(warnings)).usageHistoryDays,
    ).toBe(400)
    expect(
      readSettings(settingSource({ usageHistoryDays: 2000 }), silentLog(warnings)).usageHistoryDays,
    ).toBe(2000)
    expect(warnings).toHaveLength(0)
  })

  it('still refuses what is not a whole day of at least 1', () => {
    const warnings: string[] = []
    for (const days of [0, -3, 1.5]) {
      expect(
        readSettings(settingSource({ usageHistoryDays: days }), silentLog(warnings))
          .usageHistoryDays,
      ).toBeNull()
    }
    expect(warnings).toHaveLength(3)
  })

  it('declares no default or range of ours in the manifest', () => {
    expect(properties['museSpark.usageHistoryDays']).not.toHaveProperty('minimum')
    expect(properties['museSpark.usageHistoryDays']).not.toHaveProperty('maximum')
  })

  it('reads the runtime choice the same way: absent keeps, a set 10 trims', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'nolimits-history-'))
    try {
      expect(readUsageHistorySettings(folder)).toEqual({ enabled: true, days: null })
      await writeFile(
        path.join(folder, 'usage-settings.json'),
        '{"enabled":true,"days":10}',
        'utf8',
      )
      expect(readUsageHistorySettings(folder)).toEqual({ enabled: true, days: 10 })
      await writeFile(
        path.join(folder, 'usage-settings.json'),
        '{"enabled":true,"days":400}',
        'utf8',
      )
      expect(readUsageHistorySettings(folder)).toEqual({ enabled: true, days: 400 })
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('keeps a 400-day-old day with nothing set and trims it at a set 10 days', async () => {
    const root = await freshRoot('nolimits-history-')
    let now = Date.now()
    const store = new UsageJournalStore(new NodeUsageFs(root), {
      writerId: 'test-writer',
      isEnabled: () => true,
      now: () => now,
      onWriteError: () => undefined,
    })
    const dayMs = 24 * 60 * 60 * 1000
    const oldDay = usageLocalDay(now - 400 * dayMs)
    now -= 400 * dayMs
    store.append(recordAt(now))
    await store.flush()
    now += 400 * dayMs
    expect(await store.retain(null)).toBe(true)
    const kept = await store.read()
    expect(kept.rollups.map((row) => row.day)).toContain(oldDay)
    expect(await store.retain(10)).toBe(true)
    const trimmed = await store.read()
    expect(trimmed.rollups.map((row) => row.day)).not.toContain(oldDay)
  })
})
