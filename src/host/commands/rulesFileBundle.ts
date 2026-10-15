// The Create AGENTS.md command as the activation bundle sees it (PLAN.md D6,
// D15): dist/rulesFile.js, built from rulesFileEntry.ts and required the first
// time that command runs. Only types come from the entry's side here: a value
// imported from there would carry the command back into dist/extension.js,
// which the bundle-split gate refuses.
//
// A missing or damaged bundle refuses the command (the log has the cause)
// and the next run tries again.
import type * as Entry from './rulesFileEntry'
import { requireFile } from '../lazyBundle'

export interface RulesFileBundle {
  readonly createRulesFile: typeof Entry.createRulesFile
}

/** Signatures are trusted only for our same-build packaged entry (PLAN.md section 8). */
export function isRulesFileBundle(value: unknown): value is RulesFileBundle {
  return (
    typeof value === 'object' &&
    value !== null &&
    'createRulesFile' in value &&
    typeof value.createRulesFile === 'function'
  )
}

/** The bundle, or undefined when it cannot be loaded (the command refuses). */
export function loadRulesFileBundle(
  bundlePath: string,
  loadBundle: (file: string) => unknown = requireFile,
): RulesFileBundle | undefined {
  let loaded: unknown
  try {
    loaded = loadBundle(bundlePath)
  } catch {
    return undefined
  }
  return isRulesFileBundle(loaded) ? loaded : undefined
}
