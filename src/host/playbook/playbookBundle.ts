// The window's playbook as the activation bundle sees it (M116, lane
// C-M116-6; PLAN.md D6): dist/playbook.js, required the first time anything
// of the playbook is used. Only types come from the entry here: a value
// imported from there would carry the policy into dist/extension.js, which
// the bundle-split gate refuses.

import { UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as PlaybookEntry from './playbookEntry'

/** Whether a required module is the window's playbook bundle (PLAN.md §8). */
export function isPlaybookWindowBundle(value: unknown): value is typeof PlaybookEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPlaybookWindow' in value &&
    typeof value.createPlaybookWindow === 'function'
  )
}

/** The bundle, required on first use; a missing or wrong file is unavailable, and tried again. */
export function playbookWindowLoader(bundlePath: string, log: Logger): () => typeof PlaybookEntry {
  return lazyBundleLoader({
    bundlePath,
    log,
    isBundle: isPlaybookWindowBundle,
    label: 'playbook',
    unavailable: () => UI_TEXT.playbookUnavailable,
  })
}
