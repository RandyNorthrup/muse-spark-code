// The runtime panel's heavier ports as the session bundle sees them (M104
// lane B, PLAN.md D6): dist/runtimePanelPorts.js, built from portsEntry.ts and
// required the first time a port is used. Only types come from the entry's
// side here: a value imported from there would carry the port back into
// dist/runtimePanelSession.js, which has no room for it.
//
// A missing or damaged bundle refuses the port with the reason (the log has
// the cause), and the next use tries again.
import type { PlanFiles } from '../../host/conversation/conversationController'
import { lazyBundleLoader } from '../../host/lazyBundle'
import type { Logger } from '../../host/logger'
import { UI_TEXT } from '../../shared/constants'
import { uiLocale } from '../../shared/l10n/text'
import type * as Entry from '../panel/portsEntry'

interface PortsBundle {
  readonly createPlans: typeof Entry.createPlans
}

function isPortsBundle(value: unknown): value is PortsBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPlans' in value &&
    typeof value.createPlans === 'function'
  )
}

export interface LazyPlansDeps {
  /** dist/runtimePanelPorts.js beside the running bundle. */
  readonly bundlePath: string
  readonly log: Logger
  /** What the plans are built from; see `RuntimePlansDeps`. */
  readonly plans: Parameters<PortsBundle['createPlans']>[0]
}

/**
Saved plans, the bundle required the first time any of them is used and the
plans kept from then on. A plan action refuses with the reason when the bundle
cannot load, rather than skip the plan reader's check.
*/
export function lazyPlans(deps: LazyPlansDeps): PlanFiles {
  const load = lazyBundleLoader({
    bundlePath: deps.bundlePath,
    log: deps.log,
    isBundle: isPortsBundle,
    label: 'runtime panel ports bundle',
    unavailable: () => UI_TEXT.hostService.notAvailable,
  })
  let plans: PlanFiles | undefined
  const loaded = (): PlanFiles => {
    plans ??= load().createPlans(deps.plans, UI_TEXT, uiLocale())
    return plans
  }
  return {
    find: async (content) => await loaded().find(content),
    save: async (content, ownerRecorder) => await loaded().save(content, ownerRecorder),
    has: async (fileName) => await loaded().has(fileName),
    read: async (fileName) => await loaded().read(fileName),
    list: async () => await loaded().list(),
    confirmSave: async () => await loaded().confirmSave(),
    choose: async (summaries) => await loaded().choose(summaries),
    markdown: () => loaded().markdown(),
  }
}
