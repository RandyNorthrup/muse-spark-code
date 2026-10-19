// The Muse Code backend's shipped bundle (PR206, PLAN.md D6): esbuild
// builds this file into dist/museCode.js, which the backend manager and the
// account host require the first time that backend starts, so the host, its
// notification mapping and the SDK stay out of the bundle VS Code loads at
// activation. It receives the installed display table, since the notices it
// leaves are said in it.

import type { UiText } from '../../shared/l10n/en'
import { setUiText } from '../../shared/l10n/text'

export {
  MuseCodeHost,
  museCodeEffortPort,
  spawnAccountMspConnection,
} from '../../core/backends/musecode/MuseCodeHost'
// Deep SDK import, never the barrel (see MuseCodeHost.ts): the barrel's
// unused layers would ride into dist/museCode.js.
export { spawnMspConnection } from '@muse-code/sdk/dist/src/connection/spawn.js'

/** Installs the activation bundle's table before the bundle builds anything. */
export function installMuseCodeUiText(table: UiText, locale: string): void {
  setUiText(table, locale)
}
