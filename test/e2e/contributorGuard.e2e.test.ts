// RLF-SAFEFIX item 1: every live/real-use helper that opens a Muse
// session refuses before any prompt unless the run's model id is
// contributor-tier and the session lists it. RLF-MACLIVE's live Neovim
// test sent one request on the default `muse-wonder-1.0` because its tap
// omitted `--allow-contributor-models`, so the contributor model was not
// listed (record: docs/certification/rlf-maclive.md, "Wrong-tier run").
// The offered lists below mirror that run: the default id is recorded
// there, the base and contributor ids are the product's own constants.
// No session is opened and no prompt sent here: the real guard reads only
// the resolved id and the offered list, exactly as the drills call it
// before `startSession`.
import { describe, expect, it } from 'vitest'
import { CONTRIBUTOR_MODEL_SUFFIX, DEFAULT_MODEL_ID } from '../../src/shared/constants'
import {
  assertLiveContributorModel,
  LIVE_MODEL_ENVIRONMENT,
  liveContributorModelId,
  LIVE_MODEL_ID,
} from './liveCli'

// The RLF-MACLIVE wrong-tier shape: the default id the tap fell back to,
// plus the base id, and no contributor id listed.
const WRONG_TIER_OFFERED = ['muse-wonder-1.0', DEFAULT_MODEL_ID]

describe('live contributor guard', () => {
  it('passes the contributor model when the session lists it', () => {
    expect(() => {
      assertLiveContributorModel(LIVE_MODEL_ID, [...WRONG_TIER_OFFERED, LIVE_MODEL_ID])
    }).not.toThrow()
  })

  it('refuses before any prompt when the contributor model is not listed', () => {
    expect(() => {
      assertLiveContributorModel(LIVE_MODEL_ID, WRONG_TIER_OFFERED)
    }).toThrow(`refusing the live turn: the session offers no ${LIVE_MODEL_ID}`)
    expect(() => {
      assertLiveContributorModel(LIVE_MODEL_ID, WRONG_TIER_OFFERED)
    }).toThrow('--allow-contributor-models')
    expect(() => {
      assertLiveContributorModel(LIVE_MODEL_ID, [])
    }).toThrow('offered: none')
  })

  it('refuses a non-contributor id even when it is listed', () => {
    expect(() => {
      assertLiveContributorModel('muse-wonder-1.0', WRONG_TIER_OFFERED)
    }).toThrow('refusing the live turn: muse-wonder-1.0 is not a contributor-tier model id')
    expect(() => {
      assertLiveContributorModel(DEFAULT_MODEL_ID, WRONG_TIER_OFFERED)
    }).toThrow(`one ends in ${CONTRIBUTOR_MODEL_SUFFIX}`)
  })

  it('resolves the run-named model, defaulting to the contributor id', () => {
    expect(liveContributorModelId({})).toBe(LIVE_MODEL_ID)
    expect(liveContributorModelId({ [LIVE_MODEL_ENVIRONMENT]: '' })).toBe(LIVE_MODEL_ID)
    const override = `muse-spark-9.9${CONTRIBUTOR_MODEL_SUFFIX}`
    expect(liveContributorModelId({ [LIVE_MODEL_ENVIRONMENT]: override })).toBe(override)
    expect(() => liveContributorModelId({ [LIVE_MODEL_ENVIRONMENT]: 'muse-wonder-1.0' })).toThrow(
      `refusing the live drill: muse-wonder-1.0 is not a contributor-tier model id`,
    )
  })
})
