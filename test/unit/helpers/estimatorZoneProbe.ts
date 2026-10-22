// Time-zone probe bundle entry. test/unit/estimatorFleetFactsReview.test.ts
// bundles this file and runs the bundle in child processes under different
// TZ values to prove byte-identical forecasts; the test passes the shared
// instant through the child's environment next to TZ, so the bundle itself
// is identical on every run.
import { applyFleetBinding } from '../../../src/host/estimator/fleetBinding'
import { fleetFromHost } from '../../../src/host/estimator/localFleet'
import { simulateEstimate } from '../../../src/core/estimator/simulate'
import { lognormalPort, scheduleLane, simulationInputs } from './estimatorKindScheduleFixtures'

const asOf: string = process.env['RLM117_ZONE_PROBE_AS_OF'] ?? ''
if (asOf === '') throw new Error('zone probe needs RLM117_ZONE_PROBE_AS_OF')

async function main(): Promise<void> {
  const lane = scheduleLane('A')
  const fleet = await applyFleetBinding(
    fleetFromHost({ platform: 'linux', arch: 'x64', cores: 4, ramGiB: 8 }, [lane], asOf),
    {
      activeAccount: () => ({
        kind: 'limits',
        generation: '1',
        accountId: 'private-id',
        providerId: 'meta',
        label: 'Work',
        snapshot: {
          planWindows: { weekly: { usedPercent: 90, resetAt: '2026-10-06T13:00:00.000Z' } },
        },
      }),
    },
  )
  const input = simulationInputs([lane], fleet)
  delete input.request.seed
  process.stdout.write(JSON.stringify({ fleet, forecast: simulateEstimate(input, lognormalPort) }))
}

void main()
