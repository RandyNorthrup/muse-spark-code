// The hook call sends no output cap of ours (D121): the capability record's
// published maximum rides along, or nothing is sent when the record names
// none. Real policy records, no stand-ins.
import { describe, expect, it } from 'vitest'
import { hookModelOutputCap } from '../../src/core/backends/modelapi/hookModelEntry'
import { MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS } from '../../src/shared/constants'

describe('hookModelOutputCap', () => {
  it('sends the record maximum for a Meta model', () => {
    expect(hookModelOutputCap('muse-spark-1.3-contributor')).toBe(
      MODEL_API_RECOMMENDED_MAX_OUTPUT_TOKENS,
    )
  })

  it('sends nothing for a model the record names no maximum for', () => {
    expect(hookModelOutputCap('unrecorded-vendor/unrecorded-model')).toBeUndefined()
  })
})
