import { describe, expect, it, vi } from 'vitest'
import { readResource, resourceFailureReporter } from '../../src/runtime/resources/text'
import { UI_TEXT } from '../../src/shared/constants'

describe('ACPDOG named resource failures', () => {
  it('reports the failed reading once without its native diagnostic', async () => {
    const log = { warn: vi.fn() }
    const report = resourceFailureReporter(log)
    for (const reading of ['resources.settings', 'resources.resume', 'resources.sample'] as const) {
      for (let repeat = 0; repeat < 2; repeat++) {
        try {
          await readResource(reading, () => Promise.reject(new Error('private path/header/key')))
        } catch (error) {
          report(error)
        }
      }
    }
    expect(log.warn.mock.calls).toEqual(
      ['resources.settings', 'resources.resume', 'resources.sample'].map((reading) => [
        `${reading}: ${UI_TEXT.resourceUnavailable}`,
      ]),
    )
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('private')
    const next = resourceFailureReporter(log)
    try {
      await readResource('resources.sample', () => Promise.reject(new Error('private')))
    } catch (error) {
      next(error)
    }
    expect(log.warn).toHaveBeenCalledTimes(4)
  })
})
