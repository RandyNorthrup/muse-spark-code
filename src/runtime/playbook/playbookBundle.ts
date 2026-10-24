import { lazyBundleLoader } from '../../host/lazyBundle'
import type { CoreLogger } from '../../core/logging'
import { UI_TEXT } from '../../shared/constants'
import type * as PlaybookBundle from './playbookEntry'

type Bundle = typeof PlaybookBundle
/**
The slice a `/playbook` answer drives, in every editor: the read-only
grammar and the journal surface. The VS Code window's own bundle serves it
too, without the headless run (D219), which only the CLI loads.
*/
export type PlaybookAnswerSlice = Pick<
  Bundle,
  'parsePlaybookCommand' | 'createPlaybookSurface' | 'runPlaybookCommand' | 'runPlaybookCli'
>

/** Same-build signatures are trusted after checking every function the slice exports (PLAN §8). */
export function isPlaybookAnswerSlice(value: unknown): value is PlaybookAnswerSlice {
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

/** The CLI's whole journal bundle: the answer slice and the headless run (PLAN §8). */
export function isPlaybookBundle(value: unknown): value is Bundle {
  return (
    isPlaybookAnswerSlice(value) &&
    'runPlaybookCheckCli' in value &&
    typeof value.runPlaybookCheckCli === 'function'
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
