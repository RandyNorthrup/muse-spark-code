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
  HOOK_MAX_STOP_CONTINUATIONS,
  QUESTION_DEFER_DEFAULT_SECONDS,
  SETTING_DEFAULTS,
  SUBAGENT_CONCURRENT_MAX,
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
import { WEB_SEARCH_MAX_PER_REQUEST_LIMIT, webSearchMaxCallsFor } from '../../src/shared/constants'
import { checkMediaLimits } from '../../src/core/media/limits'
import { mediaLimitsFromSettings } from '../../src/host/media/mediaProviders'
import { screenRecordingOptionsSchema } from '../../src/shared/media'
import { pluginCallBounds } from '../../src/core/backends/modelapi/pluginHost'

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

  it('still applies a person-set value within the provider range', () => {
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

  it('still refuses a person-set value past the provider range', () => {
    const warnings: string[] = []
    const read = readSettings(
      settingSource({ hooksMaxStopContinuations: 1000, subagentMaxConcurrent: 1000 }),
      silentLog(warnings),
    )
    expect(read.hooksMaxStopContinuations).toBe(0)
    expect(read.subagentMaxConcurrent).toBe(0)
    expect(warnings).toHaveLength(2)
    expect(stopContinuationLimitFor(1000)).toBe(HOOK_MAX_STOP_CONTINUATIONS)
    expect(subagentConcurrencyFor(1000)).toBe(SUBAGENT_CONCURRENT_MAX)
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

  it('still applies a person-set bound within the provider range', () => {
    const warnings: string[] = []
    expect(
      readSettings(settingSource({ webSearchMaxPerRequest: 5 }), silentLog(warnings))
        .webSearchMaxPerRequest,
    ).toBe(5)
    expect(warnings).toHaveLength(0)
    expect(webSearchMaxCallsFor(5)).toBe(5)
    expect(webSearchMaxCallsFor(WEB_SEARCH_MAX_PER_REQUEST_LIMIT)).toBe(
      WEB_SEARCH_MAX_PER_REQUEST_LIMIT,
    )
    expect(webSearchMaxCallsFor(21)).toBeUndefined()
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
    expect(
      screenRecordingOptionsSchema.safeParse({
        maxSeconds: 5,
        microphone: false,
        systemAudio: false,
      }).success,
    ).toBe(false)
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
