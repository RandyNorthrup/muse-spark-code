// RVREPORTJOIN P2-6: no absolute path reaches a log. The report input
// loader and the network loader use the fixed-message log adapter, so a
// missing bundle under a private install path keeps only fixed words.
import { describe, expect, it } from 'vitest'
import { reportInputsLoader } from '../../src/runtime/reporting/reportInputsLoader'
import { reportingNetworkLoader } from '../../src/runtime/reporting/networkLoader'
import { errorLogger } from './helpers/collectingLogger'

const CANARY = '/home/owner-canary/extensions'

function capturingLog(): {
  errors: string[]
  log: Parameters<typeof reportInputsLoader>[0]['log']
} {
  const errors: string[] = []
  return { errors, log: errorLogger(errors) }
}

describe('report bundle loaders keep paths out of the log', () => {
  it('logs only fixed words when the inputs bundle fails to load', () => {
    const { errors, log } = capturingLog()
    const load = reportInputsLoader({
      bundlePath: `${CANARY}/dist/reportInputs.js`,
      log,
      loadBundle: () => {
        throw new Error(`EACCES: permission denied, open '${CANARY}/dist/reportInputs.js'`)
      },
    })
    expect(() => load()).toThrow()
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toContain(CANARY)
    expect(errors[0]).not.toContain('EACCES')
  })

  it('logs only fixed words when the inputs bundle has the wrong shape', () => {
    const { errors, log } = capturingLog()
    const load = reportInputsLoader({
      bundlePath: `${CANARY}/dist/reportInputs.js`,
      log,
      loadBundle: () => ({}),
    })
    expect(() => load()).toThrow()
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toContain(CANARY)
  })

  it('logs only fixed words when the network bundle fails to load', () => {
    const { errors, log } = capturingLog()
    expect(() => reportingNetworkLoader(log)()).toThrow()
    expect(errors).toHaveLength(1)
    expect(errors[0]).not.toContain('.js')
    expect(errors[0]).not.toContain('/')
  })
})
