import { describe, expect, it } from 'vitest'
import manifest from '../../package.json'
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
import {
  TOOL_OUTPUT_MAX_CHARS,
  WEB_SEARCH_MAX_PER_REQUEST_LIMIT,
  webSearchMaxCallsFor,
} from '../../src/shared/constants'
import { checkMediaLimits } from '../../src/core/media/limits'
import { mediaLimitsFromSettings } from '../../src/host/media/mediaProviders'
import { screenRecordingOptionsSchema } from '../../src/shared/media'

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

  it('waits indefinitely with nothing set and still applies a person-set delay', () => {
    expect(questionDeferSeconds()).toBe(0)
    expect(questionDeferSeconds(0)).toBe(0)
    expect(questionDeferSeconds(60)).toBe(60)
    expect(questionDeferSeconds(5)).toBe(10)
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

describe('no default limits: tool-output byte guard', () => {
  const hundredKilobyte = `${'ok line\n'.repeat(12_000)}tail\n`

  it('defaults to no byte guard of our own', () => {
    expect(SETTING_DEFAULTS.modelApiMaxToolOutputBytes).toBe(0)
    expect(manifestDefault('museSpark.modelApiMaxToolOutputBytes')).toBe(0)
  })

  it('passes a result through whole with nothing set', () => {
    const validated = validateToolResultCap(0, undefined, TOOL_OUTPUT_MAX_CHARS)
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
    const validated = validateToolResultCap(64_000, undefined, TOOL_OUTPUT_MAX_CHARS)
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
