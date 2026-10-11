import { lazyBundleLoader } from '../../host/lazyBundle'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/constants'
import type * as PlaybookBundle from './playbookEntry'

type Bundle = typeof PlaybookBundle
/** Same-build signatures are trusted after checking every exported function (PLAN §8). */
export function isPlaybookBundle(value: unknown): value is Bundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parsePlaybookCommand' in value &&
    typeof value.parsePlaybookCommand === 'function' &&
    'createPlaybookSurface' in value &&
    typeof value.createPlaybookSurface === 'function' &&
    'runPlaybookCommand' in value &&
    typeof value.runPlaybookCommand === 'function' &&
    'runPlaybookCli' in value &&
    typeof value.runPlaybookCli === 'function'
  )
}

export function playbookLoader(bundlePath: string, log: CoreLogger) {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPlaybookBundle,
    label: 'Playbook',
    unavailable: () => UI_TEXT.playbookUnavailable,
  })
}
