import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { configureResources } from '../../core/resources/admission'
import type * as ResourceGovernor from '../../core/resources/resourceGovernorEntry'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import { runtimeWindowsJob } from '../resources/jobs'

function resourceFailure(): void {
  process.stderr.write('vault-resource-refused\n')
}

/**
The governor behind every broker admission. The installed entry and the
session fixture children run this same wiring over their own generated
paths, so a fixture broker admits exactly the way the product does. The
loader differs only by packaging (the installed dist sibling versus a
fixture bundle's static import); the validated export is the same typed
build boundary either way. The D243 feeder runs it over its own
registry directory, like every other governed vault child.
*/
export async function configureBrokerResources(
  context: { dataDir: string; runDirectory: string; installRoot: string },
  loadGovernor: () => Promise<Pick<typeof ResourceGovernor, 'createResources'>>,
): Promise<() => void> {
  // Same-build governor factory; validate its export before use (PLAN §8).
  const module = await loadGovernor()
  if (typeof module.createResources !== 'function') throw new TypeError(UI_TEXT.vault.brokerBlocked)
  const resources = await module.createResources(
    {
      machineDir: path.dirname(context.dataDir),
      sleep: async (ms) => {
        await delay(ms)
      },
      onError: resourceFailure,
    },
    UI_TEXT,
    uiLocale(),
  )
  const disposeAdmission = configureResources({
    // The broker owns a separate creation registry; live editor registries must not overwrite it.
    registryFile: path.join(context.runDirectory, 'resource-created', 'registry.json'),
    inspect: () => ({}),
    onError: resourceFailure,
    admission: async (request, signal) => {
      await resources.status(signal)
      signal?.throwIfAborted()
      return await resources.admit(request, undefined, signal)
    },
    // Windows records each governed child through the job helpers, as the
    // runtime does: without them the guarded pipe helper never launches.
    windowsJob: runtimeWindowsJob(path.dirname(context.dataDir), context.installRoot),
  })
  return () => {
    disposeAdmission()
    resources.dispose()
  }
}
