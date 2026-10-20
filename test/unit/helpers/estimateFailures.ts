// Shared real-code probes for the estimate failure-boundary tests (D119):
// a duplicate-catalog refusal and a contract failure from the real
// estimator modules, never fakes.
import { lookupEstimatePrices } from '../../../src/core/estimator/prices'
import { estimatorSourcePorts } from '../../../src/host/estimator/localFleet'
import { createPlanSnapshotSource } from '../../../src/host/estimator/planSnapshotSource'
import { estimateSectionSchema } from '../../../src/shared/estimate'

export const ESTIMATE_AS_OF = '2026-10-17T00:00:00.000Z'

export function estimatePricePorts() {
  return estimatorSourcePorts(
    () => ({
      enabled: true,
      networkAllowed: false,
      maxAgeMs: 60_000,
      catalogUrls: [],
    }),
    createPlanSnapshotSource({ root: '' }),
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
