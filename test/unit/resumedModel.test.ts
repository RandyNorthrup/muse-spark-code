import { describe, expect, it } from 'vitest'
import { resolveResumedModel } from '../../src/core/backends/musecode/resumedModel'

// After a `muse serve` restart a resumed conversation must run on the model
// the person chose: the caller applies it with `session/setModel` and reads
// the CLI's answer back with `model/list`. This table decides what the
// session runs on from those two values alone.
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
