// The estimator's own refusal guard (D119): only sentences the estimator
// itself worded, with identifier details, count as refusals worth repeating.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  estimateRefusalDetail,
  estimateSectionSchema,
  isEstimateRefusal,
} from '../../src/shared/estimate'
import { BASE_LOCALE, fill, setUiText, UI_TEXT } from '../../src/shared/l10n/text'
import { EN } from '../../src/shared/l10n/en'
import { EstimateSchedulingError } from '../../src/core/estimator/schedule'
import { calibrationFailure } from '../../src/core/estimator/calibration/records'
import { lookupEstimatePrices } from '../../src/core/estimator/prices'
import { estimatePricePorts } from './helpers/estimateFailures'

const AS_OF = '2026-10-17T00:00:00.000Z'

async function catalogOptionsRefusal(): Promise<Error> {
  const ports = estimatePricePorts()
  try {
    await lookupEstimatePrices(
      {
        asOf: AS_OF,
        enabled: true,
        networkAllowed: false,
        maxAgeMs: 60_000,
        catalogUrls: ['https://example.com/catalog.json', 'https://example.com/catalog.json'],
      },
      ports,
    )
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('lookup did not refuse duplicate catalogs')
}

async function catalogHandoffWait(): Promise<Error> {
  const ports = estimatePricePorts()
  try {
    await ports.cached('https://example.com/catalog.json')
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('catalog binding did not wait')
}

function contractFailure(): Error {
  try {
    estimateSectionSchema.parse({})
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('section schema accepted an empty object')
}

function pathFailure(): Error {
  try {
    readFileSync('/nonexistent-dir-muse-estimate/no-such-file.json')
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('missing file read succeeded')
}

describe('estimate refusal guard', () => {
  it('keeps the estimator’s own refusal details', async () => {
    setUiText(EN, BASE_LOCALE)
    expect(isEstimateRefusal(await catalogOptionsRefusal())).toBe(true)
    expect(estimateRefusalDetail(await catalogOptionsRefusal())).toBe('catalog-options')
    expect(isEstimateRefusal(await catalogHandoffWait())).toBe(true)
    expect(estimateRefusalDetail(await catalogHandoffWait())).toBe('M117-W-M113-catalog')
    const scheduling = new EstimateSchedulingError('unschedulable:lane-1')
    expect(isEstimateRefusal(scheduling)).toBe(true)
    expect(estimateRefusalDetail(scheduling)).toBe('unschedulable:lane-1')
    const calibration = calibrationFailure('invalidHistory')
    expect(isEstimateRefusal(calibration)).toBe(true)
    expect(estimateRefusalDetail(calibration)).toBe('invalidHistory')
  })

  it('refuses contract failures, path failures and non-errors', () => {
    setUiText(EN, BASE_LOCALE)
    expect(isEstimateRefusal(contractFailure())).toBe(false)
    expect(estimateRefusalDetail(contractFailure())).toBeUndefined()
    expect(isEstimateRefusal(pathFailure())).toBe(false)
    expect(estimateRefusalDetail(pathFailure())).toBeUndefined()
    expect(isEstimateRefusal(new Error('boom'))).toBe(false)
    expect(isEstimateRefusal('catalog-options')).toBe(false)
    // A refusal shape around a path is not an identifier detail.
    expect(
      isEstimateRefusal(new Error(fill(UI_TEXT.estimateFailed, { detail: 'EACCES /tmp/x' }))),
    ).toBe(false)
    expect(estimateRefusalDetail(new Error('Estimate failed: '))).toBeUndefined()
  })
})
