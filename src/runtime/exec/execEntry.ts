import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'
import type { Lifecycle } from './execLimits'
import { execOutputSchemaPort, runExec, type ExecDeps } from './runExec'

/** The trusted headless runner loads only for exec and owns no credential globals. */
export async function runHeadless(
  lifecycle: Lifecycle,
  deps: ExecDeps,
  table: UiText,
  locale: string,
): Promise<number> {
  setUiText(table, locale)
  return await runExec(lifecycle, { ...deps, outputSchema: execOutputSchemaPort })
}
