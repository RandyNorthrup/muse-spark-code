// Shared real-code probes for the estimate failure-boundary tests (D207):
// a duplicate-catalog refusal and a contract failure from the real
// estimator modules, never fakes.
import { lookupEstimatePrices } from '../../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../../src/host/estimator/localFleet'
import { planSnapshotLoader } from '../../../src/host/estimator/planSnapshotBundle'
import { estimateSectionSchema } from '../../../src/shared/estimate'
import { collectingLogger } from './collectingLogger'

export const ESTIMATE_AS_OF = '2026-10-17T00:00:00.000Z'

/** The snapshot binding every shell assembles (M117 C-M117-1): the
production loader, lazy, so no bundle loads unless a snapshot is asked
for (these probes only read prices, so none ever is). */
export function estimateSnapshotBinding() {
  return planSnapshotLoader({
    bundlePath: 'dist/planSnapshot.js',
    log: collectingLogger([]),
    root: process.cwd(),
  })
}

export function estimatePricePorts() {
  return estimatorSourcePorts(
    () => ({
      enabled: true,
      networkAllowed: false,
      maxAgeMs: 60_000,
      catalogUrls: [],
    }),
    estimateSnapshotBinding(),
  ).prices()
}

export async function catalogOptionsRefusal(asOf: string = ESTIMATE_AS_OF): Promise<Error> {
  try {
    await lookupEstimatePrices(
      {
        asOf,
        enabled: true,
        networkAllowed: false,
        maxAgeMs: 60_000,
        catalogUrls: ['https://example.com/a.json', 'https://example.com/a.json'],
      },
      estimatePricePorts(),
    )
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('lookup did not refuse duplicate catalogs')
}

export function estimateContractFailure(): Error {
  try {
    estimateSectionSchema.parse({})
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error('section schema accepted an empty object')
}
