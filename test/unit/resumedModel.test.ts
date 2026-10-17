import { describe, expect, it } from 'vitest'
import { resolveResumedModel } from '../../src/core/backends/musecode/resumedModel'

// Unit proof of the comparison policy only. This does not exercise resume,
// setModel/listModels ordering, handle ownership, or turn dispatch. Those
// product behaviours require the real-life restart scenarios recorded in
// docs/certification/muse-restart-model.md, not a stand-in CLI.
describe('resolveResumedModel', () => {
  it('keeps the chosen model when the CLI reports it active', () => {
    expect(
      resolveResumedModel({ wantedModelId: 'muse-spark-1.3', activeModelId: 'muse-spark-1.3' }),
    ).toEqual({ ok: true, modelId: 'muse-spark-1.3' })
  })

  it('refuses to run when the CLI reports a different model', () => {
    expect(
      resolveResumedModel({
        wantedModelId: 'muse-spark-1.3',
        activeModelId: 'muse-wonder-1.0-contributor',
      }),
    ).toEqual({
      ok: false,
      wantedModelId: 'muse-spark-1.3',
      activeModelId: 'muse-wonder-1.0-contributor',
    })
  })

  it('trusts the applied choice when the CLI names no active model', () => {
    expect(
      resolveResumedModel({ wantedModelId: 'muse-spark-1.3', activeModelId: undefined }),
    ).toEqual({ ok: true, modelId: 'muse-spark-1.3' })
  })
})
