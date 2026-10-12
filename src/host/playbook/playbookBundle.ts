// The window's playbook as the activation bundle sees it (M116, lane
// C-M116-6; PLAN.md D6): dist/playbook.js, required the first time anything
// of the playbook is used. Only types come from the entry here: a value
// imported from there would carry the policy into dist/extension.js, which
// the bundle-split gate refuses.

import { statSync } from 'node:fs'
import path from 'node:path'
import { PLAYBOOK_RECORD_FOLDER, UI_TEXT } from '../../shared/constants'
import { lazyBundleLoader } from '../lazyBundle'
import type { Logger } from '../logger'
import type * as PlaybookEntry from './playbookEntry'
import type { PlaybookPanel, PlaybookPanelGap } from './playbookPanel'

/** Whether a required module is the window's playbook bundle (PLAN.md §8). */
export function isPlaybookWindowBundle(value: unknown): value is typeof PlaybookEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createPlaybookWindow' in value &&
    typeof value.createPlaybookWindow === 'function'
  )
}

/**
 * The panel's channel to the window's playbook, over a bundle that may not
 * load. The loader logs why; the panel is answered `playbookFailed` (the
 * word `panelWire.ts` gives a hello that could not be answered), so the
 * Agent map says the playbook is unavailable and offers to ask again. It is
 * never left without an answer, which is what a host with no playbook gives.
 */
export function playbookPanelChannel(
  load: () => { readonly panel: PlaybookPanel },
): (message: unknown, reply: (answer: unknown) => void, hasSpawnGap: PlaybookPanelGap) => void {
  return (message, reply, hasSpawnGap) => {
    try {
      void load().panel(message, reply, hasSpawnGap)
    } catch {
      reply({ type: 'playbookFailed' })
    }
  }
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

/** Decide presence before loading any policy; unreadable means present and fails in the bundle. */
export function hasWindowPlaybook(agentDataFolder: string): boolean {
  try {
    statSync(path.join(agentDataFolder, PLAYBOOK_RECORD_FOLDER))
    return true
  } catch (error) {
    return !(
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    )
  }
}
