import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { Lifecycle } from './execLimits'
import {
  execOutputSchemaPort,
  runExec,
  setUiText as setHeadlessUiText,
  type ExecDeps,
} from './runExec'

/** The trusted headless runner loads only for exec and owns no credential globals. */
export async function runHeadless(
  lifecycle: Lifecycle,
  deps: ExecDeps,
  table: UiText,
  locale: string,
): Promise<number> {
  // Two copies of the table state ship in this process: this entry's own
  // (dist/exec.js, which the split gate requires on the shared table) and
  // the one `runExec` reads (dist/headless.js). The install that matters is
  // the second: without it every exec result sentence (and, through it, the
  // engine's) stays English.
  setUiText(table, locale)
  setHeadlessUiText(table, locale)
  return await runExec(lifecycle, { ...deps, outputSchema: execOutputSchemaPort })
}
