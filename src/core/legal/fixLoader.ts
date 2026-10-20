import { UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import type * as LegalFix from './legalFixEntry'
import { LegalScanError } from './files'

/**
The header-fix planner from the fix chunk (dist/legalFix.js, D6): a scan
or fix request with nothing fixable never loads it. A request that needs
it and cannot load it is refused, never silently unpatched. This loader
lives beside the scanner instead of in it so the scan side keeps no
static edge into the fix subgraph it dynamically loads.
*/
export async function loadFixPlanner(): Promise<typeof LegalFix.prepareLegalHeaderPatches> {
  try {
    const fix = await import('./legalFixEntry.js')
    return fix.prepareLegalHeaderPatches
  } catch (error) {
    throw new LegalScanError(
      fill(UI_TEXT.legalScanFailed, {
        reason: error instanceof Error ? error.message : String(error),
      }),
      { cause: error },
    )
  }
}
