import type { UiText } from '../../shared/l10n/en'
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
  // `runExec` reads the table copy bundled into dist/headless.js, while this
  // entry's own copy lives in dist/exec.js: installing here would leave every
  // exec result sentence (and, through it, the engine's) in English.
  setHeadlessUiText(table, locale)
  return await runExec(lifecycle, { ...deps, outputSchema: execOutputSchemaPort })
}
